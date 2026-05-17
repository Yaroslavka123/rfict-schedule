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
  {code: 'additional',   label: 'ДО',      short: 'ДО',  color: '#d9d2e9', isDO: true}, // ДО — надстройка
];

const DICT_SHEET_NAME = 'Справочники';

// ──────────────────────────────────────────────────────────────────────────
// GitHub — экспорт schedule.json по событию
// ──────────────────────────────────────────────────────────────────────────

const GH_REPO_OWNER = 'Yaroslavka123';
const GH_REPO_NAME  = 'rfict-schedule';
const SCHEDULE_DIR  = 'public/schedule/';

// Задержка перед экспортом после последнего изменения (мс).
const EXPORT_DELAY_MS = 2 * 60 * 1000; // 2 минуты
const SUBJECT_COL = 1; // A
const TEACHER_COL = 2; // B
const ROOM_COL = 3;    // C

// Ключи в DocumentProperties
const PROP_COURSE_OVERRIDE = 'COURSE_OVERRIDE';
const PROP_PUSH_ENABLED    = 'PUSH_ENABLED';

// ──────────────────────────────────────────────────────────────────────────
// Настройки таблицы (курс + push-режим)
// ──────────────────────────────────────────────────────────────────────────

/** Явно указанный курс (1..8) или null. */
function getCourseOverride_() {
  var raw = PropertiesService.getDocumentProperties().getProperty(PROP_COURSE_OVERRIDE);
  if (!raw) return null;
  var n = parseInt(raw, 10);
  return (n >= 1 && n <= 8) ? n : null;
}

function setCourseOverride_(course) {
  var props = PropertiesService.getDocumentProperties();
  if (course === null || course === undefined || course === '') {
    props.deleteProperty(PROP_COURSE_OVERRIDE);
  } else {
    props.setProperty(PROP_COURSE_OVERRIDE, String(course));
  }
}

/** Push в GitHub включён? По умолчанию ВЫКЛ. */
function isPushEnabled_() {
  return PropertiesService.getDocumentProperties().getProperty(PROP_PUSH_ENABLED) === 'true';
}

function setPushEnabled_(enabled) {
  PropertiesService.getDocumentProperties().setProperty(PROP_PUSH_ENABLED, enabled ? 'true' : 'false');
}

// ──────────────────────────────────────────────────────────────────────────
// Меню и sidebar
// ──────────────────────────────────────────────────────────────────────────

function onOpen() {
  var course = getCourseOverride_();
  var pushOn = isPushEnabled_();
  var courseLabel = course ? ('🎓 Курс: ' + course) : '🎓 Курс не выбран';
  var pushLabel   = '🌐 Автосохранение на сайт: ' + (pushOn ? 'вкл' : 'выкл');

  var templateMenu = SpreadsheetApp.getUi()
    .createMenu('🧱 Шаблон листа')
    .addItem('Снять шаблон с активного листа', 'extractActiveSheetAsTemplate')
    .addItem('Создать лист по шаблону', 'createSheetFromTemplate')
    .addSeparator()
    .addItem('📤 Экспортировать шаблон в код', 'exportTemplateToCode')
    .addSeparator()
    .addItem('Тест round-trip шаблона', 'verifyTemplateRoundTrip');

  SpreadsheetApp.getUi()
    .createMenu('Расписание')
    .addItem('➕ Добавить или изменить занятие', 'showSidebar')
    .addItem('🧹 Очистить ячейку', 'clearActiveCell')
    .addSeparator()
    .addItem('📋 Открыть справочник', 'openDictionarySheet')
    .addItem('🔄 Обновить справочник из таблицы', 'rebuildDictionaryFromSheet')
    .addSeparator()
    .addItem(courseLabel, 'promptSetCourse')
    .addItem(pushLabel,   'togglePushEnabled')
    .addSeparator()
    .addItem('💾 Сохранить расписание сейчас', 'manualDispatch')
    .addSeparator()
    .addItem('📅 Сгенерировать пустой семестр', 'openSemesterGenerator')
    .addSubMenu(templateMenu)
    .addToUi();
}

/** Пересоздаёт меню после смены настроек (чтобы лейблы обновились). */
function rebuildMenu_() {
  try { onOpen(); } catch (_) { /* не в контексте таблицы */ }
}

