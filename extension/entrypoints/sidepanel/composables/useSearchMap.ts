import { ref, computed, reactive } from 'vue'

/* ────────────────────────────────────────────────────────────────
   useSearchMap — состояние «Карты поиска» (Stage 5).
   UI-слой: типы + мок-данные + построитель запросов + реактивность.
   Бэкенд (SSE-генерация) подключается позже через тот же интерфейс.
   Все цвета — через --hf-* токены, в компонентах по tone.
   ──────────────────────────────────────────────────────────────── */

// ── Типы ────────────────────────────────────────────────────────
export type DonorTier =
  | 'direct'   // прямой конкурент
  | 'forge'    // кузница кадров
  | 'adjacent' // смежный рынок
  | 'analog'   // продуктовый аналог
  | 'outsource'// аутсорс-поставщик

export interface Donor {
  id: string
  name: string
  tier: DonorTier
  justification: string
  products: string[]
  internalRoles: string[]
  techStack: string[]
  geography: string[]
  culturalFit: string
  timingSignals: string[]
  risk: string
  expectedGrade: string
  excluded: boolean
  foundCount: number
  responseCount: number
}

export type HypothesisCategory =
  | 'titles'    // названия должностей
  | 'companies' // названия компаний
  | 'tech'      // технологии
  | 'geo'       // география
  | 'indirect'  // косвенные сигналы

export type Confidence = 'high' | 'mid' | 'experimental'

export interface Hypothesis {
  id: string
  label: string
  category: HypothesisCategory
  confidence: Confidence
  enabled: boolean
  justification: string
  expectedVolume: string
  falsePositiveRisk: string
  relatedQueryIds: string[]
}

export type QueryPlatform = 'linkedin' | 'github' | 'habr' | 'hh' | 'web' | 'telegram' | 'events'
export type QueryType =
  | 'core' | 'donor' | 'product' | 'profile' | 'resume'
  | 'community' | 'conference' | 'adjacent' | 'broad' | 'experimental'

export interface QueryDef {
  id: string
  seq: number         // № в таблице спецификации
  type: QueryType
  platform: QueryPlatform
  purpose: string
  /** Базовая строка (до правок рекрутера и до фильтрации гипотез). */
  base: string
}

export interface AntiMapItem {
  id: string
  kind: 'company' | 'role' | 'segment'
  label: string
  reason: string
  source: 'ats' | 'manual'
}

export interface ActionStep {
  id: string
  title: string
  detail: string
  done: boolean
  branchIfEmpty?: string
  day: number
}

export interface CapacitySegment {
  label: string
  value: number
  tone: 'high' | 'mid' | 'low'
}

// ── Тир → цветовой токен ────────────────────────────────────────
export const TIER_META: Record<DonorTier, { label: string, color: string, muted: string }> = {
  direct:   { label: 'Прямой конкурент',  color: 'var(--hf-match-high)', muted: 'var(--hf-match-high-muted)' },
  forge:    { label: 'Кузница кадров',    color: 'var(--hf-primary)',    muted: 'var(--hf-primary-muted)' },
  adjacent: { label: 'Смежный рынок',     color: 'var(--hf-match-mid)',  muted: 'var(--hf-match-mid-muted)' },
  analog:   { label: 'Продуктовый аналог',color: 'var(--hf-info)',       muted: 'var(--hf-info-muted)' },
  outsource:{ label: 'Аутсорс-поставщик', color: 'var(--hf-fg-subtle)',  muted: 'var(--hf-surface-sunken)' },
}

export const CONFIDENCE_META: Record<Confidence, { label: string, tone: 'high' | 'mid' | 'low' }> = {
  high:         { label: 'Высокая',        tone: 'high' },
  mid:          { label: 'Средняя',        tone: 'mid' },
  experimental: { label: 'Экспериментальная', tone: 'low' },
}

export const CATEGORY_LABEL: Record<HypothesisCategory, string> = {
  titles: 'Названия должностей',
  companies: 'Названия компаний',
  tech: 'Технологии',
  geo: 'География',
  indirect: 'Косвенные сигналы',
}

export const PLATFORM_LABEL: Record<QueryPlatform, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  habr: 'Habr Career',
  hh: 'hh.ru',
  web: 'Весь веб',
  telegram: 'Telegram / форумы',
  events: 'Мероприятия',
}

// ── Синглтон-состояние ──────────────────────────────────────────
type SmState = 'empty' | 'generating' | 'partial' | 'stale' | 'error' | 'ready'

const state = ref<SmState>('empty')
const calibrated = ref(true)
const searchEngine = ref<'google' | 'yandex'>('google')
const activeJobId = ref('')
const activeJobTitle = ref('')
const lastGeneratedAt = ref<number | null>(null)
const staleBanner = ref(false)
const editingQueryId = ref<string | null>(null)
const editedQueries = reactive<Record<string, string>>({})
const queryUsed = reactive<Record<string, boolean>>({})
const queryResults = reactive<Record<string, number>>({})
const searchMapVersion = ref(1)

// Порядок раскрытия секций (сверху вниз по спеке §7.1)
const SECTION_ORDER = [
  'capacity', 'donors', 'hypotheses', 'queries', 'antimap', 'plan',
] as const
export type SectionId = typeof SECTION_ORDER[number]

const openSections = ref<Record<SectionId, boolean>>({
  capacity: false,
  donors: true,
  hypotheses: false,
  queries: false,
  antimap: false,
  plan: false,
})
// Какие секции уже «сформированы» (для каскада генерации)
const sectionReady = ref<Record<SectionId, boolean>>({
  capacity: false, donors: false, hypotheses: false,
  queries: false, antimap: false, plan: false,
})

