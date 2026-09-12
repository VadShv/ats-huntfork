<script setup lang="ts">
/**
 * ExpandableSection — сворачиваемый блок для больших полей карточки сорсинга.
 *
 * Используется для навыков, опыта, образования, обоснования оценки —
 * всего, что длиннее ~3 строк.
 *
 * Логика сворачивания:
 *  - collapsed=true по умолчанию (контролируется props.defaultCollapsed).
 *  - При свёрнутом виде показывается props.previewLimit детей/чипов,
 *    остальное скрывается под «Показать ещё (+N)».
 *  - Кнопка-тоггл внизу блока.
 *  - Сворачивание через v-show (не v-if) — чтобы не терять состояние и
 *    не дёргать layout при тоггле.
 *
 * Слоты:
 *  - default — основной контент (рендерится всегда; видимость управляется CSS)
 *  - header — заголовок секции (опц.)
 *  - summary — компактный превью при свёрнутом виде (опц.)
 */
import { ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

interface Props {
  /** Заголовок секции (если нет слота header). */
  title?: string
  /** Схлопнут ли блок по умолчанию. */
  defaultCollapsed?: boolean
  /** Сколько элементов показать в свёрнутом виде (для текста summary). */
  hiddenCount?: number
  /** Текст кнопки развернуть. */
  expandLabel?: string
  /** Текст кнопки свернуть. */
  collapseLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  defaultCollapsed: true,
  hiddenCount: 0,
  expandLabel: 'Показать ещё',
  collapseLabel: 'Свернуть',
})

const emit = defineEmits<{ (e: 'toggle', collapsed: boolean): void }>()

const collapsed = ref(props.defaultCollapsed)

const toggleLabel = computed(() =>
  collapsed.value
    ? (props.hiddenCount > 0 ? `${props.expandLabel} (+${props.hiddenCount})` : props.expandLabel)
    : props.collapseLabel,
)

function toggle() {
  collapsed.value = !collapsed.value
  emit('toggle', collapsed.value)
}
</script>

<template>
  <div class="sourcing-expandable">
    <div v-if="$slots.header || title" class="flex items-center justify-between mb-1.5">
      <slot name="header">
        <span class="text-xs font-medium text-surface-500 dark:text-surface-400">{{ title }}</span>
      </slot>
    </div>

    <!-- Превью при свёрнутом виде -->
    <div v-if="collapsed && $slots.summary" class="text-sm text-surface-600 dark:text-surface-300">
      <slot name="summary" />
    </div>

    <!-- Полный контент — скрыт при collapsed через v-show -->
    <div v-show="!collapsed" class="text-sm text-surface-600 dark:text-surface-300">
      <slot />
    </div>

    <UiButton
      v-if="hiddenCount > 0 || !$slots.summary"
      variant="link"
      size="xs"
      class="mt-1.5"
      @click="toggle"
    >
      <ChevronDown
        class="size-3.5 transition-transform"
        :class="collapsed ? '' : 'rotate-180'"
      />
      {{ toggleLabel }}
    </UiButton>
  </div>
</template>
