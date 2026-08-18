<script setup lang="ts">
/**
 * Спринт 13.3: единый блок быстрых действий по отклику.
 *
 * Используется на странице отклика, в полуокне (drawer) и в воронке вакансии —
 * один источник истины для набора кнопок, чтобы статусы, состояния и
 * действия были синхронизированы во всей системе.
 *
 * Режимы:
 *  - Вакансия с hh-воронкой → кнопки по этапам: Пригласить / Подумать / Отказать / Ещё ▾.
 *    Спринт 13.4: «Пригласить» переводит на «Первичный контакт» (type=contact) —
 *    при включённом пуше кандидат на hh.ru получает приглашение связаться.
 *    Спринт 18.x: действие «Интервью» объединено с планированием — перевод на
 *    этап типа interview открывает календарь планирования интервью (emit schedule),
 *    и наоборот: кнопка «Интервью» переводит на этап и открывает календарь.
 *  - Без воронки → legacy-переходы статуса (русифицированы), выполняет родитель.
 *
 * Спринт 15.2: меню «Ещё» показывает полное дерево воронки — root-этапы
 * с подэтапами (с отступом), включая переводы на подэтапы.
 * Спринт 15.3: горячие клавиши (prop hotkeys):
 *   1 — Пригласить, 2 — Подумать, 3 — Отказать, 4 — Ещё ▾, 5 — Запланировать интервью.
 *   При открытом меню «Ещё» цифры 1–9 выбирают пункты меню. Esc — закрыть.
 */
import { ThumbsUp, Hourglass, CircleSlash, ChevronDown, Calendar, Check, CornerDownRight } from 'lucide-vue-next'
import { APPLICATION_STATUS_TRANSITIONS } from '~~/shared/status-transitions'
import { usePreviewReadOnly } from '~/composables/usePreviewReadOnly'

const props = defineProps<{
  applicationId: string
  currentStageId: string | null
  status: string
  disabled?: boolean
  hotkeys?: boolean
}>()

const emit = defineEmits<{
  'stage-changed': [payload: { newStageId: string, newStageName: string, newStageColor: string }]
  'legacy-transition': [newStatus: string]
  'schedule': []
}>()

const { handlePreviewReadOnlyError } = usePreviewReadOnly()
const toast = useToast()
const { t } = useI18n()

// ─── Этапы воронки ────────────────────────────────────────────────────────────

interface QuickStage {
  id: string
  name: string
  color: string
  type: string
  displayOrder: number
  isTerminal: boolean
  isArchived: boolean
  isCurrent: boolean
  bucket?: string | null
  parentStageId?: string | null
  isHidden?: boolean | null
}

const quickStages = ref<QuickStage[]>([])
// Пока этапы не загружены, hasHhPipeline == false — без этого флага на пол
// секунды мигают legacy-кнопки, которые затем заменяются кнопками воронки.
// Скелетон вместо фолбэка + сброс сталых этапов при смене отклика.
const stagesReady = ref(false)
let stagesRequestId = 0
async function loadQuickStages() {
  const reqId = ++stagesRequestId
  stagesReady.value = false
  quickStages.value = []
  try {
    const res = await $fetch<QuickStage[]>(`/api/applications/${props.applicationId}/stages`)
    if (reqId === stagesRequestId) quickStages.value = res
  }
  catch {
    if (reqId === stagesRequestId) quickStages.value = []
  }
  finally {
    if (reqId === stagesRequestId) stagesReady.value = true
  }
}
onMounted(loadQuickStages)
watch(() => props.applicationId, loadQuickStages)

const NEW_STAGE_TYPES = ['on_hold', 'contact', 'assessment', 'not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred']
const hasHhPipeline = computed(() => quickStages.value.some(s => NEW_STAGE_TYPES.includes(s.type)))
// Аудит синхронизации (Д-1): этапная ветка для ЛЮБОЙ воронки (не только hh-стиля) —
// легаси-переходы показываем только когда у вакансии вовсе нет воронки
// (сервер теперь отклоняет легаси-смену статуса при наличии воронки).
const hasPipeline = computed(() => rootQuickStages.value.length > 0)