/** Меню → Курс */
function promptSetCourse() {
  var ui = SpreadsheetApp.getUi();
  var current = getCourseOverride_();
  var resp = ui.prompt(
    'Номер курса',
    'Введите номер курса (от 1 до 8).\n\nСейчас: ' + (current ? current : 'не выбран') + '.',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var txt = (resp.getResponseText() || '').trim();
  if (!txt) {
    setCourseOverride_(null);
    rebuildMenu_();
    ui.alert('Курс очищен. Он будет определяться автоматически по таблице.');
    return;
  }
  var n = parseInt(txt, 10);
  if (!(n >= 1 && n <= 8)) {
    ui.alert('Нужно число от 1 до 8.');
    return;
  }
  setCourseOverride_(n);
  rebuildMenu_();
  ui.alert('Курс сохранён: ' + n + '.');
}

/** Меню → Автосохранение на сайт: вкл/выкл */
function togglePushEnabled() {
  var ui = SpreadsheetApp.getUi();
  if (isPushEnabled_()) {
    var off = ui.alert(
      'Выключить автосохранение?',
      'Расписание перестанет автоматически сохраняться на сайт.\nВернуть можно обратно в меню.',
      ui.ButtonSet.YES_NO
    );
    if (off !== ui.Button.YES) return;
    setPushEnabled_(false);
    rebuildMenu_();
    ui.alert('Автосохранение выключено.');
    return;
  }
  // Включение
  var course = getCourseOverride_();
  if (!course) {
    ui.alert(
      'Сначала выберите курс',
      'В меню «Расписание» откройте «Курс» и введите номер (от 1 до 8). Без этого автосохранение включить нельзя.',
      ui.ButtonSet.OK
    );
    return;
  }
  var on = ui.alert(
    'Включить автосохранение?',
    'Расписание будет автоматически сохраняться на сайт через 2 минуты после любого изменения.\n\nКурс: ' + course + '.',
    ui.ButtonSet.YES_NO
  );
  if (on !== ui.Button.YES) return;
  setPushEnabled_(true);
  rebuildMenu_();
  ui.alert('Готово. Расписание будет сохраняться автоматически.');
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
 * Списки дедуплицируются по нормализованному ключу (нижний регистр, без пробелов/знаков).
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
    subjects: dedupeByNormalized_(range.map(r => r[0])),
    teachers: dedupeByNormalized_(range.map(r => r[1])),
    rooms:    dedupeByNormalized_(range.map(r => r[2])),
  };
  try { cache.put('dictionaries', JSON.stringify(result), 60); } catch (_) { /* ignore */ }
  return result;
}

/**
 * Нормализация для сравнения: нижний регистр + убираем всё кроме букв/цифр.
 * «доц. Жевняк О.Г.» → «доцжевняког»
 * «ДОЦЖевнякО.Г.»  → «доцжевняког»
 */
function normalizeForMatch_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

/**
 * Оценка читаемости: предпочитаем варианты с пробелами/точками.
 */
function readabilityScore_(s) {
  var str = String(s || '');
  var spaces = (str.match(/\s/g) || []).length;
  var dots = (str.match(/\./g) || []).length;
  return spaces * 10 + dots * 5 + str.length;
}

/**
 * Дедуплицирует список строк по normalized-ключу, оставляет самое «читабельное» представление.
 */
