// ──────────────────────────────────────────────────────────────────────────
// Template.gs — снятие и воспроизведение структуры листа расписания.
//
// Цель: захватить ВСЁ форматирование существующего листа (значения, шрифты,
// фоны, выравнивания, wrap, ширины колонок, высоты строк, freeze, мержи,
// rich-text) — так, чтобы из получившегося JSON можно было создать
// пиксель-в-пиксель идентичный лист на пустой таблице.
//
// Это фундамент для будущего генератора пустого семестра: один раз
// снимаем эталон, дальше плодим листы с правильными датами.
//
// Ограничения v1 (документируем явно):
//   • Границы (borders) не захватываются — Apps Script не даёт публичного
//     API для чтения. Применяются захардкоженным паттерном «сетка расписания»
//     в applyDefaultBorders_ на основе ширины колонок/высоты строк шаблона
//     (см. функцию ниже).
//   • Условное форматирование не захватывается.
//   • Data validations не захватываются.
//   • Защиты листа (protections) не захватываются.
//   • Заметки (notes) не захватываются — не используются.
// ──────────────────────────────────────────────────────────────────────────

var TEMPLATE_STORE_SHEET_ = '_TEMPLATE_';
var TEMPLATE_VERSION_     = 1;
var TEMPLATE_CHUNK_SIZE_  = 45000; // безопасный размер для одной ячейки

// ──────────────────────────────────────────────────────────────────────────
// Меню-обёртки (вызываются из onOpen)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Снимает шаблон с активного листа и сохраняет его в скрытый лист _TEMPLATE_.
 * Также печатает сводку в Logger.
 */
function extractActiveSheetAsTemplate() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getActiveSheet();
  var name = sheet.getName();
  if (name.charAt(0) === '_') {
    ui.alert('Это служебный лист (имя начинается с «_»). Откройте лист расписания и попробуйте снова.');
    return;
  }
  var t0 = Date.now();
  var template = extractSheetTemplate_(sheet);
  var elapsedExtract = Date.now() - t0;

  var json = JSON.stringify(template);
  saveTemplate_(template);
  var elapsedSave = Date.now() - t0 - elapsedExtract;

  Logger.log('Template extracted from "%s" in %d ms (save %d ms). Size: %d chars / %d rows / %d cols / %d merges / %d rich cells.',
    name, elapsedExtract, elapsedSave, json.length,
    template.max_rows, template.max_cols, template.merges.length, template.rich.length);

  ui.alert(
    'Шаблон сохранён',
    'Лист «' + name + '» → шаблон ' + template.max_rows + '×' + template.max_cols +
    ', мержей ' + template.merges.length +
    ', rich-ячеек ' + template.rich.length +
    '.\nЗатрачено: ' + (elapsedExtract + elapsedSave) + ' мс.' +
    '\n\nДля проверки запустите «Создать лист по шаблону» или «Тест round-trip шаблона».',
    ui.ButtonSet.OK
  );
}

/**
 * Создаёт новый лист по сохранённому шаблону. Имя нового листа спрашивает
 * у пользователя.
 */
