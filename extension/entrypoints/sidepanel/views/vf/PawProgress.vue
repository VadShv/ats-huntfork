<!--
  PawProgress.vue — индикатор процесса «След лапы».
  ТЗ «Фирменные детали» §3. Заменяет безликий спиннер на фирменный элемент.

  Горизонтальная полоса 3px + цепочка из 5 отпечатков лап.
  Определённый режим (progress не null): следы идут по границе заполнения.
  Неопределённый: цепочка бежит по всей ширине.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { usePawTrail } from '../../fx/signature'

const props = withDefaults(defineProps<{
  /** Доля выполнения 0..100. null — неопределённый режим. */
  progress?: number | null
  /** Показывать ли цепочку (true по умолчанию). */
  active?: boolean
}>(), { progress: null, active: true })

const { steps } = usePawTrail(5)

const isDeterminate = computed(() => props.progress !== null && props.progress !== undefined)
const fillWidth = computed(() => {
  if (!isDeterminate.value) return 100
  return Math.max(0, Math.min(100, props.progress!))
})
const isComplete = computed(() => isDeterminate.value && props.progress! >= 100)
</script>

<template>
  <div class="paw" :class="{
    'paw--determinate': isDeterminate,
    'paw--indeterminate': !isDeterminate,
    'paw--done': isComplete,
    'paw--inactive': !active,
  }">
    <!-- Полоса -->
    <div class="paw__track">
      <div class="paw__fill" :style="{ width: isDeterminate ? fillWidth + '%' : '100%' }" />
    </div>

    <!-- Цепочка отпечатков -->
    <div v-if="active && !isComplete" class="paw__trail" :style="{ width: isDeterminate ? fillWidth + '%' : '100%' }">
      <svg
        v-for="(step, i) in steps"
        :key="i"
        class="paw__print"
        :style="{ '--paw-delay': step.delay + 'ms', '--paw-offset': step.offset + 'px', opacity: step.opacity }"
        viewBox="0 0 10 12"
        fill="none"
        aria-hidden="true"
      >
        <!-- Четыре пальца -->
        <ellipse class="paw__toe" cx="2" cy="3" rx="1" ry="1.5" />
        <ellipse class="paw__toe" cx="4.5" cy="2" rx="1" ry="1.5" />
        <ellipse class="paw__toe" cx="6.5" cy="2" rx="1" ry="1.5" />
        <ellipse class="paw__toe" cx="8.5" cy="3" rx="1" ry="1.5" />
        <!-- Подушечка -->
        <ellipse class="paw__pad" cx="5.2" cy="8" rx="2.5" ry="2" />
      </svg>
    </div>

    <!-- Числовой процент при reduced-motion -->
    <span v-if="isDeterminate" class="paw__num">{{ Math.round(progress!) }}%</span>
  </div>
</template>

<style scoped>
.paw {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  width: 100%;
}

.paw__track {
  position: relative;
  flex: 1;
  height: 3px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-border-subtle);
  overflow: hidden;
}

.paw__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--hf-r-pill);
  background: var(--hf-primary);
  transition: width var(--hf-dur-base) var(--hf-ease-out);
}

.paw__trail {
  position: absolute;
  top: 0;
  left: 0;
  height: 3px;
  display: flex;
  align-items: center;
  pointer-events: none;
  overflow: hidden;
}

.paw--indeterminate .paw__trail {
  animation: paw-run 1.4s linear infinite;
}

@keyframes paw-run {
  0% { transform: translateX(-30%); }
  100% { transform: translateX(100%); }
}

.paw__print {
  width: 10px;
  height: 12px;
  flex-shrink: 0;
  /* Шаг 18px между отпечатками, ±2px по вертикали. */
  margin-right: 8px;
  transform: translateY(var(--paw-offset, 0px)) scale(0.85);
  animation: paw-pop 180ms var(--hf-ease-out) var(--paw-delay, 0ms) both;
}

@keyframes paw-pop {
  0% { transform: translateY(var(--paw-offset, 0px)) scale(0.7); opacity: 0; }
  100% { transform: translateY(var(--paw-offset, 0px)) scale(0.85); }
}

.paw__toe, .paw__pad {
  fill: var(--hf-primary);
}

.paw__num {
  font-size: var(--hf-t-xs);
  font-family: var(--hf-mono);
  color: var(--hf-fg-muted);
  min-width: 28px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Завершение: следы гаснут от хвоста, полоса схлопывается. */
.paw--done .paw__fill {
  animation: paw-collapse 400ms var(--hf-ease-out) forwards;
}

@keyframes paw-collapse {
  0% { height: 3px; }
  100% { height: 0; }
}
</style>
