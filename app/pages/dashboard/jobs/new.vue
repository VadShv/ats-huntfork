<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Link2,
  ClipboardCopy,
  Rocket,
  FileEdit,
  ExternalLink,
  PartyPopper,
  Copy,
  Eye,
  Briefcase,
  FileText,
  MessageSquare,
  Brain,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  Lock,
  Upload,
  CircleHelp,
  Share2,
  Globe,
  Mail,
  Users,
  BarChart3,
  Hash,
  Megaphone,
  Building2,
  Search,
} from 'lucide-vue-next'
import { z } from 'zod'
import { slugifyKeyRu, validateCriterionName } from '~/utils/criteriaKey'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useSeoMeta({
  title: 'Создать вакансию',
  description: 'Создание новой вакансии',
})

const localePath = useLocalePath()
const { createJob } = useJobs()
const { track } = useTrack()
const toast = useToast()
const { t } = useI18n()

type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'file_upload'

type DraftQuestion = {
  id: string
  label: string
  type: QuestionType
  description?: string | null
  required: boolean
  options?: string[] | null
}

// Wizard state
const currentStep = ref<1 | 2 | 3 | 4>(1)
const steps = computed(() => [
  { id: 1, title: t('dashboard.jobs.new.step1Title'), description: t('dashboard.jobs.new.step1Desc') },
  { id: 2, title: t('dashboard.jobs.new.step2Title'), description: t('dashboard.jobs.new.step2Desc') },
  { id: 3, title: t('dashboard.jobs.new.step3Title'), description: t('dashboard.jobs.new.step3Desc') },
  { id: 4, title: t('dashboard.jobs.new.step4Title'), description: t('dashboard.jobs.new.step4Desc') },
])

// Step 1: Job details (API-supported fields)
const form = ref({
  title: '',
  description: '',
  location: '',
  type: 'full_time' as 'full_time' | 'part_time' | 'contract' | 'internship',
  experienceLevel: 'mid' as 'junior' | 'mid' | 'senior' | 'lead',
  remoteStatus: undefined as 'remote' | 'hybrid' | 'onsite' | undefined,
  pipelineId: undefined as string | undefined,
})

// Pipeline selector: fetch all non-archived pipelines for this org
const { data: pipelinesData } = useFetch('/api/pipelines', {
  query: { includeArchived: false },
  headers: useRequestHeaders(['cookie']),
})
const pipelines = computed(() => pipelinesData.value ?? [])

// Auto-select the default pipeline once data loads
watch(pipelines, (list) => {
  if (form.value.pipelineId) return // don't override a user selection
  const defaultPipeline = list.find((p: any) => p.isDefault) ?? list[0]
  if (defaultPipeline) form.value.pipelineId = defaultPipeline.id
}, { immediate: true })

// --- hh.ru: импорт вакансии по ссылке ---
const hhStatus = useFetch<{ configured: boolean, connected: boolean }>('/api/hh/status', {
  headers: useRequestHeaders(['cookie']),
  default: () => ({ configured: false, connected: false }),
})
const hhConnected = computed(() => hhStatus.data.value?.connected === true)
const hhUrlInput = ref('')
const hhImporting = ref(false)
const hhImportError = ref('')
const hhImported = ref<null | { id: string, url: string, title: string }>(null)

async function importFromHh() {
  hhImportError.value = ''
  const url = hhUrlInput.value.trim()
  if (!url) {
    hhImportError.value = 'Вставьте ссылку на вакансию hh.ru'
    return
  }
  hhImporting.value = true
  try {
    const parsed = await $fetch<{
      hhVacancyId: string
      hhVacancyUrl: string
      title: string
      description: string
      location: string
      type: 'full_time' | 'part_time' | 'contract' | 'internship'
      experienceLevel?: 'junior' | 'mid' | 'senior' | 'lead'
      remoteStatus?: 'remote' | 'hybrid' | 'onsite'
    }>('/api/hh/parse-vacancy', {
      method: 'POST',
      body: { url },
    })
    form.value.title = parsed.title || form.value.title
    form.value.description = parsed.description || form.value.description
    form.value.location = parsed.location || form.value.location
    form.value.type = parsed.type || form.value.type
    if (parsed.experienceLevel) form.value.experienceLevel = parsed.experienceLevel
    if (parsed.remoteStatus) form.value.remoteStatus = parsed.remoteStatus
    hhImported.value = {
      id: parsed.hhVacancyId,
      url: parsed.hhVacancyUrl,
      title: parsed.title,
    }
    toast.add({
      title: 'Вакансия импортирована',
      description: `«${parsed.title}» — данные подставлены в форму`,
      color: 'success',
    })
    track('hh_vacancy_imported')
  }
  catch (err: any) {
    const msg = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Не удалось загрузить вакансию'
    hhImportError.value = msg
  }
  finally {
    hhImporting.value = false
  }
}

function clearHhImport() {
  hhImported.value = null
  hhUrlInput.value = ''
  hhImportError.value = ''
}

// Step 2: Application form (client-only for now)
const applicationForm = ref({
  requireResume: true,
  requireCoverLetter: false,
  questions: [] as DraftQuestion[],
})

// Step 3: AI scoring criteria
type ScoringCriterionDraft = {
  key: string
  name: string
  description: string
  category: 'technical' | 'experience' | 'soft_skills' | 'education' | 'culture' | 'custom'
  maxScore: number
  weight: number
}
const scoringCriteria = ref<ScoringCriterionDraft[]>([])
const scoringMode = ref<'none' | 'premade' | 'ai' | 'custom'>('none')
const selectedTemplate = ref<'standard' | 'technical' | 'non_technical'>('standard')
const isGeneratingCriteria = ref(false)
const showCustomForm = ref(false)
const editingCriterion = ref<ScoringCriterionDraft | null>(null)
const autoScoreOnApply = ref(false)

const customCriterionForm = ref({
  key: '',
  name: '',
  description: '',
  category: 'custom' as ScoringCriterionDraft['category'],
  maxScore: 10,
  weight: 50,
})

const categoryLabels = computed<Record<string, string>>(() => ({
  technical: t('dashboard.jobs.new.categoryTechnical'),
  experience: t('dashboard.jobs.new.categoryExperience'),
  soft_skills: t('dashboard.jobs.new.categorySoftSkills'),
  education: t('dashboard.jobs.new.categoryEducation'),
  culture: t('dashboard.jobs.new.categoryCulture'),
  custom: t('dashboard.jobs.new.categoryCustom'),
}))

const categoryColorClasses: Record<string, string> = {
  technical: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800',
  experience: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/50 dark:text-purple-300 dark:ring-purple-800',
  soft_skills: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-800',
  education: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800',
  culture: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:ring-pink-800',
  custom: 'bg-surface-50 text-surface-700 ring-surface-200 dark:bg-surface-800/50 dark:text-surface-300 dark:ring-surface-700',
}

const premadeTemplates = computed<Record<string, ScoringCriterionDraft[]>>(() => ({
  standard: [
    { key: 'technical_skills', name: t('dashboard.jobs.new.tmplTechnicalSkillsName'), description: t('dashboard.jobs.new.tmplTechnicalSkillsDesc'), category: 'technical', maxScore: 10, weight: 50 },
    { key: 'relevant_experience', name: t('dashboard.jobs.new.tmplRelevantExperienceName'), description: t('dashboard.jobs.new.tmplRelevantExperienceDesc'), category: 'experience', maxScore: 10, weight: 50 },
    { key: 'education_fit', name: t('dashboard.jobs.new.tmplEducationFitName'), description: t('dashboard.jobs.new.tmplEducationFitDesc'), category: 'education', maxScore: 10, weight: 30 },
  ],
  technical: [
    { key: 'core_tech_stack', name: t('dashboard.jobs.new.tmplCoreTechStackName'), description: t('dashboard.jobs.new.tmplCoreTechStackDesc'), category: 'technical', maxScore: 10, weight: 70 },
    { key: 'system_design', name: t('dashboard.jobs.new.tmplSystemDesignName'), description: t('dashboard.jobs.new.tmplSystemDesignDesc'), category: 'technical', maxScore: 10, weight: 50 },
    { key: 'engineering_practices', name: t('dashboard.jobs.new.tmplEngineeringPracticesName'), description: t('dashboard.jobs.new.tmplEngineeringPracticesDesc'), category: 'technical', maxScore: 10, weight: 40 },
    { key: 'relevant_experience', name: t('dashboard.jobs.new.tmplRelevantExperienceName'), description: t('dashboard.jobs.new.tmplRelevantExperienceDescTech'), category: 'experience', maxScore: 10, weight: 50 },
    { key: 'leadership_collab', name: t('dashboard.jobs.new.tmplLeadershipCollabName'), description: t('dashboard.jobs.new.tmplLeadershipCollabDesc'), category: 'soft_skills', maxScore: 10, weight: 30 },
  ],
  non_technical: [
    { key: 'relevant_experience', name: t('dashboard.jobs.new.tmplRelevantExperienceName'), description: t('dashboard.jobs.new.tmplRelevantExperienceDescNonTech'), category: 'experience', maxScore: 10, weight: 60 },
    { key: 'communication', name: t('dashboard.jobs.new.tmplCommunicationName'), description: t('dashboard.jobs.new.tmplCommunicationDesc'), category: 'soft_skills', maxScore: 10, weight: 50 },
    { key: 'domain_knowledge', name: t('dashboard.jobs.new.tmplDomainKnowledgeName'), description: t('dashboard.jobs.new.tmplDomainKnowledgeDesc'), category: 'experience', maxScore: 10, weight: 40 },
    { key: 'education_fit', name: t('dashboard.jobs.new.tmplEducationFitName'), description: t('dashboard.jobs.new.tmplEducationFitDescNonTech'), category: 'education', maxScore: 10, weight: 30 },
    { key: 'culture_fit', name: t('dashboard.jobs.new.tmplCultureFitName'), description: t('dashboard.jobs.new.tmplCultureFitDesc'), category: 'culture', maxScore: 10, weight: 30 },
  ],
}))