// ── Мок-данные: доноры (15) ─────────────────────────────────────
const donors = ref<Donor[]>([
  { id: 'd1', name: 'Тинькофф', tier: 'direct', justification: 'Тот же продукт и рынок, идентичный стек микросервисов на Go.', products: ['Тинькофф Бизнес', 'Тинькофф Касса', 'T-Pay'], internalRoles: ['Software Engineer 2', 'Senior SWE', 'Tech Lead'], techStack: ['Go', 'Kubernetes', 'PostgreSQL', 'Kafka'], geography: ['Москва', 'СПб', 'удалёнка'], culturalFit: 'Высокая зрелость процессов, продуктовые команды, сильная инженерная школа', timingSignals: ['Реструктуризация бизнес-юнита Q2', 'Уходы CTO-1 уровня'], risk: 'Зарплатный разрыв +15–20%, частые counter-offer', expectedGrade: 'Middle+ / Senior', excluded: false, foundCount: 34, responseCount: 6 },
  { id: 'd2', name: 'Авито', tier: 'direct', justification: 'Прямой конкурент по классу нагрузки, близкая архитектура highload.', products: ['Авито Недвижимость', 'Avito Pay', 'Avito Доставка'], internalRoles: ['Middle Developer', 'Senior Developer', 'Lead'], techStack: ['Java', 'Kotlin', 'Go', 'Kafka', 'ClickHouse'], geography: ['Москва', 'СПб'], culturalFit: 'Продуктовая разработка, сильная data-культура', timingSignals: ['Заморозка найма в одном из юнитов'], risk: 'Низкая мобильность, counter-offer в 70% случаев', expectedGrade: 'Middle / Senior', excluded: false, foundCount: 28, responseCount: 4 },
  { id: 'd3', name: 'Ozon Tech', tier: 'forge', justification: 'Признанная кузница кадров: регулярные уходы в продуктовые команды, сильная школа.', products: ['Ozon FBO', 'Ozon Логистика', 'Ozon Card'], internalRoles: ['SE', 'SSE', 'Staff'], techStack: ['C#', '.NET', 'Go', 'Kubernetes'], geography: ['Москва', 'Казань', 'Минск'], culturalFit: 'Зрелые процессы, продуктовый подход, менторские программы', timingSignals: ['Ротация внутри после 2 лет — частые уходы'], risk: 'Низкий, хорошая репутация уходит с ними', expectedGrade: 'Middle', excluded: false, foundCount: 19, responseCount: 8 },
  { id: 'd4', name: 'VK', tier: 'forge', justification: 'Кузница: большая инженерная школа, люди регулярно уходят в более мелкие продуктовые.', products: ['VK Почта', 'VK Tech', 'Юла'], internalRoles: ['Программист', 'Старший разработчик', 'Ведущий'], techStack: ['Go', 'C++', 'PHP', 'Kotlin'], geography: ['СПб', 'Москва'], culturalFit: 'Гибридные процессы, разная зрелость по юнитам', timingSignals: ['Реорганизация рекламного направления'], risk: 'Средний, контраст культур по командам', expectedGrade: 'Middle', excluded: false, foundCount: 22, responseCount: 5 },
  { id: 'd5', name: 'Яндекс', tier: 'forge', justification: 'Кузница высшего уровня: выпускники проходят жёсткий отбор, привычка к высокому качеству.', products: ['Яндекс.Такси', 'Маркет', 'Директ'], internalRoles: ['Разработчик', 'Старший разработчик', 'Командир'], techStack: ['C++', 'Go', 'Python', 'YT'], geography: ['Москва', 'Екатеринбург', 'Минск'], culturalFit: 'Сильная инженерная культура, высокие стандарты code review', timingSignals: ['Сокращение расходов на R&D'], risk: 'Высокий зарплатный разрыв, редкая мобильность', expectedGrade: 'Senior', excluded: false, foundCount: 41, responseCount: 3 },
  { id: 'd6', name: 'Контур', tier: 'adjacent', justification: 'Смежный рынок B2B SaaS, переносимая доменная экспертиза.', products: ['Контур.Эльба', 'Контур.Бухгалтерия'], internalRoles: ['Программист', 'Старший программист'], techStack: ['C#', '.NET', 'PostgreSQL'], geography: ['Екатеринбург', 'Ижевск', 'удалёнка'], culturalFit: 'Стабильность, продуктовые команды, долгосрочные отношения', timingSignals: [], risk: 'Низкая мобильность, привязанность к региону', expectedGrade: 'Middle', excluded: false, foundCount: 12, responseCount: 2 },
  { id: 'd7', name: '2ГИС', tier: 'adjacent', justification: 'Смежный рынок гео-сервисов, близкий стек highload.', products: ['2ГИС Карты', '2ГИС Бизнес'], internalRoles: ['Developer', 'Senior Developer'], techStack: ['Java', 'Kotlin', 'C++'], geography: ['Новосибирск', 'Москва'], culturalFit: 'Продуктовая разработка, кросс-функциональные команды', timingSignals: ['Смена технологического стека в одном юните'], risk: 'Средний, региональная привязка', expectedGrade: 'Middle', excluded: false, foundCount: 9, responseCount: 1 },
  { id: 'd8', name: 'HeadHunter', tier: 'analog', justification: 'Продуктовый аналог: похожая архитектура нагрузок и масштаб, но другой домен.', products: ['hh.ru', 'Зарплатный калькулятор'], internalRoles: ['Software Engineer', 'Senior SE'], techStack: ['Java', 'Go', 'ClickHouse'], geography: ['Москва', 'СПб'], culturalFit: 'Продуктовые команды, сильная data-инфраструктура', timingSignals: [], risk: 'Низкий', expectedGrade: 'Middle / Senior', excluded: false, foundCount: 7, responseCount: 2 },
  { id: 'd9', name: 'Циан', tier: 'analog', justification: 'Продуктовый аналог: классифайд с highload, переносимая архитектура.', products: ['Циан Недвижимость', 'Циан Бизнес'], internalRoles: ['Developer', 'Lead Developer'], techStack: ['Java', 'Kotlin', 'Kafka'], geography: ['Москва'], culturalFit: 'Продуктовая разработка, data-driven', timingSignals: ['Смена CTO'], risk: 'Средний', expectedGrade: 'Middle', excluded: false, foundCount: 6, responseCount: 0 },
  { id: 'd10', name: 'Тензор (СБИС)', tier: 'analog', justification: 'Продуктовый аналог B2B SaaS, близкий масштаб.', products: ['СБИС', 'Тензор ЭДО'], internalRoles: ['Программист', 'Старший'], techStack: ['C#', 'JavaScript', 'PostgreSQL'], geography: ['Ярославль', 'Москва', 'удалёнка'], culturalFit: 'Продуктовая разработка, своя школа', timingSignals: [], risk: 'Низкая мобильность', expectedGrade: 'Middle', excluded: false, foundCount: 5, responseCount: 1 },
  { id: 'd11', name: 'Лаборатория Касперского', tier: 'analog', justification: 'Продуктовый аналог: системная разработка, близкий масштаб.', products: ['Kaspersky Endpoint', 'KSC'], internalRoles: ['Software Engineer', 'Senior SE'], techStack: ['C++', 'Rust', 'Go'], geography: ['Москва'], culturalFit: 'Высокая инженерная культура, продуктовый подход', timingSignals: ['Уход ключевых архитекторов'], risk: 'Низкий', expectedGrade: 'Senior', excluded: false, foundCount: 8, responseCount: 2 },
  { id: 'd12', name: 'Luxoft', tier: 'outsource', justification: 'Аутсорс-поставщик: работали по контракту с близким стеком.', products: ['Daimler project', 'Deutsche Bank project'], internalRoles: ['Consultant', 'Senior Consultant'], techStack: ['Java', 'C#', '.NET'], geography: ['Москва', 'СПб', 'Дубай'], culturalFit: 'Проектная работа, гибкие процессы', timingSignals: ['Завершение крупного контракта'], risk: 'Проектный mindset, привыкли к аутсорс-ритму', expectedGrade: 'Middle', excluded: false, foundCount: 14, responseCount: 3 },
  { id: 'd13', name: 'EPAM', tier: 'outsource', justification: 'Аутсорс-поставщик: большой поток людей, близкий стек.', products: ['Various client projects'], internalRoles: ['SE', 'SSE', 'Lead'], techStack: ['Java', 'JavaScript', 'Go'], geography: ['Москва', 'СПб', 'Минск', 'удалёнка'], culturalFit: 'Проектная работа, своя школа, релоцируемость', timingSignals: ['Сокращение бенча'], risk: 'Проектный mindset, зарплатные ожидания ниже рынка', expectedGrade: 'Middle', excluded: false, foundCount: 17, responseCount: 4 },
  { id: 'd14', name: 'Yandex Cloud', tier: 'direct', justification: 'Прямой конкурент по облаку и инфраструктуре, идентичный стек.', products: ['Yandex Compute', 'Yandex Object Storage'], internalRoles: ['Разработчик', 'Старший разработчик'], techStack: ['Go', 'C++', 'Kubernetes'], geography: ['Москва'], culturalFit: 'Сильная инфраструктурная школа', timingSignals: ['Перевод части команд на новый стек'], risk: 'Высокий зарплатный разрыв', expectedGrade: 'Senior', excluded: false, foundCount: 11, responseCount: 1 },
  { id: 'd15', name: 'Selectel', tier: 'adjacent', justification: 'Смежный рынок облачной инфраструктуры, переносимые навыки.', products: ['Selectel Cloud', 'Selectel Storage'], internalRoles: ['Developer', 'Senior Developer'], techStack: ['Python', 'Go', 'Kubernetes'], geography: ['Екатеринбург', 'СПб', 'удалёнка'], culturalFit: 'Продуктовая разработка, своя инфраструктурная школа', timingSignals: ['Рост найма в R&D'], risk: 'Низкий', expectedGrade: 'Middle', excluded: false, foundCount: 10, responseCount: 2 },
])

