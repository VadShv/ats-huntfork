/**
 * CORS middleware для эндпоинтов /api/extension/*
 *
 * Chrome-расширения шлют запросы с Origin вида `chrome-extension://<id>`.
 * Стандартный браузерный CORS требует:
 *   1. Точное эхо Origin'а в Access-Control-Allow-Origin (нельзя «*» при credentials)
 *   2. Access-Control-Allow-Credentials: true (чтобы cookie better-auth пришли)
 *   3. Preflight (OPTIONS) с правильными методами/заголовками
 *
 * Поскольку у нас MV3-расширение, distributed только внутри организации
 * (не публикуется в Chrome Store), мы разрешаем ЛЮБОЙ Origin вида
 * `chrome-extension://*` — это безопасно при условии, что:
 *   • cookies httpOnly + SameSite=Lax / None (better-auth уже настроен корректно)
 *   • эндпоинт проверяет requirePermission (org-scoped)
 *   • CSRF неактуален: запросы инициируются расширением, не сайтом-злоумышленником
 *
 * Если в будущем понадобится whitelist по конкретному extension-id —
 * хардкодим список в EXTENSION_ALLOWED_ORIGINS.
 */

export default defineEventHandler((event) => {
  const url = event.path || ''
  if (!url.startsWith('/api/extension/')) return

  const origin = getRequestHeader(event, 'origin')
  if (!origin || !origin.startsWith('chrome-extension://')) {
    // Не chrome-extension origin — пусть стандартное поведение (или иной хук)
    return
  }

  setResponseHeaders(event, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  })

  // Preflight
  if (event.method === 'OPTIONS') {
    event.node.res.statusCode = 204
    event.node.res.end()
  }
})