async function loadPremadeCriteria(template: 'standard' | 'technical' | 'non_technical') {
  try {
    scoringCriteria.value = premadeTemplates.value[template] ?? []
    scoringMode.value = 'premade'
  } catch (err: any) {
    toast.error(t('dashboard.jobs.new.failedToLoadTemplate'), { message: err?.data?.statusMessage })
  }
}

async function generateAiCriteria() {
  if (!form.value.title) {
    toast.warning(t('dashboard.jobs.new.jobTitleRequired'), t('dashboard.jobs.new.jobTitleRequiredDesc'))
    return
  }
  if (!form.value.description) {
    toast.warning(t('dashboard.jobs.new.jobDescRequired'), t('dashboard.jobs.new.jobDescRequiredDesc'))
    return
  }
  isGeneratingCriteria.value = true
  try {
    const result = await $fetch('/api/ai-config/generate-criteria', {
      method: 'POST',
      body: {
        title: form.value.title,
        description: form.value.description,
      },
    })
    scoringCriteria.value = (result.criteria ?? []).map((c: any) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      category: c.category ?? 'custom',
      maxScore: c.maxScore ?? 10,
      weight: c.weight ?? 50,
    }))
    scoringMode.value = 'ai'
    toast.success(t('dashboard.jobs.new.criteriaGenerated'), `${scoringCriteria.value.length} ${t('dashboard.jobs.new.criteriaGeneratedDesc')}`)
  } catch (err: any) {
    const statusCode = err?.data?.statusCode ?? err?.statusCode
    const statusMessage = err?.data?.statusMessage ?? ''
    if (statusCode === 422 && statusMessage.includes('AI provider not configured')) {
      toast.add({
        type: 'warning',
        title: t('dashboard.jobs.new.aiProviderNotConfigured'),
        message: t('dashboard.jobs.new.aiProviderSetupFirst'),
        link: { label: t('dashboard.jobs.new.goToAiSettings'), href: '/dashboard/settings/ai' },
        duration: 10000,
      })
    } else {
      toast.error(t('dashboard.jobs.new.failedToGenerateCriteria'), {
        message: t('dashboard.jobs.new.failedToGenerateCriteriaDesc'),
        details: statusMessage || `${statusCode ?? t('dashboard.jobs.new.unknown')} ${t('dashboard.jobs.new.errorNoDetails')}`,
        statusCode,
      })
    }
  } finally {
    isGeneratingCriteria.value = false
  }
}

function addCustomCriterion() {
  const f = customCriterionForm.value
  const name = (f.name || '').trim()
  const v = validateCriterionName(name)
  if (!v.ok) {
    toast.warning(v.reason)
    return
  }

  const key = slugifyKeyRu(name, scoringCriteria.value.map(c => c.key))

  scoringCriteria.value.push({
    key,
    name,
    description: (f.description || '').trim(),
    category: f.category,
    maxScore: f.maxScore,
    weight: f.weight,
  })
  customCriterionForm.value = { key: '', name: '', description: '', category: 'custom', maxScore: 10, weight: 50 }
  showCustomForm.value = false
  if (scoringMode.value === 'none') scoringMode.value = 'custom'
}

function removeCriterion(key: string) {
  scoringCriteria.value = scoringCriteria.value.filter(c => c.key !== key)
}

const isSubmitting = ref(false)
const errors = ref<Record<string, string>>({})
const showAddForm = ref(false)
const editingQuestion = ref<DraftQuestion | null>(null)
const linkCopied = ref(false)
const questionActionError = ref<string | null>(null)
const nextQuestionId = ref(1)

// Check if at least one AI provider is configured with a valid API key.
// /api/ai-config returns an array of configurations now (multi-config era).
interface AiConfigCheckRow { hasApiKey: boolean }
const { data: aiConfigData } = useFetch<AiConfigCheckRow[]>('/api/ai-config', { key: 'ai-config-check', headers: useRequestHeaders(['cookie']) })
const isAiConfigured = computed(() => {
  return Array.isArray(aiConfigData.value) && aiConfigData.value.some((c) => c.hasApiKey)
})

// Auto-save to localStorage
const AUTO_SAVE_KEY = 'reqcore-job-draft'

function saveFormToStorage() {
  if (!import.meta.client) return
  try {
    const data = {
      form: form.value,
      applicationForm: applicationForm.value,
      scoringCriteria: scoringCriteria.value,
      scoringMode: scoringMode.value,
      autoScoreOnApply: autoScoreOnApply.value,
      currentStep: currentStep.value,
    }
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(data))
  } catch { /* storage full or unavailable */ }
}

function restoreFormFromStorage() {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw)
    if (data.form) Object.assign(form.value, data.form)
    if (data.applicationForm) Object.assign(applicationForm.value, data.applicationForm)
    if (data.scoringCriteria) scoringCriteria.value = data.scoringCriteria
    if (data.scoringMode) scoringMode.value = data.scoringMode
    if (data.autoScoreOnApply != null) autoScoreOnApply.value = data.autoScoreOnApply
    if (data.currentStep) currentStep.value = data.currentStep
  } catch { /* corrupted data, ignore */ }
}

function clearFormStorage() {
  if (!import.meta.client) return
  try { localStorage.removeItem(AUTO_SAVE_KEY) } catch { /* ignore */ }
}

onMounted(() => {
  restoreFormFromStorage()
})

// Reset all wizard state to initial values (called when user clicks "New Job" again)
function resetState() {
  currentStep.value = 1
  form.value = {
    title: '',
    description: '',
    location: '',
    type: 'full_time',
    experienceLevel: 'mid',
    remoteStatus: undefined,
    pipelineId: pipelines.value.find((p: any) => p.isDefault)?.id ?? pipelines.value[0]?.id ?? undefined,
  }
  applicationForm.value = {
    requireResume: true,
    requireCoverLetter: false,
    questions: [],
  }
  scoringCriteria.value = []
  scoringMode.value = 'none'
  autoScoreOnApply.value = false
  isPublished.value = false
  createdJobId.value = ''
  createdJobSlug.value = ''
  finalApplicationLink.value = ''
  errors.value = {}
  createdLinks.value = {}
  customBoardLinks.value = []
  clearFormStorage()
}

// Shared signal incremented by AppTopBar when the user is already on this page
const newJobResetSignal = useState('new-job-reset-signal', () => 0)
watch(newJobResetSignal, (next, prev) => {
  if (next > prev) resetState()
})

// Auto-save when step changes or form data changes
watch([currentStep, form, applicationForm, scoringCriteria, scoringMode, autoScoreOnApply], () => {
  saveFormToStorage()
}, { deep: true })

// Notify user when entering step 3 without AI configured
watch(currentStep, (step) => {
  if (step === 3 && !isAiConfigured.value) {
    toast.add({
      type: 'warning',
      title: t('dashboard.jobs.new.aiNotSetUp'),
      message: t('dashboard.jobs.new.aiNotSetUpDesc'),
      link: { label: t('dashboard.jobs.new.goToAiSettings'), href: '/dashboard/settings/ai' },
      duration: 10000,
    })
  }
})

// Step 4: Publish & Distribute
const publishChoice = ref<'publish' | 'draft'>('publish')
const isPublished = ref(false)
const createdJobSlug = ref('')
const createdJobId = ref('')
const finalApplicationLink = ref('')
const linkCopiedFinal = ref(false)

// Distribution channels for quick tracking link creation
const distributionChannels = [
  { channel: 'linkedin', name: 'LinkedIn', description: 'Опубликуйте в LinkedIn Jobs или поделитесь в ленте', category: 'job_board' },
  { channel: 'indeed', name: 'Indeed', description: 'Разместите на джоб-борде Indeed', category: 'job_board' },
  { channel: 'glassdoor', name: 'Glassdoor', description: 'Опубликуйте в вакансиях Glassdoor', category: 'job_board' },
  { channel: 'ziprecruiter', name: 'ZipRecruiter', description: 'Опубликуйте на ZipRecruiter', category: 'job_board' },
  { channel: 'email', name: 'Email-рассылка', description: 'Отправьте кандидатам или в список рассылки', category: 'outreach' },
  { channel: 'referral', name: 'Рекомендации сотрудников', description: 'Поделитесь внутри команды', category: 'outreach' },
  { channel: 'career_site', name: 'Карьерный сайт', description: 'Разместите на сайте вашей компании', category: 'outreach' },
  { channel: 'twitter', name: 'X (Twitter)', description: 'Поделитесь в своей ленте X', category: 'social' },
  { channel: 'facebook', name: 'Facebook', description: 'Опубликуйте на странице или в группах Facebook', category: 'social' },
  { channel: 'reddit', name: 'Reddit', description: 'Поделитесь в подходящих сабреддитах', category: 'social' },
] as const

const channelIcons: Record<string, any> = {
  linkedin: Briefcase,
  indeed: Search,
  glassdoor: Building2,
  ziprecruiter: Megaphone,
  email: Mail,
  referral: Users,
  career_site: Globe,
  twitter: Hash,
  facebook: Users,
  reddit: MessageSquare,
}

