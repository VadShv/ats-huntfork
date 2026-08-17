import { ref, computed, reactive } from 'vue'

/* ────────────────────────────────────────────────────────────────
   useVerification — модуль верификации и «Волкодав» (Stage 6).
   UI-слой: типы + реальный движок таймлайна + весовая модель топ-3/wolf
   + мок-находки (противоречия/ИИ/вопросы/GitHub) + состояния + этика.
   Бэкенд подключается позже через тот же интерфейс.
   Все цвета — через --hf-* токены, в компонентах по tone.
   ──────────────────────────────────────────────────────────────── */

// ── Общие типы ──────────────────────────────────────────────────
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type InfoLevel = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Confidence =
  | 'document'      // факт из документа × 1.0
  | 'date_math'     // арифметика по датам × 0.95
  | 'cross_source'  // расхождение источников × 0.9
  | 'linguistic'    // лингвистика × 0.5
  | 'ai_detection'  // детекция ИИ × 0.35

export type VfState =
  | 'idle'        // не запускалась — кнопка «Проверить»
  | 'running'     // идёт проверка — прогресс по блокам
  | 'clean'       // существенных расхождений не найдено
  | 'findings'    // есть находки — полный отчёт
  | 'insufficient'// профиль слишком беден
  | 'partial'     // частичный сбой — рабочие блоки показаны

export type WolfState = 'off' | 'running' | 'done'

// ── Таймлайн (реальный расчёт по датам) ──────────────────────────
export interface JobPeriod {
  company: string
  title: string
  startRaw: string
  endRaw: string | null      // null = «по настоящее время»
  start: number              // ms
  end: number                // ms (текущее время если null)
  isFulltime: boolean
  durationMonths: number
}

export type TimelineKind = 'intersection' | 'gap' | 'inflation' | 'short_series' | 'reverse' | 'open_many'
export type TimelineLevel = 'high' | 'mid' | 'low' | 'info'

export interface TimelineFinding {
  id: string
  kind: TimelineKind
  level: TimelineLevel
  companyA?: string
  companyB?: string
  months: number              // длительность пересечения/пробела
  detail: string              // «пересекаются на 3 мес»
  alternativeExplanation: string
}

export interface TimelineReport {
  periods: JobPeriod[]
  findings: TimelineFinding[]
  inflationMonths: number     // сумма пересечений
  calendarSpanMonths: number  // охват от первой до последней
  claimedExperienceYears?: number | null
  actualExperienceMonths: number
  experienceInflated: boolean
}

// ── Противоречия (8 классов) ────────────────────────────────────
export type ContradictionClass =
  | 'title_vs_duties'      // должность против обязанностей
  | 'grade_vs_exp'         // грейд против стажа
  | 'stack_vs_tasks'       // стек против задач
  | 'scale_vs_role'        // масштаб против роли
  | 'geo_vs_format'        // география против формата
  | 'education_vs_dates'   // образование против дат
  | 'internal'             // внутренние расхождения
  | 'cross_source'         // между источниками

export interface Contradiction {
  id: string
  cls: ContradictionClass
  title: string
  fragmentA: string         // цитата
  fragmentB: string         // цитата
  level: TimelineLevel
  suggestedQuestion: string
  alternativeExplanation: string
}

// ── Детекция ИИ ─────────────────────────────────────────────────
export interface AiDetectionResult {
  score: number             // 0-100
  band: 'low' | 'uncertain' | 'flagged'  // <30 / 30-70 / ≥75
  methods: { name: string; triggered: boolean }[]
  flaggedSection?: string
  dualPhrase: string        // «характерно для ИИ-генерации ИЛИ ...»
  disclaimer: string
}

// ── Верифицируемость ────────────────────────────────────────────
export interface VerifiabilitySource {
  kind: 'linkedin' | 'hh' | 'habr' | 'github' | 'gitlab' | 'public' | 'contacts' | 'consistency'
  label: string
  present: boolean
  note: string
}

export interface VerifiabilityIndex {
  value: number             // 0-100
  tier: 'high' | 'mid' | 'low' | 'minimal'
  sources: VerifiabilitySource[]
  note: string              // «низкий индекс — не ред-флаг»
}

// ── Ред-флаги и вопросы ─────────────────────────────────────────
export interface RedFlag {
  id: string
  title: string
  summary: string
  evidence: string          // с цитатами
  level: TimelineLevel
  alternativeExplanation: string
  questionIds: string[]
}

export type QuestionMethod = 'STAR' | 'CARE' | 'PARLA'

export interface InterviewQuestion {
  id: string
  method: QuestionMethod
  text: string              // персонализированный
  listenFor: string         // «что слушать»
  isProbe: boolean          // вопрос-зонд
}

// ── GitHub ──────────────────────────────────────────────────────
export interface GithubBasic {
  username: string | null
  accountAgeYears: number
  publicRepos: number
  topLanguages: { lang: string; pct: number }[]
  followers: number
  activityByYear: { year: number; commits: number }[]
}

