# rfict-schedule

Apps Script расширение для Google Sheets расписания **РФиКТ БГУ**.

Форма ввода занятий в sidebar — позволяет быстро заполнять расписание с правильным форматированием (цвета, жирный шрифт, подгруппы, даты).

## Установка

1. Открой таблицу расписания → **Расширения → Apps Script**
2. Создай файл `Code.gs` → вставь содержимое [`apps_script/labs_form/Code.gs`](apps_script/labs_form/Code.gs)
3. Создай файл `Sidebar.html` → вставь содержимое [`apps_script/labs_form/Sidebar.html`](apps_script/labs_form/Sidebar.html)
4. В **⚙ Project Settings** → включи **Show "appsscript.json"** → замени на [`appsscript.json`](apps_script/labs_form/appsscript.json)
5. Сохрани (Ctrl+S), обнови страницу таблицы

## Настройка GitHub dispatch (опционально)

Для автоматического обновления `schedule.json` при правках:

1. **⚙ Project Settings → Script Properties** → добавь `GITHUB_TOKEN` (PAT с `repo` scope)
2. **Triggers** → Add Trigger: `onSheetEdit`, From spreadsheet, On edit

## Использование

- Меню **Расписание → Добавить / редактировать занятие** — открывает sidebar
- Выбери тип занятия (Лекция / Лаб / Практ / Семинар / Куратор / ДО)
- Для **лабы**: каждая подгруппа — отдельный блок (предмет, NПГ, чет/нечет, препод, аудитория, даты, отмена)
- Лаба **пишется в 2 ячейки** (текущая + ниже). Если 2 подгруппы — каждая в своей ячейке
- **ОТМЕНА** — красный жирный текст под предметом
- **Ctrl+Enter** — быстрое применение
- **↓ След.** — применить и перейти к следующей ячейке

## Структура файлов

```
apps_script/labs_form/
├── Code.gs          # серверная логика (форма, парсинг, dispatch, словари)
├── Sidebar.html     # UI формы (HTML + CSS + JS)
├── appsscript.json  # манифест Apps Script
└── README.md        # подробная документация
```
