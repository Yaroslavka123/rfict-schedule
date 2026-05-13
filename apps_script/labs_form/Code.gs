/**
 * РФиКТ — структурированная форма ввода занятий.
 *
 * Привязывается к Google Sheets с расписанием.
 * Добавляет в меню пункт «Расписание → Добавить занятие», открывает sidebar
 * с кнопками типа (Лекция / ЛБ / ПЗ / Семинар / Куратор / ДО), и
 * автоматически заполняет активную ячейку правильным форматом:
 *   - правильный цвет фона по типу занятия
 *   - название предмета жирным шрифтом
 *   - аккуратные переносы строк
 *   - аудитория в соседней колонке справа
 *
 * Подробности по установке: см. README.md в этой же папке.
 */

const LESSON_TYPES = [
  {code: 'lecture',      label: 'Лекция',  short: 'ЛК',  color: '#d9ead3'}, // зелёный
  {code: 'lab',          label: 'Лаб.',    short: 'ЛБ',  color: '#fce5cd'}, // оранжевый
  {code: 'practice',     label: 'Практ.',  short: 'ПЗ',  color: '#c9daf8'}, // синий
  {code: 'seminar',      label: 'Семинар', short: 'Сем', color: '#ffffff'}, // белый (как сейчас)
  {code: 'curator_hour', label: 'Куратор', short: 'КЧ',  color: '#fff2cc'}, // жёлтый
  {code: 'additional',   label: 'ДО',      short: 'ДО',  color: '#d9d2e9'}, // фиолетовый
];

const DICT_SHEET_NAME = 'Справочники';

// ──────────────────────────────────────────────────────────────────────────
// GitHub Actions dispatch (обновление schedule.json по событию)
// ──────────────────────────────────────────────────────────────────────────

const GH_REPO_OWNER = 'Yaroslavka123';
const GH_REPO_NAME  = 'rfict-schedule';
const GH_EVENT_TYPE = 'sheets-edited';

// Минимальный интервал между dispatch-запросами (мс).
// Защита от спама при быстрых последовательных правках.
const DISPATCH_COOLDOWN_MS = 30 * 1000; // 30 сек
const SUBJECT_COL = 1; // A
const TEACHER_COL = 2; // B
const ROOM_COL = 3;    // C

// ──────────────────────────────────────────────────────────────────────────
// Меню и sidebar
// ──────────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Расписание')
    .addItem('➕ Добавить / редактировать занятие', 'showSidebar')
    .addItem('🧹 Очистить активную ячейку', 'clearActiveCell')
    .addSeparator()
    .addItem('📋 Открыть справочник', 'openDictionarySheet')
    .addItem('🔄 Пересоздать справочник из таблицы', 'rebuildDictionaryFromSheet')
    .addSeparator()
    .addItem('⚡ Обновить расписание сейчас', 'manualDispatch')
    .addToUi();
}

function showSidebar() {
  ensureDictionarySheet();
  const html = HtmlService
    .createHtmlOutputFromFile('Sidebar')
    .setTitle('Занятие')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ──────────────────────────────────────────────────────────────────────────
// Клиент → сервер: данные для формы
// ──────────────────────────────────────────────────────────────────────────

/**
 * Возвращает информацию об активной ячейке + содержимое (если уже заполнена).
 * Используется при открытии sidebar — чтобы форма знала, добавлять или редактировать.
 */
function getActiveCellInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (!cell) return { error: 'Не выбрана ячейка', types: LESSON_TYPES };

  const row = cell.getRow();
  const col = cell.getColumn();

  const value = cell.getValue();
  const richText = cell.getRichTextValue();
  const background = (cell.getBackground() || '').toLowerCase();
  const roomCell = sheet.getRange(row, col + 1);
  const roomValue = roomCell.getValue();

  const parsed = parseCellContent_(value, richText, background);

  return {
    sheet: sheet.getName(),
    row: row,
    col: col,
    background: background,
    value: String(value || ''),
    roomValue: String(roomValue || ''),
    parsed: parsed,
    types: LESSON_TYPES,
  };
}