export interface GithubDeep {
  stackMatch: { claimed: string; present: boolean }[]
  graphAnomaly: string | null
  contributionQuality: number   // 0-100
  commitMeaningfulness: number  // 0-100
  timezoneMatch: boolean
  dateCorrelation: string
  copyDetection: string | null
}

export interface GithubReport {
  present: boolean
  basic: GithubBasic | null
  deep: GithubDeep | null
  disclaimer: string
}

// ── Волкодав ────────────────────────────────────────────────────
export interface WolfFinding {
  id: string
  title: string
  severity: Severity
  confidence: Confidence
}

export interface WolfBreakdownItem {
  id: string
  title: string
  severity: Severity
  confidence: Confidence
  confidenceLabel: string
  impact: number
}

export interface WolfReport {
  findings: WolfFinding[]
  score: number               // 1-5
  levelName: string
  levelHint: string
  breakdown: WolfBreakdownItem[]
  isCapped: boolean
  triggers: string[]
  deepSections: { label: string; detail: string }[]
}

// ── Веса и множители (§3.3 ТЗ) ──────────────────────────────────
const WEIGHT: Record<Severity, number> = {
  critical: 5.0, high: 3.0, medium: 1.5, low: 0.5,
}
const CONFIDENCE_MULT: Record<Confidence, number> = {
  document: 1.0,
  date_math: 0.95,
  cross_source: 0.9,
  linguistic: 0.5,
  ai_detection: 0.35,
}
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  document: 'факт из документа',
  date_math: 'арифметика по датам',
  cross_source: 'расхождение источников',
  linguistic: 'лингвистика',
  ai_detection: 'детекция ИИ',
}
const HARD: Confidence[] = ['document', 'date_math', 'cross_source']
const NORM = 4.0

const WOLF_LEVELS = [
  { n: 1, name: 'Одинокий волк', hint: 'Профиль чистый, единичные мелочи' },
  { n: 2, name: 'Волк насторожился', hint: 'Есть что уточнить, ничего серьёзного' },
  { n: 3, name: 'Стая почуяла', hint: 'Несколько существенных несостыковок' },
  { n: 4, name: 'Волки идут по следу', hint: 'Системные противоречия' },
  { n: 5, name: 'Волкодав спущен', hint: 'Критические расхождения' },
] as const

/** Сортировка уровня для веса. */
const LEVEL_RANK: Record<TimelineLevel, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

function levelToSeverity(l: TimelineLevel): Severity {
  if (l === 'critical') return 'critical'
  if (l === 'high') return 'high'
  if (l === 'medium') return 'medium'
  return 'low'
}

/* ────────────────────────────────────────────────────────────────
   Реальный движок таймлайна
   ──────────────────────────────────────────────────────────────── */

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4375

const RU_MONTHS: Record<string, number> = {
  янв: 0, фев: 1, мар: 2, апр: 3, май: 4, июн: 5,
  июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
}

/** Устойчивый парсер дат: YYYY-MM, Mon YYYY, YYYY, настоящее. */
export function parseDate(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const s = String(raw).trim().toLowerCase()
  if (s === '' || s === 'настоящее' || s === 'по настоящее время' || s === 'now' || s === 'текущее') {
    return Date.now()
  }
  // YYYY-MM  /  YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (m) return new Date(+m[1], +m[2] - 1).getTime()
  // Mon YYYY  /  Month YYYY
  m = s.match(/^([a-zа-я]+)\.?\s+(\d{4})$/i)
  if (m) {
    const mon = RU_MONTHS[m[1].toLowerCase()] ?? EN_MONTH(m[1])
    if (mon != null) return new Date(+m[2], mon).getTime()
  }
  // YYYY
  m = s.match(/^(\d{4})$/)
  if (m) return new Date(+m[1], 0).getTime()
  return null
}

function EN_MONTH(s: string): number | null {
  const M: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  return M[s.toLowerCase().slice(0, 3)] ?? null
}

function monthsBetween(a: number, b: number): number {
  return Math.abs(b - a) / MONTH_MS
}