function dedupeByNormalized_(arr) {
  var byKey = {};
  (arr || []).forEach(function(raw) {
    var s = String(raw || '').trim();
    if (!s) return;
    var k = normalizeForMatch_(s);
    if (!k) return;
    if (!byKey[k] || readabilityScore_(s) > readabilityScore_(byKey[k])) byKey[k] = s;
  });
  return Object.keys(byKey).map(function(k) { return byKey[k]; }).sort(function(a, b) {
    return a.localeCompare(b, 'ru');
  });
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
  if (!cell) throw new Error('Сначала выберите ячейку в таблице.');
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
  if (isPushEnabled_()) {
    scheduleDelayedExport_(sheet.getName());
  }
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
  var ui = SpreadsheetApp.getUi();
  if (!isPushEnabled_()) {
    ui.alert(
      'Автосохранение выключено',
      'Чтобы сохранить расписание на сайте, включите автосохранение в меню.',
      ui.ButtonSet.OK
    );
    return;
  }
  var course = getCourseOverride_();
  if (!course) {
    ui.alert('Сначала выберите курс в меню.');
    return;
  }
  var resp = ui.alert(
    'Сохранить расписание сейчас?',
    'Расписание будет обновлено на сайте.\n\nКурс: ' + course + '.',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;
  var result = dispatchScheduleUpdate_('manual-menu', '');
  ui.alert(dispatchResultMessage_(result));
}

function dispatchResultMessage_(result) {
  if (!result) return 'Не удалось сохранить расписание.';
  if (result.sent) return 'Расписание сохранено на сайте.';
  switch (result.reason) {
    case 'no_token':
      return 'Нет доступа к сайту. Обратитесь к Ярославу.';
    default:
      return 'Не удалось сохранить: ' + (result.message || result.reason) + '.';
  }
}

function clearActiveCell() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cell = sheet.getCurrentCell();
  if (!cell) throw new Error('Сначала выберите ячейку.');
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

  // Собираем все варианты написания, дедуплицируем по normalized-ключу.
  const subjects = [];
  const teachers = [];
  const rooms = [];

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
        if (subj) subjects.push(subj);
        str.split('\n').forEach(line => {
          line = line.trim();
          if (looksLikeTeacher_(line)) teachers.push(line);
          if (looksLikeRoom_(line)) rooms.push(line);
        });
      });
    });
  });

  const subjArr  = dedupeByNormalized_(subjects);
  const teachArr = dedupeByNormalized_(teachers);
  const roomArr  = dedupeByNormalized_(rooms);

  // Очищаем (кроме шапки)
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }

  const maxLen = Math.max(subjArr.length, teachArr.length, roomArr.length);
  if (maxLen === 0) {
    SpreadsheetApp.getUi().alert('В таблице пока нет данных для справочника.');
    return;
  }

  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push([
      subjArr[i] || '',
      teachArr[i] || '',
      roomArr[i] || '',
    ]);
  }
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  try { CacheService.getScriptCache().remove('dictionaries'); } catch (_) {}
  SpreadsheetApp.getUi().alert(
    'Справочник обновлён.\n\nПредметы: ' + subjArr.length +
      '\nПреподаватели: ' + teachArr.length +
      '\nАудитории: ' + roomArr.length
  );
}

function appendToDictionary_(items) {
  const sheet = ensureDictionarySheet();
  const lastRow = Math.max(sheet.getLastRow(), 1);

  // Строим карты normalized → best display по существующему справочнику.
  const existingSubjects = {};
  const existingTeachers = {};
  const existingRooms = {};
  if (lastRow > 1) {
    const range = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    range.forEach(r => {
      if (r[0]) existingSubjects[normalizeForMatch_(r[0])] = String(r[0]).trim();
      if (r[1]) existingTeachers[normalizeForMatch_(r[1])] = String(r[1]).trim();
      if (r[2]) existingRooms[normalizeForMatch_(r[2])]    = String(r[2]).trim();
    });
  }

  function pickNew(value, existing) {
    if (!value) return null;
    var s = String(value).trim();
    if (!s) return null;
    var k = normalizeForMatch_(s);
    if (!k || existing[k]) return null;
    existing[k] = s; // отмечаем как добавленное в рамках текущего вызова
    return s;
  }

  const toAddSubj  = [pickNew(items.subject, existingSubjects)].filter(Boolean);
  const toAddTeach = (items.teachers || []).map(t => pickNew(t, existingTeachers)).filter(Boolean);
  const toAddRooms = (items.rooms || []).map(r => pickNew(r, existingRooms)).filter(Boolean);

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
  try { CacheService.getScriptCache().remove('dictionaries'); } catch (_) {}
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
  return /\d\s*ПГ|\b(нечет|чет|нечёт|чёт|еженедел)\b/i.test(s);
}

function looksLikeNotes_(s) {
  if (!s) return false;
  return /^(по|с|до)\s+\d/i.test(s) || /\d{1,2}\.\d{1,2}/.test(s)
      || /^(по|с|до)\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i.test(s);
}