/**
 * Возвращает словари для autocomplete.
 */
function getDictionaries() {
  const sheet = ensureDictionarySheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {subjects: [], teachers: [], rooms: []};
  }
  const range = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const subjects = uniqueNonEmpty_(range.map(r => r[0]));
  const teachers = uniqueNonEmpty_(range.map(r => r[1]));
  const rooms    = uniqueNonEmpty_(range.map(r => r[2]));
  return {subjects, teachers, rooms};
}

// ──────────────────────────────────────────────────────────────────────────
// Применение формы → запись в ячейку
// ──────────────────────────────────────────────────────────────────────────

/**
 * Записывает занятие в активную ячейку.
 * data: {
 *   lesson_type: 'lecture'|'lab'|'practice'|'seminar'|'curator_hour'|'additional',
 *   subject: string,
 *   lab_number: string | null,
 *   teacher: string,           // основной преподаватель (если один)
 *   teachers_by_subgroup: [{subgroup: '1ПГ', teacher: '…', room: '…'}],  // для лабы
 *   subgroup: string,          // '1ПГ нечет' и т.п. (для не-лабы)
 *   room: string,
 *   notes: string,
 * }
 */
function applyLesson(data) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (!cell) throw new Error('Не выбрана ячейка. Кликни на ячейку в таблице.');
  const row = cell.getRow();
  const col = cell.getColumn();

  const type = LESSON_TYPES.find(t => t.code === data.lesson_type);
  if (!type) throw new Error('Неизвестный тип занятия: ' + data.lesson_type);
  if (!data.subject || !data.subject.trim()) throw new Error('Не указан предмет.');

  // Сборка многострочного текста
  const lines = [];
  if (data.notes && data.notes.trim()) lines.push(data.notes.trim());
  lines.push(data.subject.trim());

  // Для лабы — собираем по подгруппам, для остального — обычный путь
  let roomLines = [];
  if (data.lesson_type === 'lab' && data.teachers_by_subgroup && data.teachers_by_subgroup.length > 0) {
    data.teachers_by_subgroup.forEach(sg => {
      if (sg.subgroup) lines.push(sg.subgroup);
      if (sg.teacher)  lines.push(sg.teacher);
      roomLines.push(sg.room || '');
    });
  } else {
    if (data.subgroup && data.subgroup.trim()) lines.push(data.subgroup.trim());
    if (data.teacher && data.teacher.trim()) lines.push(data.teacher.trim());
    if (data.room && data.room.trim()) roomLines.push(data.room.trim());
  }

  const text = lines.join('\n');

  // Жирный шрифт у строк предмета (одна или две строки: предмет может быть многострочным)
  const subjectLines = data.subject.trim().split('\n');
  const subjectStartLine = data.notes && data.notes.trim() ? 1 : 0;
  const subjectStartIdx = lines.slice(0, subjectStartLine).join('\n').length + (subjectStartLine ? 1 : 0);
  const subjectEndIdx = subjectStartIdx + subjectLines.join('\n').length;

  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  builder.setTextStyle(
    subjectStartIdx, subjectEndIdx,
    SpreadsheetApp.newTextStyle().setBold(true).build()
  );
  // Курсивом — даты-заметки (если есть)
  if (data.notes && data.notes.trim()) {
    builder.setTextStyle(
      0, data.notes.trim().length,
      SpreadsheetApp.newTextStyle().setItalic(true).build()
    );
  }

  cell.setRichTextValue(builder.build());
  cell.setBackground(type.color);
  cell.setVerticalAlignment('middle');
  cell.setHorizontalAlignment('center');
  cell.setWrap(true);

  // Аудитория — в соседнюю клетку справа
  const roomCell = sheet.getRange(row, col + 1);
  if (roomLines.length === 0) {
    roomCell.clearContent();
  } else {
    roomCell.setValue(roomLines.join('\n'));
    roomCell.setBackground(type.color);
    roomCell.setVerticalAlignment('middle');
    roomCell.setHorizontalAlignment('center');
    roomCell.setWrap(true);
  }

  // Сохраняем введённые значения в справочник (если их там ещё нет)
  appendToDictionary_({
    subject: data.subject,
    teachers: collectTeachers_(data),
    rooms: collectRooms_(data),
  });

  // Dispatch GitHub Action для обновления schedule.json
  dispatchScheduleUpdate_('form:applyLesson', cellAddress_(row, col));

  return {ok: true, cell: cellAddress_(row, col)};
}

