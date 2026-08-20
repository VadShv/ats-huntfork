<!--
  TypedQuestion.vue — печатная машинка для вопроса.
  ТЗ «Фирменные детали» §5.

  Высота резервируется заранее по финальному тексту (min-height).
  Скринридер получает текст целиком сразу (.hf-sr), анимируемый слой aria-hidden.
  Кнопка «Пропустить» + прерывание любым взаимодействием.
-->
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { useTypewriter } from '../../fx/signature'

const props = defineProps<{
  /** Уникальный id вопроса (для дедупликации печатной машинки). */
  id: string
  /** Полный текст вопроса. */
  text: string
}>()

const host = useTemplateRef<HTMLElement>('host')

const { shown, typing, skip, interrupt } = useTypewriter(
  () => props.id,
  () => props.text,
)

// min-height по финальному тексту — карточка не растёт рывками.
// Ориентировочно: 13px шрифт, 1.55 line-height, ширина ~360px → ~45 символов в строке.
const estimatedLines = computed(() => Math.max(1, Math.ceil(props.text.length / 45)))
const minHeight = computed(() => `${estimatedLines.value * 1.55 * 13 + 24}px`)

function onInteract() {
  interrupt()
}
</script>

<template>
  <div
    ref="host"
    class="typed"
    :style="{ minHeight }"
    @pointerdown="onInteract"
    @keydown="onInteract"
  >
    <!-- Полный текст для скринридера сразу -->
    <span class="hf-sr">{{ text }}</span>

    <!-- Анимируемый визуальный слой -->
    <p class="typed__text" aria-hidden="true">
      <span class="typed__shown">{{ shown }}</span><span
        v-if="typing"
        class="typed__caret"
      />
    </p>

    <button
      v-if="typing"
      class="typed__skip"
      aria-label="Пропустить набор текста"
      @click.stop="skip"
    >Пропустить</button>
  </div>
</template>

<style scoped>
.typed {
  position: relative;
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  /* min-height — иначе карточка растёт рывками при наборе. */
}

.typed__text {
  margin: 0;
  font-size: var(--hf-t-md);
  line-height: 1.55;
  color: var(--hf-fg);
}

.typed__caret {
  display: inline-block;
  width: 2px;
  height: 14px;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: var(--hf-primary);
  animation: typed-blink 1s steps(2, start) infinite;
}

@keyframes typed-blink {
  50% { opacity: 0; }
}

.typed__skip {
  position: absolute;
  right: var(--hf-s-2);
  bottom: var(--hf-s-2);
  padding: 2px 7px;
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-pill);
  background: var(--hf-surface-raised);
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
  cursor: pointer;
  transition: background var(--hf-dur-instant) var(--hf-ease-out);
}

.typed__skip:hover {
  background: var(--hf-surface-sunken);
}

@media (prefers-reduced-motion: reduce) {
  .typed__caret {
    animation: none !important;
    display: none;
  }
}
</style>
