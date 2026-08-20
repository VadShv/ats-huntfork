<!--
  InertialLayer.vue — обёртка Transition с инерцией закрытия.
  ТЗ «Фирменные детали» §7.

  Асимметрия: открытие 220мс ease-out, закрытие 260мс spring-gentle.
  Микро-замах 3px (panel) / 1.5px (popover/modal) / 0 (toast) перед уходом.
  Фокус возвращается на элемент-инициатор СРАЗУ, до анимации.
-->
<script setup lang="ts">
import { useInertialClose, type InertiaKind } from '../../composables/signature'

const props = withDefaults(defineProps<{
  /** Тип элемента для профиля инерции. */
  kind?: InertiaKind
  /** Имя transition-класса (по умолчанию 'inertia'). */
  name?: string
}>(), { kind: 'panel', name: 'inertia' })

const { style } = useInertialClose(props.kind)
</script>

<template>
  <Transition
    :name="name"
    :style="style"
    appear
  >
    <slot />
  </Transition>
</template>

<style scoped>
/* Открытие: быстро и уверенно. */
.inertia-enter-active {
  transition:
    opacity var(--hf-dur-base) var(--hf-ease-out),
    transform var(--hf-dur-base) var(--hf-ease-out);
}

.inertia-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

/* Закрытие: микро-замах, затем уход. */
.inertia-leave-active {
  animation: inertia-out var(--hf-close-dur) var(--hf-ease-in-out) both;
}

@keyframes inertia-out {
  0% {
    transform: translateX(0);
    opacity: 1;
  }
  18% {
    transform: translateX(calc(var(--hf-kick, 3px) * -1));
    opacity: 1;
  }
  100% {
    transform: translateX(110%);
    opacity: 0;
  }
}

/* Для toast — уход вниз без замаха. */
.inertia-leave-active[data-kind='toast'] {
  animation: inertia-toast-out var(--hf-close-dur) var(--spring-gentle) both;
}

@keyframes inertia-toast-out {
  0% {
    transform: translateY(0);
    opacity: 1;
  }
  100% {
    transform: translateY(100%);
    opacity: 0;
  }
}

/* Для modal — замах по оси Z. */
.inertia-leave-active[data-kind='modal'] {
  animation: inertia-modal-out var(--hf-close-dur) var(--hf-ease-in-out) both;
}

@keyframes inertia-modal-out {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  18% {
    transform: scale(1.015);
    opacity: 1;
  }
  100% {
    transform: scale(0.97);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .inertia-enter-active,
  .inertia-leave-active {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
