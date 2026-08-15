/**
 * Service worker Huntfork Sidekick.
 *
 * Роли:
 *  • Единственная точка общения с huntfork.ru (fetch с credentials: 'include',
 *    cookie better-auth подставляется браузером — у SW есть host_permissions).
 *  • Роутер сообщений от side panel и content-скриптов.
 *  • Следит за активной вкладкой и рассылает side panel событие смены URL —
 *    resumeId извлекается из URL вкладки, DOM hh.ru для этого не нужен.
 */

const HUNTFORK_BASE = 'https://huntfork.ru'

interface ApiResult {
  ok: boolean
  status?: number
  code?: string
  message?: string
  data?: any
}

async function apiFetch(path: string, options: {
  method?: string
  body?: unknown
  headers?: Record<string, string>
} = {}): Promise<ApiResult> {
  const url = `${HUNTFORK_BASE}${path}`
  let resp: Response
  try {
    resp = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
      method: options.method || 'GET',
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  }
  catch (err: any) {
    return { ok: false, code: 'NETWORK', message: `Нет соединения с huntfork.ru: ${err?.message ?? ''}` }
  }

  if (resp.status === 401) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Не залогинены на huntfork.ru' }
  }
  if (resp.status === 403) {
    const data = await resp.json().catch(() => ({} as any))
    return { ok: false, status: 403, code: 'FORBIDDEN', message: data.statusMessage || 'Нет прав' }
  }
  if (resp.status === 412) {
    return { ok: false, status: 412, code: 'NO_HH_ACCOUNT', message: 'hh.ru не подключен в Huntfork' }
  }
  if (!resp.ok) {
    let msg = `Ошибка ${resp.status}`
    let errData: any = null
    try {
      const data = await resp.json()
      msg = data.statusMessage || data.message || msg
      // nitro createError({data}) кладёт полезную нагрузку в data —
      // там живут списки дублей для 409 duplicate_*
      errData = data.data ?? null
    }
    catch {}
    return {
      ok: false,
      status: resp.status,
      code: errData?.code || 'API_ERROR',
      message: errData?.message || msg,
      data: errData,
    }
  }

  const data = await resp.json().catch(() => null)
  return { ok: true, data }
}

/**
 * Извлекатель контента — выполняется ВНУТРИ страницы через chrome.scripting.executeScript.
 * Функция САМОДОСТАТОЧНА: никаких ссылок на внешний скоуп (она сериализуется).
 *
 * Уровни извлечения:
 *  L1 — адаптер площадки (селекторы основного контента под конкретный сайт);
 *  L2 — generic (main / [role=main] / article / body);
 *  L3 — выделение пользователя (≥200 символов — приоритетно над L1/L2).
 * Плюс майнинг контактов: mailto:/tel:/t.me-ссылки + regex по тексту.
 */
function pageExtractor() {
  const MAX = 60_000
  const host = location.hostname.replace(/^www\./, '')

  function detect(): { site: string, selectors: string[] } {
    if (/(^|\.)linkedin\.com$/.test(host)) return { site: 'linkedin', selectors: ['main.scaffold-layout__main', '.scaffold-layout__main', 'main', 'body'] }
    if (host === 'career.habr.com') return { site: 'habr', selectors: ['.page-content', '.content-wrapper', 'main', 'body'] }
    if (/(^|\.)github\.com$/.test(host)) return { site: 'github', selectors: ['.Layout-main', 'main', 'body'] }
    if (/(^|\.)huntshare\.tech$/.test(host)) return { site: 'hunt', selectors: ['main', '#app', '#__nuxt', 'body'] }
    if (/(^|\.)podbor\.io$/.test(host)) return { site: 'podbor', selectors: ['main', '#app', 'body'] }
    return { site: 'generic', selectors: ['main', '[role="main"]', 'article', 'body'] }
  }
  const { site, selectors } = detect()

  // L3: выделение пользователя приоритетно
  const selection = (window.getSelection()?.toString() ?? '').trim()

  let root: HTMLElement | null = null
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(s)
    if (el && (el.innerText?.trim().length ?? 0) > 100) { root = el; break }
  }
  root = root ?? document.body

  // innerText на живом узле: учитывает видимость, даёт осмысленные переносы строк
  const pageText = (root.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX)
  const selectionUsed = selection.length >= 200
  const text = selectionUsed ? selection.slice(0, MAX) : pageText
  // Сырое выделение отдаём всегда — для режима «саммари фрагмента» (S3)

  // Майнинг контактов со всей страницы (ссылки) + из текста (regex)
  const emails = new Set<string>()
  const phones = new Set<string>()
  const telegrams = new Set<string>()
  const links = new Set<string>()
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    const h = a.href
    if (h.startsWith('mailto:')) emails.add(decodeURIComponent(h.slice(7).split('?')[0]))
    else if (h.startsWith('tel:')) phones.add(decodeURIComponent(h.slice(4)))
    else if (/(?:^https?:\/\/)(?:www\.)?t\.me\//i.test(h)) telegrams.add(h)
    else if (/linkedin\.com\/in\//i.test(h)) links.add(h.split('?')[0])
    else if (/^https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i.test(h)) links.add(h.split('?')[0])
    else if (/career\.habr\.com\/[a-z0-9_-]+$/i.test(h)) links.add(h)
    else if (/hh\.ru\/resume\/[a-f0-9]+/i.test(h)) links.add(h.split('?')[0])
  })
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0])
  for (const m of text.matchAll(/(?:\+7|\b8)[\s(-]?\d{3}[)\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g)) phones.add(m[0])
  for (const m of text.matchAll(/\bt\.me\/([A-Za-z0-9_]{4,32})\b/g)) telegrams.add(`https://t.me/${m[1]}`)

  const canonical
    = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
      || document.querySelector('meta[property="og:url"]')?.getAttribute('content')
      || location.href

  return {
    url: location.href,
    canonical,
    title: document.title.slice(0, 300),
    site,
    selectionUsed,
    text,
    selectionText: selection.slice(0, MAX),
    pageText,
    contacts: {
      emails: [...emails].slice(0, 10),
      phones: [...phones].slice(0, 10),
      telegrams: [...telegrams].slice(0, 10),
      links: [...links].slice(0, 30),
    },
  }
}

