export function googleSheetUrl(sheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`
}

export function openGoogleSheet(sheetId: string | null | undefined) {
  if (!sheetId) return false
  const opened = window.open(googleSheetUrl(sheetId), `rfict-sheet-${sheetId}`)
  opened?.focus()
  return Boolean(opened)
}