// Track created distribution links: channel → { code, url, loading, copied }
const createdLinks = ref<Record<string, { code: string; url: string; loading: boolean; copied: boolean }>>({})

async function createChannelLink(channel: string, channelName: string) {
  if (createdLinks.value[channel]?.code) return
  createdLinks.value[channel] = { code: '', url: '', loading: true, copied: false }
  try {
    const result = await $fetch<{ id: string; code: string }>('/api/tracking-links', {
      method: 'POST',
      body: {
        jobId: createdJobId.value,
        channel,
        name: `${form.value.title} — ${channelName}`,
      },
    })
    const base = `${requestUrl.protocol}//${requestUrl.host}`
    const trackUrl = `${base}/api/public/track/${encodeURIComponent(result.code)}`
    createdLinks.value[channel] = { code: result.code, url: trackUrl, loading: false, copied: false }
    track('tracking_link_created', { channel, source: 'job_wizard' })
  } catch {
    delete createdLinks.value[channel]
    toast.error(t('dashboard.jobs.new.failedToCreateTrackingLink', { name: channelName }))
  }
}

async function copyChannelLink(channel: string) {
  const link = createdLinks.value[channel]
  if (!link?.url) return
  try {
    await navigator.clipboard.writeText(link.url)
    link.copied = true
    setTimeout(() => { link.copied = false }, 2500)
  } catch {
    toast.info(link.url)
  }
}

const createdLinkCount = computed(() =>
  Object.values(createdLinks.value).filter(l => l.code).length + customBoardLinks.value.length
)

// Custom job board links
const customBoardName = ref('')
const customBoardLinks = ref<Array<{ id: string; name: string; channel: string; code: string; url: string; copied: boolean }>>([])
const isCreatingCustomBoard = ref(false)

async function createCustomBoardLink() {
  const name = customBoardName.value.trim()
  if (!name) return
  // Use a slug derived from the custom board name for local dedup only
  const dedupeKey = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}`

  // Prevent duplicates
  if (customBoardLinks.value.some(l => l.channel === dedupeKey)) {
    toast.warning(t('dashboard.jobs.new.duplicateBoard'), t('dashboard.jobs.new.duplicateBoardDesc', { name }))
    return
  }

  isCreatingCustomBoard.value = true
  try {
    const result = await $fetch<{ id: string; code: string }>('/api/tracking-links', {
      method: 'POST',
      body: {
        jobId: createdJobId.value,
        channel: 'custom',
        name: `${form.value.title} — ${name}`,
      },
    })
    const base = `${requestUrl.protocol}//${requestUrl.host}`
    const trackUrl = `${base}/api/public/track/${encodeURIComponent(result.code)}`
    customBoardLinks.value.push({ id: result.id, name, channel: dedupeKey, code: result.code, url: trackUrl, copied: false })
    customBoardName.value = ''
    track('tracking_link_created', { channel: 'custom', customName: name, source: 'job_wizard_custom' })
  } catch {
    toast.error(t('dashboard.jobs.new.failedToCreateTrackingLink', { name }))
  } finally {
    isCreatingCustomBoard.value = false
  }
}

async function copyCustomBoardLink(index: number) {
  const link = customBoardLinks.value[index]
  if (!link?.url) return
  try {
    await navigator.clipboard.writeText(link.url)
    link.copied = true
    setTimeout(() => { link.copied = false }, 2500)
  } catch {
    toast.info(link.url)
  }
}

// Validation (only Step 1 is required to submit)
const formSchema = z.object({
  title: z
    .string()
    .min(1, t('dashboard.jobs.new.validationTitleRequired'))
    .max(200, t('dashboard.jobs.new.validationTitleMax')),
  description: z.string().optional(),
  location: z.string().optional(),
  type: z.enum(['full_time', 'part_time', 'contract', 'internship']),
})

function validateStep1(): boolean {
  const result = formSchema.safeParse(form.value)
  if (!result.success) {
    errors.value = {}
    for (const issue of result.error.issues) {
      const field = issue.path[0]?.toString()
      if (field) errors.value[field] = issue.message
    }
    return false
  }
  errors.value = {}
  return true
}

// Pure check with no side-effects so it never populates errors on its own
const isStep1Valid = computed(() => formSchema.safeParse(form.value).success)

const canGoNext = computed(() => {
  if (currentStep.value === 1) return isStep1Valid.value
  return true
})

function goToStep(step: 1 | 2 | 3 | 4) {
  if (step === currentStep.value) return
  // Validate step 1 before leaving it
  if (currentStep.value === 1 && step > 1 && !validateStep1()) return
  currentStep.value = step
}

function nextStep() {
  if (currentStep.value < 4) {
    if (currentStep.value === 1 && !validateStep1()) return
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--
}

function handleAddQuestion(data: {
  label: string
  type: string
  description?: string
  required: boolean
  options?: string[]
}) {
  applicationForm.value.questions.push({
    id: `draft-${nextQuestionId.value++}`,
    label: data.label,
    type: data.type as QuestionType,
    description: data.description ?? null,
    required: data.required,
    options: data.options ?? null,
  })
  showAddForm.value = false
  questionActionError.value = null
}

function handleUpdateQuestion(data: {
  label: string
  type: string
  description?: string
  required: boolean
  options?: string[]
}) {
  if (!editingQuestion.value) return

  const index = applicationForm.value.questions.findIndex((q) => q.id === editingQuestion.value?.id)
  if (index === -1) return

  const existingQuestion = applicationForm.value.questions[index]
  if (!existingQuestion) return

  applicationForm.value.questions[index] = {
    id: existingQuestion.id,
    label: data.label,
    type: data.type as QuestionType,
    description: data.description ?? null,
    required: data.required,
    options: data.options ?? null,
  }
  editingQuestion.value = null
  questionActionError.value = null
}

function handleDeleteQuestion(questionId: string) {
  const index = applicationForm.value.questions.findIndex((q) => q.id === questionId)
  if (index === -1) return
  applicationForm.value.questions.splice(index, 1)
  if (editingQuestion.value?.id === questionId) {
    editingQuestion.value = null
  }
  questionActionError.value = null
}

function moveQuestion(index: number, direction: 'up' | 'down') {
  const list = applicationForm.value.questions
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= list.length) return
  ;[list[index], list[targetIndex]] = [list[targetIndex]!, list[index]!]
}

