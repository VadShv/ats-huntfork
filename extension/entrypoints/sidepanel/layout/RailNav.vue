<script setup lang="ts">
import { ref, computed } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import { useSidekick } from '../composables/useSidekick'
import { useTabIndicator } from '../composables/useTabIndicator'
import { useQueue } from '../composables/useQueue'

const { activeView, VIEW_DEFS } = useSidekick()
const emit = defineEmits<{ select: [string] }>()

const { pendingCount, totalCount } = useQueue()
const queueBadge = computed(() => pendingCount())
const totalBadge = computed(() => totalCount())

/** Ref на контейнер рельса — для измерения позиции индикатора из DOM. */
const railRef = ref<HTMLElement | null>(null)

/** Переезжающий индикатор: позиция и размер меряются из DOM, а не из констант.
    Защита от ResizeObserver-loop, скачка при монтировании и рассинхрона шрифта. */
const { style: indicatorStyle } = useTabIndicator(railRef, () => activeView.value, {
  orientation: 'vertical',
  ratio: 0.6,
  activeSelector: '.rail-item--active',
})

const railExpanded = defineModel<boolean>('expanded', { default: false })
</script>

<template>
 <nav ref="railRef" class="rail" :class="{ 'rail--expanded': railExpanded }">
    <!-- Единый переезжающий индикатор-полоска (позиция из DOM) -->
    <div class="rail-indicator" :style="indicatorStyle" aria-hidden="true" />

    <button
      v-for="(v, i) in VIEW_DEFS"
      :key="v.id"
      class="rail-item"
      :class="{ 'rail-item--active': activeView === v.id }"
      :data-active="activeView === v.id"
      :title="v.label"
      :aria-label="v.label"
      :aria-current="activeView === v.id ? 'page' : undefined"
      @click="emit('select', v.id)"
    >
     <span class="rail-item-ico"><HfIcon :name="v.icon" :size="22" /></span>
      <span
        v-if="v.id === 'sourcing' && queueBadge > 0"
        class="rail-badge"
      >{{ queueBadge }}</span>
      <Transition name="rail-label">
        <span v-if="railExpanded" class="rail-item-label">{{ v.label }}</span>
      </Transition>
    </button>

    <div class="rail-spacer" />
    <button
      class="rail-item rail-item--pin"
      :title="railExpanded ? 'Свернуть рельс (⌘\\)' : 'Закрепить рельс (⌘\\)'"
      aria-label="Свернуть или закрепить рельс"
      @click="railExpanded = !railExpanded"
    >
     <HfIcon name="pin" :size="22" />
    </button>
  </nav>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--hf-s-1);
  padding: var(--hf-s-2) 0;
  background: var(--hf-surface);
  border-right: 1px solid var(--hf-border);
  width: var(--hf-rail-w-collapsed);
  overflow: hidden;
  position: relative;
  transition: width var(--hf-dur-base) var(--hf-ease-out);
}
.rail--expanded { width: var(--hf-rail-w-expanded); align-items: stretch; }

.rail-indicator {
  position: absolute;
  left: 0;
  top: 0;
  width: 3px;
  border-radius: 0 var(--hf-r-pill) var(--hf-r-pill) 0;
  background: var(--hf-primary);
  /* Переезд — пружина из tokens.css. */
  transition:
    transform var(--spring-snappy-dur) var(--spring-snappy),
    height var(--spring-snappy-dur) var(--spring-snappy),
    opacity var(--hf-dur-fast) var(--hf-ease-out);
  z-index: 1;
  pointer-events: none;
}

.rail-item {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--hf-s-4);
  height: 52px;
  padding: 0 var(--hf-s-3);
  border-radius: var(--hf-r-md);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out);
  white-space: nowrap;
}
.rail--expanded .rail-item { justify-content: flex-start; }
.rail-item:hover { background: var(--hf-hover); color: var(--hf-fg); }
.rail-item--active {
  background: var(--hf-surface-raised);
  color: var(--hf-fg);
  box-shadow: var(--hf-lit), var(--hf-e2);
}

.rail-item-ico { display: flex; flex: 0 0 auto; }
.rail-item-label {
  font-size: var(--hf-t-lg);
  font-weight: var(--hf-fw-medium);
  letter-spacing: -0.012em;
}

.rail-spacer { flex: 1; }
.rail-item--pin { color: var(--hf-fg-subtle); }

.rail-label-enter-active, .rail-label-leave-active {
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out);
}
.rail-label-enter-from, .rail-label-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .rail-indicator { transition-duration: 0.01ms !important; }
}

.rail-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--hf-fg-on-accent);
  background: var(--hf-accent);
  border-radius: 8px;
  border: 2px solid var(--hf-surface);
  pointer-events: none;
  animation: hf-badge-pop var(--hf-dur-base) var(--spring-snappy, var(--hf-ease-out)) both;
}

@keyframes hf-badge-pop {
  0% { transform: scale(0); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
</style>
