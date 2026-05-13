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
 * Возвращает всё за один вызов: ячейку + словари.
 * Один roundtrip вместо двух — быстрее загрузка sidebar.
 */
function getActiveCellInfo() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  const dicts = getDictionaries_();

  if (!cell) return { error: 'Не выбрана ячейка', types: LESSON_TYPES, dicts: dicts };

  const row = cell.getRow();
  const col = cell.getColumn();

  // Batch read: 2 ячейки сразу (ячейка + аудитория справа)
  const range = sheet.getRange(row, col, 1, 2);
  const values = range.getValues();
  const bgs = range.getBackgrounds();
  const richText = cell.getRichTextValue();

  const value = values[0][0];
  const roomValue = values[0][1];
  const background = (bgs[0][0] || '').toLowerCase();

  const parsed = parseCellContent_(value, richText, background);

  // Определяем количество объединённых строк
  let spanRows = 1;
  const mergedRanges = sheet.getRange(row, col, 3, 1).getMergedRanges();
  for (let i = 0; i < mergedRanges.length; i++) {
    const mr = mergedRanges[i];
    if (mr.getRow() === row && mr.getColumn() === col) {
      spanRows = mr.getNumRows();
      break;
    }
  }

  return {
    sheet: sheet.getName(),
    row: row,
    col: col,
    background: background,
    value: String(value || ''),
    roomValue: String(roomValue || ''),
    parsed: parsed,
    types: LESSON_TYPES,
    dicts: dicts,
    spanRows: spanRows,
  };
}

/**
 * Словари для autocomplete (внутренняя). Кэш 60 сек.
 */
function getDictionaries_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dictionaries');
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* fallthrough */ }
  }
  const sheet = ensureDictionarySheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {subjects: [], teachers: [], rooms: []};
  }
  const range = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const result = {
    subjects: uniqueNonEmpty_(range.map(r => r[0])),
    teachers: uniqueNonEmpty_(range.map(r => r[1])),
    rooms:    uniqueNonEmpty_(range.map(r => r[2])),
  };
  try { cache.put('dictionaries', JSON.stringify(result), 60); } catch (_) { /* ignore */ }
  return result;
}

/** Обратная совместимость: старый вызов словарей */
function getDictionaries() { return getDictionaries_(); }

// ──────────────────────────────────────────────────────────────────────────
// Применение формы → запись в ячейку
// ──────────────────────────────────────────────────────────────────────────

// Красный для подгрупп, дат, комментариев
const RED = '#ff0000';

/**
 * Собрать содержимое одной ячейки из массива подгрупп.
 * Возвращает {text, styleRanges, roomText}.
 */
function buildCellContent_(subgroups) {
  const lines = [];
  const styleRanges = [];
  const roomLines = [];

  function pushStyled(line, style, extra) {
    const start = lines.join('\n').length + (lines.length ? 1 : 0);
    lines.push(line);
    const r = {start: start, end: start + line.length, style: style};
    if (extra) Object.assign(r, extra);
    styleRanges.push(r);
  }

  subgroups.forEach((sg, sgIdx) => {
    // Разделитель между подгруппами
    if (sgIdx > 0 && subgroups.length > 1) {
      lines.push('───────────────');
    }
    if (sg.notes && sg.notes.trim()) pushStyled(sg.notes.trim(), 'red');
    const subj = (sg.subject && sg.subject.trim()) || '';
    if (subj) pushStyled(subj, 'subject_bold');
    if (sg.subgroup) pushStyled(sg.subgroup, 'red');
    if (sg.teacher) lines.push(sg.teacher);
    if (sg.comment && sg.comment.trim()) pushStyled(sg.comment.trim(), 'red');
    if (sg.cancelled) pushStyled('ОТМЕНА', 'cancel');
    roomLines.push(sg.room || '');
  });

  return {
    text: lines.join('\n'),
    styleRanges: styleRanges,
    roomLines: roomLines,
  };
}

/**
 * Применяет RichText и форматирование к ячейке.
 */