function createSheetFromTemplate() {
  var ui = SpreadsheetApp.getUi();
  var template = loadTemplate_();
  if (!template) {
    ui.alert('Шаблон не найден. Сначала снимите его с эталонного листа («Снять шаблон с активного листа»).');
    return;
  }
  var resp = ui.prompt(
    'Имя нового листа',
    'Введите имя нового листа (например, «09.02-14.02 (1-я неделя)»).',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var newName = (resp.getResponseText() || '').trim();
  if (!newName) { ui.alert('Имя не задано.'); return; }
  var ss = SpreadsheetApp.getActive();
  if (ss.getSheetByName(newName)) {
    ui.alert('Лист с таким именем уже существует. Удалите его или выберите другое имя.');
    return;
  }
  var t0 = Date.now();
  var sheet = ss.insertSheet(newName);
  applyTemplate_(sheet, template);
  Logger.log('Sheet "%s" created from template in %d ms.', newName, Date.now() - t0);
  ui.alert('Лист «' + newName + '» создан по шаблону за ' + (Date.now() - t0) + ' мс.');
}

/**
 * Открывает модалку с JSON шаблона для вставки в `BundledTemplate.gs`.
 * Если шаблон уже сохранён в `_TEMPLATE_` — берёт его. Иначе снимает с активного
 * листа на лету.
 */
function exportTemplateToCode() {
  var ui = SpreadsheetApp.getUi();
  var template = loadTemplate_();
  if (!template) {
    var ss = SpreadsheetApp.getActive();
    var src = ss.getActiveSheet();
    if (src.getName().charAt(0) === '_') {
      ui.alert('Откройте лист расписания (не служебный) или сначала снимите шаблон.');
      return;
    }
    template = extractSheetTemplate_(src);
  }
  var json = JSON.stringify(template);
  // Экранируем для JS-литерала: " и \ и переносы строк.
  var escaped = json
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var literal = 'var BUNDLED_TEMPLATE_JSON_ = "' + escaped + '";';
  var size = literal.length;

  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial,sans-serif;margin:8px;}textarea{width:100%;height:380px;font-family:monospace;font-size:11px;}small{color:#666;}</style>' +
    '<p>Скопируйте строку ниже и вставьте её в <code>BundledTemplate.gs</code>, заменив строку <code>var BUNDLED_TEMPLATE_JSON_ = null;</code>.</p>' +
    '<small>Размер: ' + size + ' символов. Источник: ' + (getTemplateSource_() || 'active sheet') + '.</small>' +
    '<textarea id="t" readonly onclick="this.select()"></textarea>' +
    '<p><button onclick="copy()">Скопировать в буфер</button> ' +
    '<span id="msg" style="margin-left:8px;color:green;"></span></p>' +
    '<script>' +
    'var data = ' + JSON.stringify(literal) + ';' +
    'document.getElementById("t").value = data;' +
    'function copy() {' +
    '  var t = document.getElementById("t"); t.select(); t.setSelectionRange(0, 99999999);' +
    '  try { document.execCommand("copy"); document.getElementById("msg").textContent = "Скопировано"; }' +
    '  catch(e) { document.getElementById("msg").textContent = "Не получилось — выделите вручную и Ctrl+C"; }' +
    '}' +
    '</script>'
  ).setWidth(720).setHeight(560);
  ui.showModalDialog(html, 'BUNDLED_TEMPLATE_JSON_ для BundledTemplate.gs');
}

/**
 * Round-trip тест: снимает шаблон с активного листа, создаёт временный лист,
 * применяет к нему шаблон, снимает шаблон с временного листа, сравнивает.
 * Временный лист удаляется в конце.
 */
