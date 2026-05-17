// ──────────────────────────────────────────────────────────────────────────
// Generator.gs — генератор пустого семестра.
//
// Берёт сохранённый шаблон (см. Template.gs) и плодит N листов недель с
// рассчитанными датами и звонками. Структура листа определяется шаблоном
// (т.е. колонками: A=день/мерж, B=№ пары, C=время). На имена существующих
// листов алгоритм НЕ опирается — даты считаются с нуля.
//
// Логика начала семестра:
//   • Семестр 1 (осенний): start = понедельник недели, содержащей 1 сентября.
//     → первый понедельник сентября гарантированно входит в расписание.
//   • Семестр 2 (весенний): start = понедельник недели, содержащей 8 февраля.
//     → 8 февраля гарантированно входит в неделю 1.
//   • Запас: пользователь может вручную задать число недель больше 14 (по
//     умолчанию 18 = 14 учебных + 4 буфер). Всё, что выходит за нужное,
//     потом легко удалить вручную.
//
// Високосность: используется нативный JS Date, который корректно обрабатывает
// 29 февраля и переходы через границу года.
// ──────────────────────────────────────────────────────────────────────────

var GENERATOR_DEFAULTS_ = {
  year: null,            // вычислится в форме (текущий год)
  semester: 1,           // 1 = осень, 2 = весна
  pair_min: 85,          // длительность пары, мин
  break_min: 10,         // перерыв между парами, мин
  first_start: '09:00',  // начало 1-й пары, HH:MM
  lunch_after: 3,        // большой перерыв после пары №… (0 = нет)
  lunch_min: 30,         // длительность большого перерыва, мин (0 = нет)
  num_weeks: 18,         // сколько недель сгенерировать
  num_pairs: 8,          // сколько пар в день
  days_per_week: 6,      // дней в неделе (Пн..Сб = 6, Пн..Вс = 7)
  date_format: 'short'   // 'short' = DD.MM,  'full' = DD.MM.YYYY
};

/** Открывает диалог генератора. */
function openSemesterGenerator() {
  var ui = SpreadsheetApp.getUi();
  if (!loadTemplate_()) {
    ui.alert(
      'Шаблон не найден',
      'Сначала снимите шаблон с эталонного листа («🧱 Шаблон листа → Снять шаблон с активного листа») или вшейте его в код через «Экспортировать шаблон в код».',
      ui.ButtonSet.OK
    );
    return;
  }
  var html = HtmlService.createHtmlOutputFromFile('Generator')
    .setWidth(440)
    .setHeight(640);
  ui.showModalDialog(html, 'Генератор пустого семестра');
}

/** Возвращает дефолты + источник шаблона — вызывается из Generator.html при загрузке. */
function getGeneratorDefaults() {
  var now = new Date();
  var defaultYear = now.getFullYear();
  // Если сейчас осень (август..декабрь) — генерим, скорее всего, текущий год.
  // Если январь..июль — скорее всего, генерим текущий учебный год = year - 1 (для весны).
  // По умолчанию подставляем «текущий год» как академический год начала.
  var defaultSemester = (now.getMonth() >= 7) ? 1 : 2;
  return {
    defaults: Object.assign({}, GENERATOR_DEFAULTS_, {
      year: defaultYear,
      semester: defaultSemester
    }),
    template_source: getTemplateSource_()
  };
}

/**
 * Главный entrypoint из формы. Возвращает summary для отображения.
 * @param {object} rawParams — поля из HTML формы (строки)
 */