function applyRichTextToCell_(cell, text, styleRanges, bgColor) {
  if (!text) { cell.clearContent(); cell.setBackground(bgColor); return; }
  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  // Сброс: весь текст — чёрный, обычный, нормальный размер
  const normalStyle = SpreadsheetApp.newTextStyle()
    .setBold(false).setItalic(false)
    .setForegroundColor('#000000')
    .setFontFamily('Arial')
    .setFontSize(12)
    .build();
  builder.setTextStyle(0, text.length, normalStyle);

  styleRanges.forEach(r => {
    if (r.start >= r.end || r.start < 0 || r.end > text.length) return;
    if (r.style === 'subject_bold') {
      builder.setTextStyle(r.start, r.end,
        SpreadsheetApp.newTextStyle().setBold(true).setFontFamily('Arial').setFontSize(12).setForegroundColor('#000000').build());
    } else if (r.style === 'bold') {
      builder.setTextStyle(r.start, r.end,
        SpreadsheetApp.newTextStyle().setBold(true).setFontFamily('Arial').setForegroundColor('#000000').build());
    } else if (r.style === 'red') {
      builder.setTextStyle(r.start, r.end,
        SpreadsheetApp.newTextStyle().setFontFamily('Arial').setForegroundColor(RED).build());
    } else if (r.style === 'cancel') {
      builder.setTextStyle(r.start, r.end,
        SpreadsheetApp.newTextStyle().setBold(true).setFontFamily('Arial').setForegroundColor(RED).build());
    }
  });

  cell.setRichTextValue(builder.build());
  cell.setBackground(bgColor).setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
}

/**
 * Записывает занятие в активную ячейку.
 * Поддерживает:
 *   - Лабу на 2-3 пары (merge N ячеек, аудитории справа)
 *   - Лекцию/практику с несколькими предметами (всё в одной ячейке)
 *   - Обычное занятие (одна ячейка)
 */
function applyLesson(data) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (!cell) throw new Error('Не выбрана ячейка. Кликни на ячейку в таблице.');
  const row = cell.getRow();
  const col = cell.getColumn();

  const type = LESSON_TYPES.find(t => t.code === data.lesson_type);
  if (!type) throw new Error('Неизвестный тип занятия: ' + data.lesson_type);

  const hasSubs = data.teachers_by_subgroup && data.teachers_by_subgroup.length > 0;
  const isMulti = hasSubs && data.teachers_by_subgroup.some(sg => sg.subject && sg.subject.trim());

  if (isMulti) {
    const sgs = data.teachers_by_subgroup;
    const content = buildCellContent_(sgs);
    const spanRows = Math.max(1, Math.min(data.span_rows || 2, 3));

    // 1. Разъединяем ВСЕ merge в целевых строках
    for (let r = 0; r < spanRows; r++) {
      try {
        const targetRange = sheet.getRange(row + r, col, 1, 2);
        const mergedRanges = targetRange.getMergedRanges();
        mergedRanges.forEach(mr => { try { mr.breakApart(); } catch (_) {} });
      } catch (_) {}
    }

    // 2. Очищаем нижние ячейки
    for (let r = 1; r < spanRows; r++) {
      sheet.getRange(row + r, col).clearContent().setBackground(type.color);
      sheet.getRange(row + r, col + 1).clearContent();
    }

    // 3. Записываем контент + аудитории (до merge, чтобы всё было в одном flush)
    const topCell = sheet.getRange(row, col);
    applyRichTextToCell_(topCell, content.text, content.styleRanges, type.color);

    const roomLines = content.roomLines.filter(r => r.trim());
    if (roomLines.length === 0) {
      sheet.getRange(row, col + 1).clearContent();
    } else {
      const roomText = roomLines.join('\n───\n');
      setRoomCell_(sheet.getRange(row, col + 1), roomText);
    }

    // 4. Объединяем ячейки (после записи, всё в одном batch)
    if (spanRows > 1) {
      sheet.getRange(row, col, spanRows, 1).merge();
      sheet.getRange(row, col + 1, spanRows, 1).merge();
    }



    // Один flush в конце — всё отрендерится атомарно
    SpreadsheetApp.flush();

  } else {
    // Одна ячейка — обычное занятие
    if (!data.subject || !data.subject.trim()) throw new Error('Не указан предмет.');

    const lines = [];
    const styleRanges = [];
    function pushStyled(line, style) {
      const start = lines.join('\n').length + (lines.length ? 1 : 0);
      lines.push(line);
      styleRanges.push({start: start, end: start + line.length, style: style});
    }

    if (data.notes && data.notes.trim()) pushStyled(data.notes.trim(), 'red');
    pushStyled(data.subject.trim(), 'subject_bold');
    if (data.subgroup && data.subgroup.trim()) pushStyled(data.subgroup.trim(), 'red');
    if (data.teacher && data.teacher.trim()) lines.push(data.teacher.trim());
    if (data.comment && data.comment.trim()) pushStyled(data.comment.trim(), 'red');
    if (data.cancelled) pushStyled('ОТМЕНА', 'cancel');

    const text = lines.join('\n');
    applyRichTextToCell_(cell, text, styleRanges, type.color);

    const roomCell = sheet.getRange(row, col + 1);
    setRoomCell_(roomCell, data.room || '');
  }

  // Справочник
  appendToDictionary_({
    subject: isMulti ? (data.teachers_by_subgroup[0] || {}).subject : data.subject,
    teachers: collectTeachers_(data),
    rooms: collectRooms_(data),
  });

  SpreadsheetApp.flush();
  dispatchScheduleUpdate_('form:applyLesson', cellAddress_(row, col));
  return {ok: true, cell: cellAddress_(row, col)};
}