function verifyTemplateRoundTrip() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var src = ss.getActiveSheet();
  if (src.getName().charAt(0) === '_') {
    ui.alert('Откройте лист расписания (не служебный).');
    return;
  }

  var tmpName = '_RT_' + Date.now();
  var tmp = null;
  try {
    var t0 = Date.now();
    var template1 = extractSheetTemplate_(src);
    var tExtract1 = Date.now() - t0;

    tmp = ss.insertSheet(tmpName);
    var t1 = Date.now();
    applyTemplate_(tmp, template1);
    var tApply = Date.now() - t1;

    var t2 = Date.now();
    var template2 = extractSheetTemplate_(tmp);
    var tExtract2 = Date.now() - t2;

    var diffs = compareTemplates_(template1, template2);
    Logger.log('Round-trip: extract %d ms, apply %d ms, re-extract %d ms. Diffs: %d.',
      tExtract1, tApply, tExtract2, diffs.length);
    if (diffs.length === 0) {
      ui.alert('Round-trip OK',
        'Шаблон извлечён и применён без расхождений.\n\n' +
        'Размер: ' + template1.max_rows + '×' + template1.max_cols + '.\n' +
        'Время: extract ' + tExtract1 + ' мс, apply ' + tApply + ' мс, re-extract ' + tExtract2 + ' мс.',
        ui.ButtonSet.OK);
    } else {
      var preview = diffs.slice(0, 25).join('\n');
      Logger.log('Differences:\n%s', diffs.join('\n'));
      ui.alert('Round-trip: ' + diffs.length + ' расхождений',
        'Первые расхождения:\n\n' + preview + (diffs.length > 25 ? '\n\n…ещё ' + (diffs.length - 25) + '. См. Logger.' : ''),
        ui.ButtonSet.OK);
    }
  } finally {
    if (tmp) { try { ss.deleteSheet(tmp); } catch (_) {} }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// extractSheetTemplate_ — снимает всё с листа
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {{
 *   version: number,
 *   sheet_name: string,
 *   max_rows: number,
 *   max_cols: number,
 *   frozen_rows: number,
 *   frozen_cols: number,
 *   col_widths: number[],
 *   row_heights: number[],
 *   cells: {v: any, f: string|null, bg: string, ff: string, fs: number,
 *           fw: string, fst: string, fc: string,
 *           ha: string, va: string, wr: string, nf: string}[][],
 *   rich: {row:number, col:number, text:string, runs: object[]}[],
 *   merges: {row:number, col:number, num_rows:number, num_cols:number}[]
 * }}
 */
function extractSheetTemplate_(sheet) {
  var maxRows = sheet.getMaxRows();
  var maxCols = sheet.getMaxColumns();
  var range   = sheet.getRange(1, 1, maxRows, maxCols);

  var values        = range.getValues();
  var formulas      = range.getFormulas();
  var backgrounds   = range.getBackgrounds();
  var fontFamilies  = range.getFontFamilies();
  var fontSizes     = range.getFontSizes();
  var fontWeights   = range.getFontWeights();
  var fontStyles    = range.getFontStyles();
  var fontColors    = range.getFontColors();
  var hAlignments   = range.getHorizontalAlignments();
  var vAlignments   = range.getVerticalAlignments();
  var wraps         = range.getWrapStrategies(); // enum
  var numberFormats = range.getNumberFormats();
  var richValues    = range.getRichTextValues();

  // Ширины колонок и высоты строк
  var colWidths = new Array(maxCols);
  for (var c = 1; c <= maxCols; c++) colWidths[c - 1] = sheet.getColumnWidth(c);
  var rowHeights = new Array(maxRows);
  for (var r = 1; r <= maxRows; r++) rowHeights[r - 1] = sheet.getRowHeight(r);

  // Свод по ячейкам
  var cells = new Array(maxRows);
  for (var r = 0; r < maxRows; r++) {
    var rowArr = new Array(maxCols);
    for (var c = 0; c < maxCols; c++) {
      var v  = values[r][c];
      var fo = formulas[r][c];
      rowArr[c] = {
        v:  v === '' ? '' : serializeValue_(v),
        f:  fo || null,
        bg: backgrounds[r][c]   || '#ffffff',
        ff: fontFamilies[r][c]  || 'Arial',
        fs: fontSizes[r][c]     || 10,
        fw: fontWeights[r][c]   || 'normal',
        fst: fontStyles[r][c]   || 'normal',
        fc: fontColors[r][c]    || '#000000',
        ha: hAlignments[r][c]   || 'general',
        va: vAlignments[r][c]   || 'bottom',
        wr: wrapStrategyName_(wraps[r][c]),
        nf: numberFormats[r][c] || ''
      };
    }
    cells[r] = rowArr;
  }

  // RichText: сохраняем только те ячейки, где есть НЕТРИВИАЛЬНОЕ форматирование
  // (более одного run, либо стиль внутри run отличается от cell-level).
  var rich = [];
  for (var r = 0; r < maxRows; r++) {
    for (var c = 0; c < maxCols; c++) {
      var rtv = richValues[r] && richValues[r][c];
      if (!rtv) continue;
      var text = rtv.getText();
      if (!text) continue;
      var runs = rtv.getRuns();
      if (!runs || runs.length === 0) continue;
      // Однородный текст (1 run) без переходов стиля можно не сохранять —
      // cell-level форматирование его покроет. Но если в run есть явно
      // заданные стили, отличные от cell-level, всё равно сохраним.
      var significant = runs.length > 1 || runHasExplicitStyle_(runs[0]);
      if (!significant) continue;
      rich.push({
        row: r + 1,
        col: c + 1,
        text: text,
        runs: runs.map(serializeRun_)
      });
    }
  }

  // Мержи
  var mergedRanges = sheet.getRange(1, 1, maxRows, maxCols).getMergedRanges();
  var merges = mergedRanges.map(function (rng) {
    return {
      row: rng.getRow(),
      col: rng.getColumn(),
      num_rows: rng.getNumRows(),
      num_cols: rng.getNumColumns()
    };
  });

  return {
    version: TEMPLATE_VERSION_,
    sheet_name: sheet.getName(),
    max_rows: maxRows,
    max_cols: maxCols,
    frozen_rows: sheet.getFrozenRows(),
    frozen_cols: sheet.getFrozenColumns(),
    col_widths: colWidths,
    row_heights: rowHeights,
    cells: cells,
    rich: rich,
    merges: merges
  };
}

/** Преобразует значение в JSON-сериализуемый формат. */
function serializeValue_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return { __date: v.toISOString() };
  return v; // строки, числа, boolean — как есть
}