// ──────────────────────────────────────────────────────────────────────────
// Экспорт schedule.json — парсинг таблицы + пуш в GitHub
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
  if (!e || !e.source || !e.range) return;
  const sheetName = e.range.getSheet().getName();
  if (sheetName === DICT_SHEET_NAME) return;
  if (!isPushEnabled_()) return; // тестовый режим — ничего не пушим
  scheduleDelayedExport_(sheetName);
}

/**
 * Планирует отложенный экспорт через 2 минуты (debounce).
 * При каждом новом изменении таймер сбрасывается.
 */
function scheduleDelayedExport_(sheetName) {
  const props = PropertiesService.getScriptProperties();

  // Удаляем предыдущий запланированный триггер (сброс таймера)
  const existingId = props.getProperty('_pendingExportTriggerId');
  if (existingId) {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getUniqueId() === existingId) {
        ScriptApp.deleteTrigger(triggers[i]);
        break;
      }
    }
  }

  // Сохраняем ID таблицы (нужен для openById в time-based триггере)
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    props.setProperty('_pendingExportSpreadsheetId', ss.getId());
  }

  // Запоминаем какой лист изменился
  var pending = props.getProperty('_pendingExportSheet');
  if (pending && pending !== sheetName) {
    props.setProperty('_pendingExportSheet', '__ALL__');
  } else {
    props.setProperty('_pendingExportSheet', sheetName || '__ALL__');
  }

  // Новый триггер через 2 минуты
  var trigger = ScriptApp.newTrigger('runDelayedExport_')
    .timeBased()
    .after(EXPORT_DELAY_MS)
    .create();
  props.setProperty('_pendingExportTriggerId', trigger.getUniqueId());
}

/**
 * Вызывается по таймеру — выполняет отложенный экспорт.
 */
function runDelayedExport_() {
  const props = PropertiesService.getScriptProperties();

  // Чистим триггер
  var triggerId = props.getProperty('_pendingExportTriggerId');
  props.deleteProperty('_pendingExportTriggerId');
  if (triggerId) {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getUniqueId() === triggerId) {
        ScriptApp.deleteTrigger(triggers[i]);
        break;
      }
    }
  }

  var ssId = props.getProperty('_pendingExportSpreadsheetId');
  props.deleteProperty('_pendingExportSpreadsheetId');
  var sheetName = props.getProperty('_pendingExportSheet');
  props.deleteProperty('_pendingExportSheet');

  if (!ssId) {
    console.error('delayed export: no spreadsheet ID saved');
    return;
  }

  if (sheetName === '__ALL__' || !sheetName) {
    dispatchScheduleUpdate_('delayed-export', '', null, ssId);
  } else {
    dispatchScheduleUpdate_('delayed-export', '', sheetName, ssId);
  }
}

/**
 * Экспорт JSON в GitHub + webhook.
 * source — 'delayed-export', 'manual-menu', 'manual-test'.
 * detail — адрес ячейки.
 * editedSheetName — название листа (обновляем только его, иначе все).
 */