/**
 * Записывает занятие и переводит курсор на следующую строку.
 */
function applyLessonAndMoveDown(data) {
  const result = applyLesson(data);
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (cell) {
    const next = sheet.getRange(cell.getRow() + 1, cell.getColumn());
    sheet.setCurrentCell(next);
  }
  return result;
}

function manualDispatch() {
  dispatchScheduleUpdate_('manual-menu', '');
  SpreadsheetApp.getUi().alert(
    'Запрос на обновление расписания отправлен в GitHub Actions.\n'
    + 'schedule.json обновится через ~30-40 секунд.'
  );
}

function clearActiveCell() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (!cell) throw new Error('Не выбрана ячейка.');
  const roomCell = sheet.getRange(cell.getRow(), cell.getColumn() + 1);
  cell.clearContent();
  cell.setBackground(null);
  roomCell.clearContent();
  roomCell.setBackground(null);
}

// ──────────────────────────────────────────────────────────────────────────
// Справочник предметов / преподов / аудиторий
// ──────────────────────────────────────────────────────────────────────────

function openDictionarySheet() {
  const sheet = ensureDictionarySheet();
  SpreadsheetApp.setActiveSheet(sheet);
}

function ensureDictionarySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DICT_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(DICT_SHEET_NAME);
  sheet.getRange(1, 1, 1, 3).setValues([['Предмет', 'Преподаватель', 'Аудитория']]);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#f3f3f3');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 100);
  return sheet;
}

/** Пересоздаёт справочник из всех листов с занятиями (на случай первого запуска). */
function rebuildDictionaryFromSheet() {
  const sheet = ensureDictionarySheet();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const subjects = new Set();
  const teachers = new Set();
  const rooms = new Set();

  ss.getSheets().forEach(s => {
    if (s.getName() === DICT_SHEET_NAME) return;
    const values = s.getDataRange().getValues();
    const richValues = s.getDataRange().getRichTextValues();
    values.forEach((row, rowIdx) => {
      row.forEach((cellValue, colIdx) => {
        const str = String(cellValue || '').trim();
        if (!str) return;
        const richCell = richValues[rowIdx] && richValues[rowIdx][colIdx];
        const subj = extractSubjectFromRich_(richCell, str);
        if (subj) subjects.add(subj);
        str.split('\n').forEach(line => {
          line = line.trim();
          if (looksLikeTeacher_(line)) teachers.add(line);
          if (looksLikeRoom_(line)) rooms.add(line);
        });
      });
    });
  });

  // Очищаем (кроме шапки)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }

  const maxLen = Math.max(subjects.size, teachers.size, rooms.size);
  if (maxLen === 0) return;

  const subjArr = [...subjects].sort();
  const teachArr = [...teachers].sort();
  const roomArr  = [...rooms].sort();

  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      subjArr[i] || '',
      teachArr[i] || '',
      roomArr[i] || '',
    ]);
  }
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  SpreadsheetApp.getUi().alert(`Справочник обновлён: предметов ${subjArr.length}, преподов ${teachArr.length}, аудиторий ${roomArr.length}`);
}

