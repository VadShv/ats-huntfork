/**
 * useInterviewCard.ts — модуль «Опросная карта интервьюера» (CARE).
 * ТЗ «Опросная карта интервьюера (CARE)» v1.0.
 *
 * Методологическая база: руководство по интервью по компетенциям, CARE.
 * CARE = Content – Action – Role – Effect. R = Role (НЕ Result) —
 * отделяет личный вклад от командного.
 *
 * Четыре входа: резюме, вакансия, критерии скрининга, риски уровней 1–2.
 * Трёхуровневая воронка: запрос примера → уточнения CARE → зонды.
 * Правило 80%: оценка блокируется до покрытия индикаторов.
 * Максимум 4 компетенции, 3 по умолчанию.
 */

import { ref, computed, watch } from 'vue'

/* ════════════════════════════════════════════════════════════════
 * 1. Типы
 * ════════════════════════════════════════════════════════════════ */

export interface Indicator {
  num: number
  text: string
}

export interface Competency {
  id: string
  name: string
  definition: string
  block: string // группа: «управление», «результат», «взаимодействие»
  indicators: Indicator[]
}

export type CareStage = 'C' | 'A' | 'R' | 'E'
export type FunnelLevel = 1 | 2 | 3 // 1=запрос примера, 2=CARE, 3=зонд
export type Personalization = 'weak' | 'medium' | 'strong'
export type Polarity = 'positive' | 'negative'

export interface CareQuestion {
  id: string
  level: FunnelLevel
  careStage?: CareStage // только для уровня 2
  text: string
  listenFor: string
  indicatorIds: number[]
  polarity: Polarity
  personalization: Personalization
  isProbe: boolean
  probeTarget?: string // какой ред-флаг проверяет зонд
  asked: boolean // отмечено как заданное (conduct-режим)
  notes: string // записи интервьюера
}

export interface CompetencyBlock {
  competencyId: string
  questions: CareQuestion[]
  examplesCount: number
  rating: number | null // 1–5
  ratingLocked: boolean
  disclosedIndicators: Set<number> // раскрытые на интервью
}

export type CardMode = 'prep' | 'conduct'
export type Completeness = 'full' | 'partial'

export interface InterviewCard {
  blocks: CompetencyBlock[]
  budgetMinutes: number
  completeness: Completeness
  missingInputs: string[]
  mode: CardMode
}

/* ════════════════════════════════════════════════════════════════
 * 2. Встроенный справочник компетенций (6 × 5 индикаторов)
 * Контракт компетенции отсутствует в ТЗ — это мок до бэкенда.
 * ════════════════════════════════════════════════════════════════ */