// Root-этапы: не архивные, не скрытые, без родителя
const rootQuickStages = computed(() => quickStages.value
  .filter(s => !s.isArchived && !s.isHidden && !s.parentStageId)
  .sort((a, b) => a.displayOrder - b.displayOrder))

function firstRootOfType(type: string): QuickStage | null {
  return rootQuickStages.value.find(s => s.type === type) ?? null
}

// Основные кнопки в стиле hh.ru: Пригласить / Подумать / Отказать.
// Спринт 13.4: «Пригласить» → «Первичный контакт» (contact), а не сразу интервью.
// Фолбэк на interview — для воронок без этапа первичного контакта.
const inviteStage = computed(() => firstRootOfType('contact') ?? firstRootOfType('interview'))
const considerStage = computed(() => firstRootOfType('on_hold'))
// Спринт 22: после M1 «Не подходит» — подэтап родителя «Отказ». Ищем где угодно:
// сначала подэтап not_fit, затем корневой (legacy-воронки без родителя).
const rejectStage = computed(() => {
  const active = quickStages.value.filter(s => !s.isArchived && !s.isHidden && s.type === 'not_fit')
  return active.find(s => s.parentStageId) ?? active.find(s => !s.parentStageId) ?? null
})
// Объединённое действие «Интервью»: перевод на этап + открытие календаря планирования
const interviewStage = computed(() => firstRootOfType('interview'))

// ─── Спринт 15.2: полное дерево воронки в меню «Ещё» (root-этапы + подэтапы) ──

interface MenuItem {
  stage: QuickStage
  isSub: boolean
}

const subsByParent = computed(() => {
  const map = new Map<string, QuickStage[]>()
  for (const s of quickStages.value) {
    if (!s.parentStageId || s.isArchived || s.isHidden) continue
    const arr = map.get(s.parentStageId) ?? []
    arr.push(s)
    map.set(s.parentStageId, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.displayOrder - b.displayOrder)
  return map
})

const menuWorkingItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  for (const root of rootQuickStages.value) {
    if (root.bucket === 'rejected') continue
    items.push({ stage: root, isSub: false })
    for (const sub of subsByParent.value.get(root.id) ?? []) items.push({ stage: sub, isSub: true })
  }
  return items
})

const menuRejectItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []
  for (const root of rootQuickStages.value) {
    if (root.bucket !== 'rejected') continue
    items.push({ stage: root, isSub: false })
    for (const sub of subsByParent.value.get(root.id) ?? []) items.push({ stage: sub, isSub: true })
  }
  return items
})

// Спринт 22 (G3): родитель с подэтапами-причинами не выбирается напрямую
function isRejectParentWithSubs(stage: QuickStage): boolean {
  return stage.bucket === 'rejected' && !stage.parentStageId && (subsByParent.value.get(stage.id)?.length ?? 0) > 0
}

// Плоский список пунктов меню — для горячих клавиш 1–9 при открытом меню
const flatMenuItems = computed<MenuItem[]>(() => [...menuWorkingItems.value, ...menuRejectItems.value])

function menuItemHotkey(item: MenuItem): number | null {
  const idx = flatMenuItems.value.indexOf(item)
  return idx >= 0 && idx < 9 ? idx + 1 : null
}

const showMoreMenu = ref(false)
const isQuickMoving = ref(false)

// ─── Спринт 22: guard-диалоги (G1 возврат с комментарием, G2 подтверждение найма) ───

const guardDialog = ref<{ mode: 'return-comment' | 'hired-confirm'; stage: QuickStage } | null>(null)
const guardComment = ref('')

const currentQuickStage = computed(() =>
  quickStages.value.find(s => s.id === props.currentStageId) ?? null,
)

function closeGuardDialog() {
  guardDialog.value = null
  guardComment.value = ''
}