/** Нормализует массив опыта в JobPeriod[]. */
export function analyzeTimeline(experience: any[]): TimelineReport {
  if (!experience || !experience.length) {
    return { periods: [], findings: [], inflationMonths: 0, calendarSpanMonths: 0, actualExperienceMonths: 0, experienceInflated: false }
  }
  const periods: JobPeriod[] = experience.map((e, i) => {
    const start = parseDate(e.start ?? e.startDate ?? e.from) ?? 0
    const endRaw = e.end ?? e.endDate ?? e.to ?? null
    const end = parseDate(endRaw)
    const isFulltime = (e.type ?? e.employment ?? 'fulltime') !== 'parttime' && (e.type ?? e.employment ?? 'fulltime') !== 'freelance'
    const dur = end ? monthsBetween(start, end) : monthsBetween(start, Date.now())
    return {
      company: e.company ?? `Компания ${i + 1}`,
      title: e.title ?? e.position ?? '',
      startRaw: e.start ?? e.startDate ?? e.from ?? '',
      endRaw: endRaw ?? 'настоящее',
      start, end: end ?? Date.now(),
      isFulltime,
      durationMonths: Math.round(dur),
    }
  }).filter(p => p.start)

  const findings: TimelineFinding[] = []

  // Пересечения — попарно
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i], b = periods[j]
      const ovStart = Math.max(a.start, b.start)
      const ovEnd = Math.min(a.end, b.end)
      const ov = ovEnd - ovStart
      if (ov > 0) {
        const months = Math.round(ov / MONTH_MS)
        if (months >= 2) {
          let level: TimelineLevel = months >= 9 ? 'high' : months >= 4 ? 'mid' : 'low'
          // фултайм × фултайм — на уровень выше
          if (a.isFulltime && b.isFulltime) {
            level = level === 'low' ? 'mid' : level === 'mid' ? 'high' : 'high'
          }
          findings.push({
            id: `ov-${i}-${j}`,
            kind: 'intersection', level,
            companyA: a.company, companyB: b.company,
            months,
            detail: `«${a.company}» и «${b.company}» пересекаются на ${months} мес`,
            alternativeExplanation: months <= 4
              ? 'Передача дел, отработка, параллельный проект'
              : months <= 9
                ? 'Совместительство, подработка, переходный период'
                : 'Возможно декретное совмещение или договорённость; уточнить',
          })
        }
      }
    }
  }

  // Пробелы — между окончанием одной и началом следующей (по хронологии)
  const sorted = [...periods].sort((x, y) => x.start - y.start)
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end
    if (gap > 0) {
      const months = Math.round(gap / MONTH_MS)
      if (months > 2) {
        const level: TimelineLevel = months >= 14 ? 'high' : months >= 8 ? 'mid' : months >= 4 ? 'low' : 'info'
        findings.push({
          id: `gap-${i}`,
          kind: 'gap', level,
          companyA: sorted[i].company, companyB: sorted[i + 1].company,
          months,
          detail: `Пробел ${months} мес между «${sorted[i].company}» и «${sorted[i + 1].company}»`,
          alternativeExplanation: 'Декрет, уход за родственником, обучение, релокация, служба, восстановление после болезни',
        })
      }
    }
  }

  // Инфляция стажа
  const sumDur = periods.reduce((s, p) => s + p.durationMonths, 0)
  const spanStart = Math.min(...periods.map(p => p.start))
  const spanEnd = Math.max(...periods.map(p => p.end))
  const calendarSpan = monthsBetween(spanStart, spanEnd)
  const inflation = Math.max(0, Math.round(sumDur - calendarSpan))
  if (inflation > 0) {
    findings.push({
      id: 'inflation',
      kind: 'inflation', level: inflation >= 9 ? 'mid' : 'low',
      months: inflation,
      detail: `Инфляция стажа: сумма периодов на ${inflation} мес больше календарного охвата`,
      alternativeExplanation: 'Пересечения могут быть совместительством, а не завышением',
    })
  }

  // Серия коротких позиций (< 8 мес подряд)
  const shortSeries = periods.filter(p => p.durationMonths > 0 && p.durationMonths < 8)
  if (shortSeries.length >= 3) {
    findings.push({
      id: 'short_series',
      kind: 'short_series', level: 'low',
      months: shortSeries.length,
      detail: `${shortSeries.length} позиций короче 8 мес подряд`,
      alternativeExplanation: 'Стартапы, проектная работа, испытательный срок',
    })
  }

  // Открытые периоды (≥2 «по настоящее время»)
  const openCount = periods.filter(p => p.endRaw === null || /настоящ|now|текущ/i.test(String(p.endRaw))).length
  if (openCount >= 2) {
    findings.push({
      id: 'open_many',
      kind: 'open_many', level: 'mid',
      months: openCount,
      detail: `${openCount} позиций с отметкой «по настоящее время» одновременно`,
      alternativeExplanation: 'Совместительство или забытая дата окончания',
    })
  }

  // Обратная хронология
  for (const p of periods) {
    if (p.start > p.end) {
      findings.push({
        id: `reverse-${p.company}`,
        kind: 'reverse', level: 'high',
        months: Math.round(monthsBetween(p.start, p.end)),
        detail: `В «${p.company}» дата начала позже даты окончания`,
        alternativeExplanation: 'Опечатка в резюме',
      })
    }
  }

  return {
    periods,
    findings,
    inflationMonths: inflation,
    calendarSpanMonths: Math.round(calendarSpan),
    actualExperienceMonths: sumDur,
    experienceInflated: inflation > 0,
  }
}

/* ────────────────────────────────────────────────────────────────
   Весовая модель топ-3 и wolf score (реальная арифметика)
   ──────────────────────────────────────────────────────────────── */

function redFlagWeight(level: TimelineLevel, relevance = 1): number {
  const sev = levelToSeverity(level)
  return WEIGHT[sev] * relevance
}

/** Выбирает ровно 3 топ-ред-флага; остальные — в extra. */
function pickTop3(flags: RedFlag[]): { top: RedFlag[]; extra: RedFlag[] } {
  const sorted = [...flags].sort((a, b) => redFlagWeight(b.level) - redFlagWeight(a.level))
  return { top: sorted.slice(0, 3), extra: sorted.slice(3) }
}