function slugifyTitle(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

const requestUrl = useRequestURL()
const applicationLink = computed(() => {
  const base = `${requestUrl.protocol}//${requestUrl.host}`
  const slugBase = slugifyTitle(form.value.title) || 'new-job'
  return `${base}/jobs/${slugBase}-xxxxxxxx/apply`
})

async function copyApplicationLink() {
  try {
    await navigator.clipboard.writeText(applicationLink.value)
    linkCopied.value = true
    setTimeout(() => {
      linkCopied.value = false
    }, 2000)
  } catch {
    // ignore clipboard issues silently
  }
}

async function handleSubmit(mode: 'publish' | 'draft' = publishChoice.value) {
  // Ensure step 1 is valid before submit
  if (!validateStep1()) {
    currentStep.value = 1
    return
  }

  isSubmitting.value = true
  try {
    const created = await createJob({
      title: form.value.title,
      description: form.value.description || undefined,
      location: form.value.location || undefined,
      type: form.value.type,
      experienceLevel: form.value.experienceLevel || undefined,
      remoteStatus: form.value.remoteStatus || undefined,
      requireResume: applicationForm.value.requireResume,
      requireCoverLetter: applicationForm.value.requireCoverLetter,
      autoScoreOnApply: autoScoreOnApply.value,
      pipelineId: form.value.pipelineId || undefined,
    })

    track('job_created')

    // Связываем вакансию с hh.ru, если была импортирована из hh
    if (hhImported.value && created?.id) {
      try {
        await $fetch('/api/hh/link-vacancy', {
          method: 'POST',
          body: {
            jobId: created.id,
            hhVacancyId: hhImported.value.id,
            hhVacancyUrl: hhImported.value.url,
            hhVacancyTitle: hhImported.value.title,
          },
        })
        track('hh_vacancy_linked')
      } catch (e) {
        // Неблокирующая ошибка: вакансия создана, связь можно добавить позже
        console.error('Failed to link hh vacancy', e)
      }
    }

    if (applicationForm.value.questions.length > 0 && created?.id) {
      await Promise.all(
        applicationForm.value.questions.map((question, index) => (
          $fetch(`/api/jobs/${created.id}/questions`, {
            method: 'POST',
            body: {
              label: question.label,
              type: question.type,
              description: question.description || undefined,
              required: question.required,
              options: question.options || undefined,
              displayOrder: index,
            },
          })
        )),
      )
    }

    // Save scoring criteria if any were configured
    if (scoringCriteria.value.length > 0 && created?.id) {
      try {
        await $fetch(`/api/jobs/${created.id}/criteria`, {
          method: 'POST',
          body: {
            criteria: scoringCriteria.value.map((c, i) => ({
              key: c.key,
              name: c.name,
              description: c.description || undefined,
              category: c.category,
              maxScore: c.maxScore,
              weight: c.weight,
              displayOrder: i,
            })),
          },
        })
      } catch {
        // Non-blocking: criteria can be added later from job settings
      }
    }

    if (mode === 'publish' && created?.id) {
      // Publish the job immediately
      await $fetch(`/api/jobs/${created.id}`, {
        method: 'PATCH',
        body: { status: 'open' },
      })

      // Build the real application link
      const base = `${requestUrl.protocol}//${requestUrl.host}`
      const slug = created.slug || created.id
      finalApplicationLink.value = `${base}/jobs/${slug}/apply`
      createdJobSlug.value = slug
      createdJobId.value = created.id

      track('job_published')

      // Auto-copy to clipboard
      try {
        await navigator.clipboard.writeText(finalApplicationLink.value)
        linkCopiedFinal.value = true
        setTimeout(() => { linkCopiedFinal.value = false }, 3000)
      } catch {
        // Clipboard may not be available
      }

      isPublished.value = true
    } else {
      // Saved as draft — go to jobs list
      await navigateTo(localePath('/dashboard/jobs'))
    }
    clearFormStorage()
  } catch (err: any) {
    const statusMessage = err?.data?.statusMessage ?? t('dashboard.jobs.new.somethingWentWrong')
    toast.error(t('dashboard.jobs.new.failedToCreateJob'), {
      message: statusMessage,
      statusCode: err?.data?.statusCode,
    })
  } finally {
    isSubmitting.value = false
  }
}

async function copyFinalLink() {
  try {
    await navigator.clipboard.writeText(finalApplicationLink.value)
    linkCopiedFinal.value = true
    setTimeout(() => { linkCopiedFinal.value = false }, 3000)
  } catch {
    // fallback: show the link so the user can copy manually
    toast.info(finalApplicationLink.value)
  }
}

const typeOptions = computed(() => [
  { value: 'full_time', label: t('dashboard.jobs.new.typeFullTime') },
  { value: 'part_time', label: t('dashboard.jobs.new.typePartTime') },
  { value: 'contract', label: t('dashboard.jobs.new.typeContract') },
  { value: 'internship', label: t('dashboard.jobs.new.typeInternship') },
])

const questionTypeLabels = computed<Record<QuestionType, string>>(() => ({
  short_text: t('dashboard.jobs.new.qtShortText'),
  long_text: t('dashboard.jobs.new.qtLongText'),
  single_select: t('dashboard.jobs.new.qtSingleSelect'),
  multi_select: t('dashboard.jobs.new.qtMultiSelect'),
  number: t('dashboard.jobs.new.qtNumber'),
  date: t('dashboard.jobs.new.qtDate'),
  url: t('dashboard.jobs.new.qtUrl'),
  checkbox: t('dashboard.jobs.new.qtCheckbox'),
  file_upload: t('dashboard.jobs.new.qtFileUpload'),
}))
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8">
    <!-- Header with top actions -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div>
        <NuxtLink
          :to="$localePath('/dashboard/jobs')"
          class="inline-flex items-center gap-1 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 mb-2 transition-colors"
        >
          <ArrowLeft class="size-4" />
          {{ t('dashboard.jobs.new.backToJobs') }}
        </NuxtLink>
        <h1 class="text-3xl font-bold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.pageTitle') }}</h1>
      </div>
      <div v-if="!isPublished" class="flex items-center gap-3">
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
          @click="handleSubmit('draft')"
          :disabled="isSubmitting"
        >
          {{ t('dashboard.jobs.new.saveDraft') }}
        </button>
        <button
          v-if="currentStep < 4"
          type="button"
          :disabled="!canGoNext"
          @click="nextStep"
          class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {{ t('dashboard.jobs.new.saveContinue') }}
        </button>
      </div>
    </div>

    <!-- Stepper -->
    <div class="mb-10">
      <ol class="flex items-center w-full gap-2">
        <li
          v-for="(step, idx) in steps"
          :key="step.id"
          class="flex items-center flex-1 min-w-0 cursor-pointer"
          @click="goToStep(step.id as typeof currentStep)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="flex items-center justify-center size-7 rounded-full border text-xs font-medium shrink-0 transition-all"
              :class="[
                currentStep === step.id
                  ? 'bg-brand-600 text-white border-brand-600 ring-2 ring-brand-100 dark:ring-brand-950'
                  : currentStep > step.id
                    ? 'bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 border-brand-200 dark:border-brand-800'
                    : 'bg-white dark:bg-surface-900 text-surface-400 dark:text-surface-500 border-surface-200 dark:border-surface-800'
              ]"
            >
              <span v-if="currentStep > step.id" class="text-xs">&#10003;</span>
              <span v-else>{{ step.id }}</span>
            </div>
            <span
              class="text-xs font-medium truncate hidden sm:inline"
              :class="currentStep >= step.id ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 dark:text-surface-500'"
            >
              {{ step.title }}
            </span>
          </div>
          <div
            v-if="idx < steps.length - 1"
            class="flex-1 h-0.5 mx-2 rounded-full transition-colors"
            :class="currentStep > step.id ? 'bg-brand-600' : 'bg-surface-200 dark:bg-surface-800'"
          />
        </li>
      </ol>
    </div>

    <!-- Main Layout: Form + Tips -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Left side: Form -->
      <div class="lg:col-span-8 space-y-6">

        <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 shadow-sm overflow-hidden">
          <form @submit.prevent="() => handleSubmit()" class="p-6 md:p-8">
            <!-- Step 1: Job details -->
            <section v-if="currentStep === 1" class="space-y-10">

              <!-- hh.ru import block -->
              <div v-if="hhConnected" class="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50/60 dark:bg-brand-950/30 p-5">
                <div class="flex items-start gap-3 mb-3">
                  <div class="flex-shrink-0 w-9 h-9 rounded-lg bg-brand-100 dark:bg-brand-900 flex items-center justify-center">
                    <Link2 class="w-5 h-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div class="flex-1">
                    <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Импорт с hh.ru</h3>
                    <p class="text-xs text-surface-600 dark:text-surface-400 mt-0.5">Вставьте ссылку на вакансию — поля ниже заполнятся автоматически. После создания вакансии отклики будут подтягиваться автоматически.</p>
                  </div>
                </div>
                <div v-if="!hhImported" class="flex flex-col sm:flex-row gap-2">
                  <input
                    v-model="hhUrlInput"
                    type="url"
                    placeholder="https://hh.ru/vacancy/12345678"
                    class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    :disabled="hhImporting"
                    @keydown.enter.prevent="importFromHh"
                  />
                  <button
                    type="button"
                    class="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    :disabled="hhImporting || !hhUrlInput.trim()"
                    @click="importFromHh"
                  >
                    <Loader2 v-if="hhImporting" class="w-4 h-4 animate-spin" />
                    <Upload v-else class="w-4 h-4" />
                    {{ hhImporting ? 'Загружаем…' : 'Загрузить с hh.ru' }}
                  </button>
                </div>
                <div v-else class="flex items-start gap-2 rounded-lg bg-success-50 dark:bg-success-950/40 border border-success-200 dark:border-success-800 px-3 py-2.5">
                  <Check class="w-4 h-4 text-success-600 dark:text-success-400 flex-shrink-0 mt-0.5" />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-surface-900 dark:text-surface-100">Связано с hh.ru вакансией #{{ hhImported.id }}</p>
                    <a :href="hhImported.url" target="_blank" rel="noopener noreferrer" class="text-xs text-brand-600 dark:text-brand-400 hover:underline inline-flex items-center gap-1">
                      Открыть на hh.ru
                      <ExternalLink class="w-3 h-3" />
                    </a>
                  </div>
                  <button type="button" class="text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 underline" @click="clearHhImport">Отвязать</button>
                </div>
                <p v-if="hhImportError" class="mt-2 text-xs text-danger-600 dark:text-danger-400 font-medium">{{ hhImportError }}</p>
              </div>

              <!-- Section: Job title and department -->
              <div class="space-y-6">
                <div>
                  <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionJobTitle') }}</h2>
                  <label for="title" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    {{ t('dashboard.jobs.new.labelJobTitle') }} <span class="text-danger-500">*</span>
                  </label>
                  <input
                    id="title"
                    v-model="form.title"
                    type="text"
                    :placeholder="t('dashboard.jobs.new.placeholderJobTitle')"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    :class="errors.title ? 'border-danger-300 ring-1 ring-danger-100' : 'border-surface-300 dark:border-surface-700'"
                    @blur="validateStep1"
                  />
                  <p v-if="errors.title" class="mt-1.5 text-xs text-danger-600 dark:text-danger-400 font-medium">{{ errors.title }}</p>
                  <p v-else class="mt-1.5 text-xs text-surface-500">{{ t('dashboard.jobs.new.titleHint') }}</p>
                </div>
              </div>

              <!-- Section: Location -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionLocation') }}</h2>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="location" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      {{ t('dashboard.jobs.new.labelOfficeLocation') }}
                    </label>
                    <input
                      id="location"
                      v-model="form.location"
                      type="text"
                      :placeholder="t('dashboard.jobs.new.placeholderLocation')"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors border-surface-300 dark:border-surface-700"
                    />
                  </div>
                  <div>
                    <label for="type" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                      {{ t('dashboard.jobs.new.labelWorkplaceType') }}
                    </label>
                    <select
                      id="type"
                      v-model="form.type"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors bg-white dark:bg-surface-900 border-surface-300 dark:border-surface-700"
                    >
                      <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section: Experience & Remote -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionDetails') }}</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label for="experienceLevel" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">{{ t('dashboard.jobs.new.labelExperienceLevel') }}</label>
                    <select
                      id="experienceLevel"
                      v-model="form.experienceLevel"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    >
                      <option value="junior">{{ t('dashboard.jobs.new.expJunior') }}</option>
                      <option value="mid">{{ t('dashboard.jobs.new.expMid') }}</option>
                      <option value="senior">{{ t('dashboard.jobs.new.expSenior') }}</option>
                      <option value="lead">{{ t('dashboard.jobs.new.expLead') }}</option>
                    </select>
                  </div>
                  <div>
                    <label for="remoteStatus" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">{{ t('dashboard.jobs.new.labelRemoteStatus') }}</label>
                    <select
                      id="remoteStatus"
                      v-model="form.remoteStatus"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                    >
                      <option :value="undefined">{{ t('dashboard.jobs.new.remoteNotSpecified') }}</option>
                      <option value="remote">{{ t('dashboard.jobs.new.remoteRemote') }}</option>
                      <option value="hybrid">{{ t('dashboard.jobs.new.remoteHybrid') }}</option>
                      <option value="onsite">{{ t('dashboard.jobs.new.remoteOnsite') }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section: Pipeline -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.form.pipelineLabel') }}</h2>
                <div>
                  <label for="pipelineId" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    {{ t('dashboard.jobs.form.pipelineLabel') }}
                  </label>
                  <select
                    id="pipelineId"
                    v-model="form.pipelineId"
                    class="w-full rounded-lg border px-3 py-2.5 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 border-surface-300 dark:border-surface-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors"
                  >
                    <option :value="undefined" disabled>{{ t('dashboard.jobs.form.pipelinePlaceholder') }}</option>
                    <option v-for="p in pipelines" :key="(p as any).id" :value="(p as any).id">
                      {{ (p as any).name }}{{ (p as any).isSystem ? ` ${t('dashboard.jobs.form.pipelineSystemSuffix')}` : (p as any).isDefault ? ` ${t('dashboard.jobs.form.pipelineDefaultSuffix')}` : '' }}
                    </option>
                  </select>
                  <p class="mt-1.5 text-xs text-surface-500">{{ t('dashboard.jobs.form.pipelineHelp') }}</p>
                </div>
              </div>

              <!-- Section: Description -->
              <div class="space-y-6">
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-6 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionDescription') }}</h2>
                <div>
                  <label for="description" class="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                    {{ t('dashboard.jobs.new.labelAboutRole') }}
                  </label>
                  <textarea
                    id="description"
                    v-model="form.description"
                    rows="10"
                    :placeholder="t('dashboard.jobs.new.placeholderDescription')"
                    class="w-full rounded-lg border px-4 py-3 text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-900 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-colors border-surface-300 dark:border-surface-700"
                  />
                  <p class="mt-2 text-xs text-surface-500">{{ t('dashboard.jobs.new.descriptionHint') }}</p>
                </div>
              </div>
            </section>

            <!-- Step 2: Application form -->
            <section v-else-if="currentStep === 2" class="space-y-8">
              <div>
                <p class="text-xs font-semibold text-surface-400 dark:text-surface-500 uppercase tracking-wider mb-3">{{ t('dashboard.jobs.new.customizeAppForm') }}</p>
                <p class="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
                  {{ t('dashboard.jobs.new.customizeAppFormDesc') }}
                </p>
              </div>

              <!-- Personal information -->
              <div>
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 pb-3 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionPersonalInfo') }}</h2>
                <div class="divide-y divide-surface-100 dark:divide-surface-800">
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.fieldFirstName') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ t('dashboard.jobs.new.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.fieldLastName') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ t('dashboard.jobs.new.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.fieldEmail') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800">
                      {{ t('dashboard.jobs.new.mandatory') }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between py-3.5 px-1">
                    <div class="flex items-center gap-2.5">
                      <span class="text-sm text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.fieldPhone') }}</span>
                      <Lock class="size-3 text-surface-300 dark:text-surface-600" />
                    </div>
                    <span class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-400 ring-1 ring-inset ring-surface-200 dark:ring-surface-700">
                      {{ t('dashboard.jobs.new.optional') }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Documents -->
              <div>
                <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100 pb-3 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.sectionDocuments') }}</h2>
                <div class="divide-y divide-surface-100 dark:divide-surface-800">
                  <!-- Resume -->
                  <div class="flex items-center justify-between py-4 px-1">
                    <div>
                      <div class="flex items-center gap-2">
                        <Upload class="size-4 text-surface-400 dark:text-surface-500" />
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.resumeCV') }}</span>
                      </div>
                      <p class="text-xs text-surface-400 dark:text-surface-500 mt-1 ml-6">{{ t('dashboard.jobs.new.resumeHint') }}</p>
                    </div>
                    <div class="inline-flex items-center rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5" role="radiogroup" aria-label="Требования к резюме">
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="applicationForm.requireResume"
                        @click="applicationForm.requireResume = true"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="applicationForm.requireResume
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        Обязательное
                      </button>
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="!applicationForm.requireResume"
                        @click="applicationForm.requireResume = false"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="!applicationForm.requireResume
                          ? 'bg-white dark:bg-surface-700 text-surface-700 dark:text-surface-300 shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        Не требуется
                      </button>
                    </div>
                  </div>
                  <!-- Cover letter -->
                  <div class="flex items-center justify-between py-4 px-1">
                    <div>
                      <div class="flex items-center gap-2">
                        <FileText class="size-4 text-surface-400 dark:text-surface-500" />
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.coverLetter') }}</span>
                      </div>
                      <p class="text-xs text-surface-400 dark:text-surface-500 mt-1 ml-6">{{ t('dashboard.jobs.new.coverLetterHint') }}</p>
                    </div>
                    <div class="inline-flex items-center rounded-lg bg-surface-100 dark:bg-surface-800 p-0.5" role="radiogroup" aria-label="Требования к сопроводительному письму">
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="applicationForm.requireCoverLetter"
                        @click="applicationForm.requireCoverLetter = true"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="applicationForm.requireCoverLetter
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        Обязательное
                      </button>
                      <button
                        type="button"
                        role="radio"
                        :aria-checked="!applicationForm.requireCoverLetter"
                        @click="applicationForm.requireCoverLetter = false"
                        class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
                        :class="!applicationForm.requireCoverLetter
                          ? 'bg-white dark:bg-surface-700 text-surface-700 dark:text-surface-300 shadow-sm'
                          : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'"
                      >
                        Не требуется
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Screening questions -->
              <div>
                <div class="flex items-center justify-between pb-3 border-b border-surface-100 dark:border-surface-800">
                  <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.sectionScreeningQuestions') }}</h2>
                  <span v-if="applicationForm.questions.length > 0" class="text-xs font-medium text-surface-400 dark:text-surface-500 tabular-nums">
                    {{ applicationForm.questions.length }} {{ applicationForm.questions.length === 1 ? t('dashboard.jobs.new.questionSingular') : t('dashboard.jobs.new.questionPlural') }}
                  </span>
                </div>

                <div
                  v-if="questionActionError"
                  class="rounded-lg border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400 mt-4"
                >
                  {{ questionActionError }}
                  <button class="ml-2 underline" @click="questionActionError = null">{{ t('dashboard.jobs.new.dismiss') }}</button>
                </div>

                <div v-if="applicationForm.questions.length > 0" class="divide-y divide-surface-100 dark:divide-surface-800">
                  <div
                    v-for="(q, index) in applicationForm.questions"
                    :key="q.id"
                    class="flex items-center gap-3 py-3.5 px-1 group"
                  >
                    <div class="text-surface-300 dark:text-surface-600 cursor-grab">
                      <GripVertical class="size-4" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{{ q.label }}</span>
                        <span
                          v-if="q.required"
                          class="inline-flex items-center rounded-md bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300 ring-1 ring-inset ring-brand-200 dark:ring-brand-800"
                        >
                          Обязательное
                        </span>
                        <span
                          v-else
                          class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-surface-500 dark:text-surface-400 ring-1 ring-inset ring-surface-200 dark:ring-surface-700"
                        >
                          Необязательное
                        </span>
                      </div>
                      <div class="flex items-center gap-1.5 mt-0.5 ml-0">
                        <span class="text-xs text-surface-400 dark:text-surface-500">{{ questionTypeLabels[q.type] ?? q.type }}</span>
                        <span v-if="q.description" class="text-xs text-surface-400 dark:text-surface-500 truncate">
                          &middot; {{ q.description }}
                        </span>
                        <span
                          v-if="(q.type === 'single_select' || q.type === 'multi_select') && q.options"
                          class="text-xs text-surface-400 dark:text-surface-500"
                        >
                          &middot; {{ q.options.length }} {{ t('dashboard.jobs.new.options') }}
                        </span>
                      </div>
                    </div>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        :disabled="index === 0"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30"
:title="t('dashboard.jobs.new.moveUp')"
                        @click="moveQuestion(index, 'up')"
                      >
                        <ChevronUp class="size-4" />
                      </button>
                      <button
                        type="button"
                        :disabled="index === applicationForm.questions.length - 1"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-30"
:title="t('dashboard.jobs.new.moveDown')"
                        @click="moveQuestion(index, 'down')"
                      >
                        <ChevronDown class="size-4" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1.5 text-surface-400 hover:text-surface-600 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
:title="t('dashboard.jobs.new.edit')"
                        @click="editingQuestion = q; showAddForm = false"
                      >
                        <Pencil class="size-4" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1.5 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors"
:title="t('dashboard.jobs.new.delete')"
                        @click="handleDeleteQuestion(q.id)"
                      >
                        <Trash2 class="size-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <p v-else class="text-sm text-surface-400 dark:text-surface-500 py-6 text-center">
                  {{ t('dashboard.jobs.new.noQuestionsYet') }}
                </p>

                <QuestionForm
                  v-if="editingQuestion"
                  :question="editingQuestion"
                  class="mt-4 mb-2"
                  @save="handleUpdateQuestion"
                  @cancel="editingQuestion = null"
                />

                <QuestionForm
                  v-if="showAddForm && !editingQuestion"
                  class="mt-4 mb-2"
                  @save="handleAddQuestion"
                  @cancel="showAddForm = false"
                />

                <div class="mt-4 flex items-center gap-3">
                  <button
                    v-if="!showAddForm && !editingQuestion"
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-950/30 transition-colors"
                    @click="showAddForm = true"
                  >
                    <Plus class="size-4" />
                    {{ t('dashboard.jobs.new.addQuestion') }}
                  </button>
                </div>
              </div>
            </section>

            <!-- Step 3: AI scoring criteria -->
            <section v-else-if="currentStep === 3" class="space-y-8">
              <div>
                <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">
                  {{ t('dashboard.jobs.new.aiScoringTitle') }}
                </h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  {{ t('dashboard.jobs.new.aiScoringDesc') }}
                </p>
              </div>

              <!-- AI not configured warning -->
              <div v-if="!isAiConfigured" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-5">
                <div class="flex items-start gap-3">
                  <Sparkles class="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">{{ t('dashboard.jobs.new.aiProviderNotConfigured') }}</p>
                    <p class="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
                      {{ t('dashboard.jobs.new.aiProviderNotConfiguredDesc') }}
                    </p>
                    <NuxtLink
                      :to="$localePath('/dashboard/settings/ai')"
                      class="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2"
                    >
                      <ExternalLink class="size-3" />
                      {{ t('dashboard.jobs.new.goToAiSettings') }}
                    </NuxtLink>
                  </div>
                </div>
              </div>

              <!-- Mode selection cards -->
              <div v-if="scoringCriteria.length === 0" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Pre-made templates -->
                <button
                  type="button"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                  :class="scoringMode === 'premade'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="scoringMode = 'premade'"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                    <Brain class="size-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.modePremade') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ t('dashboard.jobs.new.modePremadeDesc') }}
                    </span>
                  </div>
                </button>

                <!-- AI from job description -->
                <button
                  type="button"
                  :disabled="!isAiConfigured"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="scoringMode === 'ai'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="generateAiCriteria(); scoringMode = 'ai'"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                    <Sparkles class="size-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.modeGenerate') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ t('dashboard.jobs.new.modeGenerateDesc') }}
                    </span>
                    <span v-if="!isAiConfigured" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 block">
                      {{ t('dashboard.jobs.new.requiresAiSetup') }}
                    </span>
                  </div>
                  <span v-if="isGeneratingCriteria" class="absolute top-3 right-3">
                    <Loader2 class="size-4 text-purple-600 animate-spin" />
                  </span>
                </button>

                <!-- Custom criteria -->
                <button
                  type="button"
                  class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:shadow-md"
                  :class="scoringMode === 'custom'
                    ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                    : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700'"
                  @click="scoringMode = 'custom'; showCustomForm = true"
                >
                  <div class="inline-flex items-center justify-center size-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
                    <SlidersHorizontal class="size-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.modeCustom') }}</span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                      {{ t('dashboard.jobs.new.modeCustomDesc') }}
                    </span>
                  </div>
                </button>
              </div>

              <!-- Pre-made template selector -->
              <div v-if="scoringMode === 'premade' && scoringCriteria.length === 0" class="space-y-4 mt-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    v-for="tmpl in [
                      { key: 'standard', label: t('dashboard.jobs.new.tmplStandard'), desc: t('dashboard.jobs.new.tmplStandardDesc') },
                      { key: 'technical', label: t('dashboard.jobs.new.tmplTechnical'), desc: t('dashboard.jobs.new.tmplTechnicalDesc') },
                      { key: 'non_technical', label: t('dashboard.jobs.new.tmplNonTechnical'), desc: t('dashboard.jobs.new.tmplNonTechnicalDesc') },
                    ] as const"
                    :key="tmpl.key"
                    type="button"
                    class="p-4 rounded-lg border text-left transition-all"
                    :class="selectedTemplate === tmpl.key
                      ? 'border-brand-400 dark:border-brand-600 bg-brand-50 dark:bg-brand-950/30'
                      : 'border-surface-200 dark:border-surface-800 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="selectedTemplate = tmpl.key; loadPremadeCriteria(tmpl.key)"
                  >
                    <span class="block text-sm font-medium text-surface-900 dark:text-surface-100">{{ tmpl.label }}</span>
                    <span class="text-xs text-surface-500">{{ tmpl.desc }}</span>
                  </button>
                </div>
              </div>

              <!-- Criteria list with weight sliders -->
              <div v-if="scoringCriteria.length > 0" class="space-y-4">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">
                    {{ scoringCriteria.length }} {{ scoringCriteria.length === 1 ? t('dashboard.jobs.new.criterionSingular') : t('dashboard.jobs.new.criterionPlural') }}
                  </h3>
                  <button
                    type="button"
                    class="text-xs text-danger-600 dark:text-danger-400 hover:underline"
                    @click="scoringCriteria = []; scoringMode = 'none'"
                  >
                    {{ t('dashboard.jobs.new.clearAll') }}
                  </button>
                </div>

                <div class="space-y-3">
                  <div
                    v-for="criterion in scoringCriteria"
                    :key="criterion.key"
                    class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all hover:shadow-sm"
                  >
                    <div class="flex items-start justify-between gap-3 mb-3">
                      <div class="flex-1 min-w-0 space-y-2">
                        <!-- Inline name + category -->
                        <div class="flex items-center gap-2">
                          <input
                            v-model="criterion.name"
                            type="text"
                            :placeholder="t('dashboard.jobs.new.labelName')"
                            class="flex-1 min-w-0 text-sm font-semibold rounded-md border border-transparent hover:border-surface-200 dark:hover:border-surface-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-transparent px-2 py-1 text-surface-900 dark:text-surface-100 focus:outline-none"
                          />
                          <select
                            v-model="criterion.category"
                            class="text-[10px] font-medium rounded-full ring-1 ring-inset px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                            :class="categoryColorClasses[criterion.category] ?? categoryColorClasses.custom"
                          >
                            <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
                          </select>
                        </div>
                        <!-- Inline description -->
                        <textarea
                          v-model="criterion.description"
                          rows="2"
                          :placeholder="t('dashboard.jobs.new.placeholderCriterionDesc')"
                          class="w-full text-xs rounded-md border border-transparent hover:border-surface-200 dark:hover:border-surface-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 bg-transparent px-2 py-1 text-surface-600 dark:text-surface-400 leading-relaxed focus:outline-none resize-none"
                        />
                      </div>
                      <button
                        type="button"
                        class="rounded p-1 text-surface-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950 transition-colors shrink-0"
                        :title="t('dashboard.jobs.new.remove')"
                        @click="removeCriterion(criterion.key)"
                      >
                        <Trash2 class="size-4" />
                      </button>
                    </div>

                    <!-- Max score (inline) + Weight slider -->
                    <div class="flex items-center gap-4">
                      <label class="text-xs font-medium text-surface-500 dark:text-surface-400 shrink-0">{{ t('dashboard.jobs.new.maxScore') }}</label>
                      <input
                        v-model.number="criterion.maxScore"
                        type="number"
                        min="1"
                        max="100"
                        class="w-16 text-xs rounded-md border border-surface-200 dark:border-surface-700 bg-transparent px-2 py-1 text-surface-700 dark:text-surface-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <label class="text-xs font-medium text-surface-500 dark:text-surface-400 shrink-0 ml-2">{{ t('dashboard.jobs.new.weight') }}</label>
                      <input
                        v-model.number="criterion.weight"
                        type="range"
                        :min="0"
                        :max="100"
                        class="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-brand-600 bg-surface-200 dark:bg-surface-700"
                      />
                      <span class="text-xs font-mono font-semibold text-surface-700 dark:text-surface-300 w-8 text-right">
                        {{ criterion.weight }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Add another criterion -->
                <button
                  v-if="!showCustomForm"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 dark:border-surface-700 px-3 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:border-brand-400 dark:hover:border-brand-600 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-950 transition-colors"
                  @click="showCustomForm = true"
                >
                  <Plus class="size-4" />
                  {{ t('dashboard.jobs.new.addCriterion') }}
                </button>
              </div>

              <!-- Custom criterion form -->
              <div v-if="showCustomForm" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5 space-y-4">
<h3 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ t('dashboard.jobs.new.addCustomCriterion') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.new.labelName') }} *</label>
                    <input
                      v-model="customCriterionForm.name"
                      type="text"
                      placeholder="Локация в Москве"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.new.labelCategory') }}</label>
                    <select
                      v-model="customCriterionForm.category"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option v-for="(label, key) in categoryLabels" :key="key" :value="key">{{ label }}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.new.labelDescription') }}</label>
                  <textarea
                    v-model="customCriterionForm.description"
                    rows="2"
:placeholder="t('dashboard.jobs.new.placeholderCriterionDesc')"
                    class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.new.labelMaxScore') }}</label>
                    <input
                      v-model.number="customCriterionForm.maxScore"
                      type="number"
                      min="1"
                      max="100"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-surface-700 dark:text-surface-300 mb-1">{{ t('dashboard.jobs.new.labelInitialWeight') }}</label>
                    <input
                      v-model.number="customCriterionForm.weight"
                      type="number"
                      min="0"
                      max="100"
                      class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-2 text-sm bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                </div>
                <div class="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    :disabled="!customCriterionForm.name.trim()"
                    class="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    @click="addCustomCriterion"
                  >
                    {{ t('dashboard.jobs.new.addCriterion') }}
                  </button>
                  <button
                    type="button"
                    class="px-4 py-2 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
                    @click="showCustomForm = false"
                  >
                    {{ t('dashboard.jobs.new.cancel') }}
                  </button>
                </div>
              </div>

              <!-- Auto-score toggle -->
              <div v-if="scoringCriteria.length > 0" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                <label class="flex items-start gap-3 cursor-pointer">
                  <input
                    v-model="autoScoreOnApply"
                    type="checkbox"
                    :disabled="!isAiConfigured"
                    class="mt-0.5 size-4 rounded border-surface-300 dark:border-surface-600 text-brand-600 focus:ring-brand-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div>
                    <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">
                      {{ t('dashboard.jobs.new.autoScoreTitle') }}
                    </span>
                    <span class="text-xs text-surface-500 dark:text-surface-400 mt-0.5 block leading-relaxed">
                      {{ t('dashboard.jobs.new.autoScoreDesc') }}
                    </span>
                    <span v-if="!isAiConfigured" class="text-xs text-amber-600 dark:text-amber-400 mt-1 block">
                      <NuxtLink :to="$localePath('/dashboard/settings/ai')" class="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-200">{{ t('dashboard.jobs.new.configureAiProvider') }}</NuxtLink> {{ t('dashboard.jobs.new.toEnableAutoScoring') }}
                    </span>
                  </div>
                </label>
              </div>

              <!-- Skip scoring note -->
              <div v-if="scoringCriteria.length === 0 && scoringMode === 'none'" class="text-center py-6 text-sm text-surface-400">
<p>{{ t('dashboard.jobs.new.scoringOptional') }}</p>
              </div>
            </section>

            <!-- Step 4: Publish & Distribute -->
            <section v-else-if="currentStep === 4" class="space-y-8">
              <!-- Success state after publishing -->
              <div v-if="isPublished" class="space-y-8">
                <!-- Compact success header -->
                <div class="flex items-center gap-4 rounded-xl border border-success-200 dark:border-success-800 bg-success-50 dark:bg-success-950/30 p-5">
                  <div class="inline-flex items-center justify-center size-12 rounded-full bg-success-100 dark:bg-success-900/50 shrink-0">
                    <PartyPopper class="size-6 text-success-600 dark:text-success-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h2 class="text-lg font-bold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.jobIsLive') }}</h2>
                    <p class="text-sm text-surface-500 dark:text-surface-400">
                      <strong>{{ form.title }}</strong> {{ t('dashboard.jobs.new.nowAcceptingApplications') }}
                    </p>
                  </div>
                  <NuxtLink
                    :to="finalApplicationLink"
                    target="_blank"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 bg-brand-100 dark:bg-brand-900/50 rounded-lg hover:bg-brand-200 dark:hover:bg-brand-800 transition-colors shrink-0"
                  >
                    <ExternalLink class="size-3.5" />
                    Предпросмотр
                  </NuxtLink>
                </div>

                <!-- Direct application link -->
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <div class="flex items-center gap-2 mb-3">
                    <Link2 class="size-4 text-surface-500 dark:text-surface-400" />
                    <span class="text-sm font-semibold text-surface-700 dark:text-surface-300">{{ t('dashboard.jobs.new.directAppLink') }}</span>
                    <span class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.new.noTracking') }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      :value="finalApplicationLink"
                      class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-600 dark:text-surface-400 select-all font-mono"
                    />
                    <button
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-surface-200 dark:bg-surface-700 px-4 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors shrink-0"
                      @click="copyFinalLink"
                    >
                      <Copy class="size-3.5" />
                      {{ linkCopiedFinal ? t('dashboard.jobs.new.copied') : t('dashboard.jobs.new.copy') }}
                    </button>
                  </div>
                </div>

                <!-- Distribution hub -->
                <div>
                  <div class="flex items-center gap-3 mb-2">
                    <Share2 class="size-5 text-brand-600 dark:text-brand-400" />
                    <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.distributeTitle') }}</h3>
                  </div>
                  <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                    {{ t('dashboard.jobs.new.distributeDesc') }}
                  </p>

                  <!-- Job boards -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ t('dashboard.jobs.new.jobBoards') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'job_board')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>

                        <!-- Not yet created -->
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ t('dashboard.jobs.new.createTrackingLink') }}
                          </button>
                        </div>

                        <!-- Loading -->
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ t('dashboard.jobs.new.creating') }}</span>
                        </div>

                        <!-- Created - show URL -->
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? t('dashboard.jobs.new.copied') : t('dashboard.jobs.new.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ t('dashboard.jobs.new.linkTrackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Outreach -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ t('dashboard.jobs.new.directOutreach') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'outreach')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ t('dashboard.jobs.new.createTrackingLink') }}
                          </button>
                        </div>
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ t('dashboard.jobs.new.creating') }}</span>
                        </div>
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? t('dashboard.jobs.new.copied') : t('dashboard.jobs.new.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ t('dashboard.jobs.new.linkTrackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Social media -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ t('dashboard.jobs.new.socialMedia') }}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="ch in distributionChannels.filter(c => c.category === 'social')"
                        :key="ch.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 transition-all"
                        :class="createdLinks[ch.channel]?.code ? 'ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800' : ''"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <component :is="channelIcons[ch.channel] ?? Globe" class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ ch.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ ch.description }}</span>
                          </div>
                        </div>
                        <div v-if="!createdLinks[ch.channel]" class="mt-3">
                          <button
                            type="button"
                            class="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-3 py-2 text-xs font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            @click="createChannelLink(ch.channel, ch.name)"
                          >
                            <Plus class="size-3.5" />
                            {{ t('dashboard.jobs.new.createTrackingLink') }}
                          </button>
                        </div>
                        <div v-else-if="createdLinks[ch.channel]?.loading" class="mt-3 flex items-center justify-center gap-2 py-2">
                          <Loader2 class="size-3.5 text-brand-600 animate-spin" />
                          <span class="text-xs text-surface-500">{{ t('dashboard.jobs.new.creating') }}</span>
                        </div>
                        <div v-else class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="createdLinks[ch.channel]?.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="createdLinks[ch.channel]?.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyChannelLink(ch.channel)"
                            >
                              <Check v-if="createdLinks[ch.channel]?.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ createdLinks[ch.channel]?.copied ? t('dashboard.jobs.new.copied') : t('dashboard.jobs.new.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ t('dashboard.jobs.new.linkTrackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Custom job board -->
                  <div class="mb-6">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500 mb-3">{{ t('dashboard.jobs.new.customJobBoard') }}</h4>
                    <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">
                      {{ t('dashboard.jobs.new.customJobBoardDesc') }}
                    </p>

                    <!-- Add custom board form -->
                    <div class="flex items-center gap-2 mb-4">
                      <input
                        v-model="customBoardName"
                        type="text"