// ── Мок-данные: гипотезы (по категориям, 47 шт.) ────────────────
const hypotheses = ref<Hypothesis[]>([
  // Названия должностей
  { id: 'h1', label: 'Senior Backend Developer', category: 'titles', confidence: 'high', enabled: true, justification: 'Каноническое название для целевого грейда.', expectedVolume: '~1800 профилей', falsePositiveRisk: 'Низкий, точное совпадение', relatedQueryIds: ['q1','q4'] },
  { id: 'h2', label: 'Backend Developer', category: 'titles', confidence: 'high', enabled: true, justification: 'Базовое название, охватывает middle+.', expectedVolume: '~3200 профилей', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q1','q2'] },
  { id: 'h3', label: 'Разработчик бэкенда', category: 'titles', confidence: 'high', enabled: true, justification: 'Русскоязычный вариант, частый на hh.', expectedVolume: '~1200 резюме', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q3','q12'] },
  { id: 'h4', label: 'Golang Developer', category: 'titles', confidence: 'mid', enabled: true, justification: 'Привязка к языку, часть целевого стека.', expectedVolume: '~900 профилей', falsePositiveRisk: 'Средний: фронт на Go редок, но бывает', relatedQueryIds: ['q2','q7'] },
  { id: 'h5', label: 'Серверный разработчик', category: 'titles', confidence: 'mid', enabled: false, justification: 'Устаревшее, но встречается у мигрировавших из 1С-франчайзи.', expectedVolume: '~300', falsePositiveRisk: 'Высокий: много шума из 1С-сегмента', relatedQueryIds: ['q12'] },
  { id: 'h6', label: 'Lead Backend', category: 'titles', confidence: 'mid', enabled: true, justification: 'Соседняя роль для senior-перехода.', expectedVolume: '~400', falsePositiveRisk: 'Средний: может быть руководящей ролью', relatedQueryIds: ['q16'] },
  { id: 'h7', label: 'Staff Engineer', category: 'titles', confidence: 'experimental', enabled: false, justification: 'Редкий грейд, но встречается у выходцев из крупных.', expectedVolume: '~120', falsePositiveRisk: 'Высокий: мало таких в РФ', relatedQueryIds: ['q18'] },
  { id: 'h8', label: 'Программист-разработчик', category: 'titles', confidence: 'mid', enabled: false, justification: 'Внутренний грейд доноров, как пишут в резюме.', expectedVolume: '~500', falsePositiveRisk: 'Средний', relatedQueryIds: ['q12'] },
  // Названия компаний
  { id: 'h9', label: 'Тинькофф / Tinkoff', category: 'companies', confidence: 'high', enabled: true, justification: 'Прямой донор, оба написания в ходу.', expectedVolume: '~200', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4','q5'] },
  { id: 'h10', label: 'Ozon (бывш. Ozon Tech)', category: 'companies', confidence: 'high', enabled: true, justification: 'Кузница, ребрендинг учтён.', expectedVolume: '~150', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4','q5'] },
  { id: 'h11', label: 'Яндекс / Yandex', category: 'companies', confidence: 'high', enabled: true, justification: 'Кузница, оба написания.', expectedVolume: '~400', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4','q5'] },
  { id: 'h12', label: 'VK (бывш. Mail.ru / ВКонтакте)', category: 'companies', confidence: 'high', enabled: true, justification: 'Кузница, несколько исторических названий.', expectedVolume: '~350', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q5'] },
  { id: 'h13', label: 'Luxoft / Luxoft Russia', category: 'companies', confidence: 'mid', enabled: false, justification: 'Аутсорс, но даёт поток.', expectedVolume: '~180', falsePositiveRisk: 'Средний: проектный опыт', relatedQueryIds: ['q4'] },
  { id: 'h14', label: 'HeadHunter / hh.ru', category: 'companies', confidence: 'mid', enabled: false, justification: 'Продуктовый аналог.', expectedVolume: '~90', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  // Технологии
  { id: 'h15', label: 'Go / Golang', category: 'tech', confidence: 'high', enabled: true, justification: 'Каноническое имя + жаргон.', expectedVolume: '~2400', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q1','q2','q7'] },
  { id: 'h16', label: 'Kubernetes', category: 'tech', confidence: 'high', enabled: true, justification: 'Обязательный признак целевого стека.', expectedVolume: '~1800', falsePositiveRisk: 'Средний: DevOps-инженеры', relatedQueryIds: ['q1','q7','q8'] },
  { id: 'h17', label: 'PostgreSQL', category: 'tech', confidence: 'high', enabled: true, justification: 'Основная БД в стеке.', expectedVolume: '~2600', falsePositiveRisk: 'Средний: DBA и аналитики', relatedQueryIds: ['q1','q3'] },
  { id: 'h18', label: 'Kafka', category: 'tech', confidence: 'mid', enabled: true, justification: 'Брокер сообщений, признак highload.', expectedVolume: '~1400', falsePositiveRisk: 'Средний', relatedQueryIds: ['q2','q8'] },
  { id: 'h19', label: 'gRPC', category: 'tech', confidence: 'mid', enabled: false, justification: 'Связан с Go-стеком.', expectedVolume: '~600', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q2'] },
  { id: 'h20', label: 'Microservices', category: 'tech', confidence: 'experimental', enabled: false, justification: 'Слишком общий термин.', expectedVolume: '~5000', falsePositiveRisk: 'Высокий', relatedQueryIds: ['q17'] },
  // География
  { id: 'h21', label: 'Москва', category: 'geo', confidence: 'high', enabled: true, justification: 'Основной рынок, R&D-центры доноров.', expectedVolume: '~70% базы', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q1','q3','q12'] },
  { id: 'h22', label: 'Санкт-Петербург', category: 'geo', confidence: 'high', enabled: true, justification: 'Второй по объёму, R&D VK/Яндекс.', expectedVolume: '~15% базы', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q1','q12'] },
  { id: 'h23', label: 'Минск', category: 'geo', confidence: 'mid', enabled: false, justification: 'Релокационный коридор, R&D Ozon/EPAM.', expectedVolume: '~5% базы', falsePositiveRisk: 'Средний: визовые вопросы', relatedQueryIds: ['q17'] },
  { id: 'h24', label: 'Екатеринбург', category: 'geo', confidence: 'mid', enabled: false, justification: 'R&D Контур/Selectel, переносимая школа.', expectedVolume: '~3% базы', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q17'] },
  { id: 'h25', label: 'Казань', category: 'geo', confidence: 'low' as Confidence, enabled: false, justification: 'Растущий хаб, R&D Ozon.', expectedVolume: '~2% базы', falsePositiveRisk: 'Низкий', relatedQueryIds: [] },
  // Косвенные сигналы
  { id: 'h26', label: 'Highload++ (докладчик)', category: 'indirect', confidence: 'mid', enabled: false, justification: 'Признак экспертизы в highload.', expectedVolume: '~200', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q15'] },
  { id: 'h27', label: 'GopherCon Russia', category: 'indirect', confidence: 'mid', enabled: false, justification: 'Профильная конференция по Go.', expectedVolume: '~150', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q15'] },
  { id: 'h28', label: 'ОС GO contributor', category: 'indirect', confidence: 'experimental', enabled: false, justification: 'Open-source, сильный сигнал.', expectedVolume: '~80', falsePositiveRisk: 'Низкий, но малый объём', relatedQueryIds: ['q7','q8'] },
  { id: 'h29', label: 'Сертификация CNCF', category: 'indirect', confidence: 'experimental', enabled: false, justification: 'Kubernetes-сертификаты.', expectedVolume: '~120', falsePositiveRisk: 'Средний: DevOps', relatedQueryIds: ['q7'] },
  { id: 'h30', label: 'Бывшие коллеги нанятых', category: 'indirect', confidence: 'mid', enabled: false, justification: 'Рефералы — самый тёплый канал.', expectedVolume: '~60', falsePositiveRisk: 'Низкий', relatedQueryIds: [] },
  { id: 'h31', label: 'Kotlin', category: 'tech', confidence: 'experimental', enabled: false, justification: 'Соседний стек, переносимый опыт.', expectedVolume: '~1100', falsePositiveRisk: 'Высокий: много Android', relatedQueryIds: ['q16','q18'] },
  { id: 'h32', label: 'Senior Go Developer', category: 'titles', confidence: 'high', enabled: true, justification: 'Комбинация грейд+язык.', expectedVolume: '~700', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q2','q7'] },
  { id: 'h33', label: 'Lead Developer (Go)', category: 'titles', confidence: 'mid', enabled: false, justification: 'Соседняя роль.', expectedVolume: '~250', falsePositiveRisk: 'Средний', relatedQueryIds: ['q16'] },
  { id: 'h34', label: 'Cloud Engineer', category: 'titles', confidence: 'experimental', enabled: false, justification: 'Соседняя роль для перехода.', expectedVolume: '~600', falsePositiveRisk: 'Высокий: много DevOps', relatedQueryIds: ['q18'] },
  { id: 'h35', label: 'ClickHouse', category: 'tech', confidence: 'mid', enabled: false, justification: 'Часть дата-инфраструктуры доноров.', expectedVolume: '~500', falsePositiveRisk: 'Средний: аналитики', relatedQueryIds: ['q2'] },
  { id: 'h36', label: 'Avito', category: 'companies', confidence: 'high', enabled: true, justification: 'Прямой донор.', expectedVolume: '~180', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4','q5'] },
  { id: 'h37', label: 'Контур', category: 'companies', confidence: 'mid', enabled: false, justification: 'Смежный донор.', expectedVolume: '~120', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  { id: 'h38', label: 'Тензор (СБИС)', category: 'companies', confidence: 'mid', enabled: false, justification: 'Продуктовый аналог.', expectedVolume: '~80', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  { id: 'h39', label: 'Циан', category: 'companies', confidence: 'mid', enabled: false, justification: 'Продуктовый аналог.', expectedVolume: '~70', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  { id: 'h40', label: 'Selectel', category: 'companies', confidence: 'mid', enabled: false, justification: 'Смежный донор.', expectedVolume: '~90', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  { id: 'h41', label: 'удалёнка (remote)', category: 'geo', confidence: 'high', enabled: true, justification: 'Часовые пояса для удалёнки.', expectedVolume: '~30% базы', falsePositiveRisk: 'Средний: разные часовые пояса', relatedQueryIds: ['q1','q17'] },
  { id: 'h42', label: 'C++ (background)', category: 'tech', confidence: 'experimental', enabled: false, justification: 'Уходцы из Яндекса часто с C++-бэкграундом.', expectedVolume: '~900', falsePositiveRisk: 'Высокий', relatedQueryIds: ['q18'] },
  { id: 'h43', label: 'DevOps-инженер (переход)', category: 'titles', confidence: 'experimental', enabled: false, justification: 'Соседняя роль, реалистичен переход.', expectedVolume: '~400', falsePositiveRisk: 'Высокий', relatedQueryIds: ['q18'] },
  { id: 'h44', label: 'System Analyst (переход)', category: 'titles', confidence: 'experimental', enabled: false, justification: 'Соседняя роль.', expectedVolume: '~350', falsePositiveRisk: 'Высокий', relatedQueryIds: [] },
  { id: 'h45', label: 'EPAM', category: 'companies', confidence: 'mid', enabled: false, justification: 'Аутсорс, релоцируемость.', expectedVolume: '~200', falsePositiveRisk: 'Средний', relatedQueryIds: ['q4'] },
  { id: 'h46', label: '2ГИС', category: 'companies', confidence: 'mid', enabled: false, justification: 'Смежный донор.', expectedVolume: '~60', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
  { id: 'h47', label: 'Лаборатория Касперского', category: 'companies', confidence: 'mid', enabled: false, justification: 'Продуктовый аналог.', expectedVolume: '~70', falsePositiveRisk: 'Низкий', relatedQueryIds: ['q4'] },
])

// ── Мок-данные: анти-карта ──────────────────────────────────────
const antiMap = ref<AntiMapItem[]>([
  { id: 'a1', kind: 'company', label: 'СберТех', reason: 'Договорённость о неперемании (non-poach)', source: 'manual' },
  { id: 'a2', kind: 'company', label: 'Газпром нефть (IT)', reason: 'Заведомо неподъёмные зарплатные ожидания', source: 'ats' },
  { id: 'a3', kind: 'role', label: '«Разработчик» без уточнения', reason: 'Омоним: даёт 80% шума (1С, фронт, мобайл)', source: 'ats' },
  { id: 'a4', kind: 'role', label: '«Инженер»', reason: 'Омоним: слишком широко, от промавтоматики до IT', source: 'manual' },
  { id: 'a5', kind: 'segment', label: 'Мигранты без релокации в РФ', reason: 'Визовые ограничения, исторически низкая доля дожития', source: 'ats' },
  { id: 'a6', kind: 'segment', label: 'C++-разработчики без опыта Go', reason: 'Долгий онбординг, нецелевой переход', source: 'manual' },
  { id: 'a7', kind: 'company', label: 'Ростелеком (ряд юнитов)', reason: 'Репутация: нестабильные процессы', source: 'ats' },
  { id: 'a8', kind: 'role', label: '«Junior Go»', reason: 'Ниже целевого грейда', source: 'manual' },
])

// ── Мок-данные: ёмкость рынка ───────────────────────────────────
const capacity = ref<{ total: number, segments: CapacitySegment[] }>({
  total: 4200,
  segments: [
    { label: 'Просмотрено', value: 980, tone: 'high' },
    { label: 'В работе', value: 340, tone: 'mid' },
    { label: 'Не тронуто', value: 2880, tone: 'low' },
  ],
})

// ── Мок-данные: план действий ───────────────────────────────────
const plan = ref<ActionStep[]>([
  { id: 'p1', day: 1, title: 'Запустить ядро-запросы (1–3)', detail: 'Начать со строгих запросов по LinkedIn: роль + стек + гео. Это даст самую релевантную выдачу.', done: false, branchIfEmpty: 'Если 0 результатов — ослабить гео или убрать senior-фильтр' },
  { id: 'p2', day: 1, title: 'Пройти доноров (4–5)', detail: 'Точечный заход по списку компаний-доноров. Самый тёплый канал после ядра.', done: false, branchIfEmpty: 'Если молчат — переходи к блоку 6 (продукты)' },
  { id: 'p3', day: 1, title: 'GitHub-разведка (7–9)', detail: 'Активные контрибьюторы на Go/Kubernetes — сильный сигнал экспертизы.', done: false },
  { id: 'p4', day: 2, title: 'hh.ru и резюме-поиск (10–12)', detail: 'Открытые резюме и filetype:pdf по вебу. Пополняет пассивный пул.', done: false, branchIfEmpty: 'Если пусто — проверь синтаксис, особенно кавычки' },
  { id: 'p5', day: 2, title: 'Сообщества и конференции (14–15)', detail: 'Профильные Telegram-чаты и докладчики — для тёплого аутрича.', done: false },
  { id: 'p6', day: 3, title: 'Широкий и экспериментальный (17–18)', detail: 'Переходить только если ядро и доноры дали мало. Высокий риск шума.', done: false, branchIfEmpty: 'Если и здесь пусто — пересборка карты с расширенными гипотезами' },
])

// ── Определения 18 запросов (база) ──────────────────────────────
const QUERY_DEFS: QueryDef[] = [
  { id: 'q1', seq: 1, type: 'core', platform: 'linkedin', purpose: 'Ядро: роль + стек + гео (строгий)', base: 'site:linkedin.com/in ("Senior Backend Developer" OR "Senior Go Developer") ("Go" OR "Golang") ("Kubernetes" OR "K8s") ("Москва" OR "Moscow") -inurl:dir -jobs -вакансия -резюме -курсы -intitle:profiles' },
  { id: 'q2', seq: 2, type: 'core', platform: 'linkedin', purpose: 'Ядро: роль + стек (средняя жёсткость)', base: 'site:linkedin.com/in ("Backend Developer" OR "Golang Developer") ("Go" OR "Golang") "Kubernetes" -inurl:dir -jobs -вакансия -курсы' },
  { id: 'q3', seq: 3, type: 'core', platform: 'linkedin', purpose: 'Ядро: русскоязычный вариант', base: 'site:linkedin.com/in ("Разработчик бэкенда" OR "Серверный разработчик") ("Go" OR "Golang") "Москва" -inurl:dir -jobs -вакансия' },
  { id: 'q4', seq: 4, type: 'donor', platform: 'linkedin', purpose: 'По донорам: точечно (прямые конкуренты)', base: 'site:linkedin.com/in ("Тинькофф" OR "Tinkoff" OR "Avito" OR "Авито") ("Go" OR "Golang") -inurl:dir -jobs -вакансия' },
  { id: 'q5', seq: 5, type: 'donor', platform: 'linkedin', purpose: 'По донорам: кузницы', base: 'site:linkedin.com/in ("Ozon" OR "Яндекс" OR "Yandex" OR "VK") ("Go" OR "Golang") ("Kubernetes") -inurl:dir -jobs -вакансия' },
  { id: 'q6', seq: 6, type: 'product', platform: 'linkedin', purpose: 'По названиям продуктов', base: 'site:linkedin.com/in ("Тинькофф Бизнес" OR "Avito Pay" OR "Yandex Cloud" OR "Ozon FBO") ("Go" OR "Backend") -inurl:dir -jobs -вакансия' },
  { id: 'q7', seq: 7, type: 'profile', platform: 'github', purpose: 'GitHub: локация + язык + активность', base: 'site:github.com "Go" location:Москва OR location:Moscow followers:>5 repos:>10 -inurl:stars -inurl:forks' },
  { id: 'q8', seq: 8, type: 'profile', platform: 'github', purpose: 'GitHub: контрибьюторы Go/K8s', base: 'site:github.com "kubernetes" OR "golang" "contributor" location:Россия OR location:Russia -inurl:stars' },
  { id: 'q9', seq: 9, type: 'resume', platform: 'github', purpose: 'GitHub: резюме', base: 'site:github.com intitle:резюме OR intitle:cv OR intitle:resume "Go" OR "Golang" "Москва"' },
  { id: 'q10', seq: 10, type: 'profile', platform: 'habr', purpose: 'Habr Career: профили (с отсечением служебного)', base: 'site:career.habr.com "Go" OR "Golang" "Москва" -inurl:vacancies -inurl:companies' },
  { id: 'q11', seq: 11, type: 'profile', platform: 'habr', purpose: 'Habr Career: расширенный', base: 'site:career.habr.com ("Backend" OR "бэкенд") ("Kubernetes" OR "Kafka") -inurl:vacancies' },
  { id: 'q12', seq: 12, type: 'resume', platform: 'hh', purpose: 'hh.ru: открытые резюме', base: 'site:hh.ru/resume "Go" OR "Golang" "Москва" "Backend" -vacancies' },
  { id: 'q13', seq: 13, type: 'resume', platform: 'web', purpose: 'Веб: PDF-резюме', base: 'filetype:pdf (резюме OR cv) "Go" OR "Golang" "Москва" "backend" -вакансия' },
  { id: 'q14', seq: 14, type: 'community', platform: 'telegram', purpose: 'Telegram/форумы: профильные', base: 'site:t.me "golang" OR "go-разработка" "Москва" OR "backend"' },
  { id: 'q15', seq: 15, type: 'conference', platform: 'events', purpose: 'Конференции: докладчики', base: '"Highload++" OR "GopherCon Russia" докладчик speaker "Go" OR "Golang"' },
  { id: 'q16', seq: 16, type: 'adjacent', platform: 'linkedin', purpose: 'Соседние роли: кандидаты на переход', base: 'site:linkedin.com/in ("Lead Developer" OR "Lead Backend") ("Go" OR "Kotlin") "Москва" -inurl:dir -jobs -вакансия' },
  { id: 'q17', seq: 17, type: 'broad', platform: 'web', purpose: 'Широкий: максимальный охват', base: '("Go developer" OR "Golang developer" OR "бэкенд разработчик Go") ("Москва" OR "Санкт-Петербург" OR "удалёнка") -вакансия -jobs' },
  { id: 'q18', seq: 18, type: 'experimental', platform: 'web', purpose: 'Экспериментальный: неочевидная гипотеза', base: '("C++" OR "Rust") ("переход в Go" OR "migrating to Go" OR "learning Go") "Москва" -вакансия' },
]

// ── Построитель запросов: фильтрует по включённым гипотезам ─────
function buildQuery(def: QueryDef): string {
  const edited = editedQueries[def.id]
  if (edited != null) return edited
  // Базовая строка уже корректна; фильтрация гипотез меняет только «ядро» и
  // «донорские» запросы. Для мок-режима возвращаем базу как есть.
  return def.base
}

// Валидатор синтаксиса (простой, без блокировки)
interface ValidationIssue { message: string, severity: 'warn' | 'error' }
function validateQuery(q: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  // Парные кавычки
  const dq = (q.match(/"/g) || []).length
  if (dq % 2 !== 0) issues.push({ message: 'Нечётное число прямых кавычек', severity: 'error' })
  // Парные скобки
  let depth = 0
  for (const ch of q) { if (ch === '(') depth++; else if (ch === ')') depth-- }
  if (depth !== 0) issues.push({ message: 'Скобки не сбалансированы', severity: 'error' })
  // Заглавные операторы
  const lowerOps = q.match(/\b(and|or|not)\b/g)
  if (lowerOps) issues.push({ message: 'Операторы AND/OR/NOT только заглавными', severity: 'warn' })
  // Типографские кавычки
  if (/[“”«»]/.test(q)) issues.push({ message: 'Используй прямые кавычки, не типографские', severity: 'error' })
  // NOT вместо минуса (Google)
  if (/\bNOT\b/.test(q)) issues.push({ message: 'В Google исключение — минус, не NOT', severity: 'warn' })
  return issues
}

// ── Действия ────────────────────────────────────────────────────
function toggleSection(id: SectionId) {
  openSections.value[id] = !openSections.value[id]
}
function toggleHypothesis(id: string) {
  const h = hypotheses.value.find(x => x.id === id)
  if (h) h.enabled = !h.enabled
}
function excludeDonor(id: string) {
  const d = donors.value.find(x => x.id === id)
  if (d) d.excluded = true
}
function restoreDonor(id: string) {
  const d = donors.value.find(x => x.id === id)
  if (d) d.excluded = false
}
function startEditing(id: string) {
  editingQueryId.value = id
  if (editedQueries[id] == null) editedQueries[id] = QUERY_DEFS.find(q => q.id === id)?.base || ''
}
function commitEdit(id: string) {
  editingQueryId.value = null
}
function resetEdit(id: string) {
  delete editedQueries[id]
  editingQueryId.value = null
}
function markUsed(id: string) {
  queryUsed[id] = true
}
function setQueryResults(id: string, n: number) {
  queryResults[id] = n
}
function toggleStep(id: string) {
  const s = plan.value.find(x => x.id === id)
  if (s) s.done = !s.done
}
function generate(jobId: string, jobTitle: string) {
  state.value = 'generating'
  activeJobId.value = jobId
  activeJobTitle.value = jobTitle
  staleBanner.value = false
  // Сброс готовности секций
  ;(Object.keys(sectionReady.value) as SectionId[]).forEach(k => sectionReady.value[k] = false)
  // Каскадная «готовность»: секции открываются по порядку
  const order: SectionId[] = ['capacity', 'donors', 'hypotheses', 'queries', 'antimap', 'plan']
  order.forEach((sec, i) => {
    setTimeout(() => {
      sectionReady.value[sec] = true
      if (i === order.length - 1) {
        state.value = 'ready'
        lastGeneratedAt.value = Date.now()
      }
    }, (i + 1) * 600)
  })
}
function regenerate() {
  searchMapVersion.value++
  staleBanner.value = false
  generate(activeJobId.value, activeJobTitle.value)
}
function markStale() {
  staleBanner.value = true
  state.value = 'stale'
}
function copyQuery(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => undefined)
  return Promise.resolve()
}
function exportMarkdown(): string {
  let md = `# Карта поиска: ${activeJobTitle.value}\n\n`
  md += `_Версия ${searchMapVersion.value}. Сгенерирована ${new Date(lastGeneratedAt.value || Date.now()).toLocaleString('ru-RU')}_\n\n`
  md += `## Компании-доноры\n`
  donors.value.filter(d => !d.excluded).forEach(d => {
    md += `- **${d.name}** (${TIER_META[d.tier].label}): ${d.justification}\n`
    md += `  - Продукты: ${d.products.join(', ')}\n  - Стек: ${d.techStack.join(', ')}\n  - Гео: ${d.geography.join(', ')}\n`
  })
  md += `\n## Поисковые запросы\n`
  QUERY_DEFS.forEach(q => {
    md += `${q.seq}. ${q.purpose}\n\`\`\`\n${buildQuery(q)}\n\`\`\`\n\n`
  })
  md += `## Анти-карта\n`
  antiMap.value.forEach(a => { md += `- ${a.label}: ${a.reason}\n` })
  md += `\n## План действий\n`
  plan.value.forEach(p => { md += `- [${p.done ? 'x' : ' '}] День ${p.day}: ${p.title} — ${p.detail}\n` })
  return md
}
function exportDonorsCsv(): string {
  let csv = 'Компания,Тир,Обоснование,Продукты,Стек,Гео,Риск,Ожидаемый грейд\n'
  donors.value.filter(d => !d.excluded).forEach(d => {
    const row = [d.name, TIER_META[d.tier].label, d.justification, d.products.join('; '), d.techStack.join('; '), d.geography.join('; '), d.risk, d.expectedGrade]
    csv += row.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',') + '\n'
  })
  return csv
}

// ── Геттеры ─────────────────────────────────────────────────────
const visibleDonors = computed(() => donors.value.filter(d => !d.excluded))
const excludedDonors = computed(() => donors.value.filter(d => d.excluded))
const enabledHypotheses = computed(() => hypotheses.value.filter(h => h.enabled))
const hypothesisCountByCategory = computed(() => {
  const counts: Record<HypothesisCategory, number> = { titles: 0, companies: 0, tech: 0, geo: 0, indirect: 0 }
  hypotheses.value.forEach(h => { counts[h.category]++ })
  return counts
})
const doneSteps = computed(() => plan.value.filter(s => s.done).length)
const usedQueries = computed(() => QUERY_DEFS.filter(q => queryUsed[q.id]).length)
const totalDonorsFound = computed(() => visibleDonors.value.reduce((s, d) => s + d.foundCount, 0))
const totalDonorsResponses = computed(() => visibleDonors.value.reduce((s, d) => s + d.responseCount, 0))
const queries = computed(() => QUERY_DEFS)
const allQueriesText = computed(() => QUERY_DEFS.map(q => `${q.seq}. ${buildQuery(q)}`).join('\n\n'))

export function useSearchMap() {
  return {
    // состояние
    state, calibrated, searchEngine, activeJobId, activeJobTitle,
    lastGeneratedAt, staleBanner, searchMapVersion,
    openSections, sectionReady, SECTION_ORDER,
    editingQueryId, editedQueries, queryUsed, queryResults,
    // данные
    donors, hypotheses, antiMap, capacity, plan,
    // мета
    TIER_META, CONFIDENCE_META, CATEGORY_LABEL, PLATFORM_LABEL,
    // геттеры
    visibleDonors, excludedDonors, enabledHypotheses,
    hypothesisCountByCategory, doneSteps, usedQueries,
    totalDonorsFound, totalDonorsResponses, queries, allQueriesText,
    // функции-логика
    buildQuery, validateQuery,
    // действия
    toggleSection, toggleHypothesis, excludeDonor, restoreDonor,
    startEditing, commitEdit, resetEdit, markUsed, setQueryResults,
    toggleStep, generate, regenerate, markStale, copyQuery,
    exportMarkdown, exportDonorsCsv,
  }
}