async function confirmGuardDialog() {
  const dialog = guardDialog.value
  if (!dialog) return
  if (dialog.mode === 'return-comment' && !guardComment.value.trim()) return
  const comment = dialog.mode === 'return-comment' ? guardComment.value.trim() : undefined
  closeGuardDialog()
  await doMoveToStage(dialog.stage, comment)
}

// Объединённое действие «Интервью»: сменить этап (календарь откроется через
// quickMoveToStage) либо, если кандидат уже на этапе интервью, просто открыть календарь.
async function interviewAction() {
  if (isQuickMoving.value) return
  if (interviewStage.value && interviewStage.value.id !== props.currentStageId) {
    await quickMoveToStage(interviewStage.value)
  }
  else {
    emit('schedule')
  }
}

async function quickMoveToStage(stage: QuickStage | null) {
  if (!stage || isQuickMoving.value || stage.id === props.currentStageId) return
  // G3: родитель с подэтапами — только через выбор причины
  if (isRejectParentWithSubs(stage)) return
  showMoreMenu.value = false
  // G1: возврат из терминального этапа в работу — сначала комментарий
  if (currentQuickStage.value?.isTerminal && !stage.isTerminal) {
    guardDialog.value = { mode: 'return-comment', stage }
    return
  }
  // G2: перевод в «Нанят» — явное подтверждение
  if (stage.type === 'hired') {
    guardDialog.value = { mode: 'hired-confirm', stage }
    return
  }
  await doMoveToStage(stage)
}

async function doMoveToStage(stage: QuickStage, comment?: string) {
  if (isQuickMoving.value) return
  isQuickMoving.value = true
  try {
    const res = await $fetch<{ currentStageParentName?: string | null }>(
      `/api/applications/${props.applicationId}/stage`,
      {
        method: 'PATCH',
        body: { stageId: stage.id, ...(comment ? { comment } : {}) },
      },
    )
    // Синхронизация действий: перевод на этап интервью открывает календарь
    // планирования. schedule эмитим ДО stage-changed, чтобы родитель захватил
    // текущего кандидата до обновления списка (фокус может уйти на следующего).
    if (stage.type === 'interview') emit('schedule')
    emit('stage-changed', { newStageId: stage.id, newStageName: stage.name, newStageColor: stage.color })
    quickStages.value = quickStages.value.map(s => ({ ...s, isCurrent: s.id === stage.id }))
    const label = res?.currentStageParentName ? `${res.currentStageParentName} / ${stage.name}` : stage.name
    toast.success(`Кандидат перемещён: ${label}`)
  }
  catch (err: any) {
    if (handlePreviewReadOnlyError(err)) return
    const code = err?.data?.data?.code
    if (code === 'RETURN_TO_WORK_REQUIRES_COMMENT') {
      guardDialog.value = { mode: 'return-comment', stage }
      return
    }
    toast.error('Не удалось сменить этап', { message: err.data?.statusMessage, statusCode: err.data?.statusCode })
  }
  finally {
    isQuickMoving.value = false
  }
}

// ─── Legacy-переходы статуса (фолбэк без воронки) ─────────────────────────────

const transitionLabels = computed<Record<string, string>>(() => ({
  new: t('applications.transitions.new'),
  screening: t('applications.transitions.screening'),
  interview: t('applications.transitions.interview'),
  offer: t('applications.transitions.offer'),
  hired: t('applications.transitions.hired'),
  rejected: t('applications.transitions.rejected'),
}))

const transitionClasses: Record<string, string> = {
  new: 'border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800',
  screening: 'bg-violet-600 text-white shadow-sm shadow-violet-900/20 hover:bg-violet-700',
  interview: 'bg-amber-600 text-white shadow-sm shadow-amber-900/20 hover:bg-amber-700',
  offer: 'bg-teal-600 text-white shadow-sm shadow-teal-900/20 hover:bg-teal-700',
  hired: 'bg-green-700 text-white shadow-sm shadow-green-900/30 hover:bg-green-800',
  rejected: 'bg-danger-600 text-white shadow-sm shadow-danger-900/20 hover:bg-danger-700',
}

