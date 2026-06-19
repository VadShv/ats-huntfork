<script setup lang="ts">
/**
 * UiModal — центральный диалог Huntfork UI.
 *
 * Возможности:
 *  - v-model: boolean (open/close)
 *  - sizes: sm | md | lg | xl
 *  - закрытие: ESC, клик по бэкдропу (если closeOnBackdrop), кнопка ✕
 *  - focus trap внутри диалога
 *  - блок скролла body
 *  - slots: header / default / footer
 *
 * Использует <Teleport to="body"> и <Transition> для появления.
 */
import { computed, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { X } from 'lucide-vue-next'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

interface Props {
  modelValue: boolean
  title?: string
  description?: string
  size?: ModalSize
  /** Закрывать при клике по фону (default: true) */
  closeOnBackdrop?: boolean
  /** Закрывать на ESC (default: true) */
  closeOnEsc?: boolean
  /** Скрыть кнопку закрытия в углу */
  hideClose?: boolean
  /** Кастомный класс для контейнера диалога */
  panelClass?: string
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
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

const sizeClass = computed(() => {
  switch (props.size) {
    case 'sm': return 'max-w-sm'
    case 'lg': return 'max-w-2xl'
    case 'xl': return 'max-w-4xl'
    case 'md':
    default: return 'max-w-lg'
  }
})

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
    // простой focus trap
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
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[70] bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        role="presentation"
        @click.self="onBackdropClick"
      >
        <Transition
          enter-active-class="transition duration-150 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
          appear
        >
          <div
            v-if="modelValue"
            ref="panelRef"
            :class="[
              'w-full bg-white dark:bg-surface-900 rounded-xl shadow-2xl border border-surface-200 dark:border-surface-800',
              'flex flex-col max-h-[90vh] overflow-hidden',
              sizeClass,
              panelClass,
            ]"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="title ? 'ui-modal-title' : undefined"
            :aria-describedby="description ? 'ui-modal-desc' : undefined"
            tabindex="-1"
          >
            <header
              v-if="$slots.header || title || !hideClose"
              class="px-5 py-4 border-b border-surface-200 dark:border-surface-800 flex items-start justify-between gap-4"
            >
              <div class="min-w-0">
                <slot name="header">
                  <h2
                    v-if="title"
                    id="ui-modal-title"
                    class="text-base font-semibold text-surface-900 dark:text-surface-100 truncate"
                  >
                    {{ title }}
                  </h2>
                  <p
                    v-if="description"
                    id="ui-modal-desc"
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
              class="px-5 py-3 border-t border-surface-200 dark:border-surface-800 bg-surface-50/50 dark:bg-surface-950/50 flex items-center justify-end gap-2"
            >
              <slot name="footer" />
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
