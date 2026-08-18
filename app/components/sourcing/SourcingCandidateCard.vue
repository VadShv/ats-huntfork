<script setup lang="ts">
/**
 * SourcingCandidateCard — карточка кандидата сорсинга hh.ru.
 *
 * Рендерит анонимизированный snapshot со сворачиваемыми блоками для
 * больших полей (навыки, опыт, образование, обоснование оценки).
 *
 * Все цвета — дизайн-токены (brand/surface/success/warning/danger/info),
 * тёмная тема поддерживается автоматически.
 *
 * Props:
 *  - candidate — объект из /api/jobs/:id/sourcing-candidates
 *  - selected — выбран ли в bulk-очередь (v-model:selected)
 *  - importing — id кандидата, который сейчас импортируется
 *
 * Events:
 *  - update:selected
 *  - import, approve, reject, open-card
 */
import {
  Check,
  X,
  ExternalLink,
  Loader2,
  AlertTriangle,
  MapPin,
  Clock,
  User,
  Wallet,
  Briefcase,
  GraduationCap,
  Plane,
  Calendar,
} from 'lucide-vue-next'
import { computed } from 'vue'
import UiCard from '~/components/ui/UiCard.vue'
import UiBadge from '~/components/ui/UiBadge.vue'
import UiButton from '~/components/ui/UiButton.vue'
import ExpandableSection from './ExpandableSection.vue'

/** Соответствует SourcingSnapshot из server/utils/hh/sourcing/types.ts. */
interface Snapshot {
  title: string | null
  areaId: string | null
  areaName: string | null
  salaryAmount: number | null
  salaryCurrency: string | null
  age: number | null
  updatedAt: string | null
  experienceYears: number | null
  totalExperienceMonths: number | null
  lastCompany: string | null
  lastPosition: string | null
  experience?: Array<{
    company: string | null
    position: string | null
    start: string | null
    end: string | null
    durationMonths: number | null
    description?: string | null
  }>
  skills?: string[]
  educationLevel?: string | null
  education?: Array<{
    institution: string | null
    faculty: string | null
    level: string | null
    year: string | null
  }>
  workFormat?: string[]
  employmentForm?: string[]
  relocation?: { type: string | null } | null
  citizenship?: string[]
  searchActivity?: string | null
}

interface ExistingCandidate {
  id: string
  firstName: string
  lastName: string
  lastApplicationSource: string | null
  applicationCount: number
  hasApplicationOnThisJob: boolean
  lastApplicationCreatedAt: string | null
}

interface Candidate {
  id: string
  savedSearchId: string
  hhResumeId: string
  snapshot: Snapshot
  score: number | null
  scoreRationale: string | null
  scoreStrengths?: string[] | null
  scoreGaps?: string[] | null
  state: string
  applicationId: string | null
  reviewNote: string | null
  firstSeenAt: string
  lastSeenAt: string
  existingCandidate: ExistingCandidate | null
}

const props = defineProps<{
  candidate: Candidate
  selected?: boolean
  importing?: string | null
}>()

const emit = defineEmits<{
  'update:selected': [value: boolean]
  import: [c: Candidate]
  approve: [c: Candidate]
  reject: [c: Candidate]
  'open-card': [c: Candidate]
}>()

// ── Маппинг состояний → UiBadge tone ──────────────────────
const stateLabel: Record<string, string> = {
  new: 'Новый',
  reviewed: 'Просмотрен',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  imported: 'В воронке',
  contacted: 'Контакт открыт',
}

const stateTone: Record<string, 'info' | 'neutral' | 'success' | 'danger' | 'accent' | 'warning'> = {
  new: 'info',
  reviewed: 'neutral',
  approved: 'success',
  rejected: 'danger',
  imported: 'accent',
  contacted: 'warning',
}