const transitionDotClasses: Record<string, string> = {
  new: 'bg-surface-400 dark:bg-surface-500',
  screening: 'bg-violet-200',
  interview: 'bg-amber-200',
  offer: 'bg-teal-200',
  hired: 'bg-green-100',
  rejected: 'bg-danger-200',
}

const allowedTransitions = computed(() => APPLICATION_STATUS_TRANSITIONS[props.status] ?? [])

// ─── Спринт 15.3: горячие клавиши ─────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onHotkey(e: KeyboardEvent) {
  if (!props.hotkeys || props.disabled || isQuickMoving.value) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (isTypingTarget(e.target)) return

  if (e.key === 'Escape') {
    if (showMoreMenu.value) {
      showMoreMenu.value = false
      e.preventDefault()
    }
    return
  }

  const num = Number.parseInt(e.key, 10)
  if (!Number.isInteger(num) || num < 1 || num > 9) return

  if (hasPipeline.value) {
    // При открытом меню «Ещё» цифры выбирают пункты меню (включая подэтапы)
    if (showMoreMenu.value) {
      const item = flatMenuItems.value[num - 1]
      if (item && item.stage.id !== props.currentStageId) {
        e.preventDefault()
        quickMoveToStage(item.stage)
      }
      return
    }
    switch (num) {
      case 1:
        e.preventDefault()
        quickMoveToStage(inviteStage.value)
        break
      case 2:
        e.preventDefault()
        quickMoveToStage(considerStage.value)
        break
      case 3:
        e.preventDefault()
        quickMoveToStage(rejectStage.value)
        break
      case 4:
        if (flatMenuItems.value.length) {
          e.preventDefault()
          showMoreMenu.value = true
        }
        break
      case 5:
        e.preventDefault()
        void interviewAction()
        break
    }
    return
  }

  // Legacy-режим: цифры = переходы статуса по порядку
  const nextStatus = allowedTransitions.value[num - 1]
  if (nextStatus) {
    e.preventDefault()
    emit('legacy-transition', nextStatus)
  }
}

onMounted(() => window.addEventListener('keydown', onHotkey))
onUnmounted(() => window.removeEventListener('keydown', onHotkey))
</script>

