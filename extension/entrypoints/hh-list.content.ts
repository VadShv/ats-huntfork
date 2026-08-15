/**
 * Content-script для списков резюме hh.ru (поиск + база откликов).
 *
 * Прогрессивное дополнение к side panel: рядом с каждой ссылкой на резюме,
 * уже существующее в Huntfork, рисуем мини-бейдж «В Huntfork».
 *
 * Устойчивость к SPA hh.ru: React может перерисовать список в любой момент —
 * новые элементы приходят без data-huntfork-checked и подхватываются
 * MutationObserver'ом заново. Кэш ответов бэка живёт в памяти скрипта.
 */

export default defineContentScript({
  matches: [
    'https://hh.ru/search/resume*',
    'https://*.hh.ru/search/resume*',
    'https://hh.ru/employer/applicants*',
    'https://*.hh.ru/employer/applicants*',
  ],
  runAt: 'document_idle',

  main() {
    const HUNTFORK_BASE = 'https://huntfork.ru'

    // Стили — инлайном, чтобы не зависеть от порядка загрузки CSS
    const style = document.createElement('style')
    style.textContent = `
      .hf-mini-badge {
        display: inline-flex; align-items: center; gap: 3px;
        margin-left: 6px; padding: 1px 7px;
        font-size: 11px; font-weight: 600; line-height: 18px;
        color: #fff; background: #01696f; border-radius: 9px;
        vertical-align: middle; white-space: nowrap;
        font-family: system-ui, sans-serif;
      }
      .hf-mini-badge:hover { background: #0c4e54; }
    `
    document.documentElement.appendChild(style)

    function send(msg: any): Promise<any> {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, message: chrome.runtime.lastError.message })
          }
          else resolve(resp)
        })
      })
    }

    /** Кэш по resumeId: 'exists' | 'new'. */
    const cache = new Map<string, 'exists' | 'new'>()
    const candidateIdByResume = new Map<string, string>()

    function extractResumeId(href: string | null): string | null {
      if (!href) return null
      try {
        const url = new URL(href, location.origin)
        const m = url.pathname.match(/\/resume\/([a-f0-9]{16,})/i)
          ?? url.pathname.match(/\/resume\/([^/?#]+)/)
        return m?.[1] ?? null
      }
      catch { return null }
    }

    function findUnprocessedLinks(): Array<{ link: HTMLAnchorElement, resumeId: string }> {
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/resume/"]:not([data-huntfork-checked])',
      )
      const result: Array<{ link: HTMLAnchorElement, resumeId: string }> = []
      for (const a of links) {
        const rid = extractResumeId(a.getAttribute('href'))
        if (!rid) continue
        a.setAttribute('data-huntfork-checked', '1')
        result.push({ link: a, resumeId: rid })
      }
      return result
    }

    function attachBadge(link: HTMLAnchorElement, candidateId?: string) {
      if (link.querySelector('.hf-mini-badge')) return
      const next = link.nextElementSibling
      if (next?.classList.contains('hf-mini-badge')) return

      const badge = document.createElement('span')
      badge.className = 'hf-mini-badge'
      badge.textContent = '✓ В Huntfork'
      badge.title = 'Кандидат уже в Huntfork. Клик — открыть карточку'
      if (candidateId) {
        badge.style.cursor = 'pointer'
        badge.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          send({ type: 'openHuntfork', url: `${HUNTFORK_BASE}/dashboard/candidates/${candidateId}` })
        })
      }
      link.insertAdjacentElement('afterend', badge)
    }

    let unauthorized = false

    async function processBatch(items: Array<{ link: HTMLAnchorElement, resumeId: string }>) {
      if (items.length === 0 || unauthorized) return

      const toCheck = items.filter(it => !cache.has(it.resumeId))
      const ids = [...new Set(toCheck.map(it => it.resumeId))]

      for (let i = 0; i < ids.length; i += 50) {
        const slice = ids.slice(i, i + 50)
        const resp = await send({ type: 'check', resumeIds: slice })
        if (!resp.ok) {
          if (resp.code === 'UNAUTHORIZED' || resp.status === 401) {
            unauthorized = true // не шумим — панель покажет «войдите»
            return
          }
          console.warn('[Sidekick list] check failed:', resp.message)
          continue
        }
        for (const r of resp.data?.results ?? []) {
          cache.set(r.resumeId, r.exists ? 'exists' : 'new')
          if (r.candidateId) candidateIdByResume.set(r.resumeId, r.candidateId)
        }
      }

      for (const { link, resumeId } of items) {
        if (cache.get(resumeId) === 'exists') {
          attachBadge(link, candidateIdByResume.get(resumeId))
        }
      }
    }

    let tickTimer: ReturnType<typeof setTimeout> | undefined
    function tick() {
      const items = findUnprocessedLinks()
      if (items.length > 0) {
        processBatch(items).catch(err => console.error('[Sidekick list]', err))
      }
    }

    tick()

    const observer = new MutationObserver(() => {
      clearTimeout(tickTimer)
      tickTimer = setTimeout(tick, 300)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  },
})