/** wolf_score с ограничением: лингвистика/ИИ не поднимают выше 3 без hard evidence. */
export function computeWolf(findings: WolfFinding[]): {
  score: number
  levelName: string
  levelHint: string
  breakdown: WolfBreakdownItem[]
  isCapped: boolean
} {
  const raw = findings.reduce((s, f) => s + WEIGHT[f.severity] * CONFIDENCE_MULT[f.confidence], 0)
  const hasHard = findings.some(f => HARD.includes(f.confidence))
  const uncapped = Math.max(1, Math.min(5, Math.round(raw / NORM) + 1))
  const isCapped = !hasHard && uncapped > 3
  const score = isCapped ? 3 : uncapped
  const level = WOLF_LEVELS[score - 1]
  const breakdown: WolfBreakdownItem[] = findings
    .map(f => ({
      ...f,
      impact: WEIGHT[f.severity] * CONFIDENCE_MULT[f.confidence],
      confidenceLabel: CONFIDENCE_LABEL[f.confidence],
    }))
    .sort((a, b) => b.impact - a.impact)
  return { score, levelName: level.name, levelHint: level.hint, breakdown, isCapped }
}

/* ────────────────────────────────────────────────────────────────
   Мок-данные: реалистичный кандидат
   ──────────────────────────────────────────────────────────────── */

const MOCK_EXPERIENCE = [
  { company: 'Yandex', title: 'Senior Frontend Developer', start: '2022-03', end: null, type: 'fulltime' },
  { company: 'Avito', title: 'Middle Frontend Developer', start: '2021-09', end: '2022-06', type: 'fulltime' },
  { company: 'Тинькофф', title: 'Frontend Developer', start: '2019-06', end: '2021-05', type: 'fulltime' },
  { company: 'Студия «Код»', title: 'Junior Frontend', start: '2018-02', end: '2019-04', type: 'fulltime' },
  { company: 'Фриланс', title: 'Веб-разработчик', start: '2017-01', end: '2018-03', type: 'freelance' },
]

const MOCK_TIMELINE: TimelineReport = analyzeTimeline(MOCK_EXPERIENCE)

const MOCK_CONTRADICTIONS: Contradiction[] = [
  {
    id: 'c1', cls: 'grade_vs_exp',
    title: 'Грейд Senior при 6 годах опыта',
    fragmentA: '«Senior Frontend Developer», Yandex, с 2022',
    fragmentB: 'Стаж по датам: 2017→2023 = 6 лет',
    level: 'mid',
    suggestedQuestion: 'Как вы вышли на Senior за шесть лет — через какие проекты?',
    alternativeExplanation: 'Сильный бэкграунд в смежной области или быстрый рост в продуктовой команде',
  },
  {
    id: 'c2', cls: 'stack_vs_tasks',
    title: 'Kubernetes в навыках, но нет в описании задач',
    fragmentA: 'Навыки: «Kubernetes, Docker, CI/CD»',
    fragmentB: 'В описании опыта: «вёрстка, React-компоненты, Storybook»',
    level: 'low',
    suggestedQuestion: 'Расскажите, где вы применяли Kubernetes в последнем проекте',
    alternativeExplanation: 'Инфраструктуру вёл другой человек, навык теоретический',
  },
  {
    id: 'c3', cls: 'title_vs_duties',
    title: 'Team Lead без упоминания команды',
    fragmentA: 'Должность: «Team Lead Frontend»',
    fragmentB: 'Обязанности: только индивидуальные задачи, «мы» вместо «я»',
    level: 'mid',
    suggestedQuestion: 'Сколько человек было в вашей команде и что вы делали как лид?',
    alternativeExplanation: 'Формальный титул без людей в подчинении',
  },
  {
    id: 'c4', cls: 'internal',
    title: 'Компания названа по-разному',
    fragmentA: 'Шапка: «Тинькофф»',
    fragmentB: 'Блок опыта: «Тинькофф Банк» / «Tinkoff»',
    level: 'info',
    suggestedQuestion: 'Уточните официальное название для договора',
    alternativeExplanation: 'Простое несовпадение написания бренда',
  },
]

const MOCK_AI: AiDetectionResult = {
  score: 72,
  band: 'uncertain',
  methods: [
    { name: 'Перплексия ниже нормы', triggered: true },
    { name: 'Однородность буллетов', triggered: true },
    { name: 'Плотность клише', triggered: false },
    { name: 'Круглые метрики', triggered: false },
    { name: 'Совпадение с вакансией >60%', triggered: false },
  ],
  flaggedSection: 'Раздел «О себе»',
  dualPhrase: 'Текст стилистически однороден, характерно для ИИ-генерации или для профессионально составленного резюме',
  disclaimer: 'Точность детекторов 67–82%, ложные срабатывания на резюме 12–30%. Высокий скор не влияет на ранжирование и не основание для отказа. Надёжная проверка — живой разговор с уточняющими вопросами.',
}

