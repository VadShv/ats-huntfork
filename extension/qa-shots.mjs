import { chromium } from 'playwright'
import fs from 'node:fs'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, '.output/chrome-mv3')
const OUT = join(HERE, 'qa-shots')
fs.mkdirSync(OUT, { recursive: true })

const STUB = `
(() => {
  if (!globalThis.chrome || !chrome.runtime) return
  const STATE = { url: 'https://www.linkedin.com/in/ivan-petrov' }
  try {
    chrome.permissions.contains = async () => true
    chrome.permissions.request = async () => true
  } catch {}
  // Изолируем панель от реального background (tabUrlChanged затирает URL)
  try {
    Object.defineProperty(chrome.runtime, 'onMessage', {
      value: { addListener() {}, removeListener() {} },
      configurable: true,
    })
  } catch {}
  chrome.runtime.sendMessage = (msg, cb) => {
    const respond = (r) => setTimeout(() => cb && cb(r), 40)
    switch (msg && msg.type) {
      case 'session': respond({ ok: true, data: { user: { name: 'Владимир Сержантов', email: 'v@huntfork.ru' } } }); break
      case 'activeTab': respond({ ok: true, data: { url: STATE.url, tabId: 1 } }); break
      case 'jobs': respond({ ok: true, data: { jobs: [
        { id: 'j1', title: 'Senior Python Developer', status: 'open' },
        { id: 'j2', title: 'DevOps-инженер', status: 'open' } ] } }); break
      case 'prompts': respond({ ok: true, data: { prompts: [
        { id: 'card', label: 'Карточка знаний', mode: 'card' },
        { id: 'questions', label: 'Вопросы для интервью', mode: 'questions' },
        { id: 'seniority', label: 'Оценить синьорность', mode: 'custom', instruction: 'x' },
        { id: 'outreach', label: 'Черновик первого письма', mode: 'custom', instruction: 'x' } ] } }); break
      case 'lookup': respond({ ok: true, data: { exists: false } }); break
      case 'capturePage': respond({ ok: true, data: {
        url: STATE.url, canonical: STATE.url, site: 'linkedin', title: 'Ivan Petrov',
        text: 'Иван Петров. Senior Python Developer. Москва. Опыт: Яндекс (2019—2024), VK (2016—2019). Стек: Python, FastAPI, PostgreSQL, Docker, Kubernetes. '.repeat(4),
        selectionUsed: false, contacts: {} } }); break
      case 'captureParse': respond({ ok: true, data: {
        parsed: { firstName: 'Иван', lastName: 'Петров', title: 'Senior Python Developer',
          city: 'Москва', email: 'ivan.petrov@example.com', skills: ['Python', 'FastAPI', 'PostgreSQL', 'Docker'],
          about: 'Senior-разработчик с 8-летним опытом в продуктовых командах.',
          experience: [ { position: 'Senior Python Developer', company: 'Яндекс' }, { position: 'Backend Developer', company: 'VK' } ] },
        duplicates: { exact: [], fuzzy: [], social: [] }, meta: {} } }); break
      case 'note': respond({ ok: true }); break
      case 'check': respond({ ok: true, data: { results: [ { exists: false } ] } }); break
      default: respond({ ok: true, data: {} })
    }
    return true
  }
  const origFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : (input && input.url) || ''
    if (u.includes('/api/extension/summarize') || u.includes('/api/extension/chat')) {
      const chunks = [
        '**Иван Петров** — Senior Python Developer, Москва.\\n\\n',
        '- 8 лет опыта: Яндекс (5 лет), VK (3 года)\\n',
        '- Стек: Python, FastAPI, PostgreSQL, Docker, Kubernetes\\n',
        '- Вёл команду из 4 разработчиков, выстраивал CI/CD\\n\\n',
        'Сильный кандидат на senior-позиции в продуктовые команды.'
      ]
      const enc = new TextEncoder()
      const stream = new ReadableStream({
        async start(c) {
          for (const ch of chunks) {
            await new Promise(r => setTimeout(r, 150))
            c.enqueue(enc.encode('data: ' + JSON.stringify({ delta: ch }) + '\\n\\n'))
          }
          c.enqueue(enc.encode('data: ' + JSON.stringify({ done: true, usage: { promptTokens: 1830, completionTokens: 96 }, cached: false }) + '\\n\\n'))
          c.close()
        }
      })
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    return origFetch(input, init)
  }
})()
`

async function run(scheme) {
  const ctx = await chromium.launchPersistentContext(`/tmp/pw-ext-${scheme}`, {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    viewport: { width: 400, height: 720 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent('serviceworker')
  const extId = new URL(sw.url()).host
  const page = await ctx.newPage()
  await page.addInitScript(STUB)
  const shot = (n) => page.screenshot({ path: `${OUT}/${scheme}-${n}.png`, fullPage: true })

  await page.goto(`chrome-extension://${extId}/sidepanel.html`)
  await page.waitForTimeout(700)
  await shot('01-chat-idle')

  // Обход всех вкладок рельса (aria-label из VIEW_DEFS)
  const views = [
    ['Сорсинг', '02-sourcing'],
    ['Скрининг', '03-screening'],
    ['Telegram', '04-telegram'],
    ['Аутрич', '05-outreach'],
    ['Пайплайн', '06-pipeline'],
    ['Библиотека', '07-library'],
    ['Хаб', '08-hub'],
  ]
  for (const [label, name] of views) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(450)
    await shot(name)
  }

  // Чат: стриминговый ответ (SSE-заглушка)
  await page.getByRole('button', { name: 'Чат', exact: true }).click()
  await page.waitForTimeout(300)
  const ta = page.locator('textarea').first()
  if (await ta.count()) {
    await ta.fill('Сколько лет опыта у кандидата?')
    await ta.press('Enter')
    await page.waitForTimeout(400)
    await shot('09-chat-streaming')
    await page.waitForTimeout(1400)
    await shot('10-chat-done')
  }

  await ctx.close()
}

for (const scheme of ['light', 'dark']) await run(scheme)
console.log('DONE')