/** Восстанавливает значение из serializeValue_. */
function deserializeValue_(v) {
  if (v && typeof v === 'object' && v.__date) return new Date(v.__date);
  return v;
}

/** Имя стратегии wrap → строка. */
function wrapStrategyName_(s) {
  // s — это enum SpreadsheetApp.WrapStrategy
  if (!s) return 'OVERFLOW';
  try {
    if (s === SpreadsheetApp.WrapStrategy.WRAP)     return 'WRAP';
    if (s === SpreadsheetApp.WrapStrategy.OVERFLOW) return 'OVERFLOW';
    if (s === SpreadsheetApp.WrapStrategy.CLIP)     return 'CLIP';
  } catch (_) {}
  return String(s);
}

function wrapStrategyFromName_(name) {
  if (name === 'WRAP')     return SpreadsheetApp.WrapStrategy.WRAP;
  if (name === 'OVERFLOW') return SpreadsheetApp.WrapStrategy.OVERFLOW;
  if (name === 'CLIP')     return SpreadsheetApp.WrapStrategy.CLIP;
  return SpreadsheetApp.WrapStrategy.OVERFLOW;
}

// ──────────────────────────────────────────────────────────────────────────
// RichText helpers
// ──────────────────────────────────────────────────────────────────────────

/** Сохраняет один run (отрезок RichTextValue) в JSON. */
function serializeRun_(run) {
  var style = run.getTextStyle();
  return {
    s:   run.getStartIndex(),
    e:   run.getEndIndex(),
    b:   safeStyle_(style, 'isBold'),
    i:   safeStyle_(style, 'isItalic'),
    u:   safeStyle_(style, 'isUnderline'),
    st:  safeStyle_(style, 'isStrikethrough'),
    ff:  safeStyle_(style, 'getFontFamily'),
    fs:  safeStyle_(style, 'getFontSize'),
    fc:  safeStyle_(style, 'getForegroundColor')
  };
}

/** Безопасный вызов метода TextStyle (возвращает null, если бросает). */
function safeStyle_(style, method) {
  if (!style) return null;
  try { return style[method](); } catch (_) { return null; }
}

/** Есть ли в run явно заданные стили (не дефолт). */
function runHasExplicitStyle_(run) {
  var style = run.getTextStyle();
  if (!style) return false;
  if (safeStyle_(style, 'isBold')) return true;
  if (safeStyle_(style, 'isItalic')) return true;
  if (safeStyle_(style, 'isUnderline')) return true;
  if (safeStyle_(style, 'isStrikethrough')) return true;
  var fc = safeStyle_(style, 'getForegroundColor');
  if (fc && fc !== '#000000') return true;
  var ff = safeStyle_(style, 'getFontFamily');
  if (ff && ff !== 'Arial') return true;
  var fs = safeStyle_(style, 'getFontSize');
  if (fs && fs !== 10) return true;
  return false;
}