const MOCK_VERIFIABILITY: VerifiabilityIndex = {
  value: 68,
  tier: 'mid',
  sources: [
    { kind: 'linkedin', label: 'LinkedIn', present: true, note: 'Профиль заполнен, фото есть' },
    { kind: 'hh', label: 'hh.ru', present: true, note: 'Резюме обновлено 2 нед назад' },
    { kind: 'habr', label: 'Хабр Карьера', present: false, note: 'Не найден' },
    { kind: 'github', label: 'GitHub', present: true, note: 'Есть, активность средняя' },
    { kind: 'gitlab', label: 'GitLab', present: false, note: 'Не найден' },
    { kind: 'public', label: 'Публичность', present: true, note: 'Доклад на FrontendConf 2022' },
    { kind: 'contacts', label: 'Контакты', present: true, note: 'Рабочая почта, Telegram' },
    { kind: 'consistency', label: 'Согласованность', present: true, note: 'Имя и фото совпадают' },
  ],
  note: 'Низкий индекс — не ред-флаг. Многие сильные инженеры не ведут публичных профилей. Индекс говорит лишь о том, сколько усилий потребуется на проверку.',
}

const MOCK_REDFLAGS: RedFlag[] = [
  {
    id: 'rf1',
    title: 'Пересечение двух фултайм-позиций на 4 мес',
    summary: 'Yandex и Avito пересекаются с марта по июнь 2022 — обе фултайм.',
    evidence: 'Yandex: 2022-03…настоящее; Avito: 2021-09…2022-06',
    level: 'mid',
    alternativeExplanation: 'Передача дел, параллельный проект на испытательном сроке',
    questionIds: ['q1', 'q2'],
  },
  {
    id: 'rf2',
    title: 'Грейд Senior при 6 годах опыта',
    summary: 'Заявлен Senior Frontend, по датам выходит 6 лет стажа.',
    evidence: '«Senior Frontend Developer», Yandex, с 2022; стаж 2017→2023',
    level: 'mid',
    alternativeExplanation: 'Быстрый рост в продуктовой команде или сильный бэкграунд',
    questionIds: ['q3', 'q4'],
  },
  {
    id: 'rf3',
    title: 'Team Lead без людей в обязанностях',
    summary: 'Должность Team Lead, но в описании только индивидуальные задачи.',
    evidence: '«Team Lead Frontend»; обязанности: «вёрстка, компоненты, Storybook»',
    level: 'mid',
    alternativeExplanation: 'Формальный титул, лидерство по экспертизе, а не по людям',
    questionIds: ['q5', 'q6'],
  },
  {
    id: 'rf4',
    title: 'Kubernetes в навыках без упоминания в задачах',
    summary: 'Стек включает Kubernetes, но в опыте только фронтенд-задачи.',
    evidence: 'Навыки: Kubernetes; опыт: React, Storybook',
    level: 'low',
    alternativeExplanation: 'Теоретическое знание или инфраструктуру вёл другой человек',
    questionIds: ['q7'],
  },
]

const MOCK_QUESTIONS: InterviewQuestion[] = [
  {
    id: 'q1', method: 'STAR',
    text: 'Расскажите про период с марта по июнь 2022 — как вы совмещали работу в Yandex и Avito?',
    listenFor: 'Конкретика задач в каждой компании, кто знал о совмещении, как распределялось время. Признаки уклонения: «ну просто совпадение», уход от дат.',
    isProbe: false,
  },
  {
    id: 'q2', method: 'STAR',
    text: 'Какой проект вы вели в Avito в момент перехода в Yandex?',
    listenFor: 'Названия продуктов, команда, технические детали, которые невозможно знать без реального участия.',
    isProbe: true,
  },
  {
    id: 'q3', method: 'CARE',
    text: 'Как вы вышли на грейд Senior в Yandex за шесть лет опыта — какую роль сыграли лично вы?',
    listenFor: 'Личный вклад против командного, конкретные решения, за которые повысили. Маркер «мы сделали» вместо «я сделал».',
    isProbe: false,
  },
  {
    id: 'q4', method: 'PARLA',
    text: 'Какой главный вывод о фронтенд-архитектуре вы вынесли из работы в Yandex и где применили его потом?',
    listenFor: 'Блоки Learned и Applied — их невозможно подготовить из выдуманного опыта. Конкретика переноса решений.',
    isProbe: false,
  },
  {
    id: 'q5', method: 'CARE',
    text: 'Сколько человек было в вашей команде как Team Lead и что вы делали как лид?',
    listenFor: 'Число людей, 1:1, найм, фидбек, конфликты. Уклонение: «ну я типа лид», отсутствие управленческих глаголов.',
    isProbe: false,
  },
  {
    id: 'q6', method: 'STAR',
    text: 'Опишите ситуацию, где вы как Team Lead приняли архитектурное решение в Yandex.',
    listenFor: 'Ситуация, альтернативы, почему выбрали это, результат с метриками. Признаки заученности.',
    isProbe: false,
  },
  {
    id: 'q7', method: 'STAR',
    text: 'Расскажите про случай, где вы применяли Kubernetes в последнем проекте.',
    listenFor: 'Конкретный кластер, манифесты, инциденты. Невозможно описать без реального опыта.',
    isProbe: true,
  },
]