/** Аудитория: жирный, Arial 12pt, по центру (минимум вызовов API) */
function setRoomCell_(cell, text) {
  const val = (text || '').trim();
  if (!val) { cell.clearContent(); return; }
  const style = SpreadsheetApp.newTextStyle()
    .setBold(true).setFontFamily('Arial').setFontSize(12).setForegroundColor('#000000').build();
  const rv = SpreadsheetApp.newRichTextValue().setText(val).setTextStyle(0, val.length, style).build();
  cell.setRichTextValue(rv);
  cell.setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true);
}

/**
 * Записывает занятие и переводит курсор на следующую строку.
 */
function applyLessonAndMoveDown(data) {
  const result = applyLesson(data);
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (cell) {
    const offset = Math.max(1, Math.min(data.span_rows || 2, 3));
    const next = sheet.getRange(cell.getRow() + offset, cell.getColumn());
    sheet.setCurrentCell(next);
  }
  return result;
}

function manualDispatch() {
  const result = dispatchScheduleUpdate_('manual-menu', '');
  SpreadsheetApp.getUi().alert(dispatchResultMessage_(result));
}

function dispatchResultMessage_(result) {
  if (!result) return 'Dispatch не выполнен (неизвестная ошибка).';
  if (result.sent) return 'Запрос отправлен в GitHub Actions.\nschedule.json обновится через ~30-40 сек.';
  switch (result.reason) {
    case 'no_token':
      return 'GITHUB_TOKEN не задан в Script Properties.\nНастрой токен: ⚙ Project Settings → Script Properties → GITHUB_TOKEN.';
    case 'cooldown':
      return 'Cooldown: предыдущий dispatch был < 30 сек назад.\nПодожди немного и попробуй снова.';
    default:
      return 'Dispatch не удался: ' + (result.message || result.reason) + '.';
  }
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
      comment: '',
    };
  }

  const lines = text.split('\n').map(s => s.trim()).filter(s => s && !/^[─━\-]+$/.test(s));

  // Определяем жирные строки (это название предмета)
  let subjectLines = [];
  let nonSubjectLines = [];
  if (richText && typeof richText.getRuns === 'function') {
    const runs = richText.getRuns();
    runs.forEach(run => {
      const ts = run.getTextStyle();
      const runText = run.getText();
      const parts = runText.split('\n').map(s => s.trim()).filter(s => s && !/^[─━\-]+$/.test(s));
      if (ts && ts.isBold()) {
        parts.forEach(p => {
          if (/^\s*ОТМЕНА\s*$/i.test(p)) {
            nonSubjectLines.push(p);
          } else if (looksLikeNotes_(p)) {
            nonSubjectLines.push(p);
          } else {
            subjectLines.push(p);
          }
        });
      } else {
        nonSubjectLines.push(...parts);
      }
    });
  } else {
    nonSubjectLines = lines;
  }

  // Определяем позицию каждого subject в lines (с учётом дубликатов)
  const rawBoldLines = new Set(subjectLines.map(s => s.trim()));
  const subjectPositions = [];
  {
    const usedIndices = new Set();
    subjectLines.forEach(sl => {
      for (let k = 0; k < lines.length; k++) {
        if (!usedIndices.has(k) && lines[k] === sl) {
          subjectPositions.push(k);
          usedIndices.add(k);
          break;
        }
      }
    });
  }

  // Склеиваем последовательные жирные строки без teacher/subgroup между ними
  const subjectFirstLines = [];
  if (subjectLines.length > 1) {
    const merged = [subjectLines[0]];
    subjectFirstLines.push(subjectLines[0]);
    const mergedPositions = [subjectPositions[0]];
    for (let i = 1; i < subjectLines.length; i++) {
      const prevIdx = mergedPositions[mergedPositions.length - 1];
      const currIdx = subjectPositions[i];
      let hasBreaker = false;
      for (let j = prevIdx + 1; j < currIdx; j++) {
        if (looksLikeTeacher_(lines[j]) || looksLikeSubgroup_(lines[j])) {
          hasBreaker = true;
          break;
        }
      }
      if (hasBreaker || currIdx - prevIdx > 2) {
        merged.push(subjectLines[i]);
        subjectFirstLines.push(subjectLines[i]);
        mergedPositions.push(currIdx);
      } else {
        merged[merged.length - 1] += ' ' + subjectLines[i];
        mergedPositions[mergedPositions.length - 1] = currIdx;
      }
    }
    subjectLines = merged;
  } else if (subjectLines.length === 1) {
    subjectFirstLines.push(subjectLines[0]);
  }

  const lessonType = detectLessonType_(background);
  const cancelled = lines.some(l => /^\s*ОТМЕНА\s*$/i.test(l.trim()));

  // Позиционный парсинг: порядок в ячейке — notes, subject, subgroup, teacher, comment, ОТМЕНА
  // notes = строки ДО предмета (дата-пометки «с/по/до»)
  // comment = красные строки ПОСЛЕ преподавателя (не subgroup, не ОТМЕНА)
  let subjectIdx = -1;
  if (subjectFirstLines.length) {
    subjectIdx = lines.indexOf(subjectFirstLines[0]);
  }
  const teacher = nonSubjectLines.find(looksLikeTeacher_) || '';
  const teacherIdx = teacher ? lines.indexOf(teacher) : subjectIdx;
  const subgroup = nonSubjectLines.find(looksLikeSubgroup_) || '';

  const noteLines = [];
  const commentLines = [];
  nonSubjectLines.forEach(l => {
    if (/^\s*ОТМЕНА\s*$/i.test(l)) return;
    if (looksLikeSubgroup_(l)) return;
    if (looksLikeTeacher_(l)) return;
    const lineIdx = lines.indexOf(l);
    if (subjectIdx >= 0 && lineIdx < subjectIdx && looksLikeNotes_(l)) {
      noteLines.push(l);
    } else if (lineIdx > teacherIdx) {
      commentLines.push(l);
    } else if (looksLikeNotes_(l)) {
      noteLines.push(l);
    } else {
      commentLines.push(l);
    }
  });

  const notes = noteLines.join('; ');
  const comment = commentLines.join('; ');

  // Попытка разобрать multi-subject (лабы и не только)
  let labSubgroups = null;
  if (subjectLines.length > 1) {
    labSubgroups = parseMultiSubjectLab_(lines, subjectLines, subjectFirstLines, rawBoldLines);
  }

  const subject = subjectLines.length > 1 ? subjectLines[0] : subjectLines.join(' ');

  return {
    lesson_type: lessonType,
    subject: subject,
    teacher: teacher,
    subgroup: subgroup,
    notes: notes,
    comment: comment,
    cancelled: cancelled,
    lab_subgroups: labSubgroups,
  };
}

