<script setup lang="ts">
import { Briefcase, GraduationCap, Languages, Sparkles, MapPin, Calendar, ExternalLink, Download, FileJson, FileText, Loader2, RefreshCcw } from 'lucide-vue-next'

const props = defineProps<{
  candidateId: string
  /** Если у кандидата нет hh-снепшота — не делаем запрос, показываем empty state. */
  hasSnapshot: boolean
  /** Имя для генерации файлов скачивания. */
  candidateName: string
  /** id выбранной версии резюме (null = текущая). */
  versionId?: string | null
}>()

const { t } = useI18n()
const toast = useToast()

// ─────────────────────────────────────────────
// Загрузка резюме
// ─────────────────────────────────────────────

interface ResumeData {
  fullName?: string
  firstName?: string
  lastName?: string
  middleName?: string
  title?: string
  birthDate?: string
  gender?: string
  area?: string
  salary?: { amount?: number; currency?: string }
  employments?: string[]
  schedules?: string[]
  totalExperience?: { months?: number; years?: number; monthsRemainder?: number }
  experience: Array<{ position?: string; company?: string; start?: string; end?: string; description?: string }>
  education: Array<{ organization?: string; name?: string; year?: number; result?: string }>
  skills: string[]
  about?: string
  languages: Array<{ name?: string; level?: string }>
  contacts: Array<{ type?: string; value?: string }>
  alternateUrl?: string
  photoUrl?: string
}

// Если выбрана конкретная версия — ходим в /resume-versions/:versionId, иначе в текущий /hh-resume.
const { data, status, error, refresh } = useLazyFetch<{ resume: ResumeData; fetchedAt?: string; hhResumeId?: string }>(
  () => props.versionId
    ? `/api/candidates/${props.candidateId}/resume-versions/${props.versionId}`
    : `/api/candidates/${props.candidateId}/hh-resume`,
  {
    key: computed(() => `candidate-hh-resume-${props.candidateId}-${props.versionId ?? 'current'}`),
    immediate: props.hasSnapshot, // не дёргаем, если снепшота нет
    server: false,
    watch: [() => props.versionId],
  },
)

const resume = computed(() => data.value?.resume ?? null)
const fetchedAt = computed(() => data.value?.fetchedAt ?? null)

// ─────────────────────────────────────────────
// Форматирование
// ─────────────────────────────────────────────

function fmtMonth(s?: string): string {
  if (!s) return ''
  // hh возвращает "2023-05-01" — берём YYYY-MM и красиво подписываем.
  const m = s.match(/^(\d{4})-(\d{2})/)
  if (!m) return s
  const months = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
  return `${months[parseInt(m[2]!, 10) - 1]} ${m[1]}`
}

function fmtPeriod(start?: string, end?: string): string {
  const s = fmtMonth(start)
  const e = end ? fmtMonth(end) : 'наст. время'
  return s ? `${s} — ${e}` : ''
}

const totalExpText = computed(() => {
  const te = resume.value?.totalExperience
  if (!te?.years && !te?.monthsRemainder) return null
  const parts: string[] = []
  if (te.years) parts.push(`${te.years} ${pluralRu(te.years, ['год', 'года', 'лет'])}`)
  if (te.monthsRemainder) parts.push(`${te.monthsRemainder} ${pluralRu(te.monthsRemainder, ['месяц', 'месяца', 'месяцев'])}`)
  return parts.join(' ')
})

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return forms[2]
  if (mod10 === 1) return forms[0]
  if (mod10 >= 2 && mod10 <= 4) return forms[1]
  return forms[2]
}

