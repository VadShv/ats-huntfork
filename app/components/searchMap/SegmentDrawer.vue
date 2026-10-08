<script setup lang="ts">
/**
 * SegmentDrawer — форма правки гипотезы поиска (в БД/API — segment).
 * docs/tz-search-map.md §11.2 SegmentDrawer; docs/tz-search-map-v2.md §3.4–3.5, §6.3
 */
import { Copy, ExternalLink, Sparkles, Wand2 } from 'lucide-vue-next'
import { buildQueryString as buildQueryByCode, detectQueryLanguage } from '~~/shared/searchMap/queryBuilder'
import CreateHhSearchModal from './CreateHhSearchModal.vue'

const props = defineProps<{
  modelValue: boolean
  segment: {
    segment: {
      id: string; name: string; donorLayer?: string | null; donorIds?: string[]
      titles: string[]; keywords: string[]; geo: string[]
      channelId?: string | null; queryString?: string | null; queryUrl?: string | null
      priority: string; poolEstimate?: number | null; responseLikelihood?: number | null; accessDifficulty?: number | null
      hypothesisStatus: string; rationale?: string | null; resultNote?: string | null; isArchived: boolean
    }
    channel?: { id: string; code: string; name: string; urlTemplate?: string | null; targetSite?: string | null } | null
    hhSearchesCount: number
  } | null
  jobId: string
  channels: { id: string; code: string; name: string; urlTemplate?: string | null; targetSite?: string | null; queryLanguageHint?: string | null }[]
  donors: { donor: { id: string }; company: { canonicalName: string } }[]
  /** Пункты секции «Исключения» — уходят в NOT (...) при сборке запроса кодом */
  exclusions?: string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [v: boolean]; updated: [] }>()

const toast = useToast()
const saving = ref(false)
const showHhModal = ref(false)

const form = reactive({
  name: '',
  donorLayer: '' as string,
  donorIds: [] as string[],
  titles: [] as string[],
  keywords: [] as string[],
  geo: [] as string[],
  channelId: '' as string,
  queryString: '',
  priority: 'medium' as string,
  poolEstimate: 0 as number,
  responseLikelihood: 0 as number,
  accessDifficulty: 0 as number,
  hypothesisStatus: 'untested' as string,
  rationale: '',
  resultNote: '',
})

const titleInput = ref('')
const keywordInput = ref('')
const geoInput = ref('')

watch(() => props.segment, (s) => {
  if (s) {
    const seg = s.segment
    form.name = seg.name
    form.donorLayer = seg.donorLayer ?? ''
    form.donorIds = seg.donorIds ?? []
    form.titles = [...seg.titles]
    form.keywords = [...seg.keywords]
    form.geo = [...seg.geo]
    form.channelId = seg.channelId ?? ''
    form.queryString = seg.queryString ?? ''
    form.priority = seg.priority
    form.poolEstimate = seg.poolEstimate ?? 0
    form.responseLikelihood = seg.responseLikelihood ?? 0
    form.accessDifficulty = seg.accessDifficulty ?? 0
    form.hypothesisStatus = seg.hypothesisStatus
    form.rationale = seg.rationale ?? ''
    form.resultNote = seg.resultNote ?? ''
  }
}, { immediate: true })

const selectedChannel = computed(() => props.channels.find(c => c.id === form.channelId))

const fullQueryString = computed(() => {
  if (selectedChannel.value?.targetSite && form.queryString) {
    return `site:${selectedChannel.value.targetSite} ${form.queryString}`
  }
  return form.queryString
})

const queryUrl = computed(() => {
  const ch = selectedChannel.value
  if (!ch || !form.queryString) return null
  let query = form.queryString
  if (ch.targetSite) query = `site:${ch.targetSite} ${query}`
  // Шаблон URL берём у выбранного канала (пользователь мог сменить канал в форме),
  // и только потом — у канала, сохранённого в сегменте.
  const template = ch.urlTemplate ?? props.segment?.channel?.urlTemplate
  if (!template) return null
  let url = template.replace('{query}', encodeURIComponent(query))
  if (form.titles.length) url = url.replace('{title}', encodeURIComponent(form.titles[0] ?? ''))
  if (form.geo.length) url = url.replace('{geo}', encodeURIComponent(form.geo[0] ?? ''))
  return url
})

function addTitle() {
  const v = titleInput.value.trim()
  if (v && !form.titles.includes(v)) form.titles.push(v)
  titleInput.value = ''
}
function addKeyword() {
  const v = keywordInput.value.trim()
  if (v && !form.keywords.includes(v)) form.keywords.push(v)
  keywordInput.value = ''
}
function addGeo() {
  const v = geoInput.value.trim()
  if (v && !form.geo.includes(v)) form.geo.push(v)
  geoInput.value = ''
}
function removeItem(arr: string[], idx: number) { arr.splice(idx, 1) }

