import { onMounted, onUnmounted, ref, computed } from 'vue'

import { useToast } from './useToast'
import { useConversations, type ChatMessage } from './useConversations'

const HUNTFORK_BASE = 'https://huntfork.ru'

// ── Типы ───────────────────────────────────────────────────────────
type Phase = 'boot' | 'no-session' | 'idle' | 'checking' | 'exists' | 'new' | 'error'
  | 'capturing' | 'draft' | 'saved' | 'summary' | 'chat'

/** Шесть разделов рельса — UI-слой поверх phase-машины. */
type ViewId = 'chat' | 'sourcing' | 'screening' | 'telegram' | 'outreach' | 'pipeline' | 'library' | 'hub'

interface PromptDef { id: string, label: string, mode: string, instruction?: string }

// ── Singleton-стейт (один экземпляр на панель) ─────────────────────
const phase = ref<Phase>('boot')
const activeView = ref<ViewId>('chat')
const errorMsg = ref('')
const sessionUser = ref<{ name?: string, email?: string, orgName?: string } | null>(null)
const currentUrl = ref<string | null>(null)
const resumeId = ref<string | null>(null)
const existsInfo = ref<any>(null)
const jobs = ref<Array<{ id: string, title: string, status: string }>>([])
const selectedJobId = ref('')
const importing = ref(false)
const importedOk = ref(false)

// S1 Universal Capture
const capturing = ref(false)
const captureStep = ref('')
const saving = ref(false)
const parsedFull = ref<any>(null)
const capMeta = ref<{ provider: string | null, model: string | null, site: string, sourceUrl: string, selectionUsed: boolean } | null>(null)
const capDupes = ref<{ exact: any[], fuzzy: any[], social: any[] } | null>(null)
const savedInfo = ref<{ candidateId: string, candidateName: string, applicationCreated?: boolean } | null>(null)
const forceAvailable = ref(false)
const blockedExact = ref<any[]>([])

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

// S2–S8
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

const pageCtx = ref<any>(null)
const prompts = ref<PromptDef[]>([])
const lookupInfo = ref<any>(null)

const chatMessages = ref<Array<{ role: 'user' | 'assistant', content: string }>>([])
const chatInput = ref('')
const chatStreaming = ref(false)
const chatListEl = ref<HTMLElement | null>(null)
const copiedMsg = ref(-1)

// Reasoning (глубокий анализ)
const reasoningEnabled = ref(false)
const REASONING_KEY = 'hf:reasoning'

// Пресеты чата
interface ChatPreset { id: string, label: string, desc: string, icon: string, prompt: string, recruiter?: boolean }
const CHAT_PRESETS: ChatPreset[] = [
  { id: 'summary', label: 'Самари', desc: 'Кратко по странице', icon: 'sparkle', prompt: 'Сделай краткое самари этой страницы: главные тезисы и выводы.', },
  { id: 'translate', label: 'Перевод', desc: 'На русский', icon: 'external', prompt: 'Переведи ключевой текст этой страницы на русский язык.', },
  { id: 'tech-terms', label: 'Тех. термины', desc: 'Собери и объясни', icon: 'layers', prompt: 'Собери все технические термины на этой странице и объясни каждый кратко на русском.', },
  { id: 'keypoints', label: 'Тезисы', desc: 'Ключевые моменты', icon: 'list-checks', prompt: 'Выдели ключевые тезисы страницы в виде структурированного списка.', },
  { id: 'questions', label: 'Вопросы', desc: 'Для интервью', icon: 'chat', prompt: 'Сформулируй вопросы для интервью по этой странице (контекст кандидата).', recruiter: true },
  { id: 'fit', label: 'Оценка', desc: 'Релевантность', icon: 'target', prompt: 'Оцени релевантность кандидата на этой странице для выбранной вакансии.', recruiter: true },
  { id: 'card', label: 'Карточка', desc: 'Знаний кандидата', icon: 'screening', prompt: 'Составь карточку знаний кандидата по этой странице.', recruiter: true },
]

let lastCustom: string | null = null
let lookupSeq = 0

const { toast } = useToast()

// ── Константы ──────────────────────────────────────────────────────
const SITE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', habr: 'Хабр Карьера', github: 'GitHub',
  hunt: 'HÜNT', podbor: 'Podbor.io', pdf: 'PDF', generic: 'страницы',
}