function runSemesterGenerator(rawParams) {
  var params = parseGeneratorParams_(rawParams);
  var template = loadTemplate_();
  if (!template) throw new Error('Шаблон не найден. Снимите его сначала.');

  // Валидация структуры шаблона
  var struct = analyzeTemplateStructure_(template);
  if (!struct.day_merges.length) {
    throw new Error('В шаблоне нет вертикальных мержей в колонке A с днями недели (Пн..Вс). Проверьте, что шаблон снят с корректного листа расписания.');
  }
  if (!struct.pair_rows.length) {
    throw new Error('В шаблоне не найдены строки с номерами пар (колонка B). Проверьте шаблон.');
  }

  var schedule = computeBellSchedule_(params);
  var start = computeSemesterStart_(params.year, params.semester);

  var ss = SpreadsheetApp.getActive();
  // Pre-flight: проверяем, что ни один из планируемых листов не существует.
  var planned = [];
  for (var w = 1; w <= params.num_weeks; w++) {
    var monday = addDays_(start, (w - 1) * 7);
    var lastDay = addDays_(monday, params.days_per_week - 1);
    planned.push({
      week: w,
      monday: monday,
      last_day: lastDay,
      name: buildSheetName_(w, monday, lastDay)
    });
  }
  var collisions = planned.filter(function(p) { return ss.getSheetByName(p.name); });
  if (collisions.length) {
    throw new Error(
      'Уже существуют листы с такими именами:\n• ' +
      collisions.slice(0, 5).map(function(c) { return c.name; }).join('\n• ') +
      (collisions.length > 5 ? ('\n• …и ещё ' + (collisions.length - 5)) : '') +
      '\n\nУдалите их или сгенерируйте в копии таблицы.'
    );
  }

  var created = [];
  for (var i = 0; i < planned.length; i++) {
    var p = planned[i];
    var sheet = ss.insertSheet(p.name);
    applyTemplate_(sheet, template);
    customizeWeekSheet_(sheet, template, struct, params, p.week, p.monday, schedule);
    created.push(p.name);
  }
  return {
    created: created,
    start_iso: start.toISOString(),
    start_ddmmyyyy: formatDDMMYYYY_(start),
    bell: schedule.map(function(s) { return s.pair + ': ' + s.label; })
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Параметры и расчёт дат / звонков
// ──────────────────────────────────────────────────────────────────────────

function parseGeneratorParams_(raw) {
  function num(k, dflt, min, max) {
    var v = raw && raw[k];
    if (v === undefined || v === null || v === '') return dflt;
    v = Number(v);
    if (isNaN(v)) throw new Error('Поле «' + k + '»: не число.');
    if (min !== undefined && v < min) throw new Error('Поле «' + k + '»: минимум ' + min + '.');
    if (max !== undefined && v > max) throw new Error('Поле «' + k + '»: максимум ' + max + '.');
    return v;
  }
  function str(k, dflt) {
    var v = raw && raw[k];
    return (v === undefined || v === null || v === '') ? dflt : String(v);
  }
  var year         = num('year',         GENERATOR_DEFAULTS_.year,         2000, 2099);
  var semester     = num('semester',     GENERATOR_DEFAULTS_.semester,     1,    2);
  var pair_min     = num('pair_min',     GENERATOR_DEFAULTS_.pair_min,     20,   180);
  var break_min    = num('break_min',    GENERATOR_DEFAULTS_.break_min,    0,    120);
  var lunch_after  = num('lunch_after',  GENERATOR_DEFAULTS_.lunch_after,  0,    20);
  var lunch_min    = num('lunch_min',    GENERATOR_DEFAULTS_.lunch_min,    0,    180);
  var num_weeks    = num('num_weeks',    GENERATOR_DEFAULTS_.num_weeks,    1,    30);
  var num_pairs    = num('num_pairs',    GENERATOR_DEFAULTS_.num_pairs,    1,    12);
  var days_per_week= num('days_per_week',GENERATOR_DEFAULTS_.days_per_week,5,    7);
  var first_start  = str('first_start',  GENERATOR_DEFAULTS_.first_start);
  var date_format  = str('date_format',  GENERATOR_DEFAULTS_.date_format);
  if (!/^\d{1,2}:\d{2}$/.test(first_start)) {
    throw new Error('Поле «Начало 1-й пары»: ожидается HH:MM.');
  }
  if (date_format !== 'short' && date_format !== 'full') date_format = 'short';
  return {
    year: year, semester: semester,
    pair_min: pair_min, break_min: break_min,
    lunch_after: lunch_after, lunch_min: lunch_min,
    num_weeks: num_weeks, num_pairs: num_pairs,
    days_per_week: days_per_week,
    first_start: first_start, date_format: date_format
  };
}

/**
 * Возвращает дату понедельника, с которого начинается семестр.
 *   • Семестр 1: понедельник недели, содержащей 1 сентября `year`.
 *   • Семестр 2: понедельник недели, содержащей 8 февраля `year + 1`.
 */
function computeSemesterStart_(year, semester) {
  var target;
  if (semester === 1) target = new Date(year,     8, 1);  // 1 сентября `year`
  else                target = new Date(year + 1, 1, 8);  // 8 февраля `year + 1`
  return mondayOfWeek_(target);
}

/** Возвращает понедельник недели, содержащей указанную дату. */
function mondayOfWeek_(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var dow = d.getDay(); // 0 = вс, 1 = пн, …, 6 = сб
  var diff = (dow === 0) ? -6 : (1 - dow);
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays_(date, n) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

function formatDDMM_(d)      { return pad2_(d.getDate()) + '.' + pad2_(d.getMonth() + 1); }
function formatDDMMYYYY_(d)  { return formatDDMM_(d) + '.' + d.getFullYear(); }

function formatHHMM_(totalMin) {
  totalMin = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  return pad2_(h) + ':' + pad2_(m);
}

/**
 * Считает расписание звонков. Возвращает массив из num_pairs элементов вида
 * {pair: 1, label: '09:00 - 10:25', start_min, end_min}.
 *
 * Алгоритм:
 *   - Начинаем с first_start.
 *   - Длительность пары = pair_min.
 *   - Между парами — break_min, КРОМЕ перехода после lunch_after,
 *     где вместо break_min используется lunch_min (если lunch_after > 0
 *     и lunch_min > 0, иначе обычный break_min).
 */
function computeBellSchedule_(params) {
  var startParts = params.first_start.split(':');
  var minute = Number(startParts[0]) * 60 + Number(startParts[1]);
  var out = [];
  for (var p = 1; p <= params.num_pairs; p++) {
    var s = minute;
    var e = minute + params.pair_min;
    out.push({pair: p, start_min: s, end_min: e, label: formatHHMM_(s) + ' - ' + formatHHMM_(e)});
    var gap = params.break_min;
    if (params.lunch_after > 0 && params.lunch_min > 0 && p === params.lunch_after) gap = params.lunch_min;
    minute = e + gap;
  }
  return out;
}

function buildSheetName_(week, monday, lastDay) {
  return formatDDMM_(monday) + '-' + formatDDMM_(lastDay) + ' (' + week + '-я неделя)';
}

// ──────────────────────────────────────────────────────────────────────────
// Анализ структуры шаблона и кастомизация листа недели
// ──────────────────────────────────────────────────────────────────────────

/**
 * Сканирует шаблон и возвращает координаты ключевых элементов:
 *   - day_merges: мержи в колонке A с именем дня недели (Пн..Вс)
 *     [{row, num_rows, day_index}]
 *   - pair_rows: строки, где в колонке B стоит число (номер пары)
 *     [{row, pair}]
 */
function analyzeTemplateStructure_(template) {
  var maxRows = template.max_rows;
  var dayMerges = [];
  for (var i = 0; i < template.merges.length; i++) {
    var m = template.merges[i];
    if (m.col !== 1 || m.num_rows < 1) continue;
    var cell = template.cells[m.row - 1][0];
    var first = String(cell.v || '').split('\n')[0].trim();
    var idx = DAY_NAMES_.indexOf(first);
    if (idx < 0) continue;
    dayMerges.push({row: m.row, num_rows: m.num_rows, day_index: idx});
  }

  var pairRows = [];
  for (var r = 0; r < maxRows; r++) {
    var pv = template.cells[r][1] && template.cells[r][1].v;
    var pair = typeof pv === 'number' ? pv : parseInt(pv, 10);
    if (!isNaN(pair) && pair >= 1 && pair <= 20) {
      pairRows.push({row: r + 1, pair: pair});
    }
  }
  return {day_merges: dayMerges, pair_rows: pairRows};
}

/**
 * Подгоняет уже созданный по шаблону лист под конкретную неделю:
 *   - D1 = "N семестр"
 *   - колонка C (время) — пересчитанные звонки по pair_min/break_min
 *   - колонка A (день) — добавляет дату ниже названия дня: "Пн\nDD.MM[.YYYY]"
 */
function customizeWeekSheet_(sheet, template, struct, params, weekNum, monday, schedule) {
  // 1. D1 = N семестр
  try { sheet.getRange('D1').setValue(params.semester + ' семестр'); } catch (_) {}

  // 2. Времена пар (колонка C)
  for (var i = 0; i < struct.pair_rows.length; i++) {
    var pr = struct.pair_rows[i];
    var entry = schedule[pr.pair - 1];
    if (!entry) continue;
    sheet.getRange(pr.row, 3).setValue(entry.label);
  }

  // 3. Дни недели + дата (колонка A) — пишем через RichText: день жирнее, дата мельче.
  for (var j = 0; j < struct.day_merges.length; j++) {
    var dm = struct.day_merges[j];
    if (dm.day_index >= params.days_per_week) continue; // ВС не пишем если days_per_week = 6
    var date = addDays_(monday, dm.day_index);
    var dayName = DAY_NAMES_[dm.day_index];
    var dateStr = params.date_format === 'full' ? formatDDMMYYYY_(date) : formatDDMM_(date);
    var text = dayName + '\n' + dateStr;

    // Стиль: имя дня — как в исходной ячейке (берём из шаблона); дата — italic, меньший шрифт.
    var srcCell = template.cells[dm.row - 1][0];
    var baseSize = Number(srcCell.fs) || 12;
    var smallSize = Math.max(8, baseSize - 2);
    var dateStyle = SpreadsheetApp.newTextStyle()
      .setItalic(true)
      .setFontSize(smallSize)
      .setBold(false)
      .build();
    var rtv = SpreadsheetApp.newRichTextValue()
      .setText(text)
      .setTextStyle(dayName.length + 1, text.length, dateStyle)
      .build();
    sheet.getRange(dm.row, 1).setRichTextValue(rtv);
  }
}