<template>
  <div class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white/80 dark:bg-surface-900/70 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <span class="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-400">{{ $t('applications.quick_actions') }}</span>

      <!-- Скелетон, пока этапы не загружены (анти-мигание legacy-кнопок) -->
      <template v-if="!stagesReady">
        <span
          v-for="i in 3"
          :key="`qa-skel-${i}`"
          class="inline-flex h-8 w-24 animate-pulse rounded-full bg-surface-100 dark:bg-surface-800"
        />
      </template>

      <!-- ─── Быстрые действия в стиле hh.ru (новая воронка) ─── -->
      <template v-else-if="hasPipeline">
        <!-- Пригласить → Первичный контакт -->
        <button
          v-if="inviteStage"
          :disabled="isQuickMoving || currentStageId === inviteStage.id"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm shadow-blue-900/20 hover:bg-blue-700 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          :title="`Перевести на этап «${inviteStage.name}»`"
          @click="quickMoveToStage(inviteStage)"
        >
          <ThumbsUp class="size-3.5" />
          Пригласить
          <kbd v-if="hotkeys" class="ml-0.5 inline-flex items-center justify-center rounded bg-white/20 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px]">1</kbd>
        </button>
        <!-- Подумать -->
        <button
          v-if="considerStage"
          :disabled="isQuickMoving || currentStageId === considerStage.id"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 px-3.5 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          @click="quickMoveToStage(considerStage)"
        >
          <Hourglass class="size-3.5" />
          Подумать
          <kbd v-if="hotkeys" class="ml-0.5 inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">2</kbd>
        </button>
        <!-- Отказать -->
        <button
          v-if="rejectStage"
          :disabled="isQuickMoving || currentStageId === rejectStage.id"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-red-300 dark:border-red-900 bg-white/80 dark:bg-surface-900 px-3.5 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-400 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          @click="quickMoveToStage(rejectStage)"
        >
          <CircleSlash class="size-3.5" />
          Отказать
          <kbd v-if="hotkeys" class="ml-0.5 inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">3</kbd>
        </button>
        <!-- Ещё ▾ -->
        <div v-if="flatMenuItems.length" class="relative">
          <button
            :disabled="isQuickMoving"
            class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 px-3.5 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            @click="showMoreMenu = !showMoreMenu"
          >
            Ещё
            <kbd v-if="hotkeys" class="inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">4</kbd>
            <ChevronDown class="size-3.5 transition-transform" :class="{ 'rotate-180': showMoreMenu }" />
          </button>
          <!-- Оверлей для закрытия по клику вне -->
          <div v-if="showMoreMenu" class="fixed inset-0 z-[70]" @click="showMoreMenu = false" />
          <div
            v-if="showMoreMenu"
            class="absolute left-0 top-full z-[80] mt-1.5 w-80 max-h-96 overflow-y-auto rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 py-1.5 shadow-lg shadow-surface-900/10"
          >
            <template v-if="menuWorkingItems.length">
              <div class="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500">Этапы</div>
              <button
                v-for="item in menuWorkingItems"
                :key="`more-${item.stage.id}`"
                :disabled="item.stage.id === currentStageId"
                class="flex w-full cursor-pointer items-center gap-2 py-1.5 pr-3 text-left text-sm transition-colors disabled:cursor-default"
                :class="[
                  item.isSub ? 'pl-8' : 'pl-3',
                  item.stage.id === currentStageId
                    ? 'bg-brand-50/60 dark:bg-brand-950/30 text-surface-400 dark:text-surface-500'
                    : 'text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800',
                ]"
                @click="quickMoveToStage(item.stage)"
              >
                <CornerDownRight v-if="item.isSub" class="size-3 shrink-0 text-surface-300 dark:text-surface-600" />
                <span class="inline-flex size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.stage.color || '#94a3b8' }" />
                <span class="truncate" :class="{ 'text-[13px]': item.isSub }">{{ item.stage.name }}</span>
                <Check v-if="item.stage.id === currentStageId" class="ml-auto size-3.5 shrink-0 text-brand-500" />
                <kbd v-else-if="hotkeys && menuItemHotkey(item)" class="ml-auto inline-flex items-center justify-center rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] text-surface-400 dark:text-surface-500">{{ menuItemHotkey(item) }}</kbd>
              </button>
            </template>
            <template v-if="menuRejectItems.length">
              <div class="mt-1 border-t border-surface-100 dark:border-surface-800 px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-red-400 dark:text-red-500">Отказы</div>
              <button
                v-for="item in menuRejectItems"
                :key="`more-rej-${item.stage.id}`"
                :disabled="item.stage.id === currentStageId || isRejectParentWithSubs(item.stage)"
                class="flex w-full cursor-pointer items-center gap-2 py-1.5 pr-3 text-left text-sm transition-colors disabled:cursor-default"
                :class="[
                  item.isSub ? 'pl-8' : 'pl-3',
                  item.stage.id === currentStageId
                    ? 'bg-red-50/60 dark:bg-red-950/20 text-surface-400 dark:text-surface-500'
                    : isRejectParentWithSubs(item.stage)
                      ? 'text-surface-400 dark:text-surface-500'
                      : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40',
                ]"
                :title="isRejectParentWithSubs(item.stage) ? 'Выберите причину отказа ниже' : undefined"
                @click="quickMoveToStage(item.stage)"
              >
                <CornerDownRight v-if="item.isSub" class="size-3 shrink-0 text-red-200 dark:text-red-900" />
                <span class="inline-flex size-2 shrink-0 rounded-full" :style="{ backgroundColor: item.stage.color || '#ef4444' }" />
                <span class="truncate" :class="{ 'text-[13px]': item.isSub }">{{ item.stage.name }}</span>
                <Check v-if="item.stage.id === currentStageId" class="ml-auto size-3.5 shrink-0 text-red-400" />
                <kbd v-else-if="hotkeys && menuItemHotkey(item)" class="ml-auto inline-flex items-center justify-center rounded bg-black/5 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] text-surface-400 dark:text-surface-500">{{ menuItemHotkey(item) }}</kbd>
              </button>
            </template>
          </div>
        </div>
      </template>

      <!-- Legacy-переходы — фолбэк, если у вакансии нет новой воронки -->
      <template v-else>
        <button
          v-for="(nextStatus, idx) in allowedTransitions"
          :key="nextStatus"
          :disabled="disabled"
          class="inline-flex cursor-pointer items-center rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          :class="transitionClasses[nextStatus] ?? 'border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:border-surface-400 dark:hover:border-surface-600 hover:bg-surface-50 dark:hover:bg-surface-800'"
          @click="emit('legacy-transition', nextStatus)"
        >
          <span
            class="mr-2 inline-flex size-1.5 rounded-full"
            :class="transitionDotClasses[nextStatus] ?? 'bg-surface-400 dark:bg-surface-500'"
          />
          {{ transitionLabels[nextStatus] ?? nextStatus }}
          <kbd v-if="hotkeys" class="ml-1.5 inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">{{ idx + 1 }}</kbd>
        </button>
      </template>

      <!-- Объединённое действие «Интервью»: перевод на этап + календарь планирования -->
      <button
        v-if="stagesReady && hasPipeline && interviewStage"
        :disabled="isQuickMoving"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 px-3.5 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        :title="currentStageId === interviewStage.id
          ? 'Запланировать интервью'
          : `Перевести на этап «${interviewStage.name}» и запланировать интервью`"
        @click="interviewAction"
      >
        <Calendar class="size-3.5" />
        {{ interviewStage.name }}
        <kbd v-if="hotkeys" class="ml-0.5 inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">5</kbd>
      </button>
      <!-- Фолбэк: без воронки (или без этапа интервью) — только планирование -->
      <button
        v-else-if="stagesReady"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-surface-300 dark:border-surface-700 bg-white/80 dark:bg-surface-900 px-3.5 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:border-brand-400 dark:hover:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/30 hover:text-brand-700 dark:hover:text-brand-300 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        @click="emit('schedule')"
      >
        <Calendar class="size-3.5" />
        {{ $t('applications.schedule_interview') }}
        <kbd v-if="hotkeys && hasPipeline" class="ml-0.5 inline-flex items-center justify-center rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 text-[10px] font-mono leading-none min-w-[14px] opacity-60">5</kbd>
      </button>
    </div>

    <!-- Спринт 22: guard-диалог (G1 возврат с комментарием / G2 подтверждение найма) -->
    <Teleport to="body">
      <div
        v-if="guardDialog"
        class="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
        @click.self="closeGuardDialog"
      >
        <div class="w-full max-w-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-xl">
          <template v-if="guardDialog.mode === 'return-comment'">
            <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Вернуть в работу</h3>
            <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
              Кандидат будет переведён на этап «{{ guardDialog.stage.name }}». Укажите причину возврата — она сохранится в истории.
            </p>
            <textarea
              v-model="guardComment"
              rows="3"
              placeholder="Причина возврата в работу (обязательно)"
              class="mt-3 w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 px-2.5 py-1.5 text-sm text-surface-900 dark:text-surface-100 placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </template>
          <template v-else>
            <h3 class="text-sm font-semibold text-surface-900 dark:text-surface-100">Подтвердить найм</h3>
            <p class="mt-1 text-xs text-surface-500 dark:text-surface-400">
              Кандидат будет отмечен как нанятый (этап «{{ guardDialog.stage.name }}»). Это финальный этап воронки.
            </p>
          </template>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
              @click="closeGuardDialog"
            >
              Отмена
            </button>
            <button
              type="button"
              :disabled="guardDialog.mode === 'return-comment' && !guardComment.trim()"
              class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              :class="guardDialog.mode === 'hired-confirm' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-brand-600 hover:bg-brand-700'"
              @click="confirmGuardDialog"
            >
              {{ guardDialog.mode === 'hired-confirm' ? 'Подтвердить найм' : 'Вернуть в работу' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
