<script setup lang="ts">
import {
  ArrowLeft, MapPin, Briefcase, CheckCircle2, XCircle, Sparkles, Info,
  BadgeCheck, BadgeX, FileText,
} from 'lucide-vue-next'
import type { HmApplicationResponse } from '~/composables/useHmApi'

definePageMeta({
  layout: 'hm',
  middleware: ['auth', 'require-org', 'require-hm'],
})

const route = useRoute()
const applicationId = computed(() => String(route.params.id))
const { fetchApplication, submitDecision } = useHmApi()
const toast = useToast()
const localePath = useLocalePath()

useSeoMeta({ title: 'Кандидат — Huntfork' })

const { data, pending, error, refresh } = await useAsyncData<HmApplicationResponse>(
  () => `hm-app-${applicationId.value}`,
  () => fetchApplication(applicationId.value),
  { server: false, watch: [applicationId] },
)

// ─── UI-состояние решения ───
const isDeciding = ref(false)
const decidingKind = ref<'approved' | 'rejected' | null>(null)
const comment = ref('')
const decisionError = ref('')

function formatSalary(s: { amount?: number; currency?: string } | null) {
  if (!s || !s.amount) return null
  const cur = (s.currency || 'RUR').toUpperCase()
  const currency = cur === 'RUR' ? '₽' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur
  return `${s.amount.toLocaleString('ru-RU')} ${currency}`
}

function formatExperience(months?: number) {
  if (!months || months <= 0) return ''
  const years = Math.floor(months / 12)
  const rest = months % 12
  const parts: string[] = []
  if (years > 0) parts.push(`${years} год${years === 1 ? '' : years >= 2 && years <= 4 ? 'а' : 'ов'}`)
  if (rest > 0) parts.push(`${rest} мес.`)
  return parts.join(' ') || `${months} мес.`
}

function formatDateRange(start?: string, end?: string) {
  if (!start) return ''
  const fmt = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
  }
  const from = fmt(start)
  const to = end ? fmt(end) : 'н.в.'
  return `${from} — ${to}`
}