/** Восстанавливает RichTextValue из сериализованного объекта. */
function buildRichTextValue_(obj) {
  var builder = SpreadsheetApp.newRichTextValue().setText(obj.text);
  for (var i = 0; i < obj.runs.length; i++) {
    var r = obj.runs[i];
    var sb = SpreadsheetApp.newTextStyle();
    if (r.b !== null && r.b !== undefined) sb = sb.setBold(!!r.b);
    if (r.i !== null && r.i !== undefined) sb = sb.setItalic(!!r.i);
    if (r.u !== null && r.u !== undefined) sb = sb.setUnderline(!!r.u);
    if (r.st !== null && r.st !== undefined) sb = sb.setStrikethrough(!!r.st);
    if (r.ff) sb = sb.setFontFamily(r.ff);
    if (r.fs) sb = sb.setFontSize(r.fs);
    if (r.fc) sb = sb.setForegroundColor(r.fc);
    builder = builder.setTextStyle(r.s, r.e, sb.build());
  }
  return builder.build();
}

// ──────────────────────────────────────────────────────────────────────────
// applyTemplate_ — воспроизводит лист из шаблона
// ──────────────────────────────────────────────────────────────────────────

/**
 * Применяет шаблон к листу. Лист должен быть пустым (стандартный insertSheet).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {object} template — результат extractSheetTemplate_
 */
function applyTemplate_(sheet, template) {
  // 1. Размер листа
  var curRows = sheet.getMaxRows();
  var curCols = sheet.getMaxColumns();
  if (template.max_rows > curRows) sheet.insertRowsAfter(curRows, template.max_rows - curRows);
  else if (template.max_rows < curRows) sheet.deleteRows(template.max_rows + 1, curRows - template.max_rows);
  if (template.max_cols > curCols) sheet.insertColumnsAfter(curCols, template.max_cols - curCols);
  else if (template.max_cols < curCols) sheet.deleteColumns(template.max_cols + 1, curCols - template.max_cols);

  var maxRows = template.max_rows;
  var maxCols = template.max_cols;
  var range = sheet.getRange(1, 1, maxRows, maxCols);

  // 2. Подготавливаем 2D-массивы для batch-вызовов
  var values        = new Array(maxRows);
  var formulas      = new Array(maxRows);
  var backgrounds   = new Array(maxRows);
  var fontFamilies  = new Array(maxRows);
  var fontSizes     = new Array(maxRows);
  var fontWeights   = new Array(maxRows);
  var fontStyles    = new Array(maxRows);
  var fontColors    = new Array(maxRows);
  var hAlignments   = new Array(maxRows);
  var vAlignments   = new Array(maxRows);
  var wraps         = new Array(maxRows);
  var numberFormats = new Array(maxRows);
  var hasFormula    = false;

  for (var r = 0; r < maxRows; r++) {
    values[r]        = new Array(maxCols);
    formulas[r]      = new Array(maxCols);
    backgrounds[r]   = new Array(maxCols);
    fontFamilies[r]  = new Array(maxCols);
    fontSizes[r]     = new Array(maxCols);
    fontWeights[r]   = new Array(maxCols);
    fontStyles[r]    = new Array(maxCols);
    fontColors[r]    = new Array(maxCols);
    hAlignments[r]   = new Array(maxCols);
    vAlignments[r]   = new Array(maxCols);
    wraps[r]         = new Array(maxCols);
    numberFormats[r] = new Array(maxCols);
    for (var c = 0; c < maxCols; c++) {
      var cell = template.cells[r][c];
      values[r][c]        = deserializeValue_(cell.v);
      formulas[r][c]      = cell.f || '';
      if (cell.f) hasFormula = true;
      backgrounds[r][c]   = cell.bg;
      fontFamilies[r][c]  = cell.ff;
      fontSizes[r][c]     = cell.fs;
      fontWeights[r][c]   = cell.fw;
      fontStyles[r][c]    = cell.fst;
      fontColors[r][c]    = cell.fc;
      hAlignments[r][c]   = cell.ha;
      vAlignments[r][c]   = cell.va;
      wraps[r][c]         = wrapStrategyFromName_(cell.wr);
      numberFormats[r][c] = cell.nf || '';
    }
  }

  // 3. Размеры колонок и строк — до записи значений (быстрее)
  for (var c2 = 0; c2 < maxCols; c2++) {
    sheet.setColumnWidth(c2 + 1, template.col_widths[c2]);
  }
  for (var r2 = 0; r2 < maxRows; r2++) {
    sheet.setRowHeight(r2 + 1, template.row_heights[r2]);
  }

  // 4. Freeze
  sheet.setFrozenRows(template.frozen_rows || 0);
  sheet.setFrozenColumns(template.frozen_cols || 0);

  // 5. Batch-применение значений и форматов
  range.setValues(values);
  if (hasFormula) range.setFormulas(formulas); // только если есть хоть одна формула
  range.setBackgrounds(backgrounds);
  range.setFontFamilies(fontFamilies);
  range.setFontSizes(fontSizes);
  range.setFontWeights(fontWeights);
  range.setFontStyles(fontStyles);
  range.setFontColors(fontColors);
  range.setHorizontalAlignments(hAlignments);
  range.setVerticalAlignments(vAlignments);
  range.setWrapStrategies(wraps);
  range.setNumberFormats(numberFormats);

  // 6. RichText (поячейково)
  for (var i = 0; i < template.rich.length; i++) {
    var rt = template.rich[i];
    sheet.getRange(rt.row, rt.col).setRichTextValue(buildRichTextValue_(rt));
  }

  // 7. Мержи
  for (var j = 0; j < template.merges.length; j++) {
    var m = template.merges[j];
    sheet.getRange(m.row, m.col, m.num_rows, m.num_cols).merge();
  }

  // 8. Границы (захардкожены — Apps Script не даёт API для чтения borders).
  applyDefaultBorders_(sheet, template);
}

