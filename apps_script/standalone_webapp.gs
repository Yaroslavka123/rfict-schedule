/**
 * Google Apps Script — альтернатива Python-скрипту.
 *
 * Что делает:
 *  1. Парсит rct.bsu.by/education, собирает ID всех Sheets с расписанием.
 *  2. Открывает каждую таблицу, конвертит в тот же JSON (schedule.schema.json).
 *  3. Раздаёт JSON через doGet() как Web App — Go-бэкенд просто делает GET.
 *
 * Деплой:
 *  - script.google.com -> новый проект -> вставить этот файл
 *  - Deploy -> New deployment -> Web app -> Anyone -> Deploy
 *  - Получите URL вида https://script.google.com/macros/s/AKfyc.../exec
 *  - Trigger (часы) -> Add trigger -> updateSchedule -> Time-driven -> Hour timer
 *
 * Лимиты: 6 мин на запуск, 20 тыс. вызовов/день — для расписания с запасом.
 */

const EDU_URL = "https://rct.bsu.by/education";
const CACHE_KEY = "schedule_v1";
const CACHE_TTL = 3600; // секунд

const DAY_MAP = {
  "пн": 1, "понедельник": 1, "monday": 1,
  "вт": 2, "вторник": 2, "tuesday": 2,
  "ср": 3, "среда": 3, "wednesday": 3,
  "чт": 4, "четверг": 4, "thursday": 4,
  "пт": 5, "пятница": 5, "friday": 5,
  "сб": 6, "суббота": 6, "saturday": 6,
};

