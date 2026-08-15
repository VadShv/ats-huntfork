import { chromium } from 'playwright'
import fs from 'node:fs'

const EXT = '/home/user/workspace/huntfork-sidekick/.output/chrome-mv3'
const OUT = '/home/user/workspace/huntfork-sidekick/qa-shots'
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
  await page.waitForTimeout(600)
  await shot('1-idle')

  // Сводка по странице: стриминг и финал
  await page.getByText('✨ Сводка по странице').click()
  await page.waitForTimeout(500)
  await shot('2-summary-streaming')
  await page.waitForTimeout(1200)
  await shot('3-summary-done')

  // Вопросы (чат)
  await page.getByText('💬 Задать вопрос').click()
  await page.waitForTimeout(300)
  await page.locator('.chat-ta').fill('Сколько лет опыта у кандидата?')
  await page.locator('.chat-input-row .btn').click()
  await page.waitForTimeout(350)
  await shot('4-chat-typing')
  await page.waitForTimeout(1400)
  await shot('5-chat-done')

  // Назад → импорт кандидата → проверка данных
  await page.getByText('← Назад').click()
  await page.waitForTimeout(400)
  await page.getByText('Импортировать кандидата', { exact: false }).first().click()
  await page.waitForTimeout(250)
  await shot('6-capturing')
  await page.waitForTimeout(600)
  await shot('7-draft')

  await ctx.close()
}

for (const scheme of ['light', 'dark']) await run(scheme)
console.log('DONE')