// ──────────────────────────────────────────────────────────────────────────
// applyDefaultBorders_ — захардкоженный паттерн «сетка расписания»
//
// Apps Script не отдаёт текущие границы ячеек через публичный API, поэтому
// мы их не сохраняем в шаблоне, а восстанавливаем эвристикой по структуре:
//
//   • Шапка таблицы — строки 1..5 (frozen_rows): без границ от нас, оставляем
//     то, что записано в исходных значениях.
//   • Узкие строки высотой 21px ниже шапки — «серые разделители» между днями,
//     своих границ не получают.
//   • Узкие колонки шириной 21px начиная с col >= 4 — серые вертикальные
//     полосы-разделители между блоками подгрупп; получают толстые вертикали
//     по бокам внутри каждого блока дня.
//   • Остальные строки группируются в «блоки дня» (подряд идущие
//     не-разделители). Внутри блока — тонкая чёрная сетка на весь блок.
//   • Сверху первой строки и снизу последней строки блока — толстая
//     горизонталь на всю ширину.
//
// Это даёт визуальный паттерн исходного листа: тонкая сетка с толстыми
// «рамками» вокруг блока дня и толстыми вертикалями вокруг серых
// колонок-разделителей. Если макет шаблона поменяется — функция продолжит
// работать корректно для любого варианта с такой же структурой узких
// разделительных строк/колонок.
// ──────────────────────────────────────────────────────────────────────────