/** Точка входа Web App. Возвращает кэшированный JSON. */
function doGet() {
  const cache = CacheService.getScriptCache();
  let payload = cache.get(CACHE_KEY);
  if (!payload) {
    payload = JSON.stringify(buildSchedule());
    cache.put(CACHE_KEY, payload, CACHE_TTL);
  }
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

/** Триггер по расписанию — пересобирает кэш. */
function updateSchedule() {
  const json = JSON.stringify(buildSchedule());
  CacheService.getScriptCache().put(CACHE_KEY, json, CACHE_TTL);
  // Опционально: сохранить в Drive как файл, который раздаётся напрямую
  // DriveApp.getFileById(FILE_ID).setContent(json);
}

function buildSchedule() {
  const sheets = discoverSheets();
  const groups = [];
  const lessons = [];
  for (const s of sheets) {
    const rows = fetchSheetAsRows(s.sheet_id, s.gid);
    if (s.kind === "bachelor") {
      const r = parseBachelor(rows, s.year);
      groups.push(...r.groups);
      lessons.push(...r.lessons);
    } else {
      const lang = s.kind === "master_ru" ? "ru" : "en";
      const r = parseMaster(rows, s.year, lang);
      groups.push(...r.groups);
      lessons.push(...r.lessons);
    }
  }
  return {
    academic_year: "2025-2026",
    faculty: "ФРФиКТ",
    semester: 2,
    form: "очная",
    generated_at: new Date().toISOString(),
    source: { type: "google_sheets", sheets: sheets },
    groups: groups,
    lessons: lessons,
  };
}

/** Парс rct.bsu.by → список таблиц. */
function discoverSheets() {
  const html = UrlFetchApp.fetch(EDU_URL, { muteHttpExceptions: true }).getContentText();
  const re = /<a[^>]*href="(https:\/\/docs\.google\.com\/spreadsheets\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out = [];
  const seen = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const cls = classify(text);
    if (!cls) continue;
    const idM = href.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    const gidM = href.match(/[?&#]gid=(\d+)/);
    if (!idM) continue;
    const key = cls.year + ":" + cls.kind;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({
      year: cls.year,
      kind: cls.kind,
      sheet_id: idM[1],
      gid: gidM ? gidM[1] : "0",
    });
  }
  return out;
}

function classify(text) {
  const t = text.toLowerCase();
  if (/cybersecurity|master degree/.test(t)) return { year: 4, kind: "master_en" };
  if (/магистрат/.test(t)) return { year: 4, kind: "master_ru" };
  const m = t.match(/(\d)\s*курс/);
  if (m) {
    const y = parseInt(m[1], 10);
    if (y >= 1 && y <= 4) return { year: y, kind: "bachelor" };
  }
  return null;
}

/** Прочитать sheet по ID/GID как двумерный массив строк. */
function fetchSheetAsRows(sheetId, gid) {
  // Используем встроенный API — не нужны OAuth-токены для своих таблиц,
  // но эти таблицы публичные, поэтому ходим через CSV-export как и в Python.
  const url = "https://docs.google.com/spreadsheets/d/" + sheetId +
              "/export?format=csv&gid=" + gid;
  const csv = UrlFetchApp.fetch(url).getContentText();
  return Utilities.parseCsv(csv);
}

/** Урезанная версия parse_bachelor из parse_schedule.py. */
function parseBachelor(rows, year) {
  const progRow = rows[3] || [];
  const grpRow  = rows[4] || [];
  const groupCols = [];
  let lastProg = null;
  for (let col = 0; col < grpRow.length; col++) {
    if (progRow[col] && progRow[col].trim()) lastProg = progRow[col].trim();
    const m = (grpRow[col] || "").match(/^\s*Группа\s+(\S+)/);
    if (m) groupCols.push({ col: col, num: m[1].trim(), prog: lastProg });
  }
  const groups = groupCols.map(g => ({
    id: "y" + year + "-g" + g.num,
    year: year,
    number: /^\d+$/.test(g.num) ? parseInt(g.num, 10) : g.num,
    program_code: g.prog || null,
    program_name: null,
    language: "ru",
  }));
  const lessons = [];
  let currentDay = null;
  for (let r = 5; r < rows.length; r++) {
    const row = rows[r] || [];
    const d = parseDay(row[0] || "");
    if (d) currentDay = d;
    if (!currentDay) continue;
    const pair = /^\d+$/.test((row[1] || "").trim()) ? parseInt(row[1], 10) : null;
    const tr = parseTimeRange(row[2] || "");
    if (!tr.start || !tr.end) continue;
    for (const g of groupCols) {
      const cell = row[g.col] || "";
      const room = row[g.col + 1] || "";
      if (!cell.trim()) continue;
      lessons.push(buildLessonCell(cell, room, currentDay, pair, tr.start, tr.end,
                                   "y" + year + "-g" + g.num));
    }
  }
  return { groups: groups, lessons: lessons.filter(Boolean) };
}

function parseDay(v) {
  const k = (v || "").toLowerCase().replace(/\s*\(.+?\)\s*/g, "").trim();
  return DAY_MAP[k] || null;
}
function parseTimeRange(v) {
  const ms = (v || "").match(/\d{1,2}:\d{2}/g) || [];
  return { start: ms[0] ? pad(ms[0]) : null, end: ms[1] ? pad(ms[1]) : null };
}
function pad(t) { const p = t.split(":"); return ("0" + p[0]).slice(-2) + ":" + p[1]; }

function buildLessonCell(text, room, day, pair, ts, te, gid) {
  const lines = (text || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  const subject = lines.filter(l => !/^(по|с)\s+\d|^доц\.|^ст\.пр\.|^асс\.|^пр\.ст\./.test(l)).join(" ").trim() || lines[0];
  const teacher = lines.find(l => /^(доц\.|ст\.пр\.|пр\.ст\.|асс\.|проф\.|преп\.)/.test(l)) || null;
  const notes = lines.find(l => /^(по|с)\s+\d|^отмен|^доп|^отработ/.test(l)) || null;
  const id = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    [gid, day, pair, ts, subject].join("|")
  ).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("").slice(0, 12);
  return {
    id: id,
    group_ids: [gid],
    day_of_week: day,
    pair_number: pair,
    time_start: ts,
    time_end: te,
    subject: subject,
    lesson_type: null,
    teacher: teacher,
    rooms: (room || "").split(/[\n,;]/).map(s => s.trim()).filter(Boolean),
    subgroup: null,
    weeks: "all",
    date_from: null,
    date_to: null,
    notes: notes,
    raw: text,
  };
}

/** Магистратура — для скрипта оставим заглушку: возвращаем «сырой» массив. */
function parseMaster(rows, year, lang) {
  // Для краткости — полная логика см. parse_schedule.py
  return { groups: [], lessons: [] };
}