function dispatchScheduleUpdate_(source, detail, editedSheetName, spreadsheetId) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    console.warn('GITHUB_TOKEN not set — export skipped');
    return {sent: false, reason: 'no_token'};
  }

  try {
    var ss = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('Spreadsheet not found');
    if (editedSheetName) {
      exportSingleSheet_(ss, editedSheetName, token);
    } else {
      exportAllSheets_(ss, token);
    }
    console.log('schedule pushed (' + source + ', ' + detail + ')');
    return {sent: true};
  } catch (err) {
    console.error('export error: ' + err.message);
    return {sent: false, reason: 'error', message: err.message};
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Построение JSON из всех листов расписания
// ──────────────────────────────────────────────────────────────────────────

const COLOR_TO_TYPE_MAP_ = {
  '#d9ead3': 'lecture',
  '#fce5cd': 'lab',
  '#c9daf8': 'practice',
  '#ffffff': 'seminar',
  '#fff2cc': 'curator_hour',
  '#d9d2e9': 'additional',
};

const DAY_NAMES_ = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Парсит ячейку колонки A: возвращает индекс дня (0..6 или -1), нормализованное
 * имя дня и строку даты (если есть). Терпим к форматам:
 *   • "Пн"
 *   • "Пн\n09.02"
 *   • "Пн\n09.02.2026"
 *   • "Пн 09.02" (через пробел)
 * Регистронезависим для имени дня.
 */
function parseDayCell_(raw) {
  var s = String(raw || '').trim();
  if (!s) return {dayIndex: -1, dayName: '', date: ''};
  // Берём первый «токен» — до пробела/переноса.
  var match = s.match(/^\s*([А-ЯЁа-яё]{2,3})/);
  if (!match) return {dayIndex: -1, dayName: '', date: ''};
  var first = match[1];
  // Нормализуем: «пн» → «Пн».
  var normalized = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  var idx = DAY_NAMES_.indexOf(normalized);
  if (idx < 0) return {dayIndex: -1, dayName: '', date: ''};
  // Ищем дату в остатке.
  var rest = s.slice(match[0].length);
  var dateMatch = rest.match(/(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/);
  return {
    dayIndex: idx,
    dayName: normalized,
    date: dateMatch ? dateMatch[1] : ''
  };
}

/**
 * Метаданные таблицы: курс, семестр, группы.
 */
function getSheetMeta_(ss) {
  var sheets = ss.getSheets();
  var weekSheets = sheets.filter(function(s) {
    var name = s.getName();
    return /неделя\)?\s*$/.test(name) && !/черновик/i.test(name);
  });
  if (!weekSheets.length) throw new Error('Не найдены листы расписания');

  var firstSheet = weekSheets[0];
  // Курс: явный override (из меню «🎓 Курс: …») имеет приоритет над A2.
  var override = getCourseOverride_();
  var course;
  if (override) {
    course = override;
  } else {
    var courseVal = firstSheet.getRange('A2').getValue();
    course = typeof courseVal === 'number' ? courseVal : parseInt(courseVal, 10) || null;
  }
  var semesterMatch = String(firstSheet.getRange('D1').getValue() || '').match(/(\d+)\s*семестр/);
  var semester = semesterMatch ? parseInt(semesterMatch[1], 10) : null;
  var groups = discoverGroups_(firstSheet);
  var groupsMeta = groups.map(function(g) {
    return {id: g.id, name: g.name, specialty: g.specialty, department: g.department};
  });
  return {weekSheets: weekSheets, course: course, semester: semester, groups: groups, groupsMeta: groupsMeta};
}

/**
 * Пушит один лист в GitHub + webhook.
 */
function pushSheet_(ws, meta, token) {
  var sheetName = ws.getName().trim();
  var weekMatch = sheetName.match(/(\d+)-я неделя/);
  var weekNumber = weekMatch ? parseInt(weekMatch[1], 10) : 0;
  var dateMatch = sheetName.match(/^([\d.]+\s*-\s*[\d.]+)/);
  var dateRange = dateMatch ? dateMatch[1] : '';

  var lessons = parseWeekSheet_(ws, meta.groups);

  var json = {
    name: sheetName,
    generated_at: new Date().toISOString(),
    course: meta.course,
    semester: meta.semester,
    week_number: weekNumber,
    date_range: dateRange,
    groups: meta.groupsMeta,
    lessons: lessons,
  };

  var courseDir = 'course_' + (meta.course || 'unknown');
  var fileName = (weekNumber || sheetName.replace(/[\s/\\:*?"<>|]/g, '_')) + '.json';
  var filePath = SCHEDULE_DIR + courseDir + '/' + fileName;
  var content = JSON.stringify(json, null, 2);
  pushFileToGitHub_(filePath, content, token);
  notifyWebhook_(filePath, json);
}

/**
 * Экспорт одного листа (при onEdit).
 */
function exportSingleSheet_(ss, sheetName, token) {
  var meta = getSheetMeta_(ss);
  var targetSheet = null;
  for (var i = 0; i < meta.weekSheets.length; i++) {
    if (meta.weekSheets[i].getName().trim() === sheetName.trim()) {
      targetSheet = meta.weekSheets[i];
      break;
    }
  }
  if (!targetSheet) {
    console.log('Sheet "' + sheetName + '" is not a week sheet, skipping');
    return;
  }
  pushSheet_(targetSheet, meta, token);
}

/**
 * Экспорт всех листов (manual-menu / form).
 */
function exportAllSheets_(ss, token) {
  var meta = getSheetMeta_(ss);
  for (var i = 0; i < meta.weekSheets.length; i++) {
    pushSheet_(meta.weekSheets[i], meta, token);
  }
}

/**
 * Уведомление Go backend о новом файле.
 * WEBHOOK_URL задаётся в Script Properties.
 */
function notifyWebhook_(filePath, json) {
  var webhookUrl = PropertiesService.getScriptProperties().getProperty('WEBHOOK_URL');
  if (!webhookUrl) return;

  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        event: 'schedule_updated',
        file: filePath,
        course: json.course,
        semester: json.semester,
        week_number: json.week_number,
        date_range: json.date_range,
        name: json.name,
        generated_at: json.generated_at,
        lessons_count: json.lessons.length,
      }),
      muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('webhook error: ' + err.message);
  }
}

/**
 * Определяет группы из строки 5 листа.
 * Каждая группа занимает 2 колонки: контент + аудитория.
 */
function discoverGroups_(sheet) {
  var lastCol = sheet.getLastColumn();
  var row4 = sheet.getRange(4, 1, 1, lastCol).getValues()[0];
  var row5 = sheet.getRange(5, 1, 1, lastCol).getValues()[0];

  // Определяем кафедры из строки 4 (заполняем пробелы merged-ячеек)
  var departments = [];
  var currentDept = '';
  for (var c = 0; c < lastCol; c++) {
    var v4 = String(row4[c] || '').trim();
    if (v4) currentDept = v4;
    departments[c] = currentDept;
  }

  var groups = [];
  for (var c = 0; c < lastCol; c++) {
    var val = String(row5[c] || '').trim();
    if (!val.match(/^Группа\s/)) continue;
    var parts = val.split('\n');
    var idMatch = parts[0].match(/Группа\s+(.+)/);
    var groupId = idMatch ? idMatch[1].trim() : String(c);
    groups.push({
      id: groupId,
      name: parts[0].trim(),
      specialty: parts.length > 1 ? parts.slice(1).join(' ').trim() : '',
      department: departments[c] || '',
      content_col: c + 1,
      room_col: c + 2,
    });
  }
  return groups;
}

/**
 * Парсит один лист-неделю.
 */
function parseWeekSheet_(sheet, groups) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 6 || lastCol < 4) return [];

  var dataRange = sheet.getRange(1, 1, lastRow, lastCol);
  var allValues = dataRange.getValues();
  var allBgs = dataRange.getBackgrounds();
  var allRichTexts = dataRange.getRichTextValues();

  // Карта merged-ячеек: mergeMap[row][col] = {startRow, numRows}
  var mergeMap = {};
  var mergedRanges = dataRange.getMergedRanges();
  for (var m = 0; m < mergedRanges.length; m++) {
    var mr = mergedRanges[m];
    var startR = mr.getRow();
    var startC = mr.getColumn();
    var numR = mr.getNumRows();
    if (numR > 1) {
      if (!mergeMap[startR]) mergeMap[startR] = {};
      mergeMap[startR][startC] = numR;
    }
  }

  var lessons = [];
  var currentDay = '';
  var currentDayNum = 0;
  var currentDate = '';  // строка DD.MM или DD.MM.YYYY, если день промечен датой

  for (var r = 5; r < lastRow; r++) {
    var rawDay = String(allValues[r][0] || '');
    var parsedDay = parseDayCell_(rawDay);
    if (parsedDay.dayIndex >= 0) {
      currentDay = parsedDay.dayName;
      currentDayNum = parsedDay.dayIndex + 1;
      currentDate = parsedDay.date;
    }

    var pair = allValues[r][1];
    var time = String(allValues[r][2] || '').replace(/\n/g, ' ').trim();
    if (!pair || !currentDay) continue;
    pair = typeof pair === 'number' ? pair : parseInt(pair, 10);
    if (isNaN(pair)) continue;

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var colIdx = group.content_col - 1;
      var roomColIdx = group.room_col - 1;
      if (colIdx >= lastCol) continue;

      var cellValue = String(allValues[r][colIdx] || '').trim();
      if (!cellValue) continue;

      var bg = (allBgs[r][colIdx] || '').toLowerCase();
      var type = COLOR_TO_TYPE_MAP_[bg] || 'unknown';
      var roomValue = roomColIdx < lastCol ? String(allValues[r][roomColIdx] || '') : '';

      // Определяем duration (количество пар) из merged range
      var duration = 1;
      var col1based = colIdx + 1;
      var row1based = r + 1;
      if (mergeMap[row1based] && mergeMap[row1based][col1based]) {
        duration = mergeMap[row1based][col1based];
      }

      var richText = allRichTexts[r][colIdx];
      var parsed = parseRichLessonCell_(richText, roomValue);
      for (var p = 0; p < parsed.length; p++) {
        var entry = parsed[p];
        lessons.push({
          day: currentDay,
          day_number: currentDayNum,
          date: currentDate || null,
          pair: pair,
          duration: duration,
          time: time,
          group: group.id,
          type: type,
          subject: entry.subject,
          teacher: entry.teacher,
          room: entry.room,
          subgroup: entry.subgroup || null,
          frequency: entry.frequency || null,
          period_start: entry.period_start || null,
          period_end: entry.period_end || null,
          comment: entry.comment || null,
          cancelled: entry.cancelled || false,
        });
      }
    }
  }
  return lessons;
}