async function decide(kind: 'approved' | 'rejected') {
  if (!data.value) return
  decisionError.value = ''
  isDeciding.value = true
  decidingKind.value = kind
  try {
    const result = await submitDecision({
      applicationId: applicationId.value,
      decision: kind,
      comment: comment.value.trim() || undefined,
    })
    toast.success(
      kind === 'approved' ? 'Кандидат одобрен' : 'Кандидат отклонён',
      `Кандидат перемещён в «${result.stage?.toStageName ?? result.decision.targetStage}»`,
    )
    comment.value = ''
    await refresh()
  }
  catch (err: any) {
    // Обработка 409 — уже вынесено другим НМ
    if (err?.statusCode === 409 || err?.data?.statusCode === 409) {
      const conflict = err?.data?.data ?? err?.response?._data?.data
      decisionError.value = conflict?.existingDecision
        ? `Другой НМ уже ${conflict.existingDecision === 'approved' ? 'одобрил' : 'отклонил'} этого кандидата`
        : 'Кандидат уже обработан другим НМ'
      await refresh()
    }
    else {
      const msg = err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? 'Не удалось сохранить решение'
      decisionError.value = String(msg)
      toast.error('Ошибка', { message: String(msg) })
    }
  }
  finally {
    isDeciding.value = false
    decidingKind.value = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <NuxtLink
      :to="localePath('/hm/dashboard')"
      class="inline-flex items-center gap-1.5 text-sm text-surface-500 no-underline hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100"
    >
      <ArrowLeft class="size-4" />
      К моим кандидатам
    </NuxtLink>

    <div v-if="pending" class="text-sm text-surface-500">
      Загружаем…
    </div>

    <div
      v-else-if="error || !data"
      class="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300"
    >
      {{ error ? `Не удалось загрузить: ${error.message}` : 'Кандидат не найден' }}
    </div>

    <template v-else>
      <!-- Шапка -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
            <Briefcase class="size-3.5" />
            <NuxtLink
              :to="localePath(`/hm/jobs/${data.job.id}`)"
              class="truncate no-underline hover:text-surface-900 dark:hover:text-surface-100"
            >
              {{ data.job.title }}
            </NuxtLink>
            <span v-if="data.job.location" class="text-surface-400">·</span>
            <span v-if="data.job.location" class="inline-flex items-center gap-1 text-xs">
              <MapPin class="size-3" />{{ data.job.location }}
            </span>
          </div>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-surface-900 dark:text-surface-100">
            {{ data.candidate.fullName }}
          </h1>
          <div v-if="data.candidate.city" class="mt-1 text-sm text-surface-500 dark:text-surface-400">
            {{ data.candidate.city }}
          </div>
        </div>

        <div class="shrink-0">
          <span
            v-if="data.application.currentStage"
            class="inline-flex items-center rounded-full border border-surface-200 bg-surface-50 px-3 py-1 text-xs font-medium text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300"
          >
            {{ data.application.currentStage.name }}
          </span>
        </div>
      </div>

      <!-- Уже вынесенное решение (кем-то) -->
      <UiCard
        v-if="data.effectiveDecision"
        variant="tinted"
        :tone="data.effectiveDecision.decision === 'approved' ? 'success' : 'warning'"
      >
        <div class="flex items-start gap-3">
          <component
            :is="data.effectiveDecision.decision === 'approved' ? BadgeCheck : BadgeX"
            class="mt-0.5 size-5 shrink-0"
          />
          <div class="flex-1">
            <div class="text-sm font-medium text-surface-900 dark:text-surface-100">
              {{ data.effectiveDecision.decision === 'approved' ? 'Кандидат одобрен' : 'Кандидат отклонён' }}
            </div>
            <div class="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
              Решение вынесено {{ new Date(data.effectiveDecision.decidedAt).toLocaleString('ru-RU') }}
            </div>
            <div v-if="data.effectiveDecision.comment" class="mt-2 text-sm text-surface-700 dark:text-surface-300">
              {{ data.effectiveDecision.comment }}
            </div>
          </div>
        </div>
      </UiCard>

      <!-- Основная карточка кандидата -->
      <div class="grid gap-6 lg:grid-cols-3">
        <div class="space-y-6 lg:col-span-2">
          <UiCard v-if="data.candidate.aiSummary">
            <div class="mb-2 flex items-center gap-2 text-sm font-medium text-surface-900 dark:text-surface-100">
              <Sparkles class="size-4 text-brand-600 dark:text-brand-400" />
              Кратко о кандидате
            </div>
            <p class="whitespace-pre-line text-sm leading-relaxed text-surface-700 dark:text-surface-300">
              {{ data.candidate.aiSummary }}
            </p>
          </UiCard>

          <!-- Структурированное резюме hh.ru (без PII) -->
          <UiCard v-if="data.candidate.resume">
            <div class="mb-3 flex items-center gap-2 text-sm font-medium text-surface-900 dark:text-surface-100">
              <FileText class="size-4 text-brand-600 dark:text-brand-400" />
              Резюме кандидата
            </div>

            <div class="space-y-4 text-sm text-surface-700 dark:text-surface-300">
              <!-- Header резюме -->
              <div v-if="data.candidate.resume.title || data.candidate.resume.totalExperienceMonths" class="space-y-1">
                <div v-if="data.candidate.resume.title" class="text-base font-semibold text-surface-900 dark:text-surface-100">
                  {{ data.candidate.resume.title }}
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
                  <span v-if="data.candidate.resume.area">{{ data.candidate.resume.area }}</span>
                  <span v-if="data.candidate.resume.totalExperienceMonths">
                    Опыт: {{ formatExperience(data.candidate.resume.totalExperienceMonths) }}
                  </span>
                </div>
              </div>

              <!-- О себе -->
              <div v-if="data.candidate.resume.about">
                <div class="mb-1 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">О себе</div>
                <p class="whitespace-pre-line leading-relaxed">{{ data.candidate.resume.about }}</p>
              </div>

              <!-- Ключевые навыки -->
              <div v-if="data.candidate.resume.keySkills && data.candidate.resume.keySkills.length">
                <div class="mb-1 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">Ключевые навыки</div>
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="skill in data.candidate.resume.keySkills"
                    :key="skill"
                    class="rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5 text-xs"
                  >{{ skill }}</span>
                </div>
              </div>

              <!-- Опыт работы -->
              <div v-if="data.candidate.resume.experiences && data.candidate.resume.experiences.length">
                <div class="mb-2 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">Опыт работы</div>
                <div class="space-y-3">
                  <div
                    v-for="(exp, idx) in data.candidate.resume.experiences"
                    :key="idx"
                    class="border-l-2 border-surface-200 dark:border-surface-800 pl-3"
                  >
                    <div class="font-medium text-surface-900 dark:text-surface-100">{{ exp.position || '—' }}</div>
                    <div class="text-xs text-surface-500 dark:text-surface-400">
                      {{ exp.company || '' }}<span v-if="exp.start">, {{ formatDateRange(exp.start, exp.end) }}</span>
                    </div>
                    <p v-if="exp.description" class="mt-1 whitespace-pre-line text-xs leading-relaxed">
                      {{ exp.description }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- Образование -->
              <div v-if="data.candidate.resume.education && data.candidate.resume.education.length">
                <div class="mb-2 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">Образование</div>
                <ul class="space-y-1 text-xs">
                  <li v-for="(ed, idx) in data.candidate.resume.education" :key="idx">
                    <span class="font-medium text-surface-900 dark:text-surface-100">{{ ed.name || ed.organization || '—' }}</span>
                    <span v-if="ed.organization && ed.name" class="text-surface-500">, {{ ed.organization }}</span>
                    <span v-if="ed.result" class="text-surface-500">, {{ ed.result }}</span>
                    <span v-if="ed.year" class="text-surface-500"> — {{ ed.year }}</span>
                  </li>
                </ul>
              </div>

              <!-- Языки -->
              <div v-if="data.candidate.resume.languages && data.candidate.resume.languages.length">
                <div class="mb-1 text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">Языки</div>
                <div class="flex flex-wrap gap-1.5 text-xs">
                  <span
                    v-for="(lang, idx) in data.candidate.resume.languages"
                    :key="idx"
                    class="rounded-md bg-surface-100 dark:bg-surface-800 px-2 py-0.5"
                  >{{ lang.name || '—' }}<span v-if="lang.level" class="text-surface-500"> — {{ lang.level }}</span></span>
                </div>
              </div>
            </div>
          </UiCard>

          <UiCard v-else-if="!data.candidate.aiSummary" variant="dashed">
            <div class="flex items-center gap-2 py-2 text-sm text-surface-500 dark:text-surface-400">
              <Info class="size-4" />
              Резюме кандидата ещё не загружено. Попросите рекрутёра обновить данные с hh.ru.
            </div>
          </UiCard>
        </div>

        <div class="space-y-3">
          <UiCard>
            <dl class="space-y-3 text-sm">
              <div v-if="data.permissions.canViewSalary">
                <dt class="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">
                  Ожидания по зарплате
                </dt>
                <dd class="mt-1 font-medium text-surface-900 dark:text-surface-100">
                  {{ formatSalary(data.candidate.expectedSalary) || 'Не указано' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs uppercase tracking-wide text-surface-500 dark:text-surface-400">
                  Отклик
                </dt>
                <dd class="mt-1 text-surface-700 dark:text-surface-300">
                  {{ new Date(data.application.createdAt).toLocaleDateString('ru-RU') }}
                </dd>
              </div>
            </dl>
          </UiCard>
        </div>
      </div>

      <!-- Форма решения -->
      <UiCard v-if="data.canDecide">
        <div class="mb-3">
          <h2 class="text-base font-semibold text-surface-900 dark:text-surface-100">
            Ваше решение
          </h2>
          <p class="mt-1 text-sm text-surface-500 dark:text-surface-400">
            Одобряете кандидата на дальнейшее интервью или отклоняете?
          </p>
        </div>

        <div class="space-y-3">
          <textarea
            v-model="comment"
            rows="3"
            placeholder="Комментарий (необязательно) — что понравилось / что смутило"
            class="w-full rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-100 dark:placeholder:text-surface-500 dark:focus:ring-brand-950"
          />

          <div
            v-if="decisionError"
            class="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300"
          >
            {{ decisionError }}
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <UiButton
              variant="primary"
              :loading="isDeciding && decidingKind === 'approved'"
              :disabled="isDeciding"
              @click="decide('approved')"
            >
              <CheckCircle2 class="size-4" />
              <span class="ml-1.5">Одобрить</span>
            </UiButton>
            <UiButton
              variant="secondary"
              :loading="isDeciding && decidingKind === 'rejected'"
              :disabled="isDeciding"
              @click="decide('rejected')"
            >
              <XCircle class="size-4" />
              <span class="ml-1.5">Отклонить</span>
            </UiButton>
          </div>
        </div>
      </UiCard>

      <UiCard v-else-if="!data.effectiveDecision" variant="dashed">
        <div class="flex items-center gap-2 py-3 text-sm text-surface-500 dark:text-surface-400">
          <Info class="size-4" />
          Кандидат уже не на этапе «Неразобранные» — решение недоступно
        </div>
      </UiCard>
    </template>
  </div>
</template>
