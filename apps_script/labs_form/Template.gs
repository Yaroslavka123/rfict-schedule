// ──────────────────────────────────────────────────────────────────────────
// Template.gs — минимальный набор функций для загрузки и применения
// захардкоженного шаблона из BundledTemplate.gs.
//
// Функции извлечения/сохранения/экспорта шаблонов удалены —
// используется только встроенный BUNDLED_TEMPLATE_JSON_.
// ──────────────────────────────────────────────────────────────────────────

var DAY_NAMES_ = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ──────────────────────────────────────────────────────────────────────────
// Загрузка шаблона
// ──────────────────────────────────────────────────────────────────────────

/**
 * Загружает шаблон из встроенной константы BUNDLED_TEMPLATE_JSON_.
 * @return {object|null}
 */
function loadTemplate_() {
  if (typeof BUNDLED_TEMPLATE_JSON_ === 'string' && BUNDLED_TEMPLATE_JSON_) {
    try { return JSON.parse(BUNDLED_TEMPLATE_JSON_); } catch (_) { return null; }
  }
  return null;
}

/** Возвращает источник шаблона. */
function getTemplateSource_() {
  if (typeof BUNDLED_TEMPLATE_JSON_ === 'string' && BUNDLED_TEMPLATE_JSON_) return 'bundled';
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Вспомогательные функции для значений и форматов
// ──────────────────────────────────────────────────────────────────────────

function deserializeValue_(v) {
  if (v && typeof v === 'object' && v.__date) return new Date(v.__date);
  return v;
}

function wrapStrategyFromName_(name) {
  if (name === 'WRAP')     return SpreadsheetApp.WrapStrategy.WRAP;
  if (name === 'OVERFLOW') return SpreadsheetApp.WrapStrategy.OVERFLOW;
  if (name === 'CLIP')     return SpreadsheetApp.WrapStrategy.CLIP;
  return SpreadsheetApp.WrapStrategy.OVERFLOW;
}

// ──────────────────────────────────────────────────────────────────────────
// RichText
// ──────────────────────────────────────────────────────────────────────────

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

function applyTemplate_(sheet, template) {
  var curRows = sheet.getMaxRows();
  var curCols = sheet.getMaxColumns();
  if (template.max_rows > curRows) sheet.insertRowsAfter(curRows, template.max_rows - curRows);
  else if (template.max_rows < curRows) sheet.deleteRows(template.max_rows + 1, curRows - template.max_rows);
  if (template.max_cols > curCols) sheet.insertColumnsAfter(curCols, template.max_cols - curCols);
  else if (template.max_cols < curCols) sheet.deleteColumns(template.max_cols + 1, curCols - template.max_cols);

  var maxRows = template.max_rows;
  var maxCols = template.max_cols;
  var range = sheet.getRange(1, 1, maxRows, maxCols);

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

  for (var c2 = 0; c2 < maxCols; c2++) {
    sheet.setColumnWidth(c2 + 1, template.col_widths[c2]);
  }
  for (var r2 = 0; r2 < maxRows; r2++) {
    sheet.setRowHeight(r2 + 1, template.row_heights[r2]);
  }

  sheet.setFrozenRows(template.frozen_rows || 0);
  sheet.setFrozenColumns(template.frozen_cols || 0);

  range.setValues(values);
  if (hasFormula) range.setFormulas(formulas);
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

  for (var i = 0; i < template.rich.length; i++) {
    var rt = template.rich[i];
    sheet.getRange(rt.row, rt.col).setRichTextValue(buildRichTextValue_(rt));
  }

  for (var j = 0; j < template.merges.length; j++) {
    var m = template.merges[j];
    sheet.getRange(m.row, m.col, m.num_rows, m.num_cols).merge();
  }

  applyDefaultBorders_(sheet, template);
}

// ──────────────────────────────────────────────────────────────────────────
// applyDefaultBorders_ — захардкоженный паттерн «сетка расписания»
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

  var sepRowSet = {};
  for (var r = frozenRows + 1; r <= maxRows; r++) {
    if (rowHeights[r - 1] === 21) sepRowSet[r] = true;
  }
  var sepCols = [];
  for (var c = 4; c <= maxCols; c++) {
    if (colWidths[c - 1] === 21) sepCols.push(c);
  }

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
    rng.setBorder(true, true, true, true, true, true, BLACK, THIN);
    rng.setBorder(true, null, true, null, null, null, BLACK, THICK);
    for (var j = 0; j < sepCols.length; j++) {
      var sc = sepCols[j];
      sheet.getRange(b.start, sc, h, 1)
        .setBorder(null, true, null, true, null, null, BLACK, THICK);
    }
  }
}
