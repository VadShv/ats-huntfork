#!/usr/bin/env python3
"""QA-скрипт живого стриминга ИИ в панели Sidekick (П4/П6, коммит 0df1cfc).

Проверяет на собранном расширении (.output/chrome-mv3) три потока:
  1. Верификация резюме — этапы «Читаю→Думаю→Пишу», partial-рендер секций, «Стоп», мета-строка;
  2. Карточка интервью — то же + автоскролл; контроль отсутствия горизонтального перелива;
  3. Чат/сводка (слэш-команда) — этапы над блоком размышлений, исчезновение по done.

Сеть и chrome.* замоканы (см. INIT) — реальный сервер не нужен.
Запуск:
  pip install playwright && playwright install chromium
  PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 xvfb-run -a python3 qa-streaming.py
Скриншоты складываются в qa-shots-p6/.
"""
import asyncio, json, os
from playwright.async_api import async_playwright

EXT = os.environ.get("SIDEKICK_EXT", os.path.join(os.path.dirname(__file__), ".output/chrome-mv3"))
OUT = os.environ.get("QA_OUT", "qa-shots-p6")
os.makedirs(OUT, exist_ok=True)

INIT = r"""
// ── Мок chrome-сообщений: активная вкладка + захват страницы ──
const RESUME = "Иван Иванов — Senior Frontend Developer. Опыт 6 лет. " +
  "2020–2026 ООО Рога и Копыта: ведущий разработчик, Vue 3, TypeScript, Nuxt. " +
  "2016–2019 StartupX: fullstack, Node.js, PostgreSQL. Достижения: ускорил сборку на 40%, " +
  "построил дизайн-систему, вырастил команду с 2 до 8 человек. Образование: МГТУ им. Баумана, 2016. " +
  "Навыки: Vue, Nuxt, TypeScript, Node.js, PostgreSQL, Docker, CI/CD. Английский B2.";
if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
  const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg && msg.type === 'activeTab') { cb && cb({ ok: true, data: { tabId: 1, url: 'https://hh.ru/resume/abc123' } }); return; }
    if (msg && msg.type === 'capturePage') { cb && cb({ ok: true, data: { url: 'https://hh.ru/resume/abc123', canonical: 'https://hh.ru/resume/abc123', title: 'Иван Иванов — резюме', text: RESUME } }); return; }
    return orig(msg, cb);
  };
}
if (window.chrome && chrome.permissions) {
  chrome.permissions.contains = () => Promise.resolve(true);
  chrome.permissions.request = () => Promise.resolve(true);
}

// ── Мок SSE-стрима верификации и карточки интервью ──
const enc = new TextEncoder();
const sse = (o) => enc.encode('data: ' + JSON.stringify(o) + '\n\n');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REPORT = {
  summary: "Кандидат с последовательной карьерой во фронтенде: 6 лет, рост от fullstack до ведущего разработчика. Таймлайн в целом непротиворечив, есть один разрыв 2019–2020, который стоит уточнить.",
  timeline: [
    { period: "2020–2026", place: "ООО Рога и Копыта", role: "Ведущий разработчик" },
    { period: "2016–2019", place: "StartupX", role: "Fullstack-разработчик", gap: "Разрыв 2019–2020 не объяснён" }
  ],
  contradictions: [
    { claim: "Вырастил команду с 2 до 8 человек", issue: "В должности не указан менеджерский трек", severity: "medium" }
  ],
  verifiability: [
    { claim: "Ускорил сборку на 40%", status: "partially", how: "Попросить показать метрики CI до/после" },
    { claim: "Образование МГТУ, 2016", status: "verifiable", how: "Диплом / реестр" }
  ],
  redFlags: [
    { flag: "Разрыв в занятости 2019–2020", severity: "low", basis: "Между StartupX и текущим местом" }
  ],
  questions: [
    "Чем занимались в 2019–2020 годах?",
    "Как измеряли ускорение сборки на 40%?",
    "Сколько человек было в прямом подчинении?"
  ]
};
const CARD = {
  role: "Senior Frontend Developer (Vue/Nuxt)",
  intro: ["Расскажите о текущем проекте и вашей роли в нём", "Что было самым сложным за последний год?"],
  blocks: [
    { competency: "Vue 3 / архитектура фронтенда", rationale: "Ядро роли: 6 лет во Vue-стеке, дизайн-система", questions: [
      { question: "Расскажите, как строили дизайн-систему: с чего начали, что было в первом релизе?", listenFor: "Конкретика: токены, версионирование, adoption", redFlag: "Говорит только про UI-кит без процессов" },
      { question: "Как ускорили сборку на 40% — что именно поменяли?", listenFor: "Измеримые шаги: кэш, чанки, профилирование", redFlag: "Нет цифр до/после" }
    ]},
    { competency: "Лидерство и рост команды", rationale: "Заявлен рост команды с 2 до 8", questions: [
      { question: "Как нанимали и онбордили новых разработчиков?", listenFor: "Роль в найме, план онбординга, менторство", redFlag: "Приписывает себе чужие решения" }
    ]}
  ],
  finalChecks: ["Уточнить разрыв 2019–2020", "Проверить уровень английского в диалоге"]
};

const _f = window.fetch.bind(window);
window.fetch = (url, opts) => {
  const u = String(url);
  const mkStream = (steps, finalObj) => new ReadableStream({
    async start(c) {
      for (const [obj, ms] of steps) { c.enqueue(sse(obj)); await sleep(ms); }
      c.enqueue(sse(finalObj));
      c.close();
    }
  });
  if (u.includes('/api/extension/verification/run')) {
    const steps = [
      [{ partial: { summary: REPORT.summary.slice(0, 60) } }, 700],
      [{ partial: { summary: REPORT.summary } }, 900],
      [{ partial: { summary: REPORT.summary, timeline: REPORT.timeline } }, 900],
      [{ partial: { summary: REPORT.summary, timeline: REPORT.timeline, contradictions: REPORT.contradictions, verifiability: REPORT.verifiability } }, 1000],
      [{ partial: REPORT }, 800],
    ];
    const fin = { done: true, report: REPORT, meta: { provider: 'cloud_ru', model: 'Qwen/Qwen3.5-397B-A17B', totalMs: 4300, generatedAt: new Date().toISOString() }, usage: { promptTokens: 3100, completionTokens: 620 }, timing: { ttftMs: 700, totalMs: 4300 } };
    return Promise.resolve(new Response(mkStream(steps, fin), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  }
  if (u.includes('/api/extension/interview-card')) {
    const steps = [
      [{ partial: { role: CARD.role } }, 800],
      [{ partial: { role: CARD.role, intro: CARD.intro } }, 800],
      [{ partial: { role: CARD.role, intro: CARD.intro, blocks: [CARD.blocks[0]] } }, 1000],
      [{ partial: CARD }, 800],
    ];
    const fin = { done: true, card: CARD, meta: { provider: 'cloud_ru', model: 'Qwen/Qwen3.5-397B-A17B', totalMs: 3400, generatedAt: new Date().toISOString() }, usage: { promptTokens: 2800, completionTokens: 540 }, timing: { ttftMs: 800, totalMs: 3400 } };
    return Promise.resolve(new Response(mkStream(steps, fin), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  }
  if (u.includes('/api/extension/summarize')) {
    const TXT = "## Сводка\n\nКандидат: senior frontend, 6 лет. Стек Vue/Nuxt/TS. Достижения: сборка −40%, дизайн-система.";
    const stream = new ReadableStream({ async start(c) {
      await sleep(1400);
      for (let i = 0; i < TXT.length; i += 12) { c.enqueue(sse({ delta: TXT.slice(i, i + 12) })); await sleep(90); }
      c.enqueue(sse({ done: true, usage: {}, timing: { ttftMs: 500, firstTextMs: 1500, totalMs: 3600 }, model: 'Qwen/Qwen3.5-397B-A17B' }));
      c.close();
    }});
    return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  }
  return _f(url, opts);
};
"""

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            "/tmp/pw-profile-p6", headless=False,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
        async def handler(route):
            url = route.request.url
            if "/api/extension/session" in url:
                await route.fulfill(status=200, content_type="application/json",
                    body=json.dumps({"user": {"id": "qa", "name": "QA"}}))
            elif "/api/extension/" in url:
                await route.fulfill(status=200, content_type="application/json", body="{}")
            else:
                await route.continue_()
        await ctx.route("**/huntfork.ru/**", handler)
        sw = ctx.service_workers or [await ctx.wait_for_event("serviceworker", timeout=15000)]
        ext_id = sw[0].url.split("/")[2]
        page = await ctx.new_page()
        await page.add_init_script(INIT)
        await page.set_viewport_size({"width": 380, "height": 720})
        await page.goto(f"chrome-extension://{ext_id}/sidepanel.html")
        await page.wait_for_timeout(2500)

        # ── Верификация ──
        await page.click("[title='Скрининг']")
        await page.wait_for_timeout(400)
        await page.click("text=Верификация")
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/vf-00-idle.png")
        await page.click("text=Считать страницу и проверить")
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{OUT}/vf-01-stages.png")
        stages = await page.evaluate("() => (document.querySelector('.hf-stages')||{}).textContent || 'NO_STAGES'")
        print("stages@0.9s:", " ".join(stages.split()))
        await page.wait_for_timeout(1400)
        await page.screenshot(path=f"{OUT}/vf-02-partial-summary.png")
        await page.wait_for_timeout(1600)
        await page.screenshot(path=f"{OUT}/vf-03-partial-timeline.png")
        has_stop = await page.evaluate("() => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Стоп'))")
        print("stop-button-visible:", has_stop)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT}/vf-04-done.png")
        meta = await page.evaluate("() => (document.querySelector('.vfr-meta')||document.querySelector('[class*=meta]')||{}).textContent || ''")
        print("vf meta:", " ".join(meta.split()))

        # ── Карточка интервью ──
        await page.click("text=Интервью")
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/ic-00-ready.png")
        btn = await page.evaluate("() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.includes('Составить') || x.textContent.includes('составить')); return b ? b.textContent.trim() : 'NO_BTN' }")
        print("ic start btn:", btn)
        await page.click("text=оставить")
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{OUT}/ic-01-stages.png")
        stages2 = await page.evaluate("() => (document.querySelector('.hf-stages')||{}).textContent || 'NO_STAGES'")
        print("ic stages@1s:", " ".join(stages2.split()))
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/ic-02-partial.png")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT}/ic-03-done.png")
        wide = await page.evaluate("() => { const out = []; const sv = document.querySelector('.screening-view'); if (sv) out.push(['SV', sv.scrollWidth, sv.clientWidth, sv.scrollLeft]); document.querySelectorAll('.icr, .icr *').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) out.push([String(el.className).slice(0,40), el.scrollWidth, el.clientWidth]); }); return out.slice(0, 12) }")
        print("WIDE:", wide)
        meta2 = await page.evaluate("() => (document.querySelector('.icr-meta')||{}).textContent || ''")
        print("ic meta:", " ".join(meta2.split()))

        # ── Чат: этапы в summary-фазе ──
        await page.click("[title='Чат']")
        await page.wait_for_timeout(500)
        await page.click("textarea")
        await page.keyboard.press("/")
        await page.wait_for_timeout(400)
        await page.keyboard.press("Enter")  # первая быстрая команда
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/chat-01-think-stage.png")
        st3 = await page.evaluate("() => (document.querySelector('.hf-stages')||{}).textContent || 'NO_STAGES'")
        print("chat stages@0.7s:", " ".join(st3.split()))
        await page.wait_for_timeout(1400)
        await page.screenshot(path=f"{OUT}/chat-02-write-stage.png")
        st4 = await page.evaluate("() => (document.querySelector('.hf-stages')||{}).textContent || 'NO_STAGES'")
        print("chat stages@2.1s:", " ".join(st4.split()))
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{OUT}/chat-03-done.png")
        st5 = await page.evaluate("() => (document.querySelector('.hf-stages')||{}).textContent || 'GONE'")
        print("chat stages@done:", " ".join(st5.split()))

        await ctx.close()

asyncio.run(main())