// ── Форматтеры ────────────────────────────────────────────
function formatSalary(s: Snapshot): string {
  if (!s.salaryAmount) return ''
  return `${s.salaryAmount.toLocaleString('ru')} ${s.salaryCurrency ?? 'RUR'}`
}

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин назад`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH} ч назад`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD} дн назад`
  return date.toLocaleDateString('ru')
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru', { month: 'short', year: 'numeric' })
}

function formatDuration(months: number | null): string {
  if (months === null) return ''
  const years = Math.floor(months / 12)
  const m = months % 12
  if (years === 0) return `${m} мес`
  if (m === 0) return `${years} г`
  return `${years} г ${m} мес`
}

// ── Производные списки ────────────────────────────────────
const skills = computed(() => props.candidate.snapshot.skills ?? [])
const skillsPreview = computed(() => skills.value.slice(0, 6))
const skillsHidden = computed(() => Math.max(0, skills.value.length - 6))

const experience = computed(() => props.candidate.snapshot.experience ?? [])
const education = computed(() => props.candidate.snapshot.education ?? [])
const workFormat = computed(() => props.candidate.snapshot.workFormat ?? [])
const employmentForm = computed(() => props.candidate.snapshot.employmentForm ?? [])

const hasScore = computed(() => props.candidate.score !== null && props.candidate.score !== undefined)
const hasRationale = computed(() =>
  Boolean(props.candidate.scoreRationale)
  || (props.candidate.scoreStrengths?.length ?? 0) > 0
  || (props.candidate.scoreGaps?.length ?? 0) > 0,
)

const isImported = computed(() => props.candidate.state === 'imported')
const canApprove = computed(() => props.candidate.state === 'new' || props.candidate.state === 'reviewed')
const canReject = computed(() => props.candidate.state !== 'rejected' && props.candidate.state !== 'imported')

// Человеко-читаемые метки условий работы.
const WORK_FORMAT_LABELS: Record<string, string> = {
  ON_SITE: 'В офисе',
  REMOTE: 'Удалёнка',
  HYBRID: 'Гибрид',
  FIELD_WORK: 'Разъездная',
}
const EMPLOYMENT_LABELS: Record<string, string> = {
  full: 'Полная',
  part: 'Частичная',
  project: 'Проект',
  probation: 'Стажировка',
}
</script>

<template>
  <UiCard
    variant="default"
    padding="md"
    :class="[
      'relative transition-all',
      selected ? 'ring-2 ring-brand-500 border-brand-300 dark:border-brand-700' : '',
    ]"
  >
    <!-- Чекбокс bulk-выбора (если кандидат ещё не импортирован) -->
    <label
      v-if="!isImported"
      class="absolute top-3 right-3 flex items-center"
    >
      <input
        type="checkbox"
        :checked="selected"
        class="size-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-900"
        @change="emit('update:selected', ($event.target as HTMLInputElement).checked)"
      />
    </label>

    <div class="flex items-start justify-between gap-3 pr-7">
      <div class="min-w-0 flex-1">
        <!-- Шапка: title + бейджи -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-medium text-surface-900 dark:text-surface-100">
            {{ candidate.snapshot.title || 'Без названия' }}
          </span>
          <UiBadge :tone="stateTone[candidate.state] ?? 'neutral'" size="sm">
            {{ stateLabel[candidate.state] ?? candidate.state }}
          </UiBadge>
          <UiBadge v-if="hasScore" tone="warning" size="sm">
            Score: {{ candidate.score }}
          </UiBadge>

          <!-- Бейджи дубля -->
          <UiBadge
            v-if="candidate.existingCandidate?.hasApplicationOnThisJob"
            tone="danger"
            size="sm"
            :title="`Уже в воронке этой вакансии: ${candidate.existingCandidate.firstName} ${candidate.existingCandidate.lastName}`"
          >
            <AlertTriangle class="size-3 mr-0.5" />
            Уже в воронке
          </UiBadge>
          <UiBadge
            v-else-if="candidate.existingCandidate"
            tone="warning"
            size="sm"
            :title="`Уже в базе: ${candidate.existingCandidate.firstName} ${candidate.existingCandidate.lastName}, откликов: ${candidate.existingCandidate.applicationCount}`"
          >
            <AlertTriangle class="size-3 mr-0.5" />
            Уже в базе
          </UiBadge>
        </div>

        <!-- Мета-строка -->
        <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-surface-600 dark:text-surface-400">
          <span v-if="candidate.snapshot.areaName" class="inline-flex items-center gap-1">
            <MapPin class="size-3.5" /> {{ candidate.snapshot.areaName }}
          </span>
          <span v-if="candidate.snapshot.experienceYears" class="inline-flex items-center gap-1">
            <Clock class="size-3.5" /> Опыт: {{ candidate.snapshot.experienceYears }} лет
          </span>
          <span v-if="candidate.snapshot.age" class="inline-flex items-center gap-1">
            <User class="size-3.5" /> {{ candidate.snapshot.age }} лет
          </span>
          <span v-if="formatSalary(candidate.snapshot)" class="inline-flex items-center gap-1">
            <Wallet class="size-3.5" /> {{ formatSalary(candidate.snapshot) }}
          </span>
        </div>

        <!-- Краткое последнее место (всегда видно) -->
        <div v-if="candidate.snapshot.lastPosition" class="mt-1 text-sm text-surface-500 dark:text-surface-400">
          <Briefcase class="size-3.5 inline mr-1" />
          {{ candidate.snapshot.lastPosition }}
          <span v-if="candidate.snapshot.lastCompany">в «{{ candidate.snapshot.lastCompany }}»</span>
        </div>

        <!-- ── Сворачиваемые блоки ── -->

        <!-- Навыки -->
        <ExpandableSection
          v-if="skills.length > 0"
          title="Навыки"
          :hidden-count="skillsHidden"
          class="mt-3"
        >
          <template #summary>
            <div class="flex flex-wrap gap-1">
              <UiBadge
                v-for="skill in skillsPreview"
                :key="skill"
                tone="info"
                variant="soft"
                size="sm"
              >{{ skill }}</UiBadge>
            </div>
          </template>
          <div class="flex flex-wrap gap-1">
            <UiBadge
              v-for="skill in skills"
              :key="skill"
              tone="info"
              variant="soft"
              size="sm"
            >{{ skill }}</UiBadge>
          </div>
        </ExpandableSection>

        <!-- Опыт работы (детально) -->
        <ExpandableSection
          v-if="experience.length > 0"
          title="Опыт работы"
          :hidden-count="Math.max(0, experience.length - 2)"
          class="mt-3"
        >
          <template #summary>
            <span>{{ experience[0]?.position ?? '—' }} · {{ experience[0]?.company ?? '—' }}</span>
          </template>
          <div class="space-y-2">
            <div v-for="(exp, i) in experience" :key="i" class="border-l-2 border-surface-200 dark:border-surface-700 pl-3">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-surface-700 dark:text-surface-200">
                  {{ exp.position ?? '—' }}
                </span>
                <span v-if="formatDuration(exp.durationMonths)" class="text-xs text-surface-500">
                  {{ formatDuration(exp.durationMonths) }}
                </span>
              </div>
              <div class="text-xs text-surface-500 dark:text-surface-400">
                {{ exp.company ?? '—' }}
                <span class="mx-1">·</span>
                <Calendar class="size-3 inline" />
                {{ formatDate(exp.start) }} — {{ exp.end ? formatDate(exp.end) : 'по н.в.' }}
              </div>
            </div>
          </div>
        </ExpandableSection>

        <!-- Образование -->
        <ExpandableSection
          v-if="education.length > 0 || candidate.snapshot.educationLevel"
          title="Образование"
          :hidden-count="Math.max(0, education.length - 1)"
          class="mt-3"
        >
          <template #summary>
            <span>{{ candidate.snapshot.educationLevel || education[0]?.institution || '—' }}</span>
          </template>
          <div class="space-y-1">
            <div v-for="(edu, i) in education" :key="i" class="flex items-start gap-1.5">
              <GraduationCap class="size-3.5 mt-0.5 shrink-0 text-surface-400" />
              <div>
                <span>{{ edu.institution ?? '—' }}</span>
                <span v-if="edu.faculty" class="text-surface-500">, {{ edu.faculty }}</span>
                <span v-if="edu.year" class="text-xs text-surface-500 ml-1">({{ edu.year }})</span>
              </div>
            </div>
            <div v-if="candidate.snapshot.educationLevel && education.length === 0" class="text-surface-500">
              {{ candidate.snapshot.educationLevel }}
            </div>
          </div>
        </ExpandableSection>

        <!-- Условия работы + релокация -->
        <div
          v-if="workFormat.length || employmentForm.length || candidate.snapshot.relocation"
          class="mt-3 flex flex-wrap gap-1"
        >
          <UiBadge
            v-for="wf in workFormat"
            :key="`wf-${wf}`"
            tone="neutral"
            variant="soft"
            size="sm"
          >{{ WORK_FORMAT_LABELS[wf] ?? wf }}</UiBadge>
          <UiBadge
            v-for="ef in employmentForm"
            :key="`ef-${ef}`"
            tone="neutral"
            variant="soft"
            size="sm"
          >{{ EMPLOYMENT_LABELS[ef] ?? ef }}</UiBadge>
          <UiBadge
            v-if="candidate.snapshot.relocation?.type"
            tone="accent"
            variant="soft"
            size="sm"
          >
            <Plane class="size-3 mr-0.5" />
            Релокация: {{ candidate.snapshot.relocation.type }}
          </UiBadge>
        </div>

        <!-- Обоснование оценки (когда скоринг подключат) -->
        <ExpandableSection
          v-if="hasRationale"
          title="Обоснование оценки"
          :default-collapsed="true"
          class="mt-3"
        >
          <template #summary>
            <span class="text-surface-500">AI-анализ — развернуть для деталей</span>
          </template>
          <div v-if="candidate.scoreRationale" class="mb-2 text-surface-600 dark:text-surface-300">
            {{ candidate.scoreRationale }}
          </div>
          <div v-if="candidate.scoreStrengths?.length" class="mb-1.5">
            <div class="text-xs font-medium text-success-700 dark:text-success-400 mb-0.5">Сильные стороны</div>
            <ul class="list-disc list-inside text-sm text-surface-600 dark:text-surface-300">
              <li v-for="(s, i) in candidate.scoreStrengths" :key="`s-${i}`">{{ s }}</li>
            </ul>
          </div>
          <div v-if="candidate.scoreGaps?.length">
            <div class="text-xs font-medium text-danger-700 dark:text-danger-400 mb-0.5">Пробелы</div>
            <ul class="list-disc list-inside text-sm text-surface-600 dark:text-surface-300">
              <li v-for="(g, i) in candidate.scoreGaps" :key="`g-${i}`">{{ g }}</li>
            </ul>
          </div>
        </ExpandableSection>

        <!-- Найден -->
        <div class="mt-3 text-xs text-surface-400 dark:text-surface-500">
          Найден: {{ formatRelative(candidate.firstSeenAt) }}
        </div>
      </div>

      <!-- Действия -->
      <div class="flex flex-col gap-1.5 shrink-0">
        <UiButton
          v-if="!isImported && candidate.existingCandidate?.hasApplicationOnThisJob"
          size="sm"
          variant="secondary"
          :icon-left="ExternalLink"
          @click="emit('open-card', candidate)"
        >
          Открыть карточку
        </UiButton>
        <UiButton
          v-else-if="!isImported"
          size="sm"
          variant="primary"
          :disabled="importing === candidate.id"
          :icon-left="importing === candidate.id ? Loader2 : ExternalLink"
          @click="emit('import', candidate)"
        >
          В воронку
        </UiButton>
        <NuxtLink
          v-else-if="candidate.applicationId"
          :to="$localePath(`/dashboard/applications/${candidate.applicationId}`)"
        >
          <UiButton size="sm" variant="secondary">Открыть отклик</UiButton>
        </NuxtLink>
        <UiButton
          v-if="canApprove"
          size="sm"
          variant="ghost"
          :icon-left="Check"
          title="Добавить в лист ожидания"
          @click="emit('approve', candidate)"
        >
          Одобрить
        </UiButton>
        <UiButton
          v-if="canReject"
          size="sm"
          variant="ghost"
          class="text-danger-700 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950"
          :icon-left="X"
          @click="emit('reject', candidate)"
        >
          Отклонить
        </UiButton>
      </div>
    </div>
  </UiCard>
</template>