function applyDefaultBorders_(sheet, template) {
  var BLACK = '#000000';
  var THIN  = SpreadsheetApp.BorderStyle.SOLID;
  var THICK = SpreadsheetApp.BorderStyle.SOLID_THICK;

  var maxRows = template.max_rows;
  var maxCols = template.max_cols;
  var frozenRows = template.frozen_rows || 0;
  var rowHeights = template.row_heights || [];
  var colWidths  = template.col_widths  || [];

  // Узкие разделительные строки ниже шапки.
  var sepRowSet = {};
  for (var r = frozenRows + 1; r <= maxRows; r++) {
    if (rowHeights[r - 1] === 21) sepRowSet[r] = true;
  }
  // Узкие разделительные колонки в области данных (col >= 4 = после A/B/C).
  var sepCols = [];
  for (var c = 4; c <= maxCols; c++) {
    if (colWidths[c - 1] === 21) sepCols.push(c);
  }

  // Группируем подряд идущие не-разделительные строки в «блоки дня».
  var blocks = [];
  var bStart = 0;
  for (var rr = frozenRows + 1; rr <= maxRows; rr++) {
    if (sepRowSet[rr]) {
      if (bStart) { blocks.push({start: bStart, end: rr - 1}); bStart = 0; }
    } else {
      if (!bStart) bStart = rr;
    }
  }
  if (bStart) blocks.push({start: bStart, end: maxRows});

  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var h = b.end - b.start + 1;
    var rng = sheet.getRange(b.start, 1, h, maxCols);

    // Тонкая сетка по всему блоку.
    rng.setBorder(true, true, true, true, true, true, BLACK, THIN);
    // Толстый верх и низ блока (на всю ширину).
    rng.setBorder(true, null, true, null, null, null, BLACK, THICK);

    // Толстые вертикали по бокам серых колонок-разделителей внутри блока.
    for (var j = 0; j < sepCols.length; j++) {
      var sc = sepCols[j];
      sheet.getRange(b.start, sc, h, 1)
        .setBorder(null, true, null, true, null, null, BLACK, THICK);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Хранилище шаблона (скрытый лист _TEMPLATE_)
// ──────────────────────────────────────────────────────────────────────────

function saveTemplate_(template) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(TEMPLATE_STORE_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(TEMPLATE_STORE_SHEET_);
    sheet.hideSheet();
  }
  sheet.clear();
  var json = JSON.stringify(template);
  var chunks = chunkString_(json, TEMPLATE_CHUNK_SIZE_);
  // A1 — количество чанков, A2..An — сами чанки
  var rows = [[String(chunks.length)]];
  for (var i = 0; i < chunks.length; i++) rows.push([chunks[i]]);
  sheet.getRange(1, 1, rows.length, 1).setValues(rows);
}

/**
 * Загружает шаблон. Приоритет:
 *   1. Скрытый лист `_TEMPLATE_` (per-spreadsheet override).
 *   2. Встроенная константа `BUNDLED_TEMPLATE_JSON_` из BundledTemplate.gs.
 *   3. null.
 *
 * @return {object|null}
 */
function loadTemplate_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(TEMPLATE_STORE_SHEET_);
  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var first = sheet.getRange(1, 1).getValue();
      var n = parseInt(first, 10);
      if (n > 0) {
        var parts = sheet.getRange(2, 1, n, 1).getValues();
        var combined = '';
        for (var i = 0; i < n; i++) combined += String(parts[i][0] || '');
        try { return JSON.parse(combined); } catch (_) { /* fall through */ }
      }
    }
  }
  // Fallback на встроенный шаблон.
  if (typeof BUNDLED_TEMPLATE_JSON_ === 'string' && BUNDLED_TEMPLATE_JSON_) {
    try { return JSON.parse(BUNDLED_TEMPLATE_JSON_); } catch (_) { return null; }
  }
  return null;
}

/**
 * Возвращает источник, из которого загрузился шаблон: 'sheet' | 'bundled' | null.
 */
function getTemplateSource_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(TEMPLATE_STORE_SHEET_);
  if (sheet && sheet.getLastRow() >= 2) {
    var n = parseInt(sheet.getRange(1, 1).getValue(), 10);
    if (n > 0) return 'sheet';
  }
  if (typeof BUNDLED_TEMPLATE_JSON_ === 'string' && BUNDLED_TEMPLATE_JSON_) return 'bundled';
  return null;
}