function appendToDictionary_(items) {
  const sheet = ensureDictionarySheet();
  const lastRow = Math.max(sheet.getLastRow(), 1);

  const existingSubjects = new Set();
  const existingTeachers = new Set();
  const existingRooms = new Set();
  if (lastRow > 1) {
    const range = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    range.forEach(r => {
      if (r[0]) existingSubjects.add(String(r[0]).trim());
      if (r[1]) existingTeachers.add(String(r[1]).trim());
      if (r[2]) existingRooms.add(String(r[2]).trim());
    });
  }

  const toAddSubj = items.subject && !existingSubjects.has(items.subject.trim()) ? [items.subject.trim()] : [];
  const toAddTeach = (items.teachers || []).filter(t => t && !existingTeachers.has(t.trim())).map(t => t.trim());
  const toAddRooms = (items.rooms || []).filter(r => r && !existingRooms.has(r.trim())).map(r => r.trim());

  if (!toAddSubj.length && !toAddTeach.length && !toAddRooms.length) return;

  const maxLen = Math.max(toAddSubj.length, toAddTeach.length, toAddRooms.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      toAddSubj[i] || '',
      toAddTeach[i] || '',
      toAddRooms[i] || '',
    ]);
  }
  sheet.getRange(lastRow + 1, 1, rows.length, 3).setValues(rows);
}

// ──────────────────────────────────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────────────────────────────────

function collectTeachers_(data) {
  const out = [];
  if (data.teacher) out.push(data.teacher);
  (data.teachers_by_subgroup || []).forEach(sg => sg.teacher && out.push(sg.teacher));
  return out;
}

function collectRooms_(data) {
  const out = [];
  if (data.room) out.push(data.room);
  (data.teachers_by_subgroup || []).forEach(sg => sg.room && out.push(sg.room));
  return out;
}

