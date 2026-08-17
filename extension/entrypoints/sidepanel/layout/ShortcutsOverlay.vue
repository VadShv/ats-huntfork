<script setup lang="ts">
/**
 * ShortcutsOverlay — модалка со всеми горячими клавишами.
 * Открывается по клавише ? (или Shift+/).
 */
import { ref } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const groups = ref([
  {
    title: 'Навигация',
    items: [
      { keys: ['⌘', '1–7'], label: 'Переключение разделов' },
      { keys: ['⌘', 'K'], label: 'Командная палитра' },
      { keys: ['⌘', '\\'], label: 'Свернуть/закрепить рельс' },
      { keys: ['⌘', ','], label: 'Настройки' },
      { keys: ['?'], label: 'Эта справка' },
      { keys: ['Esc'], label: 'Закрыть окно' },
    ],
  },
  {
    title: 'Сорсинг',
    items: [
      { keys: ['⌘', 'Shift', 'C'], label: 'Захватить профиль' },
      { keys: ['⌘', 'Shift', 'S'], label: 'Сводка по профилю' },
      { keys: ['⌘', 'Shift', 'V'], label: 'Верификация' },
      { keys: ['⌘', 'Shift', 'Q'], label: 'В очередь' },
      { keys: ['Space'], label: 'Быстрый захват (на странице)' },
    ],
  },
  {
    title: 'Действия',
    items: [
      { keys: ['⌘', 'Enter'], label: 'Отправить черновик' },
      { keys: ['⌘', 'D'], label: 'Дублировать черновик' },
      { keys: ['⌘', 'E'], label: 'Экспорт CSV' },
    ],
  },
])

function onClose() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="hf-overlay">
      <div v-if="props.open" class="shortcuts-overlay" @click.self="onClose">
        <div class="shortcuts-modal hf-scroll" role="dialog" aria-label="Горячие клавиши">
          <header class="shortcuts-header">
            <h2>Горячие клавиши</h2>
            <button class="shortcuts-close" @click="onClose" aria-label="Закрыть">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div class="shortcuts-body">
            <section v-for="g in groups" :key="g.title" class="shortcut-group">
              <h3 class="shortcut-group__title">{{ g.title }}</h3>
              <ul class="shortcut-list">
                <li v-for="item in g.items" :key="item.label" class="shortcut-item">
                  <span class="shortcut-item__label">{{ item.label }}</span>
                  <span class="shortcut-item__keys">
                    <kbd v-for="(k, idx) in item.keys" :key="idx" class="shortcut-kbd">{{ k }}</kbd>
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 10, 0.6);
  animation: hf-fade-in var(--hf-dur-base) var(--hf-ease-out);
}

.shortcuts-modal {
  width: min(440px, 90vw);
  max-height: 80vh;
  border-radius: 14px;
  background: var(--hf-surface);
  border: 1px solid var(--hf-border);
  box-shadow: var(--hf-shadow-lg);
  overflow-y: auto;
}

.shortcuts-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--hf-surface);
  border-bottom: 1px solid var(--hf-border);
  z-index: 1;
}

.shortcuts-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--hf-fg);
}

.shortcuts-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--hf-fg-muted);
  cursor: pointer;
  transition: background var(--hf-dur-fast) var(--hf-ease-out),
              color var(--hf-dur-fast) var(--hf-ease-out);
}

.shortcuts-close:hover {
  background: var(--hf-surface-hover);
  color: var(--hf-fg);
}

.shortcuts-body {
  padding: 12px 20px 20px;
}

.shortcut-group {
  margin-bottom: 16px;
}

.shortcut-group:last-child {
  margin-bottom: 0;
}

.shortcut-group__title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--hf-fg-muted);
}

.shortcut-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px;
  border-radius: 7px;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}

.shortcut-item:hover {
  background: var(--hf-surface-hover);
}

.shortcut-item__label {
  font-size: 13px;
  color: var(--hf-fg);
}

.shortcut-item__keys {
  display: flex;
  align-items: center;
  gap: 4px;
}

.shortcut-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
  font-family: var(--hf-mono, ui-monospace, monospace);
  font-weight: 500;
  color: var(--hf-fg);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  line-height: 1;
}

:global(.dark) .shortcut-kbd {
  background: var(--hf-surface-raised);
  border-color: var(--hf-border-strong);
}

.hf-overlay-enter-active,
.hf-overlay-leave-active {
  transition: opacity var(--hf-dur-base) var(--hf-ease-out);
}

.hf-overlay-enter-active .shortcuts-modal,
.hf-overlay-leave-active .shortcuts-modal {
  transition: transform var(--hf-dur-base) var(--spring-snappy, var(--hf-ease-out)),
              opacity var(--hf-dur-base) var(--hf-ease-out);
}

.hf-overlay-enter-from,
.hf-overlay-leave-to {
  opacity: 0;
}

.hf-overlay-enter-from .shortcuts-modal,
.hf-overlay-leave-to .shortcuts-modal {
  transform: scale(0.95) translateY(8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .shortcuts-modal { animation: none; }
  .hf-overlay-enter-active,
  .hf-overlay-leave-active,
  .hf-overlay-enter-active .shortcuts-modal,
  .hf-overlay-leave-active .shortcuts-modal {
    transition-duration: 0.01ms;
  }
}
</style>