function chunkString_(str, size) {
  var out = [];
  for (var i = 0; i < str.length; i += size) out.push(str.substr(i, size));
  if (out.length === 0) out.push('');
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// compareTemplates_ — точная диагностика расхождений (для round-trip теста)
// ──────────────────────────────────────────────────────────────────────────

function compareTemplates_(a, b) {
  var diffs = [];
  function push(msg) { if (diffs.length < 500) diffs.push(msg); }

  if (a.max_rows !== b.max_rows) push('max_rows: ' + a.max_rows + ' vs ' + b.max_rows);
  if (a.max_cols !== b.max_cols) push('max_cols: ' + a.max_cols + ' vs ' + b.max_cols);
  if (a.frozen_rows !== b.frozen_rows) push('frozen_rows: ' + a.frozen_rows + ' vs ' + b.frozen_rows);
  if (a.frozen_cols !== b.frozen_cols) push('frozen_cols: ' + a.frozen_cols + ' vs ' + b.frozen_cols);

  // col widths / row heights
  for (var c = 0; c < Math.min(a.col_widths.length, b.col_widths.length); c++) {
    if (a.col_widths[c] !== b.col_widths[c]) {
      push('col_widths[' + (c + 1) + ']: ' + a.col_widths[c] + ' vs ' + b.col_widths[c]);
    }
  }
  for (var r = 0; r < Math.min(a.row_heights.length, b.row_heights.length); r++) {
    if (a.row_heights[r] !== b.row_heights[r]) {
      push('row_heights[' + (r + 1) + ']: ' + a.row_heights[r] + ' vs ' + b.row_heights[r]);
    }
  }

  // cells
  var maxR = Math.min(a.cells.length, b.cells.length);
  for (var rr = 0; rr < maxR; rr++) {
    var maxC = Math.min(a.cells[rr].length, b.cells[rr].length);
    for (var cc = 0; cc < maxC; cc++) {
      var ca = a.cells[rr][cc];
      var cb = b.cells[rr][cc];
      var keys = ['v','f','bg','ff','fs','fw','fst','fc','ha','va','wr','nf'];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var va = JSON.stringify(ca[key]);
        var vb = JSON.stringify(cb[key]);
        if (va !== vb) {
          push('cell[' + (rr + 1) + ',' + (cc + 1) + '].' + key + ': ' + va + ' vs ' + vb);
        }
      }
    }
  }

  // merges
  var ma = a.merges.slice().sort(mergeSort_);
  var mb = b.merges.slice().sort(mergeSort_);
  if (ma.length !== mb.length) {
    push('merges count: ' + ma.length + ' vs ' + mb.length);
  } else {
    for (var mi = 0; mi < ma.length; mi++) {
      if (JSON.stringify(ma[mi]) !== JSON.stringify(mb[mi])) {
        push('merge #' + mi + ': ' + JSON.stringify(ma[mi]) + ' vs ' + JSON.stringify(mb[mi]));
      }
    }
  }

  // rich cells (по (row,col))
  var ra = indexRich_(a.rich);
  var rb = indexRich_(b.rich);
  var allKeys = {};
  Object.keys(ra).forEach(function(k){allKeys[k]=true;});
  Object.keys(rb).forEach(function(k){allKeys[k]=true;});
  Object.keys(allKeys).sort().forEach(function(k){
    var x = ra[k], y = rb[k];
    if (!x) { push('rich missing in source A: ' + k); return; }
    if (!y) { push('rich missing in source B: ' + k); return; }
    if (x.text !== y.text) {
      push('rich[' + k + '].text: ' + JSON.stringify(x.text) + ' vs ' + JSON.stringify(y.text));
      return;
    }
    if (x.runs.length !== y.runs.length) {
      push('rich[' + k + '].runs.length: ' + x.runs.length + ' vs ' + y.runs.length);
      return;
    }
    for (var ri = 0; ri < x.runs.length; ri++) {
      if (JSON.stringify(x.runs[ri]) !== JSON.stringify(y.runs[ri])) {
        push('rich[' + k + '].runs[' + ri + ']: ' + JSON.stringify(x.runs[ri]) + ' vs ' + JSON.stringify(y.runs[ri]));
      }
    }
  });

  return diffs;
}

function mergeSort_(a, b) {
  if (a.row !== b.row) return a.row - b.row;
  if (a.col !== b.col) return a.col - b.col;
  if (a.num_rows !== b.num_rows) return a.num_rows - b.num_rows;
  return a.num_cols - b.num_cols;
}

function indexRich_(rich) {
  var idx = {};
  for (var i = 0; i < rich.length; i++) {
    idx[rich[i].row + ':' + rich[i].col] = rich[i];
  }
  return idx;
}