const MOCK_GITHUB: GithubReport = {
  present: true,
  basic: {
    username: 'ivan-dev',
    accountAgeYears: 6,
    publicRepos: 14,
    topLanguages: [
      { lang: 'TypeScript', pct: 58 },
      { lang: 'JavaScript', pct: 22 },
      { lang: 'Go', pct: 12 },
      { lang: 'CSS', pct: 8 },
    ],
    followers: 31,
    activityByYear: [
      { year: 2021, commits: 410 },
      { year: 2022, commits: 680 },
      { year: 2023, commits: 520 },
    ],
  },
  deep: {
    stackMatch: [
      { claimed: 'React', present: true },
      { claimed: 'TypeScript', present: true },
      { claimed: 'Kubernetes', present: false },
    ],
    graphAnomaly: 'Равномерная активность без выходных — возможна накрутка',
    contributionQuality: 64,
    commitMeaningfulness: 71,
    timezoneMatch: true,
    dateCorrelation: 'Пики активности совпадают с заявленными периодами работы',
    copyDetection: null,
  },
  disclaimer: 'Отсутствие GitHub или слабая активность — не негативный сигнал. Большинство коммерческих разработчиков пишут в закрытых репозиториях.',
}

const MOCK_WOLF_FINDINGS: WolfFinding[] = [
  { id: 'w1', title: 'Пересечение фултайм-позиций Yandex/Avito', severity: 'medium', confidence: 'date_math' },
  { id: 'w2', title: 'Грейд Senior при 6 годах опыта', severity: 'medium', confidence: 'cross_source' },
  { id: 'w3', title: 'Team Lead без управленческих обязанностей', severity: 'medium', confidence: 'linguistic' },
  { id: 'w4', title: 'Однородный стиль раздела «О себе»', severity: 'low', confidence: 'ai_detection' },
]

const MOCK_WOLF_DEEP = [
  { label: 'Глубокий разбор таймлайна', detail: 'Реконструкция хронологии по всем источникам. Yandex и Avito пересекаются — сверка с публичными данными компаний подтверждает.' },
  { label: 'Кросс-верификация источников', detail: 'Матрица «утверждение × источник»: даты в резюме совпадают с LinkedIn, но должность в hh.ru указана как «Middle», а не «Senior».' },
  { label: 'Стиль между разделами', detail: 'Резкая смена стиля между блоком «О себе» и описанием опыта — признак компиляции.' },
  { label: 'Правдоподобность достижений', detail: '«Увеличил конверсию на 40%» — метрика круглая, проверить арифметически невозможно без данных компании.' },
  { label: 'Карьерная траектория', detail: 'Переход Junior→Middle→Senior за 6 лет без промежуточного шага — требует уточнения.' },
  { label: 'Поведенческие сигналы', detail: 'Данных по pipeline пока нет — включается после первого касания.' },
]

const MOCK_RISK_FACTORS = {
  hypeRole: true,
  hypeStack: true,
  grade: 'middle',
  aboveMarketSalary: false,
  fullRemote: true,
  immediateStart: true,
  multipleOffers: false,
}

/* ────────────────────────────────────────────────────────────────
   Состояние (синглтон)
   ──────────────────────────────────────────────────────────────── */

const state = ref<VfState>('idle')
const wolfState = ref<WolfState>('off')
const activeSection = ref<string | null>('redflags')
const progressBlocks = reactive<Record<string, boolean>>({})
const lastRunAt = ref<number | null>(null)
const scenario = ref<'demo' | 'clean' | 'risk' | 'insufficient'>('demo')

// Данные отчёта
const timeline = ref<TimelineReport>(MOCK_TIMELINE)
const contradictions = ref<Contradiction[]>(MOCK_CONTRADICTIONS)
const aiDetection = ref<AiDetectionResult>(MOCK_AI)
const verifiability = ref<VerifiabilityIndex>(MOCK_VERIFIABILITY)
const allRedFlags = ref<RedFlag[]>(MOCK_REDFLAGS)
const questions = ref<InterviewQuestion[]>(MOCK_QUESTIONS)
const github = ref<GithubReport>(MOCK_GITHUB)
const wolfFindings = ref<WolfFinding[]>(MOCK_WOLF_FINDINGS)
const wolfDeep = ref<{ label: string; detail: string }[]>([])
const wolfTriggers = ref<string[]>([])

// Сценарий интервью (выбранные вопросы)
const scenarioQuestionIds = ref<string[]>([])

// Аудит-лог (§6.4)
const auditLog = ref<{ ts: number; url: string; action: string; note?: string }[]>([])

const top3 = computed(() => pickTop3(allRedFlags.value))
const mediumPlusCount = computed(() => allRedFlags.value.filter(f => LEVEL_RANK[f.level] >= 2).length)

const isRiskZone = computed(() => {
  const r = MOCK_RISK_FACTORS
  return Boolean(r.hypeRole && r.hypeStack && r.grade === 'middle' && r.fullRemote && r.immediateStart)
})