const fetchedAgo = computed(() => {
  if (!fetchedAt.value) return null
  const diff = Date.now() - new Date(fetchedAt.value).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} мин. назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${pluralRu(hours, ['час', 'часа', 'часов'])} назад`
  const days = Math.floor(hours / 24)
  return `${days} ${pluralRu(days, ['день', 'дня', 'дней'])} назад`
})

// ─────────────────────────────────────────────
// Действия
// ─────────────────────────────────────────────

function downloadRaw() {
  // Прямая ссылка — браузер сам сохранит.
  const url = `/api/candidates/${props.candidateId}/hh-resume/raw`
  window.open(url, '_blank')
}

function printResume() {
  // Используем window.print() — самый надёжный способ получить PDF без серверных зависимостей.
  // Печатается только секция с классом .resume-print через @media print.
  window.print()
}

function openOnHh() {
  if (resume.value?.alternateUrl) {
    window.open(resume.value.alternateUrl, '_blank', 'noopener')
  }
  else {
    toast.error('Нет ссылки на hh.ru в данных резюме')
  }
}
</script>

<template>
  <div>
    <!-- Empty state — нет hh-снепшота -->
    <div
      v-if="!hasSnapshot"
      class="rounded-lg border border-dashed border-surface-300 dark:border-surface-700 p-6 text-center"
    >
      <FileText class="size-8 mx-auto text-surface-400 dark:text-surface-500" />
      <p class="mt-2 text-sm text-surface-500 dark:text-surface-400">
        Резюме с hh.ru пока не подтянулось.
      </p>
      <p class="mt-1 text-xs text-surface-400 dark:text-surface-500">
        Снепшот появляется автоматически после первого синка hh-отклика.
      </p>
    </div>

    <!-- Loading -->
    <div v-else-if="status === 'pending'" class="flex items-center justify-center py-12 text-surface-400">
      <Loader2 class="size-5 animate-spin mr-2" />
      Загружаем резюме…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 p-4">
      <p class="text-sm text-rose-700 dark:text-rose-300">
        Не удалось загрузить резюме: {{ (error as any)?.statusMessage ?? 'неизвестная ошибка' }}
      </p>
      <button
        class="mt-2 inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
        @click="refresh()"
      >
        <RefreshCcw class="size-3" /> Повторить
      </button>
    </div>

    <!-- Resume view -->
    <article v-else-if="resume" class="resume-print space-y-6">
      <!-- Action toolbar — не печатаем -->
      <div class="no-print flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-surface-300 dark:border-surface-700 px-2.5 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800"
          :disabled="!resume.alternateUrl"
          @click="openOnHh"
        >
          <ExternalLink class="size-3.5" />
          Открыть на hh.ru
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-surface-300 dark:border-surface-700 px-2.5 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800"
          @click="printResume"
        >
          <Download class="size-3.5" />
          Сохранить в PDF
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-surface-300 dark:border-surface-700 px-2.5 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800"
          @click="downloadRaw"
        >
          <FileJson class="size-3.5" />
          Скачать JSON
        </button>
        <span v-if="fetchedAgo" class="ml-auto text-surface-400 dark:text-surface-500">
          Обновлено {{ fetchedAgo }}
        </span>
      </div>

      <!-- Header: title, salary, area -->
      <header class="border-b border-surface-200 dark:border-surface-700 pb-4">
        <h2 v-if="resume.title" class="text-xl font-semibold text-surface-900 dark:text-surface-100">
          {{ resume.title }}
        </h2>
        <p v-else class="text-sm italic text-surface-400">
          Желаемая должность не указана
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-surface-600 dark:text-surface-400">
          <span v-if="resume.salary?.amount" class="font-medium text-surface-900 dark:text-surface-100">
            {{ resume.salary.amount.toLocaleString('ru-RU') }} {{ resume.salary.currency }}
          </span>
          <span v-if="resume.area" class="inline-flex items-center gap-1">
            <MapPin class="size-3.5" />{{ resume.area }}
          </span>
          <span v-if="totalExpText" class="inline-flex items-center gap-1">
            <Calendar class="size-3.5" />Опыт {{ totalExpText }}
          </span>
          <span v-if="resume.employments?.length" class="text-xs">
            {{ resume.employments.join(', ') }}
          </span>
        </div>
      </header>

      <!-- Experience -->
      <section v-if="resume.experience.length">
        <h3 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-3">
          <Briefcase class="size-4" /> Опыт работы
        </h3>
        <ol class="space-y-4">
          <li
            v-for="(exp, i) in resume.experience"
            :key="i"
            class="border-l-2 border-surface-200 dark:border-surface-700 pl-4"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h4 class="text-sm font-semibold text-surface-900 dark:text-surface-100">
                {{ exp.position || '(должность не указана)' }}
              </h4>
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ fmtPeriod(exp.start, exp.end) }}
              </span>
            </div>
            <p v-if="exp.company" class="text-sm text-surface-600 dark:text-surface-300">
              {{ exp.company }}
            </p>
            <p
              v-if="exp.description"
              class="mt-2 whitespace-pre-line text-sm text-surface-700 dark:text-surface-300 leading-relaxed"
            >
              {{ exp.description }}
            </p>
          </li>
        </ol>
      </section>

      <!-- Education -->
      <section v-if="resume.education.length">
        <h3 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-3">
          <GraduationCap class="size-4" /> Образование
        </h3>
        <ul class="space-y-2">
          <li
            v-for="(ed, i) in resume.education"
            :key="i"
            class="text-sm"
          >
            <div class="font-medium text-surface-900 dark:text-surface-100">
              {{ ed.organization || '—' }}
              <span v-if="ed.year" class="ml-1 text-xs font-normal text-surface-500">({{ ed.year }})</span>
            </div>
            <div v-if="ed.name" class="text-surface-600 dark:text-surface-400">
              {{ ed.name }}
            </div>
          </li>
        </ul>
      </section>

      <!-- Skills -->
      <section v-if="resume.skills.length">
        <h3 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-3">
          <Sparkles class="size-4" /> Ключевые навыки
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="skill in resume.skills"
            :key="skill"
            class="inline-flex items-center rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs text-surface-700 dark:text-surface-300"
          >
            {{ skill }}
          </span>
        </div>
      </section>

      <!-- Languages -->
      <section v-if="resume.languages.length">
        <h3 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-3">
          <Languages class="size-4" /> Языки
        </h3>
        <ul class="text-sm space-y-1">
          <li v-for="(lng, i) in resume.languages" :key="i">
            <span class="font-medium">{{ lng.name }}</span>
            <span v-if="lng.level" class="text-surface-500 dark:text-surface-400"> — {{ lng.level }}</span>
          </li>
        </ul>
      </section>

      <!-- About -->
      <section v-if="resume.about">
        <h3 class="text-sm font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 mb-3">
          О себе
        </h3>
        <p class="whitespace-pre-line text-sm text-surface-700 dark:text-surface-300 leading-relaxed">
          {{ resume.about }}
        </p>
      </section>
    </article>
  </div>
</template>

<style scoped>
/* При печати — печатаем только это резюме, остальное скрыто через @media print в layout-уровне. */
@media print {
  .no-print { display: none !important; }
  .resume-print { font-size: 11pt; color: #000; }
  .resume-print h2 { font-size: 18pt; }
  .resume-print h3 { font-size: 12pt; }
  .resume-print h4 { font-size: 11pt; }
}
</style>