export const COMPETENCY_CATALOG: Competency[] = [
  {
    id: 'planning',
    name: 'Планирование',
    definition: 'Способность определять цели, выстраивать последовательность действий, распределять ресурсы и адаптировать план в меняющихся условиях.',
    block: 'управление',
    indicators: [
      { num: 1, text: 'Определяет цели и приоритеты' },
      { num: 2, text: 'Строит реалистичный план с этапами' },
      { num: 3, text: 'Распределяет ресурсы и время' },
      { num: 4, text: 'Адаптирует план при изменениях' },
      { num: 5, text: 'Учитывает риски и зависимости' },
    ],
  },
  {
    id: 'leadership',
    name: 'Лидерство',
    definition: 'Способность вести за собой команду, принимать решения, брать ответственность за результат группы, развивать людей.',
    block: 'управление',
    indicators: [
      { num: 1, text: 'Принимает решения в неопределённости' },
      { num: 2, text: 'Берёт ответственность за команду' },
      { num: 3, text: 'Развивает и менторит членов команды' },
      { num: 4, text: 'Разрешает конфликты' },
      { num: 5, text: 'Влияет без формальных полномочий' },
    ],
  },
  {
    id: 'responsibility',
    name: 'Ответственность',
    definition: 'Готовность отвечать за свои решения и ошибки, доводить начатое до конца, не перекладывать вину.',
    block: 'управление',
    indicators: [
      { num: 1, text: 'Признаёт свои ошибки' },
      { num: 2, text: 'Доводит задачи до завершения' },
      { num: 3, text: 'Не перекладывает ответственность' },
      { num: 4, text: 'Предупреждает о рисках заранее' },
      { num: 5, text: 'Берёт ответственность за результат' },
    ],
  },
  {
    id: 'result',
    name: 'Ориентация на результат',
    definition: 'Фокус на достижении измеримого результата, способность преодолевать препятствия, доводить до цели несмотря на обстоятельства.',
    block: 'результат',
    indicators: [
      { num: 1, text: 'Ставит измеримые цели' },
      { num: 2, text: 'Преодолевает препятствия' },
      { num: 3, text: 'Доводит до результата вопреки обстоятельствам' },
      { num: 4, text: 'Измеряет и анализирует результат' },
      { num: 5, text: 'Учится на неудачах' },
    ],
  },
  {
    id: 'collaboration',
    name: 'Взаимодействие',
    definition: 'Способность работать в команде, выстраивать отношения с коллегами и стейкхолдерами, коммуницировать конструктивно.',
    block: 'взаимодействие',
    indicators: [
      { num: 1, text: 'Выстраивает отношения с коллегами' },
      { num: 2, text: 'Коммуницирует конструктивно' },
      { num: 3, text: 'Работает в кросс-функциональной команде' },
      { num: 4, text: 'Управляет ожиданиями стейкхолдеров' },
      { num: 5, text: 'Согласовывает позиции в конфликте интересов' },
    ],
  },
  {
    id: 'systems',
    name: 'Системное мышление',
    definition: 'Способность видеть систему целиком, понимать взаимосвязи компонентов, проектировать архитектурные решения.',
    block: 'результат',
    indicators: [
      { num: 1, text: 'Видит систему целиком' },
      { num: 2, text: 'Понимает взаимосвязи компонентов' },
      { num: 3, text: 'Проектирует архитектурные решения' },
      { num: 4, text: 'Оценивает компромиссы' },
      { num: 5, text: 'Применяет технологии на практике' },
    ],
  },
]

/* ════════════════════════════════════════════════════════════════
 * 3. Таблица маппинга риск → компетенция (§5.6 ТЗ)
 * ════════════════════════════════════════════════════════════════ */

export const RISK_TO_COMPETENCY: Record<
  string,
  { competencyIds: string[]; enhancedStage?: CareStage }
> = {
  date_intersection: {
    competencyIds: ['planning', 'responsibility'],
  },
  gap: {
    competencyIds: ['result'],
  },
  grade_inflation: {
    competencyIds: ['leadership', 'collaboration'],
    enhancedStage: 'R',
  },
  personal_contribution: {
    competencyIds: ['leadership'],
    enhancedStage: 'R',
  },
  ai_generation: {
    competencyIds: ['systems'],
  },
  stack_mismatch: {
    competencyIds: ['systems'],
  },
}

/* ════════════════════════════════════════════════════════════════
 * 4. Экстрактор фактов из резюме
 * ════════════════════════════════════════════════════════════════ */

export interface ResumeFacts {
  companies: string[]
  roles: string[]
  skills: string[]
  periods: { company: string; months: number; role: string }[]
  shortTenures: { company: string; months: number }[]
  longestTenure: { company: string; months: number } | null
}

export function extractFacts(parsedFull: any): ResumeFacts {
  if (!parsedFull) {
    return {
      companies: [],
      roles: [],
      skills: [],
      periods: [],
      shortTenures: [],
      longestTenure: null,
    }
  }

  const experience = parsedFull.experience || []
  const skills = parsedFull.skills || []

  const periods = experience.map((e: any) => ({
    company: e.company || e.organization || '',
    months: e.durationMonths || Math.round((e.endMs - e.startMs) / (1000 * 60 * 60 * 24 * 30)) || 0,
    role: e.title || e.position || '',
  }))

  const companies = [...new Set(periods.map((p: any) => p.company).filter(Boolean))]
  const roles = [...new Set(periods.map((p: any) => p.role).filter(Boolean))]

  const shortTenures = periods
    .filter((p: any) => p.months > 0 && p.months < 9)
    .map((p: any) => ({ company: p.company, months: p.months }))

  const longest = periods.reduce(
    (acc: { company: string; months: number } | null, p: any) =>
      !acc || p.months > acc.months ? { company: p.company, months: p.months } : acc,
    null,
  )

  return {
    companies,
    roles,
    skills: Array.isArray(skills) ? skills : [],
    periods,
    shortTenures,
    longestTenure: longest,
  }
}