export default defineBackground(() => {
  // Клик по иконке открывает боковую панель
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.warn('[Sidekick] setPanelBehavior:', err))

  // ── Роутер сообщений ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    ;(async () => {
      try {
        switch (msg?.type) {
          case 'session':
            sendResponse(await apiFetch('/api/extension/session'))
            break
          case 'check':
            sendResponse(await apiFetch('/api/extension/check', {
              method: 'POST',
              body: { resumeIds: msg.resumeIds, urls: msg.urls },
            }))
            break
          case 'jobs':
            sendResponse(await apiFetch('/api/extension/jobs'))
            break
          case 'import':
            sendResponse(await apiFetch('/api/extension/import', {
              method: 'POST',
              body: { resumeId: msg.resumeId, url: msg.url, jobId: msg.jobId },
            }))
            break
          case 'activeTab': {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            sendResponse({ ok: true, data: { url: tab?.url ?? null, tabId: tab?.id ?? null } })
            break
          }
          // ── S1 Universal Capture ──────────────────────────────
          case 'capturePage': {
            // Извлекаем контент активной вкладки. Разрешение на origin
            // панель запрашивает сама (chrome.permissions.request — нужен user gesture).
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: msg.tabId },
                func: pageExtractor,
              })
              const payload = results?.[0]?.result ?? null
              if (!payload) {
                sendResponse({ ok: false, code: 'EMPTY', message: 'Не удалось извлечь контент страницы' })
              }
              else {
                sendResponse({ ok: true, data: payload })
              }
            }
            catch (err: any) {
              sendResponse({
                ok: false,
                code: 'INJECT_FAILED',
                message: `Нет доступа к странице: ${err?.message ?? 'служебная страница браузера?'}`,
              })
            }
            break
          }
          case 'captureParse':
            sendResponse(await apiFetch('/api/extension/capture', {
              method: 'POST',
              body: msg.payload,
            }))
            break
          case 'captureConfirm':
            sendResponse(await apiFetch('/api/extension/capture-confirm', {
              method: 'POST',
              body: msg.payload,
            }))
            break
          // ── S2–S8 Sidekick ──────────────────────────────────
          case 'lookup':
            // Проверка «уже в базе?» по URL (linkedin/github/t.me)
            sendResponse(await apiFetch('/api/extension/lookup', {
              method: 'POST',
              body: { url: msg.url },
            }))
            break
          case 'prompts':
            sendResponse(await apiFetch('/api/extension/prompts'))
            break
          case 'note':
            sendResponse(await apiFetch('/api/extension/note', {
              method: 'POST',
              body: { candidateId: msg.candidateId, body: msg.body },
            }))
            break
          case 'pdfText': {
            // S7: скачиваем PDF из вкладки и извлекаем текст на бэкенде
            try {
              const resp = await fetch(msg.url, { credentials: 'include' })
              if (!resp.ok) {
                sendResponse({ ok: false, code: 'PDF_FETCH', message: `Не удалось скачать PDF (${resp.status})` })
                break
              }
              const buf = await resp.arrayBuffer()
              if (buf.byteLength > 6_000_000) {
                sendResponse({ ok: false, code: 'PDF_TOO_BIG', message: 'PDF больше 6 МБ' })
                break
              }
              // base64 без переполнения стека
              const bytes = new Uint8Array(buf)
              let bin = ''
              const CHUNK = 0x8000
              for (let i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
              }
              const dataBase64 = btoa(bin)
              const fname = (() => {
                try {
                  const p = new URL(msg.url).pathname
                  return decodeURIComponent(p.split('/').pop() || 'document.pdf')
                }
                catch { return 'document.pdf' }
              })()
              sendResponse(await apiFetch('/api/extension/pdf-text', {
                method: 'POST',
                body: { sourceUrl: msg.url, dataBase64, filename: fname },
              }))
            }
            catch (err: any) {
              sendResponse({ ok: false, code: 'PDF_FETCH', message: `Ошибка загрузки PDF: ${err?.message ?? ''}` })
            }
            break
          }
          case 'openHuntfork':
            chrome.tabs.create({ url: msg.url || HUNTFORK_BASE })
            sendResponse({ ok: true })
            break
          default:
            sendResponse({ ok: false, message: `Unknown message type: ${msg?.type}` })
        }
      }
      catch (err: any) {
        console.error('[Sidekick BG]', err)
        sendResponse({ ok: false, message: err?.message || 'Внутренняя ошибка расширения' })
      }
    })()
    return true // держим канал до sendResponse
  })

  // ── Слежение за активной вкладкой → событие в side panel ─────────
  function broadcastUrl(url: string | undefined, tabId: number) {
    if (!url) return
    chrome.runtime.sendMessage({ type: 'tabUrlChanged', url, tabId }).catch(() => {
      // side panel закрыта — это нормально
    })
  }

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId)
      broadcastUrl(tab.url, tabId)
    }
    catch {}
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      if (tab.active) broadcastUrl(tab.url, tabId)
    }
  })

  console.log('[Sidekick] service worker started, base =', HUNTFORK_BASE)
})