/**
 * Парсит ячейку занятия используя RichText (стили текста).
 * Формат ячейки (создаётся buildCellContent_ / applyLesson):
 *   [даты]       — RED: "с 03.03 по 26.05"
 *   предмет      — BOLD BLACK
 *   [подгруппа]  — RED: "1ПГ/2ПГ нечет/чет"
 *   [преподаватель] — NORMAL BLACK
 *   [комментарий] — RED
 *   [ОТМЕНА]      — BOLD RED
 * Блоки разделены ───────────────
 */
function parseRichLessonCell_(richText, roomValue) {
  if (!richText) return [];
  var text = richText.getText();
  if (!text || !text.trim()) return [];

  var rooms = (roomValue || '').split('\n')
    .map(function(s) { return s.trim(); })
    .filter(function(s) { return s && !/^[─━\-]+$/.test(s); });
  rooms = rooms.map(function(r) { return r.replace(/\.0$/, ''); });

  // Получаем стили из RichText runs
  var runs = richText.getRuns();
  var styleMap = buildStyleMap_(runs);

  var lines = text.split('\n');
  var allEntries = [];
  var current = newParseEntry_();
  var foundSubject = false;
  var foundTeacher = false;
  var charPos = 0;

  for (var i = 0; i < lines.length; i++) {
    var rawLine = lines[i];
    var line = rawLine.trim();

    if (!line || /^─{3,}$/.test(line)) {
      if (current.subject) allEntries.push(current);
      current = newParseEntry_();
      foundSubject = false;
      foundTeacher = false;
      charPos += rawLine.length + 1;
      continue;
    }

    // Определяем стиль первого значимого символа строки
    var firstCharPos = charPos;
    for (var j = 0; j < rawLine.length; j++) {
      if (rawLine[j] !== ' ') { firstCharPos = charPos + j; break; }
    }
    var charStyle = styleMap[firstCharPos] || {bold: false, red: false};
    var isBold = charStyle.bold;
    var isRed = charStyle.red;

    if (/^\s*ОТМЕНА\s*$/i.test(line)) {
      current.cancelled = true;
    } else if (isBold && !isRed) {
      // BOLD BLACK = предмет (может быть на несколько строк)
      current.subject = current.subject ? current.subject + ' ' + line : line;
      foundSubject = true;
    } else if (isRed && !foundSubject) {
      // RED перед предметом = даты (период)
      extractPeriod_(line, current);
    } else if (isRed && foundSubject && !foundTeacher) {
      // RED после предмета, до преподавателя = подгруппа
      current.subgroup = line;
      if (/нечет\/чет|чет\/нечет/.test(line)) current.frequency = line.match(/нечет\/чет|чет\/нечет/)[0];
      else if (/\bнечет\b/i.test(line)) current.frequency = 'нечет';
      else if (/\bчет\b/i.test(line)) current.frequency = 'чет';
      else if (/еженедел/i.test(line)) current.frequency = 'еженедельно';
    } else if (!isBold && !isRed && foundSubject) {
      // NORMAL BLACK после предмета = преподаватель
      current.teacher = current.teacher ? current.teacher + ', ' + line : line;
      foundTeacher = true;
    } else if (isRed && foundTeacher) {
      // RED после преподавателя = комментарий
      current.comment = current.comment ? current.comment + '; ' + line : line;
    } else if (!foundSubject) {
      // Fallback: нестилизованный текст до предмета → предмет
      current.subject = current.subject ? current.subject + ' ' + line : line;
      foundSubject = true;
    } else {
      current.comment = current.comment ? current.comment + '; ' + line : line;
    }

    charPos += rawLine.length + 1;
  }
  if (current.subject) allEntries.push(current);

  // Назначаем аудитории
  for (var e = 0; e < allEntries.length; e++) {
    allEntries[e].room = rooms[e] !== undefined ? rooms[e] : (rooms[0] || '');
    allEntries[e].subject = allEntries[e].subject.replace(/\\/g, ' ').replace(/\s+/g, ' ').trim();
  }
  allEntries = allEntries.filter(function(e) { return e.subject; });
  return allEntries;
}