/**
 * Парсит сложную ячейку с несколькими предметами.
 * Поддерживает одинаковые названия предметов (ЦОСи ВА + ЦОСи ВА + ИАД).
 */
function parseMultiSubjectLab_(allLines, subjectLines, firstLines, rawBoldSet) {
  const fls = firstLines || subjectLines;
  // Находим позиции первых строк каждого предмета в allLines (с учётом дубликатов)
  const firstLinePositions = [];
  const usedIdx = new Set();
  fls.forEach((fl, i) => {
    for (let k = 0; k < allLines.length; k++) {
      if (!usedIdx.has(k) && allLines[k].trim() === fl.trim()) {
        firstLinePositions.push({ pos: k, subject: subjectLines[i].trim() });
        usedIdx.add(k);
        break;
      }
    }
  });
  const firstLinePosSet = new Set(firstLinePositions.map(fp => fp.pos));

  // Строки-продолжения: жирные строки, которые не являются первой строкой предмета
  const continuationPositions = new Set();
  if (rawBoldSet) {
    allLines.forEach((l, idx) => {
      if (rawBoldSet.has(l.trim()) && !firstLinePosSet.has(idx)) {
        continuationPositions.add(idx);
      }
    });
  }

  const groups = [];
  let current = null;
  let nextFirstIdx = 0;
  let pendingNotes = '';

  allLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || /^[─━\-]+$/.test(trimmed)) return;
    if (nextFirstIdx < firstLinePositions.length && idx === firstLinePositions[nextFirstIdx].pos) {
      current = { subject: firstLinePositions[nextFirstIdx].subject, subgroup: '', teacher: '', notes: '', comment: '', cancelled: false };
      if (pendingNotes) {
        current.notes = pendingNotes;
        pendingNotes = '';
      }
      groups.push(current);
      nextFirstIdx++;
    } else if (current) {
      if (continuationPositions.has(idx)) return;
      if (looksLikeTeacher_(trimmed) && !current.teacher) {
        current.teacher = trimmed;
      } else if (looksLikeSubgroup_(trimmed) && !current.subgroup) {
        current.subgroup = trimmed;
      } else if (/^\s*ОТМЕНА\s*$/i.test(trimmed)) {
        current.cancelled = true;
      } else if (looksLikeNotes_(trimmed) && !current.notes && !current.teacher) {
        current.notes = trimmed;
      } else if (looksLikeNotes_(trimmed) && current.teacher) {
        // Дата после преподавателя → для следующего предмета
        pendingNotes = pendingNotes ? pendingNotes + '; ' + trimmed : trimmed;
      } else if (!current.comment) {
        current.comment = trimmed;
      }
    } else if (looksLikeNotes_(trimmed)) {
      pendingNotes = pendingNotes ? pendingNotes + '; ' + trimmed : trimmed;
    }
  });

  // Оставшиеся pendingNotes → notes последней группы
  if (pendingNotes && groups.length > 0) {
    const last = groups[groups.length - 1];
    last.notes = last.notes ? last.notes + '; ' + pendingNotes : pendingNotes;
  }

  return groups.length > 1 ? groups : null;
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
  const t = s.trim();
  if (/^[─━\-]+$/.test(t)) return false;
  return /^[0-9]{2,4}[A-Za-zА-Яа-я\-/]?(\s*\([^)]+\))?$/.test(t)
      || /^[КкKk]\s*\d+/i.test(t)
      || /^\d+\/[КкKk]\d+/i.test(t);
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
    return {sent: false, reason: 'no_token'};
  }

  // Cooldown: не шлём dispatch чаще чем раз в DISPATCH_COOLDOWN_MS
  const props = PropertiesService.getScriptProperties();
  const lastDispatch = parseInt(props.getProperty('_lastDispatchMs') || '0', 10);
  const now = Date.now();
  if (now - lastDispatch < DISPATCH_COOLDOWN_MS) {
    console.log('dispatch cooldown, skipping (' + source + ')');
    return {sent: false, reason: 'cooldown'};
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
      return {sent: false, reason: 'http_' + code};
    }
    console.log('dispatch OK (' + source + ')');
    return {sent: true};
  } catch (err) {
    console.error('dispatch error: ' + err.message);
    return {sent: false, reason: 'error', message: err.message};
  }
}

/** Ручной тест dispatch — можно запустить из редактора Apps Script. */
function testDispatch() {
  const result = dispatchScheduleUpdate_('manual-test', 'A1');
  SpreadsheetApp.getUi().alert(dispatchResultMessage_(result));
}