function uniqueNonEmpty_(arr) {
  const seen = new Set();
  const out = [];
  arr.forEach(v => {
    const s = String(v || '').trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out.sort();
}

function cellAddress_(row, col) {
  return columnToLetter_(col) + row;
}

function columnToLetter_(col) {
  let s = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

/**
 * Пытается распознать тип занятия по цвету фона.
 */
function detectLessonType_(background) {
  if (!background) return null;
  const bg = background.toLowerCase();
  for (let i = 0; i < LESSON_TYPES.length; i++) {
    if (LESSON_TYPES[i].color.toLowerCase() === bg) return LESSON_TYPES[i].code;
  }
  return null;
}

/**
 * Очень грубо парсит уже существующую ячейку, чтобы при редактировании форма
 * не была пустой. Идеального парсинга не нужно — пользователь всё равно перепроверит.
 */
function parseCellContent_(value, richText, background) {
  const text = String(value || '').trim();
  if (!text) {
    return {
      lesson_type: detectLessonType_(background),
      subject: '',
      teacher: '',
      subgroup: '',
      notes: '',
    };
  }

  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

  // Определяем жирные строки (это название предмета)
  let subjectLines = [];
  let nonSubjectLines = [];
  if (richText && typeof richText.getRuns === 'function') {
    const runs = richText.getRuns();
    runs.forEach(run => {
      const ts = run.getTextStyle();
      const runText = run.getText();
      if (ts && ts.isBold()) {
        subjectLines.push(...runText.split('\n').map(s => s.trim()).filter(Boolean));
      } else {
        nonSubjectLines.push(...runText.split('\n').map(s => s.trim()).filter(Boolean));
      }
    });
  } else {
    nonSubjectLines = lines;
  }

  const subject = subjectLines.join(' ');
  const notes = nonSubjectLines.filter(looksLikeNotes_).join('; ');
  const teacher = nonSubjectLines.find(looksLikeTeacher_) || '';
  const subgroup = nonSubjectLines.find(looksLikeSubgroup_) || '';

  return {
    lesson_type: detectLessonType_(background),
    subject: subject,
    teacher: teacher,
    subgroup: subgroup,
    notes: notes,
  };
}

function extractSubjectFromRich_(richCell, fallbackStr) {
  if (!richCell || typeof richCell.getRuns !== 'function') return null;
  const runs = richCell.getRuns();
  const boldParts = [];
  runs.forEach(run => {
    const ts = run.getTextStyle();
    if (ts && ts.isBold()) boldParts.push(run.getText());
  });
  const result = boldParts.join('').trim();
  if (!result) return null;
  // отбрасываем «жирные дата-пометки» типа «по 01.06»
  if (looksLikeNotes_(result)) return null;
  return result;
}

function looksLikeTeacher_(s) {
  if (!s) return false;
  const t = s.trim();
  return /(^(доц\.|проф\.|ст\.\s*пр\.|пр\.\s*ст\.|ст\.пр\.|пр\.|асс\.))/i.test(t)
      || /\.[А-ЯA-Z][А-ЯA-Z]?\.?$/.test(t);
}

function looksLikeRoom_(s) {
  if (!s) return false;
  return /^[0-9]{2,4}[A-Za-zа-я\-/]?(\s*\([^)]+\))?$/.test(s.trim());
}

function looksLikeSubgroup_(s) {
  if (!s) return false;
  return /\dПГ|\b(нечет|чет|нечёт|чёт)\b/i.test(s);
}

function looksLikeNotes_(s) {
  if (!s) return false;
  return /^(по|с|до)\s+\d/i.test(s) || /\d{1,2}\.\d{1,2}/.test(s);
}

// ──────────────────────────────────────────────────────────────────────────
// GitHub Actions dispatch — обновление schedule.json по событию
// ──────────────────────────────────────────────────────────────────────────

/**
 * Installable trigger: вешается на событие «On edit» (любая правка ячейки).
 *
 * Установка (один раз):
 *   Triggers (часы слева) → Add Trigger → onSheetEdit
 *     Event source: From spreadsheet
 *     Event type:   On edit
 */
function onSheetEdit(e) {
  // Не срабатывать на правки в листе «Справочники»
  if (e && e.source && e.range) {
    const sheetName = e.range.getSheet().getName();
    if (sheetName === DICT_SHEET_NAME) return;
  }
  const rangeStr = (e && e.range) ? e.range.getA1Notation() : '';
  dispatchScheduleUpdate_('onEdit', rangeStr);
}

/**
 * Отправить repository_dispatch в GitHub Actions.
 * source — откуда вызов ('form:applyLesson', 'onEdit', 'manual-test').
 * detail — доп. информация (адрес ячейки, и т.п.).
 */
function dispatchScheduleUpdate_(source, detail) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    console.warn('GITHUB_TOKEN not set in Script Properties — dispatch skipped');
    return;
  }

  // Cooldown: не шлём dispatch чаще чем раз в DISPATCH_COOLDOWN_MS
  const props = PropertiesService.getScriptProperties();
  const lastDispatch = parseInt(props.getProperty('_lastDispatchMs') || '0', 10);
  const now = Date.now();
  if (now - lastDispatch < DISPATCH_COOLDOWN_MS) {
    console.log('dispatch cooldown, skipping (' + source + ')');
    return;
  }
  props.setProperty('_lastDispatchMs', String(now));

  const url = 'https://api.github.com/repos/' + GH_REPO_OWNER + '/' + GH_REPO_NAME + '/dispatches';
  const payload = {
    event_type: GH_EVENT_TYPE,
    client_payload: {
      source: source,
      detail: detail || '',
      sheet: (SpreadsheetApp.getActiveSpreadsheet() || {getName: () => 'unknown'}).getName(),
      user: (Session.getEffectiveUser() || {getEmail: () => ''}).getEmail(),
      at: new Date().toISOString(),
    },
  };

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code >= 300) {
      console.error('dispatch failed: ' + code + ' ' + resp.getContentText());
    } else {
      console.log('dispatch OK (' + source + ')');
    }
  } catch (err) {
    console.error('dispatch error: ' + err.message);
  }
}

/** Ручной тест dispatch — можно запустить из редактора Apps Script. */
function testDispatch() {
  dispatchScheduleUpdate_('manual-test', 'A1');
  SpreadsheetApp.getUi().alert('Dispatch отправлен. Проверь GitHub Actions.');
}
