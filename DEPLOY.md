# Деплой rfict-schedule на бесплатный хостинг

## Вариант 1: Vercel (быстрее всего)

```bash
npm i -g vercel
vercel
```

- Выбрать `Y` — это корень проекта
- Build command: `npm run build`
- Output dir: `dist`
- Single-Page App: `Y`

После деплоя появится ссылка вида `rfict-schedule.vercel.app`.

При следующих пушах можно обновлять командой `vercel --prod`.

## Вариант 2: Netlify (через CLI)

```bash
npm i -g netlify-cli
netlify deploy
```

- Build command: `npm run build`
- Publish directory: `dist`

На первом деплое — `netlify deploy` (черновик), потом `netlify deploy --prod`.

Можно подключить авто-деплой с GitHub:
1. Зайти на [netlify.com](https://netlify.com)
2. Нажать **Add new site** → **Import an existing project**
3. Подключить GitHub и выбрать rfict-schedule
4. Build command: `npm run build`, Publish directory: `dist`

## Вариант 3: Cloudflare Pages (рекомендуемый)

1. Зайти на [dash.cloudflare.com](https://dash.cloudflare.com) → **Pages**
2. Нажать **Create a project** → **Connect to Git**
3. Выбрать репозиторий `rfict-schedule`
4. Build command: `npm run build`
5. Build output: `dist`
6. Нажать **Save and Deploy**

## Файл конфига для Vercel/Netlify (если нужно)

Vite уже сам определяет Platform и настраивает конфиг, но если что — добавьте в корень `_redirects` (для Netlify):
```
/*    /index.html   200
```

Или `vercel.json` (для Vercel):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## После деплоя

1. Открыть ссылку — сайт сразу работает, все запросы идут к `https://rfict.up.railway.app`
2. Если нужно свой бэкенд — поменять `API_BASE_URL` в `src/api/scheduleClient.ts`

## CI/CD — авто-деплой при пуше

Все три платформы поддерживают автодеплой:

| Платформа | Авто-деплой из коробки |
|---|---|
| Vercel | Да — сразу после импорта |
| Netlify | Да — нужно подключить GitHub |
| Cloudflare Pages | Да — сразу после импорта |

Просто пушите в `main` — изменения улетят на прод автоматически.