const MODE_LABELS: Record<string, string> = {
  summary: 'Сводка по странице', fit: 'Оценка соответствия вакансии',
  fragment: 'Сводка по выделенному', questions: 'Вопросы для интервью',
  translate: 'Перевод на русский', card: 'Карточка знаний', custom: 'Быстрая команда',
}

const FALLBACK_PROMPTS: PromptDef[] = [
  { id: 'card', label: 'Карточка знаний', mode: 'card' },
  { id: 'questions', label: 'Вопросы для интервью', mode: 'questions' },
  { id: 'translate', label: 'Перевести на русский', mode: 'translate' },
]

const VIEW_DEFS: Array<{ id: ViewId, label: string, icon: string }> = [
 { id: 'chat', label: 'Чат', icon: 'chat' },
 { id: 'sourcing', label: 'Сорсинг', icon: 'sourcing' },
 { id: 'screening', label: 'Скрининг', icon: 'screening' },
 { id: 'telegram', label: 'Telegram', icon: 'telegram' },
 { id: 'outreach', label: 'Аутрич', icon: 'outreach' },
 { id: 'pipeline', label: 'Пайплайн', icon: 'pipeline' },
 { id: 'library', label: 'Библиотека', icon: 'library' },
 { id: 'hub', label: 'Хаб', icon: 'hub' },
]

// ── Computed ───────────────────────────────────────────────────────
function safeHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' }
}

