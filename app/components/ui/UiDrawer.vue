<script setup lang="ts">
/**
 * UiDrawer — боковая выезжающая панель Huntfork UI.
 *
 * Обобщение существующих CandidateDetailDrawer/ApplicationDetailDrawer.
 *
 * Возможности:
 *  - v-model: boolean (open/close)
 *  - side: 'right' (default) | 'left'
 *  - width: 'sm' | 'md' | 'lg' | 'xl' | 'full'
 *  - закрытие: ESC (closeOnEsc), клик по бэкдропу (closeOnBackdrop)
 *  - focus trap, блок скролла body, восстановление фокуса
 *  - slots: header / default / footer
 *  - z-index 55 (бэкдроп) / 60 (панель) — совпадает с текущими дроверами,
 *    UiModal выше (70).
 */
import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { X } from 'lucide-vue-next'

type Side = 'right' | 'left'
type Width = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface Props {
  modelValue: boolean
  title?: string
  description?: string
  side?: Side
  width?: Width
  closeOnBackdrop?: boolean
  closeOnEsc?: boolean
  hideClose?: boolean
  panelClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  side: 'right',
  width: 'md',
  closeOnBackdrop: true,
  closeOnEsc: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  close: []
}>()

const panelRef = ref<HTMLElement | null>(null)
const previouslyFocused = ref<HTMLElement | null>(null)

const widthClass = computed(() => {
  switch (props.width) {
    case 'sm': return 'max-w-md'
    case 'lg': return 'max-w-3xl'
    case 'xl': return 'max-w-5xl'
    case 'full': return 'max-w-full'
    case 'md':
    default: return 'max-w-2xl'
  }
})

const sideClass = computed(() =>
  props.side === 'left'
    ? 'inset-y-0 left-0 border-r'
    : 'inset-y-0 right-0 border-l',
)

const enterFromClass = computed(() => (props.side === 'left' ? 'translate-x-[-100%]' : 'translate-x-full'))
const leaveToClass = computed(() => (props.side === 'left' ? 'translate-x-[-100%]' : 'translate-x-full'))

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onBackdropClick() {
  if (props.closeOnBackdrop) close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.closeOnEsc) {
    e.stopPropagation()
    close()
    return
  }
  if (e.key === 'Tab' && panelRef.value) {
    const focusables = panelRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      previouslyFocused.value = (document.activeElement as HTMLElement) || null
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
      emit('open')
      await nextTick()
      const target = panelRef.value?.querySelector<HTMLElement>(
        '[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )
      target?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
      previouslyFocused.value?.focus?.()
    }
  },
  { immediate: false },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

defineSlots<{
  header?: () => any
  default?: () => any
  footer?: () => any
}>()
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[55] bg-surface-900/40 dark:bg-black/60"
        role="presentation"
        @click="onBackdropClick"
      />
    </Transition>

    <!-- Panel -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      :enter-from-class="enterFromClass"
      enter-to-class="translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-x-0"
      :leave-to-class="leaveToClass"
    >
      <aside
        v-if="modelValue"
        ref="panelRef"
        :class="[
          'fixed z-[60] w-full flex flex-col bg-white dark:bg-surface-900 shadow-2xl border-surface-200 dark:border-surface-800',
          sideClass,
          widthClass,
          panelClass,
        ]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? 'ui-drawer-title' : undefined"
        :aria-describedby="description ? 'ui-drawer-desc' : undefined"
        tabindex="-1"
      >
        <header
          v-if="$slots.header || title || !hideClose"
          class="px-5 py-4 border-b border-surface-200 dark:border-surface-800 flex items-start justify-between gap-4 shrink-0"
        >
          <div class="min-w-0">
            <slot name="header">
              <h2
                v-if="title"
                id="ui-drawer-title"
                class="text-base font-semibold text-surface-900 dark:text-surface-100 truncate"
              >
                {{ title }}
              </h2>
              <p
                v-if="description"
                id="ui-drawer-desc"
                class="mt-1 text-sm text-surface-500 dark:text-surface-400"
              >
                {{ description }}
              </p>
            </slot>
          </div>
          <button
            v-if="!hideClose"
            type="button"
            class="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors cursor-pointer"
            :aria-label="'Закрыть'"
            @click="close"
          >
            <X :size="18" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="px-5 py-3 border-t border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-950/50 flex items-center justify-end gap-2 shrink-0"
        >
          <slot name="footer" />
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>