/* ════════════════════════════════════════════════════════════════
 * 5. Генерация вопросов — ядро
 * ════════════════════════════════════════════════════════════════ */

let qIdCounter = 0
function nextId(prefix: string): string {
  qIdCounter++
  return `${prefix}-${qIdCounter}`
}

const CARE_CLARIFICATIONS: Record<CareStage, string[]> = {
  C: [
    'Что это была за ситуация? В чём была основная сложность?',
    'Кто ещё принимал участие? Когда это произошло?',
  ],
  A: [
    'Как вы изначально отреагировали на задачу?',
    'С какими препятствиями столкнулись? Как их преодолевали?',
  ],
  R: [
    'Какова была ваша роль и уровень ответственности?',
    'Что вы делали лично, а что — команда?',
  ],
  E: [
    'Каковы итоговые результаты? Какую обратную связь получили?',
    'Какие выводы сделали на будущее?',
  ],
}

const NEGATIVE_PROMPTS = [
  'Расскажите о случае, когда вам не удалось достичь цели. Что произошло?',
  'Опишите ситуацию, когда вы недооценили последствия своего решения.',
  'Расскажите о случае, когда пришлось исправлять серьёзную ошибку. Чья она была?',
]

const UNIVERSAL_LISTEN = [
  'Признаки достоверного ответа: конкретные имена, числа, даты, названия инструментов; называет собственные ошибки без наводящих; различает «я» и «we», не присваивает командное; помнит детали, которые невозможно выдумать; признаёт границы своей роли.',
  'Признаки уклонения: переход в общие рассуждения «как надо»; гипотетическое время вместо прошедшего; постоянное «мы» без конкретизации личного вклада; смена примера при просьбе о деталях; противоречия внутри рассказа; метрики без основания («увеличил на 40%» без объяснения замера).',
]

/**
 * buildQuestionsForCompetency — генерирует вопросы по воронке для одной компетенции.
 * Воронка: уровень 1 (запрос примера) → уровень 2 (CARE) → уровень 3 (зонды).
 * ≥1 негативный кейс. Зонды встроены, а не отдельным блоком.
 */