function newParseEntry_() {
  return {
    subject: '', teacher: '', room: '', subgroup: '',
    frequency: '', period_start: '', period_end: '',
    comment: '', cancelled: false,
  };
}

/** Строит карту: charIndex → {bold, red} из RichText runs */
function buildStyleMap_(runs) {
  var map = {};
  for (var r = 0; r < runs.length; r++) {
    var run = runs[r];
    var style = run.getTextStyle();
    var start = run.getStartIndex();
    var end = run.getEndIndex();
    var info = {
      bold: !!style.isBold(),
      red: (style.getForegroundColor() || '').toLowerCase() === '#ff0000',
    };
    for (var c = start; c < end; c++) {
      map[c] = info;
    }
  }
  return map;
}

/** Извлекает даты периода из строки в поля period_start / period_end */
function extractPeriod_(line, entry) {
  var combined = line.match(/с\s+(\d{1,2}\.\d{2})\s+по\s+(\d{1,2}\.\d{2})/);
  if (combined) {
    entry.period_start = combined[1];
    entry.period_end = combined[2];
    return;
  }
  var endMatch = line.match(/по\s+(\d{1,2}\.\d{2})/);
  if (endMatch) { entry.period_end = endMatch[1]; return; }
  var startMatch = line.match(/с\s+(\d{1,2}\.\d{2})/);
  if (startMatch) { entry.period_start = startMatch[1]; return; }
  // Месяцы: "с апреля", "по мая"
  var monthStart = line.match(/с\s+(январ\S*|феврал\S*|март\S*|апрел\S*|ма\S*|июн\S*|июл\S*|август\S*|сентябр\S*|октябр\S*|ноябр\S*|декабр\S*)/i);
  if (monthStart) { entry.period_start = monthStart[1]; return; }
  // Остальное — в комментарий
  entry.comment = entry.comment ? entry.comment + '; ' + line : line;
}

// ──────────────────────────────────────────────────────────────────────────
// Пуш файла в GitHub через Contents API
// ──────────────────────────────────────────────────────────────────────────

function pushFileToGitHub_(path, content, token) {
  var base = 'https://api.github.com/repos/' + GH_REPO_OWNER + '/' + GH_REPO_NAME;
  var url = base + '/contents/' + path;
  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
  };

  // Получаем SHA текущего файла (если существует)
  var sha = null;
  try {
    var getResp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: headers,
      muteHttpExceptions: true,
    });
    if (getResp.getResponseCode() === 200) {
      sha = JSON.parse(getResp.getContentText()).sha;
    }
  } catch (_) { /* файл не существует */ }

  var payload = {
    message: 'chore: обновление ' + path.split('/').pop(),
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: 'main',
  };
  if (sha) payload.sha = sha;

  var putResp = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = putResp.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub API: ' + code + ' ' + putResp.getContentText().substring(0, 200));
  }
}

/** Ручной тест экспорта — можно запустить из редактора Apps Script. */
function testDispatch() {
  var result = dispatchScheduleUpdate_('manual-test', 'A1');
  SpreadsheetApp.getUi().alert(dispatchResultMessage_(result));
}