const wolfShouldAutoRun = computed(() =>
  mediumPlusCount.value > 3 || isRiskZone.value,
)

const SECTION_ORDER = ['redflags', 'timeline', 'contradictions', 'ai', 'verifiability', 'questions', 'github'] as const
const SECTION_META: Record<string, { label: string; icon: string }> = {
  redflags:      { label: 'Топ-3 ред-флага',    icon: 'alert' },
  timeline:      { label: 'Таймлайн',           icon: 'timeline' },
  contradictions:{ label: 'Противоречия',       icon: 'ban' },
  ai:            { label: 'Стиль текста',       icon: 'radar' },
  verifiability: { label: 'Верифицируемость',   icon: 'fingerprint' },
  questions:     { label: 'Вопросы к интервью', icon: 'help' },
  github:        { label: 'GitHub',             icon: 'github' },
}

/* ── Действия ─────────────────────────────────────────────────── */

let runTimers: ReturnType<typeof setTimeout>[] = []

function setScenario(s: 'demo' | 'clean' | 'risk' | 'insufficient') {
  scenario.value = s
  resetReport()
}

function resetReport() {
  runTimers.forEach(clearTimeout)
  runTimers = []
  state.value = 'idle'
  wolfState.value = 'off'
  activeSection.value = 'redflags'
  lastRunAt.value = null
  SECTION_ORDER.forEach(s => { progressBlocks[s] = false })
}

function loadScenario(s: 'demo' | 'clean' | 'risk' | 'insufficient') {
  if (s === 'clean') {
    timeline.value = { ...MOCK_TIMELINE, findings: [] }
    contradictions.value = []
    aiDetection.value = { ...MOCK_AI, score: 18, band: 'low' }
    verifiability.value = { ...MOCK_VERIFIABILITY, value: 88, tier: 'high' }
    allRedFlags.value = []
    questions.value = []
    github.value = MOCK_GITHUB
    wolfFindings.value = []
    wolfDeep.value = []
  } else if (s === 'risk') {
    timeline.value = MOCK_TIMELINE
    contradictions.value = MOCK_CONTRADICTIONS
    aiDetection.value = { ...MOCK_AI, score: 78, band: 'flagged' }
    verifiability.value = { ...MOCK_VERIFIABILITY, value: 42, tier: 'low' }
    allRedFlags.value = [...MOCK_REDFLAGS, {
      id: 'rf5', title: 'Критическое расхождение дат с LinkedIn',
      summary: 'В резюме Yandex с 2022-03, в LinkedIn — с 2022-08.',
      evidence: 'Резюме: 2022-03; LinkedIn: 2022-08',
      level: 'high',
      alternativeExplanation: 'Разница в оформлении или позднее обновление LinkedIn',
      questionIds: ['q1'],
    }]
    questions.value = MOCK_QUESTIONS
    github.value = MOCK_GITHUB
    wolfFindings.value = [...MOCK_WOLF_FINDINGS, {
      id: 'w5', title: 'Расхождение дат резюме и LinkedIn на 5 мес',
      severity: 'high', confidence: 'cross_source',
    }]
    wolfDeep.value = MOCK_WOLF_DEEP
  } else if (s === 'insufficient') {
    timeline.value = { periods: [], findings: [], inflationMonths: 0, calendarSpanMonths: 0, actualExperienceMonths: 0, experienceInflated: false }
    contradictions.value = []
    aiDetection.value = { ...MOCK_AI, score: 0, band: 'low' }
    verifiability.value = { ...MOCK_VERIFIABILITY, value: 10, tier: 'minimal' }
    allRedFlags.value = []
    questions.value = []
    github.value = { present: false, basic: null, deep: null, disclaimer: MOCK_GITHUB.disclaimer }
    wolfFindings.value = []
    wolfDeep.value = []
  } else {
    timeline.value = MOCK_TIMELINE
    contradictions.value = MOCK_CONTRADICTIONS
    aiDetection.value = MOCK_AI
    verifiability.value = MOCK_VERIFIABILITY
    allRedFlags.value = MOCK_REDFLAGS
    questions.value = MOCK_QUESTIONS
    github.value = MOCK_GITHUB
    wolfFindings.value = MOCK_WOLF_FINDINGS
    wolfDeep.value = []
  }
}

/** Запуск проверки L1. Имитация бюджета ≤8с через setTimeout по блокам (не rAF). */
function run() {
  runTimers.forEach(clearTimeout)
  runTimers = []
  loadScenario(scenario.value)
  state.value = 'running'
  SECTION_ORDER.forEach(s => { progressBlocks[s] = false })

  // Достаточно данных?
  if (scenario.value === 'insufficient') {
    runTimers.push(setTimeout(() => { state.value = 'insufficient' }, 600))
    logAccess('run-l1-insufficient')
    return
  }

  const delays = [350, 900, 1500, 2100, 2700, 3300, 3900]
  SECTION_ORDER.forEach((s, i) => {
    runTimers.push(setTimeout(() => { progressBlocks[s] = true }, delays[i]))
  })
  runTimers.push(setTimeout(() => {
    state.value = allRedFlags.value.length ? 'findings' : 'clean'
    lastRunAt.value = Date.now()
    logAccess('run-l1-done')
    if (wolfShouldAutoRun.value && scenario.value !== 'clean') {
      runWolfhound(true)
    }
  }, 4200))
}