function buildQuestionsForCompetency(
  comp: Competency,
  facts: ResumeFacts,
  riskFlags: any[],
): CareQuestion[] {
  const questions: CareQuestion[] = []
  const compRisks = riskFlags.filter((rf) => {
    const mapping = RISK_TO_COMPETENCY[rf.id] || RISK_TO_COMPETENCY[rf.title?.toLowerCase()?.replace(/\s/g, '_')]
    return mapping?.competencyIds.includes(comp.id)
  })

  // ── Уровень 1: запрос примера (позитивный + негативный = минимум 2 примера) ──
  const company = facts.companies[0] || 'вашей предыдущей работе'
  const role = facts.roles[0] || comp.name.toLowerCase()

  // Позитивный кейс — персонализация средняя (компания/период)
  questions.push({
    id: nextId('q'),
    level: 1,
    text: `Расскажите о ситуации в ${company}, когда вам пришлось проявить ${comp.name.toLowerCase()}. Что это был за проект?`,
    listenFor: UNIVERSAL_LISTEN.join('\n\n'),
    indicatorIds: [1, 2],
    polarity: 'positive',
    personalization: 'medium',
    isProbe: false,
    asked: false,
    notes: '',
  })

  // Негативный кейс — обязательный (≥1 на компетенцию)
  const negIdx = Math.floor(Math.random() * NEGATIVE_PROMPTS.length)
  questions.push({
    id: nextId('q'),
    level: 1,
    text: `${NEGATIVE_PROMPTS[negIdx]} Речь о работе в роли ${role}.`,
    listenFor: UNIVERSAL_LISTEN.join('\n\n'),
    indicatorIds: [3, 5],
    polarity: 'negative',
    personalization: 'weak',
    isProbe: false,
    asked: false,
    notes: '',
  })

  // ── Уровень 2: уточнения по CARE (C→A→R→E) ──
  const enhancedStage = compRisks.reduce<CareStage | undefined>(
    (acc, rf) => {
      const m = RISK_TO_COMPETENCY[rf.id]
      return m?.enhancedStage || acc
    },
    undefined,
  )

  ;(Object.keys(CARE_CLARIFICATIONS) as CareStage[]).forEach((stage) => {
    CARE_CLARIFICATIONS[stage].forEach((text) => {
      // Усиленный этап R при риске личного вклада
      const isEnhanced = stage === 'R' && enhancedStage === 'R'
      questions.push({
        id: nextId('q'),
        level: 2,
        careStage: stage,
        text: isEnhanced ? `${text} Что именно делали лично вы, за что отвечали напрямую?` : text,
        listenFor: UNIVERSAL_LISTEN.join('\n\n'),
        indicatorIds: getIndicatorForStage(stage, comp),
        polarity: 'neutral' as Polarity,
        personalization: 'weak',
        isProbe: false,
        asked: false,
        notes: '',
      })
    })
  })

  // ── Уровень 3: зонды (100% персонализация из резюме) ──
  compRisks.forEach((rf) => {
    const probeText = buildProbe(rf, facts, comp)
    if (probeText) {
      questions.push({
        id: nextId('q'),
        level: 3,
        text: probeText,
        listenFor: buildProbeListen(rf),
        indicatorIds: [4, 5],
        polarity: 'neutral' as Polarity,
        personalization: 'strong',
        isProbe: true,
        probeTarget: rf.id || rf.title,
        asked: false,
        notes: '',
      })
    }
  })

  // Дополнительный зонд по стеку/технологиям, если есть skills
  if (facts.skills.length && comp.id === 'systems') {
    const tech = facts.skills[0]
    questions.push({
      id: nextId('q'),
      level: 3,
      text: `Расскажите о задаче, где вы применяли ${tech}. Как именно использовали, какие ограничения технологии обнаружили?`,
      listenFor: 'Конкретика: имена инструментов, числа, названия. Невозможно описать без реального опыта.',
      indicatorIds: [5, 3],
      polarity: 'neutral' as Polarity,
      personalization: 'strong',
      isProbe: true,
      probeTarget: 'stack_verification',
      asked: false,
      notes: '',
    })
  }

  return questions
}

function getIndicatorForStage(stage: CareStage, comp: Competency): number[] {
  // Привязка CARE-этапа к индикаторам
  const map: Record<CareStage, number[]> = {
    C: [1],
    A: [2, 3],
    R: [4],
    E: [5],
  }
  return map[stage]
}

function buildProbe(rf: any, facts: ResumeFacts, comp: Competency): string | null {
  const riskId = rf.id || rf.title?.toLowerCase()?.replace(/\s/g, '_')

  switch (riskId) {
    case 'date_intersection':
      if (facts.shortTenures.length) {
        const st = facts.shortTenures[0]
        return `Расскажите о работе в ${st.company}. Как вы распределяли время, если периоды накладывались? Кто знал о совмещении?`
      }
      return null
    case 'gap':
      return `Был ли период, когда вы не работали? Чем занимались в это время, какие выводы сделали?`
    case 'grade_inflation':
      return `Расскажите о случае, когда вы руководили командой без формальных полномочий. Как вы добивались результата без должности?`
    case 'personal_contribution':
      return `В проекте в ${facts.companies[0] || 'последней компании'} — каков был ваш личный вклад? Что делали лично вы, а не команда?`
    case 'ai_generation':
      return `Уточните детали по разделу резюме: какие именно инструменты использовали, в каких числах измерялся результат?`
    case 'stack_mismatch':
      if (facts.skills.length) {
        return `Приведите пример задачи на ${facts.skills[0]}, которую вы решали. Какие конкретно функции технологии применяли?`
      }
      return null
    default:
      return null
  }
}

function buildProbeListen(rf: any): string {
  const riskId = rf.id || rf.title?.toLowerCase()?.replace(/\s/g, '_')
  const specific: Record<string, string> = {
    date_intersection: 'Кто знал о совмещении, как распределялось время. Признаки уклонения: «просто совпадение», уход от дат.',
    gap: 'Чем реально занимался. Признаки уклонения: общие фразы вместо конкретики.',
    grade_intribution: 'Конкретные управленческие действия: найм, 1:1, фидбек, конфликты. Маркер «мы сделали» вместо «я сделал».',
    personal_contribution: 'Чёткое разделение «я» и «мы». Уклонение: «ну я типа лид», отсутствие управленческих глаголов.',
    ai_generation: 'Имена, числа, названия, которые невозможно выдумать. Уклонение: общие рассуждения вместо деталей.',
    stack_mismatch: 'Конкретный кластер, манифесты, инциденты. Невозможно описать без реального опыта.',
  }
  return specific[riskId] || UNIVERSAL_LISTEN.join('\n\n')
}