async function save() {
  if (!props.segment) return
  saving.value = true
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/segments/${props.segment.segment.id}`, {
      method: 'PATCH',
      body: {
        name: form.name,
        donorLayer: form.donorLayer || null,
        donorIds: form.donorIds,
        titles: form.titles,
        keywords: form.keywords,
        geo: form.geo,
        channelId: form.channelId || null,
        queryString: form.queryString || null,
        priority: form.priority,
        poolEstimate: form.poolEstimate || null,
        responseLikelihood: form.responseLikelihood || null,
        accessDifficulty: form.accessDifficulty || null,
        hypothesisStatus: form.hypothesisStatus,
        rationale: form.rationale || null,
        resultNote: form.resultNote || null,
      },
    })
    toast.success('Сохранено')
    emit('updated')
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  } finally {
    saving.value = false
  }
}

async function archive() {
  if (!props.segment) return
  try {
    await $fetch(`/api/jobs/${props.jobId}/search-map/segments/${props.segment.segment.id}/archive`, { method: 'POST' })
    toast.success('Архивировано')
    emit('updated')
    emit('update:modelValue', false)
  } catch (e: any) {
    toast.error(e?.statusMessage ?? 'Ошибка')
  }
}

function copyQuery() {
  navigator.clipboard.writeText(fullQueryString.value)
  toast.success('Скопировано')
}

function openInChannel() {
  if (queryUrl.value) window.open(queryUrl.value, '_blank')
}

/**
 * Собрать строку запроса кодом (ТЗ §6.3) — та же функция, что на сервере при генерации,
 * поэтому «Собрать» на экране и авто-запрос у ИИ-гипотезы совпадают. Язык зависит от канала.
 */
function buildQueryString() {
  form.queryString = buildQueryByCode(
    { titles: form.titles, keywords: form.keywords, geo: form.geo },
    selectedChannel.value ?? null,
    props.exclusions ?? [],
  )
}
const queryLanguageLabel = computed(() => {
  const lang = detectQueryLanguage(selectedChannel.value ?? null)
  return lang === 'xray' ? 'Google x-ray' : lang === 'plain' ? 'обычный текст' : 'boolean (AND / OR / NOT)'
})

// ── ИИ: переписать запрос (единственная замена в дровере — через «было / стало») ──
const showRewrite = ref(false)
const rewriteHint = ref('')
const rewriting = ref(false)
const rewriteProposal = ref<{ queryString: string; previous: string | null; explanation: string | null } | null>(null)

async function proposeRewrite() {
  if (!props.segment || !rewriteHint.value.trim() || rewriting.value) return
  rewriting.value = true
  try {
    const res = await $fetch(`/api/jobs/${props.jobId}/search-map/generate`, {
      method: 'POST',
      body: { scope: 'query_string', segmentId: props.segment.segment.id, hint: rewriteHint.value.trim().slice(0, 500) },
      timeout: 320_000,
    }) as any
    rewriteProposal.value = { queryString: res.queryString, previous: form.queryString || res.previous || null, explanation: res.explanation ?? null }
  } catch (e: any) {
    const msg = e?.data?.statusMessage ?? e?.statusMessage
    toast.error('Не удалось переписать запрос', { message: msg && msg !== 'Internal Server Error' ? msg : 'Проверьте настройки ИИ' })
  } finally {
    rewriting.value = false
  }
}

function applyRewrite() {
  if (!rewriteProposal.value) return
  form.queryString = rewriteProposal.value.queryString
  rewriteProposal.value = null
  showRewrite.value = false
  rewriteHint.value = ''
  toast.success('Запрос подставлен в форму', 'Не забудьте сохранить гипотезу')
}

function cancelRewrite() {
  rewriteProposal.value = null
  showRewrite.value = false
}

// ── ИИ: ещё похожие гипотезы — подсказка собирается из текущей ──
const similarHint = computed(() => {
  const parts: string[] = []
  if (form.donorLayer) parts.push(`слой ${form.donorLayer}`)
  if (form.titles.length) parts.push(`близкие к «${form.titles.slice(0, 2).join('», «')}»`)
  if (selectedChannel.value) parts.push(`канал ${selectedChannel.value.name} или соседние`)
  return `Похожие на «${form.name}»: ${parts.join(', ')}. Другие тайтлы, слои или каналы — не дубли.`
})

const layerOptions = [
  { label: 'Ядро', value: 'core' }, { label: 'Смежный', value: 'adjacent' },
  { label: 'Школы', value: 'school' }, { label: 'Alumni', value: 'alumni' }, { label: 'Своё', value: 'custom' },
]
const priorityOptions = [{ label: 'Высокий', value: 'high' }, { label: 'Средний', value: 'medium' }, { label: 'Низкий', value: 'low' }]
const statusOptions = [
  { label: 'Не проверена', value: 'untested' }, { label: 'В работе', value: 'in_progress' },
  { label: 'Работает', value: 'working' }, { label: 'Отклонена', value: 'rejected' },
]
const channelOptions = computed(() => props.channels.map(c => ({ label: c.name, value: c.id })))
const scoreOptions = [{ label: '—', value: 0 }, { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }]
// Код системного канала hh — 'hh' (server/utils/searchMap/seed.ts). Раньше проверялись
// несуществующие 'hh_ru'/'hh_ru_resumes', и кнопка «Создать поиск hh» никогда не показывалась.
const isHhChannel = computed(() => selectedChannel.value?.code === 'hh')
</script>

<template>
  <UiDrawer :model-value="modelValue" width="lg" @update:model-value="emit('update:modelValue', $event)">
    <template #header>
      <h3 class="text-lg font-semibold">{{ form.name || 'Гипотеза поиска' }}</h3>
    </template>

    <div v-if="segment" class="space-y-4">
      <!-- Name -->
      <div>
        <label class="mb-1 block text-sm font-medium">Название</label>
        <UiInput v-model="form.name" />
      </div>

      <!-- Layer + Priority -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-sm font-medium">Слой доноров</label>
          <UiSelect v-model="form.donorLayer" :options="layerOptions" />
        </div>
        <div>
          <label class="mb-1 block text-sm font-medium">Приоритет</label>
          <UiSelect v-model="form.priority" :options="priorityOptions" />
        </div>
      </div>

      <!-- Titles (chips) -->
      <div>
        <label class="mb-1 block text-sm font-medium">Должности (как пишут в резюме)</label>
        <div class="flex flex-wrap gap-1">
          <UiBadge v-for="(t, i) in form.titles" :key="i" tone="neutral" class="cursor-pointer" @click="removeItem(form.titles, i)">{{ t }} ✕</UiBadge>
        </div>
        <UiInput v-model="titleInput" placeholder="Добавить тайтл…" class="mt-1" @keyup.enter="addTitle" />
      </div>

      <!-- Keywords (chips) -->
      <div>
        <label class="mb-1 block text-sm font-medium">Ключевые слова</label>
        <div class="flex flex-wrap gap-1">
          <UiBadge v-for="(k, i) in form.keywords" :key="i" tone="neutral" class="cursor-pointer" @click="removeItem(form.keywords, i)">{{ k }} ✕</UiBadge>
        </div>
        <UiInput v-model="keywordInput" placeholder="Добавить ключевое слово…" class="mt-1" @keyup.enter="addKeyword" />
      </div>

      <!-- Geo (chips) -->
      <div>
        <label class="mb-1 block text-sm font-medium">Гео</label>
        <div class="flex flex-wrap gap-1">
          <UiBadge v-for="(g, i) in form.geo" :key="i" tone="neutral" class="cursor-pointer" @click="removeItem(form.geo, i)">{{ g }} ✕</UiBadge>
        </div>
        <UiInput v-model="geoInput" placeholder="Добавить гео…" class="mt-1" @keyup.enter="addGeo" />
      </div>

      <!-- Channel -->
      <div>
        <label class="mb-1 block text-sm font-medium">Канал</label>
        <UiSelect v-model="form.channelId" :options="channelOptions" />
      </div>

      <!-- Query string -->
      <div>
        <div class="mb-1 flex items-center justify-between">
          <label class="text-sm font-medium">Строка запроса <span class="font-normal text-surface-400">· {{ queryLanguageLabel }}</span></label>
          <div class="flex gap-1">
            <UiButton size="xs" variant="ghost" title="Собрать из тайтлов, ключевых слов, гео и исключений — без ИИ" @click="buildQueryString"><Wand2 class="mr-1 size-3" />Собрать</UiButton>
            <UiButton size="xs" variant="ghost" title="Модель перепишет запрос по вашей подсказке; вы увидите «было / стало»" @click="showRewrite = !showRewrite"><Sparkles class="mr-1 size-3" />С ИИ</UiButton>
            <UiButton size="xs" variant="ghost" title="Скопировать" @click="copyQuery"><Copy class="size-3" /></UiButton>
            <UiButton v-if="queryUrl" size="xs" variant="ghost" title="Открыть в канале" @click="openInChannel"><ExternalLink class="size-3" /></UiButton>
          </div>
        </div>
        <div v-if="selectedChannel?.targetSite" class="mb-1 rounded bg-surface-100 px-2 py-1 text-xs text-surface-500 dark:bg-surface-800">
          site:{{ selectedChannel.targetSite }} <span class="text-surface-400">(добавляется автоматически)</span>
        </div>
        <UiTextarea v-model="form.queryString" :rows="2" placeholder="Нажмите «Собрать» или напишите вручную…" />

        <!-- Переписать с ИИ -->
        <div v-if="showRewrite" class="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900 dark:bg-brand-950/30">
          <template v-if="!rewriteProposal">
            <label class="block text-xs font-medium text-surface-700 dark:text-surface-300">Что изменить в запросе? <span class="text-danger-600">*</span></label>
            <div class="flex gap-1">
              <UiInput v-model="rewriteHint" size="sm" class="flex-1" maxlength="500" placeholder="Например: «добавь английские синонимы и убери junior»" @keyup.enter="proposeRewrite" />
              <UiButton size="sm" variant="primary" :loading="rewriting" :disabled="!rewriteHint.trim()" @click="proposeRewrite">Предложить</UiButton>
              <UiButton size="sm" variant="ghost" @click="cancelRewrite">✕</UiButton>
            </div>
            <p class="text-xs text-surface-400">Без подсказки запрос лучше собрать кодом — это быстрее и бесплатно.</p>
          </template>
          <template v-else>
            <div class="grid gap-2 sm:grid-cols-2">
              <div>
                <div class="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-surface-400">Было</div>
                <code class="block whitespace-pre-wrap break-words rounded bg-surface-100 px-2 py-1.5 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">{{ rewriteProposal.previous || '— пусто —' }}</code>
              </div>
              <div>
                <div class="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600">Стало</div>
                <code class="block whitespace-pre-wrap break-words rounded bg-white px-2 py-1.5 text-xs text-surface-900 ring-1 ring-brand-200 dark:bg-surface-900 dark:text-surface-50 dark:ring-brand-800">{{ rewriteProposal.queryString }}</code>
              </div>
            </div>
            <p v-if="rewriteProposal.explanation" class="text-xs text-surface-500">{{ rewriteProposal.explanation }}</p>
            <div class="flex justify-end gap-1">
              <UiButton size="xs" variant="ghost" @click="cancelRewrite">Оставить как было</UiButton>
              <UiButton size="xs" variant="primary" @click="applyRewrite">Подставить</UiButton>
            </div>
          </template>
        </div>
      </div>

      <!-- Scores -->
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium">Пул</label>
          <UiSelect v-model="form.poolEstimate" :options="scoreOptions" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium">Отклик</label>
          <UiSelect v-model="form.responseLikelihood" :options="scoreOptions" />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium">Доступ</label>
          <UiSelect v-model="form.accessDifficulty" :options="scoreOptions" />
        </div>
      </div>

      <!-- Status -->
      <div>
        <label class="mb-1 block text-sm font-medium">Статус гипотезы</label>
        <UiSelect v-model="form.hypothesisStatus" :options="statusOptions" />
      </div>

      <!-- Rationale + Result -->
      <div>
        <label class="mb-1 block text-sm font-medium">Почему сработает</label>
        <UiTextarea v-model="form.rationale" :rows="2" />
      </div>
      <div>
        <label class="mb-1 block text-sm font-medium">Результат проверки</label>
        <UiTextarea v-model="form.resultNote" :rows="2" />
      </div>

      <!-- HH bridge -->
      <div v-if="isHhChannel" class="rounded-lg border border-surface-200 p-3 dark:border-surface-800">
        <div class="flex items-center justify-between">
          <span class="text-sm text-surface-600 dark:text-surface-400">hh-поиски: {{ segment.hhSearchesCount }}</span>
          <UiButton size="sm" @click="showHhModal = true">Создать поиск hh</UiButton>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <UiButton variant="ghost" class="text-danger-600" @click="archive">Архивировать</UiButton>
        <div class="flex items-center gap-2">
          <SearchMapAiAssist
            v-if="segment"
            :job-id="jobId"
            scope="segments"
            label="Ещё похожие"
            size="sm"
            :limit="3"
            :preset-hint="similarHint"
            @done="emit('updated')"
          />
          <UiButton :loading="saving" @click="save">Сохранить</UiButton>
        </div>
      </div>
    </template>
  </UiDrawer>

  <CreateHhSearchModal
    v-model="showHhModal"
    :job-id="jobId"
    :segment="segment"
    :query-string="fullQueryString"
    :segment-id="segment?.segment.id"
  />
</template>
