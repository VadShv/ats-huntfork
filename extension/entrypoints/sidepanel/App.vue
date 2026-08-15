<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'

const HUNTFORK_BASE = 'https://huntfork.ru'

// ── Состояние ────────────────────────────────────────────────────────
type Phase = 'boot' | 'no-session' | 'idle' | 'checking' | 'exists' | 'new' | 'error'
  | 'capturing' | 'draft' | 'saved' | 'summary' | 'chat'

const phase = ref<Phase>('boot')
const errorMsg = ref('')
const sessionUser = ref<{ name?: string, email?: string, orgName?: string } | null>(null)
const currentUrl = ref<string | null>(null)
const resumeId = ref<string | null>(null)
const existsInfo = ref<any>(null)
const jobs = ref<Array<{ id: string, title: string, status: string }>>([])
const selectedJobId = ref('')
const importing = ref(false)
const importedOk = ref(false)

const isHhPage = computed(() => !!currentUrl.value && /(^|\.)hh\.ru$/.test(safeHost(currentUrl.value)))
const isListPage = computed(() =>
  !!currentUrl.value && /\/(search\/resume|employer\/applicants)/.test(currentUrl.value))

// ── S1 Universal Capture: состояние ─────────────────────────────────
const capturing = ref(false)
const captureStep = ref('') // 'extract' | 'parse'
const saving = ref(false)
const parsedFull = ref<any>(null)      // полный StructuredResume от бэкенда
const capMeta = ref<{ provider: string | null, model: string | null, site: string, sourceUrl: string, selectionUsed: boolean } | null>(null)
const capDupes = ref<{ exact: any[], fuzzy: any[], social: any[] } | null>(null)
const savedInfo = ref<{ candidateId: string, candidateName: string, applicationCreated?: boolean } | null>(null)
const forceAvailable = ref(false) // 409 fuzzy/social — можно сохранить с force
const blockedExact = ref<any[]>([]) // 409 exact — сохранить нельзя

// Редактируемые поля черновика
const dFirstName = ref('')
const dLastName = ref('')
const dTitle = ref('')
const dCity = ref('')
const dEmail = ref('')
const dPhone = ref('')
const dTelegram = ref('')
const dLinkedin = ref('')
const dGithub = ref('')
const dAbout = ref('')
const dSkills = ref('')

const SITE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  habr: 'Хабр Карьера',
  github: 'GitHub',
  hunt: 'HÜNT',
  podbor: 'Podbor.io',
  pdf: 'PDF',
  generic: 'страницы',
}

