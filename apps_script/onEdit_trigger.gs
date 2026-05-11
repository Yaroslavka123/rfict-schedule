/**
 * BOUND Apps Script для гибрида: запускает GitHub Action при каждом редактировании Sheets.
 *
 * УСТАНОВКА (один раз, выполняется ВЛАДЕЛЬЦЕМ каждой таблицы):
 *  1. В нужной Google Sheets: Extensions → Apps Script.
 *  2. Вставить этот файл (заменить любой существующий код).
 *  3. Project Settings (шестерёнка слева) → Script Properties → Add:
 *       key:   GITHUB_TOKEN
 *       value: github_pat_xxx     (Personal Access Token с правом `repo` или fine-grained
 *                                  `actions:write` на репо Yaroslavka123/rfict-schedule)
 *  4. Triggers (часы слева) → Add Trigger:
 *       Function: onEditTrigger
 *       Event source: From spreadsheet
 *       Event type:   On edit
 *  5. Авторизовать (Google спросит разрешение на UrlFetchApp).
 *
 * После этого: любая правка ячейки в таблице → ~5 сек → GitHub Action перезапускается
 * → public/schedule.json обновляется на GitHub Pages через ~30-40 сек.
 *
 * Если bound-script повесить нельзя (нет доступа к таблице) — этот файл просто не нужен.
 * Тогда cron каждые 5 минут всё равно подхватит правку.
 */

const REPO_OWNER = "Yaroslavka123";
const REPO_NAME  = "rfict-schedule";
const EVENT_TYPE = "sheets-edited";

function onEditTrigger(e) {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) {
    console.warn("GITHUB_TOKEN not set in Script Properties");
    return;
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;
  const payload = {
    event_type: EVENT_TYPE,
    client_payload: {
      sheet: e ? e.source.getName() : "unknown",
      range: e && e.range ? e.range.getA1Notation() : "",
      user:  e && e.user  ? e.user.getEmail()      : "",
      at:    new Date().toISOString(),
    },
  };

  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() >= 300) {
    console.error("dispatch failed: " + resp.getResponseCode() + " " + resp.getContentText());
  }
}

/** Можно дёрнуть руками из редактора, чтобы проверить, что токен валиден. */
function testDispatch() {
  onEditTrigger({ source: { getName: () => "manual-test" }, range: { getA1Notation: () => "A1" }, user: { getEmail: () => "" } });
}
