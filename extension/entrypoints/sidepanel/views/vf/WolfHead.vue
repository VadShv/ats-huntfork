<!--
  WolfHead.vue — силуэт головы волка для шкалы «Волкодава».
  ТЗ «Фирменные детали» §2. Заменяет эмодзи 🐺 — зрачками эмодзи управлять нельзя.

  SVG: голова + уши + белки + зрачки + морда отдельными элементами.
  Погашенные волки «спят»: .wolf:not(.is-lit) .wolf__eyes { transform: none }.
  Зрачки отстают на 120мс (в useWolfEyes).
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useWolfEyes } from '../../fx/signature'

const props = withDefaults(defineProps<{
  /** Зажжён ли волк. */
  isLit?: boolean
  /** Индекс для data-eye. */
  index?: number
  /** Ref на хост-контейнер для слежения (если этот волк — часть шкалы). */
  hostRef?: ReturnType<typeof useWolfEyes> | null
}>(), { isLit: false, index: 0, hostRef: null })

const eyeLeft = computed(() => `wolf-eye-l-${props.index}`)
const eyeRight = computed(() => `wolf-eye-r-${props.index}`)
</script>

<template>
  <span class="wolf" :class="{ 'is-lit': isLit }">
    <svg class="wolf__svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <!-- Уши -->
      <path class="wolf__ear" d="M7 12 L9 4 L13 11 Z" />
      <path class="wolf__ear" d="M25 12 L23 4 L19 11 Z" />

      <!-- Голова (силуэт) -->
      <path class="wolf__head" d="
        M16 6
        C22 6 26 10 26 16
        C26 22 22 26 16 26
        C10 26 6 22 6 16
        C6 10 10 6 16 6 Z" />

      <!-- Белки глаз -->
      <circle class="wolf__sclera" cx="12" cy="15" r="2.2" />
      <circle class="wolf__sclera" cx="20" cy="15" r="2.2" />

      <!-- Зрачки — отдельные элементы, управляются трансформом -->
      <circle
        class="wolf__pupil"
        :class="{ 'is-lit': isLit }"
        :data-eye="eyeLeft"
        cx="12" cy="15" r="1.1"
      />
      <circle
        class="wolf__pupil"
        :class="{ 'is-lit': isLit }"
        :data-eye="eyeRight"
        cx="20" cy="15" r="1.1"
      />

      <!-- Морда -->
      <path class="wolf__snout" d="M14 20 Q16 22 18 20" />
      <circle class="wolf__nose" cx="16" cy="19" r="0.8" />
    </svg>
  </span>
</template>

<style scoped>
.wolf {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}

.wolf__svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.wolf__head {
  fill: var(--hf-fg);
  transition: fill var(--hf-dur-fast) var(--hf-ease-out);
}

.wolf__ear {
  fill: var(--hf-fg);
}

.wolf__sclera {
  fill: var(--hf-surface-raised);
}

.wolf__pupil {
  fill: var(--hf-fg);
  /* transform-box: fill-box — без него transform-origin: center
     в SVG считается от вьюпорта, и зрачки уезжают. */
  transform-box: fill-box;
  transform-origin: center;
  /* Переход 120мс — зрачок отстаёт от курсора, выглядит живее. */
  transition: transform 120ms var(--hf-ease-out);
}

/* Погашенные волки «спят». */
.wolf:not(.is-lit) .wolf__pupil,
.wolf:not(.is-lit) .wolf__sclera {
  opacity: 0.18;
}

.wolf:not(.is-lit) .wolf__head {
  fill: var(--hf-fg-faint);
}

.wolf:not(.is-lit) .wolf__ear {
  fill: var(--hf-fg-faint);
}

.wolf__snout {
  fill: none;
  stroke: var(--hf-fg);
  stroke-opacity: 0.5;
  stroke-width: 1;
  stroke-linecap: round;
}

.wolf__nose {
  fill: var(--hf-fg);
}

@media (prefers-reduced-motion: reduce) {
  .wolf__pupil {
    transform: none !important;
    transition: none !important;
  }
}

@media (hover: none) {
  /* Слежение зрачков не имеет смысла без курсора. */
  .wolf__pupil {
    transform: none !important;
  }
}
</style>