const currentSite = computed(() => {
  const h = safeHost(currentUrl.value ?? '')
  if (/(^|\.)linkedin\.com$/.test(h)) return 'linkedin'
  if (h === 'career.habr.com') return 'habr'
  if (/(^|\.)github\.com$/.test(h)) return 'github'
  if (/(^|\.)huntshare\.tech$/.test(h)) return 'hunt'
  if (/(^|\.)podbor\.io$/.test(h)) return 'podbor'
  return 'generic'
})
const currentSiteLabel = computed(() => SITE_LABELS[currentSite.value] ?? 'страницы')
const canCapture = computed(() => {
  if (!currentUrl.value) return false
  if (isHhPage.value) return false // на hh — только штатный импорт через API
  return /^https?:\/\//.test(currentUrl.value)
})
const isPdfPage = computed(() => !!currentUrl.value && /\.pdf([?#]|$)/i.test(currentUrl.value))

// ── S2–S8 Sidekick: состояние ИИ-функций ──────────────────────
const MODE_LABELS: Record<string, string> = {
  summary: 'Сводка по странице',
  fit: 'Оценка соответствия вакансии',
  fragment: 'Сводка по выделенному',
  questions: 'Вопросы для интервью',
  translate: 'Перевод на русский',
  card: 'Карточка знаний',
  custom: 'Быстрая команда',
}

interface PromptDef { id: string, label: string, mode: string, instruction?: string }
const FALLBACK_PROMPTS: PromptDef[] = [
  { id: 'card', label: 'Карточка знаний', mode: 'card' },
  { id: 'questions', label: 'Вопросы для интервью', mode: 'questions' },
  { id: 'translate', label: 'Перевести на русский', mode: 'translate' },
]

const pageCtx = ref<any>(null)          // последний извлечённый контент страницы
const prompts = ref<PromptDef[]>([])    // библиотека промптов с бэкенда (S8)
const lookupInfo = ref<any>(null)       // «уже в базе?» по URL (S6)

const aiMode = ref('summary')
const aiModeLabel = ref('Сводка')
const aiText = ref('')
const aiRunning = ref(false)
const aiError = ref('')
const aiUsage = ref<{ promptTokens: number, completionTokens: number } | null>(null)
const aiCached = ref(false)
const aiJobId = ref('')
const copied = ref(false)
const noteSaving = ref(false)
const noteSaved = ref(false)
let aiAbort: AbortController | null = null
let jobsLoaded = false

const promptChips = computed<PromptDef[]>(() => {
  const list = prompts.value.length ? prompts.value : FALLBACK_PROMPTS
  return list.filter(p => p.mode !== 'summary')
})
const noteCandidateId = computed<string | null>(() =>
  lookupInfo.value?.candidate?.id ?? savedInfo.value?.candidateId ?? null)
const aiHtml = computed(() => mdToHtml(aiText.value))

// Чат (S5)
const chatMessages = ref<Array<{ role: 'user' | 'assistant', content: string }>>([])
const chatInput = ref('')
const chatStreaming = ref(false)
const chatListEl = ref<HTMLElement | null>(null)

function safeHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' }
}

/**
 * resumeId из URL вкладки. Никакого DOM hh.ru:
 * /resume/<hex-hash> — как в старом расширении, но дополнительно терпим
 * любые не-слэш идентификаторы (если hh сменит формат, панель не умрёт).
 */
function extractResumeId(u: string | null): string | null {
  if (!u) return null
  try {
    const url = new URL(u)
    if (!/(^|\.)hh\.ru$/.test(url.hostname)) return null
    const m = url.pathname.match(/\/resume\/([a-f0-9]{16,})/i)
      ?? url.pathname.match(/\/resume\/([^/?#]+)/)
    return m?.[1] ?? null
  }
  catch { return null }
}

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

function fmtDate(iso?: string) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  catch { return '' }
}

// ── Основной цикл (hh-флоу, без изменений) ──────────────────────────
async function refresh() {
  errorMsg.value = ''
  importedOk.value = false
  existsInfo.value = null

  // 1. Сессия
  const session = await send({ type: 'session' })
  if (!session.ok) {
    if (session.code === 'UNAUTHORIZED' || session.status === 401) {
      phase.value = 'no-session'
    }
    else {
      phase.value = 'error'
      errorMsg.value = session.message || 'Ошибка соединения с Huntfork'
    }
    return
  }
  sessionUser.value = session.data?.user ?? session.data ?? null

  // 2. Резюме в активной вкладке?
  if (!resumeId.value) {
    phase.value = 'idle'
    return
  }

  // 3. Дубль-чек
  phase.value = 'checking'
  const checkResp = await send({ type: 'check', resumeIds: [resumeId.value] })
  if (!checkResp.ok) {
    phase.value = 'error'
    errorMsg.value = checkResp.message || 'Ошибка проверки дублей'
    return
  }
  const result = checkResp.data?.results?.[0]
  if (result?.exists) {
    existsInfo.value = result
    phase.value = 'exists'
    return
  }

  // 4. Вакансии для дропдауна
  const jobsResp = await send({ type: 'jobs' })
  jobs.value = jobsResp.ok ? (jobsResp.data?.jobs ?? []) : []
  phase.value = 'new'
}

async function doImport() {
  if (!resumeId.value) return
  importing.value = true
  errorMsg.value = ''
  const resp = await send({
    type: 'import',
    resumeId: resumeId.value,
    url: currentUrl.value,
    jobId: selectedJobId.value || undefined,
  })
  importing.value = false
  if (resp.ok) {
    importedOk.value = true
    await refresh() // теперь exists=true
  }
  else {
    errorMsg.value = resp.message || 'Ошибка импорта'
  }
}

function openHuntfork(url?: string) {
  send({ type: 'openHuntfork', url: url || HUNTFORK_BASE })
}

async function syncActiveTab() {
  const resp = await send({ type: 'activeTab' })
  const url = resp?.data?.url ?? null
  currentUrl.value = url
  resumeId.value = extractResumeId(url)
}

// ── S1 Universal Capture: логика ────────────────────────────────────
async function startCapture() {
  if (!canCapture.value || capturing.value) return
  errorMsg.value = ''
  blockedExact.value = []
  forceAvailable.value = false
  capturing.value = true

  try {
    // 1–2. Разрешение на origin + извлечение контента (общая точка grabPage)
    phase.value = 'capturing'
    captureStep.value = 'extract'
    const p = await grabPage()
    if (!p.text || p.text.length < 80) {
      throw new Error('На странице слишком мало текста. Выделите блок с резюме и попробуйте снова')
    }
    await parseAndDraft(p)
  }
  catch (err: any) {
    phase.value = 'idle'
    errorMsg.value = err?.message || 'Не удалось импортировать данные'
  }
  finally {
    capturing.value = false
    captureStep.value = ''
  }
}

/** Разрешение на origin текущей вкладки + извлечение контента. Общая точка для захвата, саммари и чата. */
async function grabPage(): Promise<any> {
  const u = currentUrl.value!
  const originPattern = `${new URL(u).origin}/*`
  const has = await chrome.permissions.contains({ origins: [originPattern] })
  if (!has) {
    const granted = await chrome.permissions.request({ origins: [originPattern] })
    if (!granted) throw new Error('Без доступа к сайту действие невозможно')
  }
  const tabResp = await send({ type: 'activeTab' })
  const tabId = tabResp?.data?.tabId
  if (!tabId) throw new Error('Активная вкладка не найдена')
  const page = await send({ type: 'capturePage', tabId })
  if (!page.ok) throw new Error(page.message || 'Не удалось извлечь контент')
  pageCtx.value = page.data
  return page.data
}

/** LLM-разбор извлечённого контента → черновик кандидата (шаги 3–5 захвата). */
async function parseAndDraft(p: any) {
  phase.value = 'capturing'
  captureStep.value = 'parse'
    const parseResp = await send({
      type: 'captureParse',
      payload: {
        sourceUrl: p.canonical || p.url,
        site: p.site,
        title: p.title,
        text: p.text,
        selection: p.selectionUsed,
        contacts: p.contacts,
      },
    })
    if (!parseResp.ok) throw new Error(parseResp.message || 'Ошибка разбора страницы')

    // 4. Заполняем черновик
    const d = parseResp.data
    parsedFull.value = d.parsed
    capMeta.value = {
      provider: d.meta?.provider ?? null,
      model: d.meta?.model ?? null,
      site: p.site,
      sourceUrl: p.canonical || p.url,
      selectionUsed: !!p.selectionUsed,
    }
    capDupes.value = d.duplicates ?? { exact: [], fuzzy: [], social: [] }
    dFirstName.value = d.parsed.firstName ?? ''
    dLastName.value = d.parsed.lastName ?? ''
    dTitle.value = d.parsed.title ?? ''
    dCity.value = d.parsed.area ?? ''
    dEmail.value = d.contacts?.email ?? ''
    dPhone.value = d.contacts?.phone ?? ''
    dTelegram.value = d.contacts?.telegram ?? ''
    dLinkedin.value = d.contacts?.linkedin ?? ''
    dGithub.value = d.contacts?.github ?? ''
    dAbout.value = d.parsed.about ?? ''
    dSkills.value = (d.parsed.skills ?? []).join(', ')

    // 5. Вакансии для привязки
    const jobsResp = await send({ type: 'jobs' })
    jobs.value = jobsResp.ok ? (jobsResp.data?.jobs ?? []) : []
    jobsLoaded = true

    phase.value = 'draft'
}

async function saveDraft(force = false) {
  if (saving.value || !parsedFull.value || !capMeta.value) return
  if (!dFirstName.value.trim() && !dLastName.value.trim()) {
    errorMsg.value = 'Укажите имя или фамилию'
    return
  }
  saving.value = true
  errorMsg.value = ''
  blockedExact.value = []
  forceAvailable.value = false

  const parsed = {
    ...parsedFull.value,
    firstName: dFirstName.value.trim(),
    lastName: dLastName.value.trim(),
    title: dTitle.value.trim(),
    area: dCity.value.trim(),
    about: dAbout.value.trim(),
    skills: dSkills.value.split(',').map(s => s.trim()).filter(Boolean),
    contacts: [
      dPhone.value.trim() && { type: 'phone', value: dPhone.value.trim() },
      dEmail.value.trim() && { type: 'email', value: dEmail.value.trim() },
      dTelegram.value.trim() && { type: 'telegram', value: dTelegram.value.trim() },
      dLinkedin.value.trim() && { type: 'linkedin', value: dLinkedin.value.trim() },
      dGithub.value.trim() && { type: 'github', value: dGithub.value.trim() },
    ].filter(Boolean),
  }

  const resp = await send({
    type: 'captureConfirm',
    payload: {
      parsed,
      contacts: {
        email: dEmail.value.trim() || null,
        phone: dPhone.value.trim() || null,
        telegram: dTelegram.value.trim() || null,
        linkedin: dLinkedin.value.trim() || null,
        github: dGithub.value.trim() || null,
      },
      sourceUrl: capMeta.value.sourceUrl,
      site: capMeta.value.site,
      provider: capMeta.value.provider,
      model: capMeta.value.model,
      jobId: selectedJobId.value || undefined,
      force,
    },
  })
  saving.value = false

  if (resp.ok) {
    savedInfo.value = {
      candidateId: resp.data.candidateId,
      candidateName: resp.data.candidateName,
      applicationCreated: resp.data.applicationCreated,
    }
    phase.value = 'saved'
    return
  }

  // 409 — дубликаты
  if (resp.code === 'duplicate_exact') {
    blockedExact.value = resp.data?.exact ?? []
    errorMsg.value = 'Кандидат с таким email или телефоном уже есть в базе'
    return
  }
  if (resp.code === 'duplicate_fuzzy' || resp.code === 'duplicate_social') {
    forceAvailable.value = true
    if (resp.data?.fuzzy?.length && capDupes.value) capDupes.value.fuzzy = resp.data.fuzzy
    if (resp.data?.social?.length && capDupes.value) capDupes.value.social = resp.data.social
    errorMsg.value = resp.code === 'duplicate_social'
      ? 'Кандидат с таким профилем уже есть в базе'
      : 'Похоже, такой кандидат уже есть в базе'
    return
  }
  errorMsg.value = resp.message || 'Ошибка сохранения'
}

function cancelDraft() {
  parsedFull.value = null
  capMeta.value = null
  capDupes.value = null
  savedInfo.value = null
  errorMsg.value = ''
  blockedExact.value = []
  forceAvailable.value = false
  selectedJobId.value = ''
  phase.value = 'idle'
}

// ── S2–S8 Sidekick: ИИ-функции ──────────────────────────────────

/** Мини-рендер Markdown → HTML (без зависимостей, с экранированием). */
function mdToHtml(md: string): string {
  if (!md) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  let html = ''
  let inUl = false
  let inOl = false
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const h = line.match(/^#{1,4}\s+(.*)/)
    const ul = line.match(/^\s*[-*•]\s+(.*)/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/)
    if (h) { closeLists(); html += `<div class="md-h">${inline(h[1])}</div>` }
    else if (ul) {
      if (!inUl) { closeLists(); html += '<ul>'; inUl = true }
      html += `<li>${inline(ul[1])}</li>`
    }
    else if (ol) {
      if (!inOl) { closeLists(); html += '<ol>'; inOl = true }
      html += `<li>${inline(ol[1])}</li>`
    }
    else if (!line.trim()) { closeLists() }
    else { closeLists(); html += `<p>${inline(line)}</p>` }
  }
  closeLists()
  return html
}

/** Стриминговый POST на SSE-эндпоинты Sidekick (fetch прямо из панели, cookie подхватываются). */
async function sseFetch(path: string, body: any, onDelta: (s: string) => void): Promise<any> {
  const resp = await fetch(`${HUNTFORK_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: aiAbort?.signal,
  })
  if (resp.status === 401) throw new Error('Требуется вход на huntfork.ru')
  const ctype = resp.headers.get('content-type') || ''
  if (!resp.ok || !ctype.includes('text/event-stream')) {
    let msg = `Ошибка ${resp.status}`
    try {
      const j = await resp.json()
      msg = j.statusMessage || j.message || msg
    }
    catch {}
    throw new Error(msg)
  }
  const reader = resp.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let final: any = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx = buf.indexOf('\n\n')
    while (idx >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        let obj: any = null
        try { obj = JSON.parse(line.slice(6)) } catch { continue }
        if (obj.delta) onDelta(obj.delta)
        else if (obj.done) final = obj
        else if (obj.error) throw new Error(obj.error)
      }
      idx = buf.indexOf('\n\n')
    }
  }
  return final
}

async function loadJobsOnce() {
  if (jobsLoaded) return
  const jobsResp = await send({ type: 'jobs' })
  if (jobsResp.ok) {
    jobs.value = jobsResp.data?.jobs ?? []
    jobsLoaded = true
  }
}

async function loadPrompts() {
  const resp = await send({ type: 'prompts' })
  if (resp.ok && resp.data?.prompts?.length) prompts.value = resp.data.prompts
}

/** Запуск саммари/режима (S2/S3/S4/S8). */
async function runSummary(mode: string, opts: { instruction?: string, label?: string, ctx?: any } = {}) {
  if (aiRunning.value || capturing.value) return
  errorMsg.value = ''
  aiError.value = ''
  aiMode.value = mode
  aiModeLabel.value = opts.label ?? MODE_LABELS[mode] ?? 'Сводка'
  lastCustom = opts.instruction ?? null
  phase.value = 'summary'
  aiText.value = ''
  aiUsage.value = null
  aiCached.value = false
  noteSaved.value = false
  copied.value = false

  try {
    let ctx = opts.ctx ?? pageCtx.value
    // Свежее извлечение: для фрагмента (актуальное выделение) или если контекст устарел
    if (mode === 'fragment' || !ctx || ctx.url !== currentUrl.value) {
      ctx = await grabPage()
    }
    let text = ctx.text ?? ''
    if (mode === 'fragment') {
      text = (ctx.selectionText ?? '').trim()
      if (text.length < 80) throw new Error('Выделите на странице фрагмент текста (от 80 символов) и нажмите снова')
    }
    if (text.length < 80) throw new Error('На странице слишком мало текста для анализа')

    if (mode === 'fit') {
      await loadJobsOnce()
      if (!aiJobId.value) return // ждём выбор вакансии в экране саммари
    }

    aiRunning.value = true
    aiAbort = new AbortController()
    const final = await sseFetch('/api/extension/summarize', {
      sourceUrl: ctx.canonical || ctx.url,
      site: ctx.site,
      title: ctx.title,
      text,
      mode,
      jobId: mode === 'fit' ? aiJobId.value : undefined,
      instruction: opts.instruction,
    }, (d) => { aiText.value += d })
    aiUsage.value = final.usage ?? null
    aiCached.value = !!final.cached
  }
  catch (err: any) {
    if (err?.name !== 'AbortError') aiError.value = err?.message || 'Ошибка генерации'
  }
  finally {
    aiRunning.value = false
    aiAbort = null
  }
}

let lastCustom: string | null = null

function runPrompt(p: PromptDef) {
  if (p.mode === 'custom') runSummary('custom', { instruction: p.instruction, label: p.label })
  else runSummary(p.mode, { label: p.label })
}

function rerunFit() {
  if (aiJobId.value && !aiRunning.value) runSummary('fit')
}

function abortAi() {
  aiAbort?.abort()
}

async function copyAi() {
  try {
    await navigator.clipboard.writeText(aiText.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {}
}

/** Сохранение результата заметкой кандидату (S4). */
async function saveAsNote() {
  const cid = noteCandidateId.value
  if (!cid || !aiText.value.trim() || noteSaving.value) return
  noteSaving.value = true
  aiError.value = ''
  const header = `${aiModeLabel.value} · ${pageCtx.value?.canonical || pageCtx.value?.url || ''}\n\n`
  const resp = await send({ type: 'note', candidateId: cid, body: header + aiText.value })
  noteSaving.value = false
  if (resp.ok) noteSaved.value = true
  else aiError.value = resp.message || 'Не удалось сохранить заметку'
}

/** Из экрана саммари — в черновик кандидата (CTA «Добавить в Huntfork»). */
async function addToBase() {
  if (!pageCtx.value || capturing.value) return
  capturing.value = true
  errorMsg.value = ''
  try {
    await parseAndDraft(pageCtx.value)
  }
  catch (err: any) {
    phase.value = 'summary'
    aiError.value = err?.message || 'Не удалось импортировать данные'
  }
  finally {
    capturing.value = false
    captureStep.value = ''
  }
}

// ── S7: PDF ─────────────────────────────────────────────────

/** Разрешение + скачивание PDF и извлечение текста на бэкенде. */
async function pdfCtx(): Promise<any> {
  const u = currentUrl.value!
  const originPattern = `${new URL(u).origin}/*`
  const has = await chrome.permissions.contains({ origins: [originPattern] })
  if (!has) {
    const granted = await chrome.permissions.request({ origins: [originPattern] })
    if (!granted) throw new Error('Без доступа к сайту действие невозможно')
  }
  const resp = await send({ type: 'pdfText', url: u })
  if (!resp.ok) throw new Error(resp.message || 'Не удалось прочитать PDF')
  const ctx = {
    url: u,
    canonical: u,
    title: resp.data?.meta?.filename || 'PDF-документ',
    site: 'pdf',
    text: resp.data?.text ?? '',
    pageText: resp.data?.text ?? '',
    selectionText: '',
    selectionUsed: false,
    contacts: {},
  }
  pageCtx.value = ctx
  return ctx
}

async function capturePdf() {
  if (capturing.value || aiRunning.value) return
  capturing.value = true
  errorMsg.value = ''
  try {
    phase.value = 'capturing'
    captureStep.value = 'extract'
    const ctx = await pdfCtx()
    await parseAndDraft(ctx)
  }
  catch (err: any) {
    phase.value = 'idle'
    errorMsg.value = err?.message || 'Не удалось импортировать данные из PDF'
  }
  finally {
    capturing.value = false
    captureStep.value = ''
  }
}

async function summarizePdf() {
  if (capturing.value || aiRunning.value) return
  errorMsg.value = ''
  try {
    phase.value = 'capturing'
    captureStep.value = 'extract'
    const ctx = await pdfCtx()
    await runSummary('summary', { ctx })
  }
  catch (err: any) {
    phase.value = 'idle'
    errorMsg.value = err?.message || 'Ошибка чтения PDF'
  }
  finally {
    captureStep.value = ''
  }
}

// ── S5: чат со страницей ─────────────────────────────────────

async function openChat() {
  errorMsg.value = ''
  phase.value = 'chat'
  // Контекст страницы желателен, но не обязателен
  if (!isPdfPage.value && (!pageCtx.value || pageCtx.value.url !== currentUrl.value)) {
    try { await grabPage() }
    catch { /* чат без контекста страницы */ }
  }
}

async function sendChat() {
  const q = chatInput.value.trim()
  if (!q || chatStreaming.value) return
  chatMessages.value.push({ role: 'user', content: q })
  chatInput.value = ''
  const history = chatMessages.value.slice(-20).map(m => ({ role: m.role, content: m.content }))
  chatMessages.value.push({ role: 'assistant', content: '' })
  chatStreaming.value = true
  aiAbort = new AbortController()
  try {
    const ctx = pageCtx.value && pageCtx.value.url === currentUrl.value ? pageCtx.value : pageCtx.value
    await sseFetch('/api/extension/chat', {
      messages: history,
      pageText: ctx?.text ? String(ctx.text).slice(0, 15_000) : undefined,
      sourceUrl: ctx?.canonical || ctx?.url || undefined,
      title: ctx?.title,
      jobId: aiJobId.value || undefined,
    }, (d) => {
      const last = chatMessages.value[chatMessages.value.length - 1]
      if (last) last.content += d
    })
  }
  catch (err: any) {
    const last = chatMessages.value[chatMessages.value.length - 1]
    if (last && !last.content) {
      last.content = `⚠️ ${err?.name === 'AbortError' ? 'Остановлено' : (err?.message || 'Ошибка')}`
    }
  }
  finally {
    chatStreaming.value = false
    aiAbort = null
  }
}

watch(chatMessages, async () => {
  await nextTick()
  if (chatListEl.value) chatListEl.value.scrollTop = chatListEl.value.scrollHeight
}, { deep: true })

// ── S6: «уже в базе?» по URL ─────────────────────────────────
let lookupSeq = 0
async function doLookup(url: string | null) {
  lookupInfo.value = null
  if (!url || !/linkedin\.com\/in\/|github\.com\/[^/?#]+\/?([?#]|$)|t\.me\//i.test(url)) return
  const seq = ++lookupSeq
  const resp = await send({ type: 'lookup', url })
  if (seq !== lookupSeq) return // устаревший ответ
  if (resp.ok && resp.data?.exists) lookupInfo.value = resp.data
}

// Слушаем смену URL от background
function onMessage(msg: any) {
  if (msg?.type === 'tabUrlChanged') {
    // Не сбрасываем черновик/саммари/чат при переключении вкладок — рекрутёр мог
    // отойти свериться с вакансией. Экраны закрываются явно.
    if (['draft', 'capturing', 'saved', 'summary', 'chat'].includes(phase.value)) {
      currentUrl.value = msg.url
      return
    }
    currentUrl.value = msg.url
    doLookup(msg.url)
    const newId = extractResumeId(msg.url)
    if (newId !== resumeId.value) {
      resumeId.value = newId
      refresh()
    }
    else if (!newId) {
      // generic-страницы: обновляем подпись кнопки захвата без refresh
    }
  }
}

onMounted(async () => {
  chrome.runtime.onMessage.addListener(onMessage)
  await syncActiveTab()
  await refresh()
  doLookup(currentUrl.value)
  loadPrompts()
})

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onMessage)
})
</script>

<template>
  <div class="panel">
    <!-- Шапка -->
    <header class="hdr">
      <svg class="logo" viewBox="0 0 24 24" fill="none" aria-label="Huntfork">
        <path d="M5 3v7a4 4 0 0 0 4 4h1v7h4v-7h1a4 4 0 0 0 4-4V3h-3v7a1 1 0 0 1-1 1h-1V3h-4v8H9a1 1 0 0 1-1-1V3H5Z" fill="currentColor"/>
      </svg>
      <div class="hdr-text">
        <div class="hdr-title">Huntfork Sidekick</div>
        <div v-if="sessionUser" class="hdr-sub">{{ sessionUser.name || sessionUser.email }}</div>
      </div>
      <button class="btn btn-ghost btn-sm" title="Обновить" @click="syncActiveTab().then(refresh)">⟳</button>
    </header>

    <Transition name="screen" mode="out-in">

    <!-- Загрузка -->
    <section v-if="phase === 'boot' || phase === 'checking'" key="boot" class="card muted">
      <div class="spinner-inline"><div class="spinner" /> Подключаемся к Huntfork…</div>
    </section>

    <!-- Не залогинен -->
    <section v-else-if="phase === 'no-session'" key="no-session" class="card">
      <div class="card-title">🔒 Нужен вход в Huntfork</div>
      <p class="hint">Войдите на huntfork.ru — панель подхватит сессию автоматически.</p>
      <button class="btn btn-primary" @click="openHuntfork()">Открыть huntfork.ru</button>
      <button class="btn btn-ghost" @click="refresh">Я вошёл — проверить</button>
    </section>

    <!-- Ошибка -->
    <section v-else-if="phase === 'error'" key="error" class="card card-error">
      <div class="card-title">⚠️ Ошибка</div>
      <p class="hint">{{ errorMsg }}</p>
      <button class="btn btn-ghost" @click="refresh">Повторить</button>
    </section>

    <!-- Не на резюме hh: контекстная подсказка + Universal Capture -->
    <section v-else-if="phase === 'idle'" key="idle" class="card">
      <template v-if="isListPage">
        <div class="card-title">Список резюме</div>
        <p class="hint">Откройте резюме кандидата — панель проверит его и предложит импорт. Бейджи «В Huntfork» отображаются прямо в списке.</p>
      </template>
      <template v-else-if="isHhPage">
        <div class="card-title">hh.ru</div>
        <p class="hint">Откройте страницу резюме (hh.ru/resume/…), чтобы добавить кандидата в Huntfork.</p>
      </template>
      <template v-else-if="canCapture">
        <!-- S6: кандидат уже в базе (по URL профиля) -->
        <div v-if="lookupInfo?.exists" class="lookup-banner">
          <span>✅ Уже в базе: <strong>{{ lookupInfo.candidate?.name || 'Кандидат' }}</strong></span>
          <button class="btn btn-ghost btn-sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${lookupInfo.candidate?.id}`)">Открыть</button>
        </div>

        <template v-if="isPdfPage">
          <div class="card-title">📄 PDF-документ</div>
          <p class="hint">Панель извлечёт текст из PDF и разберёт его как резюме либо подготовит сводку.</p>
          <button class="btn btn-primary" :disabled="capturing || aiRunning" @click="capturePdf">
            📥 Импортировать кандидата из PDF
          </button>
          <button class="btn btn-ghost" :disabled="capturing || aiRunning" @click="summarizePdf">
            ✨ Сводка по PDF
          </button>
        </template>
        <template v-else>
          <div class="card-title">Huntfork Sidekick</div>
          <p class="hint">
            Сводка, вопросы и импорт кандидата со {{ currentSite === 'generic' ? 'страницы' : currentSiteLabel }}.
            Выделите фрагмент текста — панель будет работать только с ним.
          </p>
          <button class="btn btn-primary" :disabled="capturing || aiRunning" @click="runSummary('summary')">
            ✨ Сводка по странице
          </button>
          <div class="actions-grid">
            <button class="action-tile" :disabled="capturing || aiRunning" @click="startCapture">
              <span class="action-ico">📥</span> Импортировать кандидата
            </button>
            <button class="action-tile" :disabled="capturing" @click="openChat">
              <span class="action-ico">💬</span> Вопросы по странице
            </button>
            <button class="action-tile" :disabled="aiRunning" @click="runSummary('fit')">
              <span class="action-ico">🎯</span> Оценка соответствия
            </button>
            <button class="action-tile" :disabled="aiRunning" @click="runSummary('fragment')">
              <span class="action-ico">✂️</span> Сводка по выделенному
            </button>
          </div>
          <template v-if="promptChips.length">
            <div class="chips-label">Быстрые команды</div>
            <div class="chips">
              <button v-for="p in promptChips" :key="p.id" class="chip" :disabled="aiRunning" @click="runPrompt(p)">
                {{ p.label }}
              </button>
            </div>
          </template>
        </template>
        <div v-if="errorMsg" class="flash-err">{{ errorMsg }}</div>
      </template>
      <template v-else>
        <div class="card-title">Huntfork Sidekick</div>
        <p class="hint">Откройте резюме на hh.ru или профиль кандидата на любом сайте (LinkedIn, Хабр Карьера, GitHub…), чтобы добавить его в Huntfork.</p>
      </template>
    </section>

    <!-- Импорт: прогресс -->
    <section v-else-if="phase === 'capturing'" key="capturing" class="card">
      <div class="spinner-inline">
        <div class="spinner" />
        {{ captureStep === 'parse' ? 'ИИ разбирает данные кандидата…' : 'Извлекаем данные со страницы…' }}
      </div>
      <div class="skeleton">
        <div class="sk-line w-90" />
        <div class="sk-line w-70" />
        <div class="sk-line w-50" />
      </div>
    </section>

    <!-- Импорт: проверка данных -->
    <section v-else-if="phase === 'draft'" key="draft" class="card">
      <div class="card-title">📥 Проверка данных перед импортом</div>
      <p class="hint">
        Источник: {{ SITE_LABELS[capMeta?.site ?? 'generic'] ?? capMeta?.site }}<template v-if="capMeta?.selectionUsed"> (из выделенного текста)</template>.
        Проверьте и при необходимости поправьте поля.
      </p>

      <!-- Дубликаты -->
      <div v-if="capDupes && (capDupes.exact.length || capDupes.social.length)" class="dup-block dup-hard">
        <div class="dup-title">⛔ Уже в базе</div>
        <div v-for="(x, i) in capDupes.exact" :key="'e' + i" class="dup-row">
          <span>{{ x.candidateName || 'Кандидат' }} — совпал {{ x.kind === 'email' ? 'email' : 'телефон' }}</span>
          <button class="btn btn-ghost btn-sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</button>
        </div>
        <div v-for="(x, i) in capDupes.social" :key="'s' + i" class="dup-row">
          <span>{{ x.candidateName || 'Кандидат' }} — совпал профиль {{ x.kind }}</span>
          <button class="btn btn-ghost btn-sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</button>
        </div>
      </div>
      <div v-if="capDupes?.fuzzy?.length" class="dup-block dup-soft">
        <div class="dup-title">⚠️ Возможные дубли</div>
        <div v-for="(x, i) in capDupes.fuzzy" :key="'f' + i" class="dup-row">
          <span>{{ x.candidateName || 'Кандидат' }} — схожесть {{ x.score }}%</span>
          <button class="btn btn-ghost btn-sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</button>
        </div>
      </div>

      <!-- Форма -->
      <div class="form-grid">
        <div class="fld">
          <label class="label">Имя</label>
          <input v-model="dFirstName" class="input" placeholder="Имя">
        </div>
        <div class="fld">
          <label class="label">Фамилия</label>
          <input v-model="dLastName" class="input" placeholder="Фамилия">
        </div>
      </div>
      <div class="fld">
        <label class="label">Должность</label>
        <input v-model="dTitle" class="input" placeholder="Например: Senior Python Developer">
      </div>
      <div class="form-grid">
        <div class="fld">
          <label class="label">Город</label>
          <input v-model="dCity" class="input" placeholder="Город">
        </div>
        <div class="fld">
          <label class="label">Телефон</label>
          <input v-model="dPhone" class="input" placeholder="+7…">
        </div>
      </div>
      <div class="fld">
        <label class="label">Email</label>
        <input v-model="dEmail" class="input" type="email" placeholder="email@example.com">
      </div>
      <div class="fld">
        <label class="label">Telegram</label>
        <input v-model="dTelegram" class="input" placeholder="@username или t.me/…">
      </div>
      <div class="fld">
        <label class="label">LinkedIn</label>
        <input v-model="dLinkedin" class="input" placeholder="linkedin.com/in/…">
      </div>
      <div class="fld">
        <label class="label">GitHub</label>
        <input v-model="dGithub" class="input" placeholder="github.com/…">
      </div>
      <div class="fld">
        <label class="label">Навыки (через запятую)</label>
        <input v-model="dSkills" class="input" placeholder="Python, SQL, Docker">
      </div>
      <div class="fld">
        <label class="label">О кандидате</label>
        <textarea v-model="dAbout" class="input textarea" rows="4" placeholder="Краткое описание кандидата" />
      </div>

      <div v-if="parsedFull?.experience?.length" class="exp-block">
        <div class="label">Опыт ({{ parsedFull.experience.length }})</div>
        <div v-for="(e, i) in parsedFull.experience.slice(0, 5)" :key="i" class="exp-row">
          {{ e.position || '—' }}<template v-if="e.company"> · {{ e.company }}</template>
        </div>
      </div>

      <label class="label">Вакансия</label>
      <select v-model="selectedJobId" class="select">
        <option value="">— Без привязки к вакансии —</option>
        <option v-for="j in jobs" :key="j.id" :value="j.id">
          {{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}
        </option>
      </select>

      <!-- Блокирующие дубли после попытки сохранения -->
      <div v-if="blockedExact.length" class="dup-block dup-hard">
        <div class="dup-title">⛔ Импорт заблокирован</div>
        <div v-for="(x, i) in blockedExact" :key="i" class="dup-row">
          <span>{{ x.candidateName || 'Кандидат' }} — {{ x.kind === 'email' ? 'email' : 'телефон' }} уже в базе</span>
          <button class="btn btn-ghost btn-sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</button>
        </div>
        <p class="hint">Измените email/телефон или откройте существующую карточку.</p>
      </div>

      <button v-if="!forceAvailable" class="btn btn-primary" :disabled="saving" @click="saveDraft(false)">
        {{ saving ? 'Импортируем…' : 'Импортировать в Huntfork' }}
      </button>
      <template v-else>
        <button class="btn btn-primary" :disabled="saving" @click="saveDraft(true)">
          {{ saving ? 'Импортируем…' : 'Импортировать всё равно' }}
        </button>
      </template>
      <button class="btn btn-ghost" :disabled="saving" @click="cancelDraft">Отменить</button>
      <div v-if="errorMsg" class="flash-err">{{ errorMsg }}</div>
    </section>

    <!-- Импорт: завершён -->
    <section v-else-if="phase === 'saved'" key="saved" class="card card-ok">
      <div class="card-title">✅ Кандидат импортирован</div>
      <div class="cand-name">{{ savedInfo?.candidateName || 'Кандидат' }}</div>
      <div v-if="savedInfo?.applicationCreated" class="hint">Создана заявка на вакансию</div>
      <button
        class="btn btn-primary"
        @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${savedInfo?.candidateId}`)"
      >
        Открыть карточку
      </button>
      <button class="btn btn-ghost" @click="cancelDraft">Готово</button>
    </section>

    <!-- Уже в базе (hh) -->
    <section v-else-if="phase === 'exists'" key="exists" class="card card-ok">
      <div class="card-title">✅ Уже в базе Huntfork</div>
      <div class="cand-name">{{ existsInfo?.candidateName || 'Кандидат' }}</div>
      <div class="hint">Добавлен {{ fmtDate(existsInfo?.addedAt) }}</div>

      <div v-if="existsInfo?.applications?.length" class="apps">
        <div v-for="a in existsInfo.applications" :key="a.jobTitle" class="app-row">
          <span class="app-job">{{ a.jobTitle }}</span>
          <span v-if="a.currentStageName" class="app-stage">→ {{ a.currentStageName }}</span>
        </div>
      </div>
      <div v-else class="hint">Без откликов на вакансии</div>

      <button
        class="btn btn-primary"
        @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${existsInfo?.candidateId}`)"
      >
        Открыть карточку
      </button>
      <div v-if="importedOk" class="flash-ok">Резюме импортировано</div>
    </section>

    <!-- Новый кандидат (hh) -->
    <section v-else-if="phase === 'new'" key="new" class="card">
      <div class="card-title">➕ Импорт в Huntfork</div>
      <p class="hint">Резюме будет загружено с hh.ru через официальный API и сохранено в базе.</p>

      <label class="label">Вакансия</label>
      <select v-model="selectedJobId" class="select">
        <option value="">— Без привязки к вакансии —</option>
        <option v-for="j in jobs" :key="j.id" :value="j.id">
          {{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}
        </option>
      </select>

      <button class="btn btn-primary" :disabled="importing" @click="doImport">
        {{ importing ? 'Импортируем…' : 'Импортировать кандидата' }}
      </button>
      <div v-if="errorMsg" class="flash-err">{{ errorMsg }}</div>
    </section>

    <!-- S2–S4/S8: экран анализа -->
    <section v-else-if="phase === 'summary'" key="summary" class="card">
      <div class="card-title">✨ {{ aiModeLabel }}</div>

      <template v-if="aiMode === 'fit'">
        <label class="label">Вакансия</label>
        <select v-model="aiJobId" class="select" :disabled="aiRunning" @change="rerunFit">
          <option value="">— Выберите вакансию —</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">
            {{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}
          </option>
        </select>
        <p v-if="!aiJobId && !aiText" class="hint">Выберите вакансию — оценка соответствия запустится автоматически.</p>
      </template>

      <div v-if="aiText" class="md" :class="{ streaming: aiRunning }" v-html="aiHtml" />
      <div v-if="aiRunning && !aiText" class="spinner-inline">
        <div class="spinner" /> Читаем страницу и готовим ответ…
      </div>
      <div v-if="aiRunning && !aiText" class="skeleton">
        <div class="sk-line w-90" />
        <div class="sk-line w-70" />
        <div class="sk-line w-50" />
      </div>
      <div v-if="aiError" class="flash-err">{{ aiError }}</div>
      <div v-if="aiUsage && !aiRunning" class="usage">
        {{ aiCached ? 'результат из кэша' : `токены: ${aiUsage.promptTokens ?? '?'} + ${aiUsage.completionTokens ?? '?'}` }}
      </div>

      <div class="btn-row">
        <button v-if="aiRunning" class="btn btn-ghost" @click="abortAi">⏹ Остановить</button>
        <template v-if="!aiRunning && aiText">
          <button class="btn btn-ghost btn-sm" @click="copyAi">{{ copied ? '✓ Скопировано' : '📋 Копировать' }}</button>
          <button
            v-if="noteCandidateId"
            class="btn btn-ghost btn-sm"
            :disabled="noteSaving || noteSaved"
            @click="saveAsNote"
          >
            {{ noteSaved ? '✓ Сохранено в заметках' : (noteSaving ? 'Сохраняем…' : '📝 В заметки кандидата') }}
          </button>
        </template>
      </div>
      <button
        v-if="!aiRunning && aiText && aiMode !== 'fragment' && !noteCandidateId"
        class="btn btn-primary"
        :disabled="capturing"
        @click="addToBase"
      >
        {{ capturing ? 'Импортируем…' : '📥 Импортировать в Huntfork' }}
      </button>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" :disabled="aiRunning" @click="openChat">💬 Задать вопрос</button>
        <button class="btn btn-ghost btn-sm" :disabled="aiRunning" @click="phase = 'idle'">← Назад</button>
      </div>
    </section>

    <!-- S5: вопросы по странице -->
    <section v-else-if="phase === 'chat'" key="chat" class="card card-chat">
      <div class="card-title">💬 Вопросы по странице</div>
      <p v-if="!chatMessages.length" class="hint">
        Спросите что угодно о содержимом страницы: «сколько лет опыта?», «есть ли пробелы в карьере?», «составь вопросы для интервью».
      </p>
      <div ref="chatListEl" class="chat-list">
        <div v-for="(m, i) in chatMessages" :key="i" :class="m.role === 'user' ? 'msg msg-user' : 'msg msg-ai'">
          <template v-if="m.role === 'user'">{{ m.content }}</template>
          <span v-else-if="!m.content" class="typing"><i /><i /><i /></span>
          <div v-else class="md" v-html="mdToHtml(m.content)" />
        </div>
      </div>
      <div class="chat-input-row">
        <textarea
          v-model="chatInput"
          class="input textarea chat-ta"
          rows="2"
          placeholder="Ваш вопрос… (Enter — отправить)"
          :disabled="chatStreaming"
          @keydown.enter.exact.prevent="sendChat"
        />
        <button class="btn btn-primary btn-sm" :disabled="chatStreaming || !chatInput.trim()" @click="sendChat">➤</button>
      </div>
      <div class="btn-row">
        <button v-if="chatStreaming" class="btn btn-ghost btn-sm" @click="abortAi">⏹ Остановить</button>
        <button v-if="chatMessages.length && !chatStreaming" class="btn btn-ghost btn-sm" @click="chatMessages = []">Очистить диалог</button>
        <button class="btn btn-ghost btn-sm" :disabled="chatStreaming" @click="phase = 'idle'">← Назад</button>
      </div>
    </section>

    </Transition>

    <!-- Футер: контекст -->
    <footer class="ftr">
      <span v-if="resumeId" class="rid" :title="resumeId">резюме: {{ resumeId.slice(0, 10) }}…</span>
      <span v-else-if="canCapture" class="rid">{{ safeHost(currentUrl ?? '') }}</span>
      <span v-else class="rid rid-empty">источник не определён</span>
    </footer>
  </div>
</template>