/* ════════════════════════════════════════════════════════════════
 * 6. Отбор компетенций (§4.1)
 * priority = 0.35·важность + 0.30·связь_рисками + 0.20·непроверенность + 0.15·критичность
 * ════════════════════════════════════════════════════════════════ */

interface CompetencyScore {
  comp: Competency
  priority: number
}

function selectCompetencies(
  riskFlags: any[],
  vacancyTitle: string,
  maxCount = 3,
): Competency[] {
  const scores: CompetencyScore[] = COMPETENCY_CATALOG.map((comp) => {
    // Связь с рисками: сколько ред-флагов маппятся на эту компетенцию
    const riskLinks = riskFlags.filter((rf) => {
      const riskId = rf.id || rf.title?.toLowerCase()?.replace(/\s/g, '_')
      return RISK_TO_COMPETENCY[riskId]?.competencyIds.includes(comp.id)
    }).length
    const riskScore = Math.min(1, riskLinks / 2)

    // Важность для вакансии: грубый эвристический матч по словам
    const vLower = (vacancyTitle || '').toLowerCase()
    const importance =
      comp.name.toLowerCase().split(' ').some((w) => vLower.includes(w)) ? 0.9 : 0.5

    // Критичность: управление/результат — выше для ролей с ответственностью
    const criticality = comp.block === 'управление' ? 0.8 : comp.block === 'результат' ? 0.7 : 0.5

    // Непроверенность: мок, всё непроверено
    const unverified = 0.7

    const priority =
      0.35 * importance + 0.3 * riskScore + 0.2 * unverified + 0.15 * criticality

    return { comp, priority }
  })

  scores.sort((a, b) => b.priority - a.priority)

  // Обязательно хотя бы одна компетенция, связанная с топ-1 ред-флагом
  const topRisk = riskFlags[0]
  const topRiskId = topRisk?.id || topRisk?.title?.toLowerCase()?.replace(/\s/g, '_')
  const requiredIds = topRiskId ? RISK_TO_COMPETENCY[topRiskId]?.competencyIds : []

  const selected: Competency[] = []
  const blockCounts: Record<string, number> = {}

  for (const { comp } of scores) {
    if (selected.length >= maxCount) break
    // Не более двух из одного блока
    if ((blockCounts[comp.block] || 0) >= 2) continue
    selected.push(comp)
    blockCounts[comp.block] = (blockCounts[comp.block] || 0) + 1
  }

  // Гарантия: компетенция топ-1 ред-флага входит в выборку
  if (requiredIds?.length) {
    const hasRequired = selected.some((c) => requiredIds.includes(c.id))
    if (!hasRequired && selected.length < 4) {
      const reqComp = COMPETENCY_CATALOG.find((c) => c.id === requiredIds[0])
      if (reqComp) selected.push(reqComp)
    }
  }

  return selected.slice(0, 4)
}

/* ════════════════════════════════════════════════════════════════
 * 7. Singleton-композабл
 * ════════════════════════════════════════════════════════════════ */

const card = ref<InterviewCard | null>(null)
const cardMode = ref<CardMode>('prep')
const activeBlockIdx = ref(0)
const activeQuestionIdx = ref(0)
const consecutiveThrees = ref(0) // защита «тяга к середине»
const ratingsHistory = ref<Record<string, number[]>>({}) // защита «личное смещение»

// Conduct-режим: таймер
const elapsedSeconds = ref(0)
let timerHandle: ReturnType<typeof setInterval> | null = null

function loadRatingsHistory(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get('hf:ratings', (data) => {
        if (data['hf:ratings']) ratingsHistory.value = data['hf:ratings']
      })
    }
  } catch {}
}

function saveRatingsHistory(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ 'hf:ratings': ratingsHistory.value })
    }
  } catch {}
}

loadRatingsHistory()