:placeholder="t('dashboard.jobs.new.placeholderCustomBoard')"
                        class="flex-1 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 px-3 py-2 text-sm text-surface-700 dark:text-surface-300 placeholder-surface-400 dark:placeholder-surface-500 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                        @keydown.enter.prevent="createCustomBoardLink"
                      />
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 px-4 py-2 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="!customBoardName.trim() || isCreatingCustomBoard"
                        @click="createCustomBoardLink"
                      >
                        <Loader2 v-if="isCreatingCustomBoard" class="size-3.5 animate-spin" />
                        <Plus v-else class="size-3.5" />
                        {{ t('dashboard.jobs.new.createLink') }}
                      </button>
                    </div>

                    <!-- Created custom board links -->
                    <div v-if="customBoardLinks.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div
                        v-for="(cbl, idx) in customBoardLinks"
                        :key="cbl.channel"
                        class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-950 p-4 ring-1 ring-brand-200 dark:ring-brand-800 border-brand-200 dark:border-brand-800"
                      >
                        <div class="flex items-start gap-3">
                          <div class="inline-flex items-center justify-center size-9 rounded-lg bg-surface-100 dark:bg-surface-800 shrink-0">
                            <Globe class="size-4 text-surface-500 dark:text-surface-400" />
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ cbl.name }}</span>
                            <span class="text-xs text-surface-400 dark:text-surface-500">{{ t('dashboard.jobs.new.customJobBoard') }}</span>
                          </div>
                        </div>
                        <div class="mt-3 space-y-2">
                          <div class="flex items-center gap-1.5">
                            <input
                              type="text"
                              readonly
                              :value="cbl.url"
                              class="flex-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-2.5 py-1.5 text-xs text-surface-600 dark:text-surface-400 select-all font-mono truncate"
                            />
                            <button
                              type="button"
                              class="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors shrink-0"
                              :class="cbl.copied
                                ? 'bg-success-100 dark:bg-success-900/50 text-success-700 dark:text-success-300'
                                : 'bg-brand-600 text-white hover:bg-brand-700'"
                              @click="copyCustomBoardLink(idx)"
                            >
                              <Check v-if="cbl.copied" class="size-3" />
                              <Copy v-else class="size-3" />
                              {{ cbl.copied ? t('dashboard.jobs.new.copied') : t('dashboard.jobs.new.copy') }}
                            </button>
                          </div>
                          <p class="flex items-center gap-1 text-[11px] text-success-600 dark:text-success-400">
                            <Check class="size-3" />
                            {{ t('dashboard.jobs.new.linkTrackedHint') }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Summary and link to full dashboard -->
                  <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-4">
                    <div class="flex items-center gap-3">
                      <BarChart3 class="size-5 text-surface-400 dark:text-surface-500 shrink-0" />
                      <div class="flex-1">
                        <p class="text-sm text-surface-700 dark:text-surface-300">
                          <span v-if="createdLinkCount > 0">
                            {{ createdLinkCount }} {{ createdLinkCount === 1 ? t('dashboard.jobs.new.trackingLinkSingular') : t('dashboard.jobs.new.trackingLinkPlural') }}.
                          </span>
                          {{ t('dashboard.jobs.new.viewAnalytics') }}
                          <NuxtLink :to="$localePath('/dashboard/source-tracking')" class="text-brand-600 dark:text-brand-400 font-medium underline underline-offset-2">{{ t('dashboard.jobs.new.sourceTrackingDashboard') }}</NuxtLink>.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="flex items-center justify-between pt-6 border-t border-surface-100 dark:border-surface-800">
                  <NuxtLink
                    :to="$localePath(`/dashboard/jobs/${createdJobId}`)"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  >
                    <Eye class="size-4" />
                    {{ t('dashboard.jobs.new.viewJob') }}
                  </NuxtLink>
                  <NuxtLink
                    :to="$localePath('/dashboard')"
                    class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors shadow-sm"
                  >
                    {{ t('dashboard.jobs.new.goToDashboard') }}
                  </NuxtLink>
                </div>
              </div>

              <!-- Pre-publish state: choose publish or draft -->
              <div v-else>
<h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-2 pb-2 border-b border-surface-100 dark:border-surface-800">{{ t('dashboard.jobs.new.readyToGo') }}</h2>
                <p class="text-sm text-surface-500 dark:text-surface-400 mb-6">
                  {{ t('dashboard.jobs.new.readyToGoDesc') }}
                </p>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                  <!-- Publish now option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'publish'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'publish'"
                  >
                    <span
                      v-if="publishChoice === 'publish'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-brand-100 dark:bg-brand-900/50">
                      <Rocket class="size-5 text-brand-600 dark:text-brand-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.publishNow') }}</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        {{ t('dashboard.jobs.new.publishNowDesc') }}
                      </span>
                    </div>
                  </button>

                  <!-- Save as draft option -->
                  <button
                    type="button"
                    class="relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all"
                    :class="publishChoice === 'draft'
                      ? 'border-brand-500 dark:border-brand-400 bg-brand-50/70 dark:bg-brand-950/30 ring-2 ring-brand-200 dark:ring-brand-900'
                      : 'border-surface-200 dark:border-surface-800 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800/50'"
                    @click="publishChoice = 'draft'"
                  >
                    <span
                      v-if="publishChoice === 'draft'"
                      class="absolute top-3 right-3 inline-flex items-center justify-center size-5 rounded-full bg-brand-600 text-white"
                    >
                      <Check class="size-3" />
                    </span>
                    <div class="inline-flex items-center justify-center size-10 rounded-lg bg-surface-100 dark:bg-surface-800">
                      <FileEdit class="size-5 text-surface-500 dark:text-surface-400" />
                    </div>
                    <div>
                      <span class="block text-sm font-semibold text-surface-900 dark:text-surface-100">{{ t('dashboard.jobs.new.saveAsDraft') }}</span>
                      <span class="text-xs text-surface-500 dark:text-surface-400 mt-1 block leading-relaxed">
                        {{ t('dashboard.jobs.new.saveAsDraftDesc') }}
                      </span>
                    </div>
                  </button>
                </div>

                <!-- Summary of what was configured -->
                <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50 dark:bg-surface-900/50 p-5">
                  <h3 class="text-sm font-semibold text-surface-700 dark:text-surface-300 mb-4">{{ t('dashboard.jobs.new.jobSummary') }}</h3>
                  <dl class="space-y-3 text-sm">
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Briefcase class="size-3.5" /> {{ t('dashboard.jobs.new.summaryTitle') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100 font-medium">{{ form.title }}</dd>
                    </div>
                    <div v-if="form.location" class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <Link2 class="size-3.5" /> {{ t('dashboard.jobs.new.summaryLocation') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ form.location }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <FileText class="size-3.5" /> {{ t('dashboard.jobs.new.summaryResume') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ applicationForm.requireResume ? t('dashboard.jobs.new.required') : t('dashboard.jobs.new.optional') }}</dd>
                    </div>
                    <div class="flex items-start gap-3">
                      <dt class="flex items-center gap-1.5 text-surface-500 dark:text-surface-400 shrink-0 w-32">
                        <MessageSquare class="size-3.5" /> {{ t('dashboard.jobs.new.summaryQuestions') }}
                      </dt>
                      <dd class="text-surface-900 dark:text-surface-100">{{ applicationForm.questions.length }} {{ t('dashboard.jobs.new.customLabel') }} {{ applicationForm.questions.length === 1 ? t('dashboard.jobs.new.questionSingular') : t('dashboard.jobs.new.questionPlural') }}</dd>
                    </div>
                  </dl>
                </div>

                <!-- What happens next hint -->
                <div v-if="publishChoice === 'publish'" class="rounded-xl border border-brand-100 dark:border-brand-900 bg-brand-50/50 dark:bg-brand-950/20 p-4 mt-6">
                  <div class="flex items-start gap-3">
                    <Share2 class="size-4 text-brand-600 dark:text-brand-400 shrink-0 mt-0.5" />
                    <div>
                      <p class="text-sm font-medium text-brand-800 dark:text-brand-200">{{ t('dashboard.jobs.new.afterPublishing') }}</p>
                      <p class="text-xs text-brand-700 dark:text-brand-300 mt-0.5 leading-relaxed">
                        {{ t('dashboard.jobs.new.afterPublishingDesc') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Actions Footer -->
            <div v-if="!isPublished" class="flex items-center justify-between mt-12 pt-8 border-t border-surface-100 dark:border-surface-800">
              <NuxtLink
                :to="$localePath('/dashboard')"
                class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              >
                {{ t('dashboard.jobs.new.cancel') }}
              </NuxtLink>

              <div class="flex items-center gap-3">
                <button
                  v-if="currentStep > 1"
                  type="button"
                  @click="prevStep"
                  class="px-6 py-2.5 text-sm font-medium text-surface-700 dark:text-surface-300 bg-white dark:bg-surface-900 border border-surface-300 dark:border-surface-700 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                >
                  {{ t('dashboard.jobs.new.back') }}
                </button>
                <button
                  v-if="currentStep < 4"
                  type="button"
                  :disabled="!canGoNext"
                  @click="nextStep"
                  class="px-8 py-2.5 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {{ t('dashboard.jobs.new.saveContinue') }}
                </button>
                <button
                  v-else
                  type="submit"
                  :disabled="isSubmitting"
                  class="inline-flex items-center gap-2 px-8 py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                  :class="publishChoice === 'publish' ? 'bg-brand-600 hover:bg-brand-700' : 'bg-surface-600 hover:bg-surface-700'"
                >
                  <Rocket v-if="publishChoice === 'publish'" class="size-4" />
                  <FileEdit v-else class="size-4" />
                  {{ isSubmitting
                    ? (publishChoice === 'publish' ? t('dashboard.jobs.new.publishing') : t('dashboard.jobs.new.saving'))
                    : (publishChoice === 'publish' ? t('dashboard.jobs.new.publishCopyLink') : t('dashboard.jobs.new.saveAsDraft'))
                  }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <!-- Right side: Tips -->
      <aside class="lg:col-span-4 space-y-6">
        <div class="sticky top-8 space-y-6">
          <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-900/50 p-6">
<h3 class="text-sm font-bold text-surface-900 dark:text-surface-100 uppercase tracking-wider mb-4">{{ t('dashboard.jobs.new.tips') }}</h3>
            <ul class="space-y-4">
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip1Title') }}</p>
                {{ t('dashboard.jobs.new.tip1Desc') }}
              </li>
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip2Title') }}</p>
                {{ t('dashboard.jobs.new.tip2Desc') }}
              </li>
              <li v-if="currentStep === 1" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip3Title') }}</p>
                {{ t('dashboard.jobs.new.tip3Desc') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip4Title') }}</p>
                {{ t('dashboard.jobs.new.tip4Desc') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip5Title') }}</p>
                {{ t('dashboard.jobs.new.tip5Desc') }}
              </li>
              <li v-if="currentStep === 2" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip6Title') }}</p>
                {{ t('dashboard.jobs.new.tip6Desc') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip7Title') }}</p>
                {{ t('dashboard.jobs.new.tip7Desc') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip8Title') }}</p>
                {{ t('dashboard.jobs.new.tip8Desc') }}
              </li>
              <li v-if="currentStep === 3" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip9Title') }}</p>
                {{ t('dashboard.jobs.new.tip9DescPart1') }} <NuxtLink :to="$localePath('/dashboard/settings/ai')" class="text-brand-600 dark:text-brand-400 underline">{{ t('dashboard.jobs.new.tip9DescLink') }}</NuxtLink>.
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip10Title') }}</p>
                {{ t('dashboard.jobs.new.tip10Desc') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip11Title') }}</p>
                {{ t('dashboard.jobs.new.tip11Desc') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip12Title') }}</p>
                {{ t('dashboard.jobs.new.tip12Desc') }}
              </li>
              <li v-if="currentStep === 4" class="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
<p class="font-medium text-surface-900 dark:text-surface-100 mb-1">{{ t('dashboard.jobs.new.tip13Title') }}</p>
                {{ t('dashboard.jobs.new.tip13Desc') }}
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
button:not(:disabled) {
  cursor: pointer;
}
</style>
