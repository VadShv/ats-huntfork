<!--
  SearchCompass.vue — компас карты поиска.
  ТЗ «Фирменные детали» §4. Подсказывает, в какой секции наибольший потенциал.

  Роза ветров 24×24px: окружность, четыре засечки, стрелка.
  В покое — микроколебание ±1.5°/4с. При пересчёте — оборот 600мс.
-->
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSearchCompass, type CompassSection } from '../../composables/signature'

const props = defineProps<{
  sections: CompassSection[]
}>()

const sectionsRef = ref(props.sections)
watch(() => props.sections, (v) => { sectionsRef.value = v }, { deep: true })

const { angle, label, hasData } = useSearchCompass(sectionsRef)

// Триггер полного оборота при пересчёте.
const spinning = ref(false)
let spinTimer: ReturnType<typeof setTimeout> | null = null
watch(angle, () => {
  spinning.value = true
  if (spinTimer) clearTimeout(spinTimer)
  spinTimer = setTimeout(() => { spinning.value = false }, 600)
})
</script>

<template>
  <div class="compass" v-if="hasData">
    <svg
      class="compass__rose"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <!-- Окружность -->
      <circle class="compass__ring" cx="12" cy="12" r="10" />
      <!-- Четыре засечки -->
      <line class="compass__tick" x1="12" y1="2" x2="12" y2="4" />
      <line class="compass__tick" x1="12" y1="20" x2="12" y2="22" />
      <line class="compass__tick" x1="2" y1="12" x2="4" y2="12" />
      <line class="compass__tick" x1="20" y1="12" x2="22" y2="12" />
      <!-- Стрелка -->
      <g
        class="compass__needle"
        :class="{ 'is-spinning': spinning, 'is-idle': !spinning }"
        :style="{ rotate: angle + 'deg' }"
      >
        <path class="compass__needle-n" d="M12 3 L14 12 L12 11 Z" />
        <path class="compass__needle-s" d="M12 21 L10 12 L12 13 Z" />
      </g>
      <!-- Центральный пин -->
      <circle class="compass__pin" cx="12" cy="12" r="1.2" />
    </svg>
    <span class="compass__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.compass {
  display: inline-flex;
  align-items: center;
  gap: var(--hf-s-2);
}

.compass__rose {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  overflow: visible;
}

.compass__ring {
  fill: none;
  stroke: var(--hf-fg-subtle);
  stroke-width: 1.25;
}

.compass__tick {
  stroke: var(--hf-fg-subtle);
  stroke-width: 1.25;
  stroke-linecap: round;
}

.compass__needle {
  transform-origin: center;
  transform-box: fill-box;
  transition: rotate var(--spring-gentle-dur) var(--spring-gentle);
}

.compass__needle.is-spinning {
  animation: compass-spin 600ms var(--hf-ease-in-out);
}

@keyframes compass-spin {
  0% { rotate: 0deg; }
  100% { rotate: 360deg; }
}

/* В покое — микроколебание ±1.5°, имитация магнитной стрелки. */
.compass__needle.is-idle {
  animation: compass-sway 4s ease-in-out infinite;
}

@keyframes compass-sway {
  0%, 100% { rotate: var(--sway-base, 0deg); }
  50% { rotate: calc(var(--sway-base, 0deg) + 1.5deg); }
}

.compass__needle-n {
  fill: var(--hf-primary);
}

.compass__needle-s {
  fill: var(--hf-fg-subtle);
}

.compass__pin {
  fill: var(--hf-fg-muted);
}

.compass__label {
  font-size: var(--hf-t-xs);
  font-weight: 400;
  color: var(--hf-fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .compass__needle,
  .compass__needle.is-idle,
  .compass__needle.is-spinning {
    animation: none !important;
    transition: none !important;
  }
}
</style>