export function useInterviewCard() {
  const hasCard = computed(() => card.value !== null)

  /** Покрытие индикаторов блоком (матрица). */
  function coverageMatrix(block: CompetencyBlock): Map<number, boolean> {
    const comp = COMPETENCY_CATALOG.find((c) => c.id === block.competencyId)
    if (!comp) return new Map()
    const covered = new Map<number, boolean>()
    comp.indicators.forEach((ind) => {
      const isCovered = block.questions.some(
        (q) => q.indicatorIds.includes(ind.num) && q.asked,
      )
      covered.set(ind.num, isCovered)
    })
    return covered
  }

  /** Доля покрытия индикаторов (0..1). */
  function coverageRatio(block: CompetencyBlock): number {
    const m = coverageMatrix(block)
    if (!m.size) return 0
    const covered = Array.from(m.values()).filter(Boolean).length
    return covered / m.size
  }

  /** Правило 80% + минимум 2 примера → можно ли выставить оценку. */
  function canRate(block: CompetencyBlock): boolean {
    const ratio = coverageRatio(block)
    const examples = block.questions.filter((q) => q.level === 1 && q.asked).length
    return ratio >= 0.8 && examples >= 2
  }

  /** Кол-во примеров в блоке. */
  function examplesCount(block: CompetencyBlock): number {
    return block.questions.filter((q) => q.level === 1).length
  }

  /**
   * buildCard — построение опросной карты из четырёх входов.
   */
  function buildCard(
    parsedFull: any,
    vacancyTitle: string,
    riskFlags: any[],
    screeningConfirmed: string[] = [],
  ): void {
    const facts = extractFacts(parsedFull)
    const missingInputs: string[] = []
    if (!parsedFull) missingInputs.push('резюме')
    if (!vacancyTitle) missingInputs.push('вакансия')
    if (!riskFlags.length) missingInputs.push('риски')
    if (!screeningConfirmed.length) missingInputs.push('критерии скрининга')

    const selected = selectCompetencies(riskFlags, vacancyTitle, 3)
    const blocks: CompetencyBlock[] = selected.map((comp) => {
      const questions = buildQuestionsForCompetency(comp, facts, riskFlags)
      return {
        competencyId: comp.id,
        questions,
        examplesCount: examplesCount({ questions } as any),
        rating: null,
        ratingLocked: true,
        disclosedIndicators: new Set<number>(),
      }
    })

    // Бюджет времени (§3.2): вступление 7 + компетенции × 17.5 + верификация 10 + завершение 5
    const budget = Math.round(7 + blocks.length * 17.5 + 10 + 5)

    card.value = {
      blocks,
      budgetMinutes: budget,
      completeness: missingInputs.length ? 'partial' : 'full',
      missingInputs,
      mode: cardMode.value,
    }
    activeBlockIdx.value = 0
    activeQuestionIdx.value = 0
  }

  /** Установка оценки (с защитами). */
  function setRating(blockIdx: number, rating: number): void {
    if (!card.value) return
    const block = card.value.blocks[blockIdx]
    if (!block) return

    // Блокировка до 80% + 2 примера
    if (!canRate(block)) {
      block.ratingLocked = true
      return
    }
    block.ratingLocked = false
    block.rating = rating

    // Защита «тяга к середине»: напоминание при 3-й «3» подряд
    if (rating === 3) {
      consecutiveThrees.value++
    } else {
      consecutiveThrees.value = 0
    }

    // Защита «личное смещение»: сохраняем историю
    const compId = block.competencyId
    if (!ratingsHistory.value[compId]) ratingsHistory.value[compId] = []
    ratingsHistory.value[compId].push(rating)
    saveRatingsHistory()
  }

  /** Отметить вопрос как заданный (conduct-режим). */
  function markAsked(blockIdx: number, qId: string): void {
    if (!card.value) return
    const block = card.value.blocks[blockIdx]
    if (!block) return
    const q = block.questions.find((x) => x.id === qId)
    if (q) q.asked = true
  }

  /** Сохранить записи к вопросу. */
  function setNotes(blockIdx: number, qId: string, notes: string): void {
    if (!card.value) return
    const block = card.value.blocks[blockIdx]
    if (!block) return
    const q = block.questions.find((x) => x.id === qId)
    if (q) q.notes = notes
  }

  /** Отметить индикатор как раскрытый. */
  function markIndicator(blockIdx: number, indNum: number): void {
    if (!card.value) return
    const block = card.value.blocks[blockIdx]
    if (!block) return
    block.disclosedIndicators.add(indNum)
  }

  /** Переключение режима prep ↔ conduct. */
  function setMode(mode: CardMode): void {
    cardMode.value = mode
    if (card.value) card.value.mode = mode

    if (mode === 'conduct') {
      elapsedSeconds.value = 0
      timerHandle = setInterval(() => {
        elapsedSeconds.value++
      }, 1000)
    } else {
      if (timerHandle) {
        clearInterval(timerHandle)
        timerHandle = null
      }
    }
  }

  /** Навигация в conduct-режиме. */
  function nextQuestion(): void {
    if (!card.value) return
    const block = card.value.blocks[activeBlockIdx.value]
    if (!block) return
    if (activeQuestionIdx.value < block.questions.length - 1) {
      activeQuestionIdx.value++
    } else if (activeBlockIdx.value < card.value.blocks.length - 1) {
      activeBlockIdx.value++
      activeQuestionIdx.value = 0
    }
  }

  function prevQuestion(): void {
    if (!card.value) return
    if (activeQuestionIdx.value > 0) {
      activeQuestionIdx.value--
    } else if (activeBlockIdx.value > 0) {
      activeBlockIdx.value--
      const prevBlock = card.value.blocks[activeBlockIdx.value]
      activeQuestionIdx.value = prevBlock.questions.length - 1
    }
  }

  /** Проверка личного смещения интервьюера. */
  function hasBiasWarning(): boolean {
    const allRatings = Object.values(ratingsHistory.value).flat()
    if (allRatings.length < 6) return false
    const avg = allRatings.reduce((a, b) => a + b, 0) / allRatings.length
    return avg >= 4.3 || avg <= 1.7
  }

  /** Экспорт карты в текстовый сценарий. */
  function exportCard(): string {
    if (!card.value) return ''
    let out = `ОПРОСНАЯ КАРТА ИНТЕРВЬЮЕРА (CARE)\n`
    out += `Бюджет: ~${card.value.budgetMinutes} мин\n`
    out += `Полнота: ${card.value.completeness === 'full' ? 'полная' : 'неполная'}\n`
    if (card.value.missingInputs.length) {
      out += `Не хватает: ${card.value.missingInputs.join(', ')}\n`
    }
    out += `\n${'═'.repeat(50)}\n\n`

    card.value.blocks.forEach((block, i) => {
      const comp = COMPETENCY_CATALOG.find((c) => c.id === block.competencyId)
      if (!comp) return
      out += `${i + 1}. ${comp.name}\n`
      out += `${comp.definition}\n`
      out += `Индикаторы: ${comp.indicators.map((ind) => `${ind.num}. ${ind.text}`).join('; ')}\n\n`

      block.questions.forEach((q) => {
        const levelLabel = q.level === 1 ? '[Запрос примера]' : q.level === 2 ? `[CARE ${q.careStage}]` : '[ЗОНД]'
        const polLabel = q.polarity === 'negative' ? ' (негативный кейс)' : ''
        out += `  ${levelLabel}${polLabel} ${q.text}\n`
        out += `  Что слушать: ${q.listenFor.slice(0, 120)}...\n\n`
      })

      if (block.rating) out += `Оценка: ${block.rating}/5\n`
      out += `\n${'─'.repeat(50)}\n\n`
    })

    return out
  }

  function clearCard(): void {
    card.value = null
    activeBlockIdx.value = 0
    activeQuestionIdx.value = 0
    if (timerHandle) {
      clearInterval(timerHandle)
      timerHandle = null
    }
  }

  return {
    // состояние
    card,
    cardMode,
    activeBlockIdx,
    activeQuestionIdx,
    consecutiveThrees,
    elapsedSeconds,
    hasCard,
    COMPETENCY_CATALOG,
    // методы
    buildCard,
    setRating,
    markAsked,
    setNotes,
    markIndicator,
    setMode,
    nextQuestion,
    prevQuestion,
    coverageMatrix,
    coverageRatio,
    canRate,
    examplesCount,
    hasBiasWarning,
    exportCard,
    clearCard,
  }
}