/** Ручной запуск «Волкодава». */
function runWolfhound(auto = false) {
  if (wolfState.value === 'running') return
  wolfState.value = 'running'
  logAccess(auto ? 'wolf-auto' : 'wolf-manual')
  wolfTriggers.value = auto
    ? (mediumPlusCount.value > 3 ? ['> 3 ред-флагов уровня средний+'] : []).concat(isRiskZone.value ? ['Зона риска по совокупности признаков'] : [])
    : ['Ручной запуск рекрутером']
  if (!wolfDeep.value.length) wolfDeep.value = MOCK_WOLF_DEEP

  runTimers.push(setTimeout(() => { wolfState.value = 'done' }, 1100))
}

function abort() {
  runTimers.forEach(clearTimeout)
  runTimers = []
  state.value = 'idle'
  wolfState.value = 'off'
  SECTION_ORDER.forEach(s => { progressBlocks[s] = false })
}

function toggleSection(id: string) {
  activeSection.value = activeSection.value === id ? null : id
}

function copyQuestion(q: InterviewQuestion) {
  try { navigator.clipboard?.writeText(q.text) } catch {}
}

function addToScenario(qid: string) {
  if (!scenarioQuestionIds.value.includes(qid)) scenarioQuestionIds.value.push(qid)
}

function removeFromScenario(qid: string) {
  scenarioQuestionIds.value = scenarioQuestionIds.value.filter(id => id !== qid)
}

function clearReport() {
  resetReport()
  scenarioQuestionIds.value = []
  logAccess('clear-report')
  try { chrome.storage?.local?.remove?.('hf:vf:report') } catch {}
}

/** §6.4 — логирование доступа. */
function logAccess(action: string, note?: string) {
  const entry = { ts: Date.now(), url: typeof location !== 'undefined' ? location.href : '', action, note }
  auditLog.value.push(entry)
  try {
    chrome.storage?.local?.get?.('hf:vf:audit', (res: any) => {
      const log = res?.['hf:vf:audit'] ?? []
      log.push(entry)
      chrome.storage?.local?.set?.({ 'hf:vf:audit': log.slice(-200) })
    })
  } catch {}
}

function exportReport(): string {
  const top = top3.value.top
  const lines: string[] = []
  lines.push('# Отчёт верификации — Huntfork Sidekick')
  lines.push('')
  lines.push(`Дата: ${lastRunAt.value ? new Date(lastRunAt.value).toLocaleString('ru-RU') : '—'}`)
  lines.push('')
  lines.push('## Топ-3 ред-флага')
  if (!top.length) lines.push('Существенных расхождений не найдено.')
  top.forEach((f, i) => {
    lines.push(`${i + 1}. **${f.title}** (${f.level})`)
    lines.push(`   ${f.summary}`)
    lines.push(`   Доказательство: ${f.evidence}`)
    lines.push(`   Альтернативное объяснение: ${f.alternativeExplanation}`)
  })
  lines.push('')
  if (timeline.value.findings.length) {
    lines.push('## Таймлайн')
    timeline.value.findings.forEach(f => lines.push(`- ${f.detail} (${f.level})`))
    lines.push('')
  }
  if (contradictions.value.length) {
    lines.push('## Противоречия')
    contradictions.value.forEach(c => lines.push(`- ${c.title} (${c.level})`))
    lines.push('')
  }
  if (wolfState.value === 'done') {
    const w = computeWolf(wolfFindings.value)
    lines.push(`## Волкодав: ${w.score}/5 — ${w.levelName}`)
    lines.push(w.levelHint)
    if (w.isCapped) lines.push('Оценка ограничена тремя волками: только лингвистика/ИИ.')
    lines.push('')
  }
  if (questions.value.length) {
    lines.push('## Вопросы к интервью')
    questions.value.forEach(q => lines.push(`- [${q.method}] ${q.text}`))
  }
  lines.push('')
  lines.push('—')
  lines.push('Это не вывод о добросовестности кандидата и не основание для отказа.')
  return lines.join('\n')
}

const wolfComputed = computed(() => computeWolf(wolfFindings.value))

export function useVerification() {
  return {
    // состояние
    state, wolfState, activeSection, progressBlocks, lastRunAt, scenario,
    SECTION_ORDER, SECTION_META,
    // данные
    timeline, contradictions, aiDetection, verifiability,
    allRedFlags, questions, github,
    wolfFindings, wolfDeep, wolfTriggers,
    top3, mediumPlusCount, isRiskZone, wolfShouldAutoRun, wolfComputed,
    scenarioQuestionIds, auditLog,
    // методы
    run, runWolfhound, abort, toggleSection,
    copyQuestion, addToScenario, removeFromScenario,
    clearReport, exportReport, setScenario,
  }
}