const isHhPage = computed(() => !!currentUrl.value && /(^|\.)hh\.ru$/.test(safeHost(currentUrl.value)))
const isListPage = computed(() =>
  !!currentUrl.value && /\/(search\/resume|employer\/applicants)/.test(currentUrl.value))

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
  if (isHhPage.value) return false
  return /^https?:\/\//.test(currentUrl.value)
})
const isPdfPage = computed(() => !!currentUrl.value && /\.pdf([?#]|$)/i.test(currentUrl.value))

const promptChips = computed<PromptDef[]>(() => {
  const list = prompts.value.length ? prompts.value : FALLBACK_PROMPTS
  return list.filter(p => p.mode !== 'summary')
})
const noteCandidateId = computed<string | null>(() =>
  lookupInfo.value?.candidate?.id ?? savedInfo.value?.candidateId ?? null)
const aiHtml = computed(() => mdToHtml(aiText.value))

const candInitials = computed(() => {
  const f = (dFirstName.value || existsInfo.value?.candidateName || '').trim()
  const l = dLastName.value.trim()
  if (f && l) return (f[0] + l[0])
  if (f) return f[0]
  return '?'
})
const candFullName = computed(() =>
  [dFirstName.value, dLastName.value].filter(Boolean).join(' ').trim()
  || existsInfo.value?.candidateName
  || savedInfo.value?.candidateName
  || 'Кандидат')
const dSkillsList = computed(() =>
  dSkills.value.split(',').map(s => s.trim()).filter(Boolean))

export function useSidekick() {
  return {
    HUNTFORK_BASE, phase, activeView, errorMsg, sessionUser, currentUrl, resumeId,
    existsInfo, jobs, selectedJobId, importing, importedOk,
    capturing, captureStep, saving, parsedFull, capMeta, capDupes, savedInfo,
    forceAvailable, blockedExact,
    dFirstName, dLastName, dTitle, dCity, dEmail, dPhone, dTelegram,
    dLinkedin, dGithub, dAbout, dSkills,
    aiMode, aiModeLabel, aiText, aiRunning, aiError, aiUsage, aiCached,
    aiJobId, copied, noteSaving, noteSaved,
    pageCtx, prompts, lookupInfo,
    chatMessages, chatInput, chatStreaming, chatListEl, copiedMsg,
    reasoningEnabled, CHAT_PRESETS,
    isHhPage, isListPage, currentSite, currentSiteLabel, canCapture, isPdfPage,
    promptChips, noteCandidateId, aiHtml, candInitials, candFullName, dSkillsList,
    VIEW_DEFS, MODE_LABELS, FALLBACK_PROMPTS,
    safeHost,
    // функции — см. useSidekickActions
  }
}

export function useSidekickActions() {
  return {
    extractResumeId, send, fmtDate, refresh, doImport, openHuntfork, syncActiveTab,
    startCapture, grabPage, parseAndDraft, saveDraft, cancelDraft,
    mdToHtml, sseFetch, loadJobsOnce, loadPrompts, runSummary, runPrompt,
    setReasoning, setJob, runPreset, loadConversationIntoChat, newConversation,
    rerunFit, abortAi, copyAi, copyChatMsg, saveAsNote, addToBase,
    pdfCtx, capturePdf, summarizePdf, openChat, sendChat, doLookup,
    selectView, init,
  }
}

// ── Вспомогательные ────────────────────────────────────────────────
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

// ── Выбор раздела рельса ──────────────────────────────────────────
function selectView(v: ViewId) {
  activeView.value = v
  // Маппинг раздела → фаза. Сами переходы и вызовы не меняются.
  if (v === 'chat') {
    if (!['chat', 'summary'].includes(phase.value)) {
      // открываем чат-режим, контекст подхватится
      phase.value = 'idle'
    }
  } else if (v === 'sourcing') {
    if (!['idle', 'capturing', 'draft', 'saved', 'new', 'exists', 'checking'].includes(phase.value)) {
      phase.value = 'idle'
    }
 } else if (v === 'screening') {
   // оценка соответствия запускается явно кнопкой; раздел показывает слот
   if (!['summary'].includes(phase.value)) phase.value = 'idle'
 }
  else if (v === 'telegram') {
    // Telegram-модуль — фазу не меняем, модуль самостоятельный
  }
 // outreach / pipeline / library — чисто визуальные слоты, phase не трогаем
}

// ── HH-флоу (без изменений) ───────────────────────────────────────
async function refresh() {
  errorMsg.value = ''
  importedOk.value = false
  existsInfo.value = null

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

  if (!resumeId.value) {
    phase.value = 'idle'
    return
  }

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

  const jobsResp = await send({ type: 'jobs' })
  jobs.value = jobsResp.ok ? (jobsResp.data?.jobs ?? []) : []
  phase.value = 'new'
}

async function doImport() {
  if (!resumeId.value) return
  importing.value = true
  errorMsg.value = ''
  const resp = await send({
    type: 'import', resumeId: resumeId.value, url: currentUrl.value, jobId: selectedJobId.value || undefined,
  })
  importing.value = false
  if (resp.ok) {
    importedOk.value = true
    await refresh()
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

// ── S1 Universal Capture (без изменений) ──────────────────────────
async function startCapture() {
  if (!canCapture.value || capturing.value) return
  errorMsg.value = ''
  blockedExact.value = []
  forceAvailable.value = false
  capturing.value = true
  try {
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

async function parseAndDraft(p: any) {
  phase.value = 'capturing'
  captureStep.value = 'parse'
  const parseResp = await send({
    type: 'captureParse',
    payload: {
      sourceUrl: p.canonical || p.url, site: p.site, title: p.title,
      text: p.text, selection: p.selectionUsed, contacts: p.contacts,
    },
  })
  if (!parseResp.ok) throw new Error(parseResp.message || 'Ошибка разбора страницы')

  const d = parseResp.data
  parsedFull.value = d.parsed
  capMeta.value = {
    provider: d.meta?.provider ?? null, model: d.meta?.model ?? null,
    site: p.site, sourceUrl: p.canonical || p.url, selectionUsed: !!p.selectionUsed,
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
    firstName: dFirstName.value.trim(), lastName: dLastName.value.trim(),
    title: dTitle.value.trim(), area: dCity.value.trim(), about: dAbout.value.trim(),
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
      parsed, contacts: {
        email: dEmail.value.trim() || null, phone: dPhone.value.trim() || null,
        telegram: dTelegram.value.trim() || null, linkedin: dLinkedin.value.trim() || null,
        github: dGithub.value.trim() || null,
      },
      sourceUrl: capMeta.value.sourceUrl, site: capMeta.value.site,
      provider: capMeta.value.provider, model: capMeta.value.model,
      jobId: selectedJobId.value || undefined, force,
    },
  })
  saving.value = false

  if (resp.ok) {
    savedInfo.value = {
      candidateId: resp.data.candidateId, candidateName: resp.data.candidateName,
      applicationCreated: resp.data.applicationCreated,
    }
    phase.value = 'saved'
    return
  }
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

// ── Markdown + SSE (без изменений) ────────────────────────────────
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

async function sseFetch(path: string, body: any, onDelta: (s: string) => void): Promise<any> {
  const resp = await fetch(`${HUNTFORK_BASE}${path}`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: aiAbort?.signal,
  })
  if (resp.status === 401) throw new Error('Требуется вход на huntfork.ru')
  const ctype = resp.headers.get('content-type') || ''
  if (!resp.ok || !ctype.includes('text/event-stream')) {
    let msg = `Ошибка ${resp.status}`
    try { const j = await resp.json(); msg = j.statusMessage || j.message || msg } catch {}
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
  if (jobsResp.ok) { jobs.value = jobsResp.data?.jobs ?? []; jobsLoaded = true }
}

async function loadPrompts() {
  const resp = await send({ type: 'prompts' })
  if (resp.ok && resp.data?.prompts?.length) prompts.value = resp.data.prompts
}

async function runSummary(mode: string, opts: { instruction?: string, label?: string, ctx?: any } = {}) {
  if (aiRunning.value || capturing.value) return
  errorMsg.value = ''
  aiError.value = ''
  aiMode.value = mode
  aiModeLabel.value = opts.label ?? MODE_LABELS[mode] ?? 'Сводка'
  lastCustom = opts.instruction ?? null
  phase.value = 'summary'
  activeView.value = mode === 'fit' ? 'screening' : 'chat'
  aiText.value = ''
  aiUsage.value = null
  aiCached.value = false
  noteSaved.value = false
  copied.value = false

  try {
    let ctx = opts.ctx ?? pageCtx.value
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
      if (!aiJobId.value) return
    }

    aiRunning.value = true
    aiAbort = new AbortController()
    const final = await sseFetch('/api/extension/summarize', {
      sourceUrl: ctx.canonical || ctx.url, site: ctx.site, title: ctx.title,
      text, mode, jobId: mode === 'fit' ? aiJobId.value : undefined, instruction: opts.instruction,
      reasoning: reasoningEnabled.value,
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
    toast('Скопировано', 'success')
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch { toast('Не удалось скопировать', 'error') }
}

async function copyChatMsg(i: number) {
  try {
    const m = chatMessages.value[i]
    if (!m?.content) return
    await navigator.clipboard.writeText(m.content)
    copiedMsg.value = i
    toast('Скопировано', 'success')
    setTimeout(() => { copiedMsg.value = -1 }, 2000)
  }
  catch { toast('Не удалось скопировать', 'error') }
}

async function saveAsNote() {
  const cid = noteCandidateId.value
  if (!cid || !aiText.value.trim() || noteSaving.value) return
  noteSaving.value = true
  aiError.value = ''
  const header = `${aiModeLabel.value} · ${pageCtx.value?.canonical || pageCtx.value?.url || ''}\n\n`
  const resp = await send({ type: 'note', candidateId: cid, body: header + aiText.value })
  noteSaving.value = false
  if (resp.ok) { noteSaved.value = true; toast('Заметка сохранена', 'success') }
  else { aiError.value = resp.message || 'Не удалось сохранить заметку'; toast('Не удалось сохранить', 'error') }
}

async function addToBase() {
  if (!pageCtx.value || capturing.value) return
  capturing.value = true
  errorMsg.value = ''
  try {
    await parseAndDraft(pageCtx.value)
    activeView.value = 'sourcing'
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

// ── S7: PDF (без изменений) ───────────────────────────────────────
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
    url: u, canonical: u, title: resp.data?.meta?.filename || 'PDF-документ',
    site: 'pdf', text: resp.data?.text ?? '', pageText: resp.data?.text ?? '',
    selectionText: '', selectionUsed: false, contacts: {},
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
    activeView.value = 'sourcing'
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

// ── S5: чат (без изменений) ───────────────────────────────────────
async function openChat() {
  errorMsg.value = ''
  phase.value = 'chat'
  activeView.value = 'chat'
  const { load: loadConversations, createConversation, getActive } = useConversations()
  await loadConversations()
  if (!getActive()) {
    createConversation({
      jobId: selectedJobId.value || undefined,
      sourceUrl: currentUrl.value || undefined,
      site: currentSiteLabel.value,
    })
  }
  if (!isPdfPage.value && (!pageCtx.value || pageCtx.value.url !== currentUrl.value)) {
    try { await grabPage() }
    catch { /* чат без контекста страницы */ }
  }
}

async function sendChat() {
  const q = chatInput.value.trim()
  if (!q || chatStreaming.value) return
  // Переход в фазу чата, если отправили из idle/summary
  if (phase.value !== 'chat') {
    phase.value = 'chat'
    activeView.value = 'chat'
  }
  // Создаём переписку, если нет активной
  const { getActive, createConversation, saveActive } = useConversations()
  if (!getActive()) {
    createConversation({
      jobId: selectedJobId.value || undefined,
      sourceUrl: currentUrl.value || undefined,
      site: currentSiteLabel.value,
    })
  }
  chatMessages.value.push({ role: 'user', content: q })
  chatInput.value = ''
  saveActive(chatMessages.value as ChatMessage[])
  const history = chatMessages.value.slice(-20).map(m => ({ role: m.role, content: m.content }))
  chatMessages.value.push({ role: 'assistant', content: '' })
  chatStreaming.value = true
  aiAbort = new AbortController()
  try {
    const ctx = pageCtx.value && pageCtx.value.url === currentUrl.value ? pageCtx.value : null
    await sseFetch('/api/extension/chat', {
      messages: history,
      pageText: ctx?.text ? String(ctx.text).slice(0, 15_000) : undefined,
      sourceUrl: ctx?.canonical || ctx?.url || undefined,
      title: ctx?.title, jobId: aiJobId.value || undefined,
      reasoning: reasoningEnabled.value,
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
    saveActive(chatMessages.value as ChatMessage[])
  }
}

// ── S6: lookup (без изменений) ────────────────────────────────────
async function doLookup(url: string | null) {
  lookupInfo.value = null
  if (!url || !/linkedin\.com\/in\/|github\.com\/[^/?#]+\/?([?#]|$)|t\.me\//i.test(url)) return
  const seq = ++lookupSeq
  const resp = await send({ type: 'lookup', url })
  if (seq !== lookupSeq) return
  if (resp.ok && resp.data?.exists) lookupInfo.value = resp.data
}

// ── Слушатель сообщений (без изменений) ───────────────────────────
function onMessage(msg: any) {
  if (msg?.type === 'tabUrlChanged') {
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
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────
async function init() {
  chrome.runtime.onMessage.addListener(onMessage)
  // Загружаем сохранённые пресет reason и вакансию
  try {
    const stored = await chrome.storage.local.get([REASONING_KEY, 'hf:selectedJob'])
    reasoningEnabled.value = stored[REASONING_KEY] === true
    if (stored['hf:selectedJob']) selectedJobId.value = stored['hf:selectedJob']
  } catch {}
  // Загружаем переписки
  const { load: loadConversations } = useConversations()
  await loadConversations()
  await syncActiveTab()
  await refresh()
  doLookup(currentUrl.value)
  loadPrompts()
}

// ── Reasoning toggle ──────────────────────────────────────────────
function setReasoning(on: boolean) {
  reasoningEnabled.value = on
  try { chrome.storage.local.set({ [REASONING_KEY]: on }) } catch {}
}

// ── Селектор вакансии ─────────────────────────────────────────────
async function setJob(jobId: string) {
  selectedJobId.value = jobId
  aiJobId.value = jobId
  try { chrome.storage.local.set({ 'hf:selectedJob': jobId }) } catch {}
}

// ── Пресет чата ───────────────────────────────────────────────────
function runPreset(preset: ChatPreset) {
  chatInput.value = preset.prompt
  sendChat()
}

// ── Загрузить переписку ───────────────────────────────────────────
function loadConversationIntoChat(id: string) {
  const { loadConversation } = useConversations()
  const messages = loadConversation(id)
  chatMessages.value = messages.map(m => ({ ...m }))
  phase.value = 'chat'
  activeView.value = 'chat'
}

// ── Новая переписка ───────────────────────────────────────────────
function newConversation() {
  const { createConversation } = useConversations()
  chatMessages.value = []
  createConversation({
    jobId: selectedJobId.value || undefined,
    sourceUrl: currentUrl.value || undefined,
    site: currentSiteLabel.value,
  })
  phase.value = 'idle'
  activeView.value = 'chat'
}

export type { Phase, ViewId, PromptDef }
