<script setup lang="ts">
/** QueuePanel — аккордеон «Очередь · N» в SourcingView.
 *  Рекрутер складывает профили хоткеем (⌘⇧E), потом обрабатывает пачкой.
 *  Поддержка заметок, тегов и CSV-экспорта. */
import { ref, computed } from 'vue'
import { useQueue } from '../composables/useQueue'
import HfButton from '../ui/HfButton.vue'
import HfIcon from '../ui/HfIcon.vue'

const {
  queue,
  remove,
  clear,
  clearDone,
  pendingCount,
  totalCount,
  setNote,
  addTag,
  removeTag,
  allTags,
  exportCsv,
} = useQueue()

const expanded = ref(true)
const pending = computed(() => pendingCount())
const total = computed(() => totalCount())

const expandedItem = ref<string | null>(null)
const newTagInput = ref<Record<string, string>>({})

function toggleItem(id: string) {
  expandedItem.value = expandedItem.value === id ? null : id
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener')
}

function handleTagEnter(id: string, e: KeyboardEvent) {
  const val = (e.target as HTMLInputElement).value
  if (val.trim()) {
    addTag(id, val)
    newTagInput.value[id] = ''
  }
}

function downloadCsv() {
  const csv = exportCsv()
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `huntfork-queue-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function statusLabel(s: string): string {
  return { pending: 'ожидает', processing: 'в работе', done: 'готово', error: 'ошибка' }[s] ?? s
}
</script>

<template>
  <section class="queue-panel">
    <button class="queue-header" @click="expanded = !expanded">
      <span class="queue-header__title">
        Очередь
        <span v-if="pending > 0" class="queue-badge">{{ pending }}</span>
      </span>
      <span class="queue-header__meta">
        {{ total }} {{ total === 1 ? 'профиль' : total < 5 && total > 0 ? 'профиля' : 'профилей' }}
      </span>
      <HfIcon
        name="chevron-down"
        :size="16"
        class="queue-header__chevron"
        :class="{ 'queue-header__chevron--open': expanded }"
      />
    </button>

    <Transition name="queue-expand">
      <div v-if="expanded" class="queue-body">
        <div v-if="queue.length > 0" class="queue-toolbar">
          <HfButton size="sm" variant="ghost" @click="clearDone">
            <HfIcon name="check" :size="14" /> Очистить готовые
          </HfButton>
          <HfButton size="sm" variant="ghost" @click="downloadCsv" title="Экспорт в CSV">
            <HfIcon name="download" :size="14" /> CSV
          </HfButton>
          <HfButton size="sm" variant="ghost" @click="clear">
            <HfIcon name="trash" :size="14" /> Очистить
          </HfButton>
        </div>

        <p v-if="queue.length === 0" class="queue-empty">
          Очередь пуста. Добавляйте профили хоткеем <kbd>⌘⇧Q</kbd> при просмотре выдачи.
        </p>

        <ul v-else class="queue-list">
          <li
            v-for="(item, i) in queue"
            :key="item.id"
            class="queue-item"
            :class="`queue-item--${item.status}`"
            :style="{ '--hf-i': i }"
          >
            <div class="queue-item-row">
              <button class="queue-item-main" @click="openUrl(item.url)">
                <span class="queue-item-name">{{ item.name || 'Без имени' }}</span>
                <span class="queue-item-src">{{ item.source }}</span>
              </button>
              <button
                class="queue-item-expand"
                :title="expandedItem === item.id ? 'Свернуть' : 'Заметки и теги'"
                @click="toggleItem(item.id)"
              >
                <HfIcon
                  name="chevron-down"
                  :size="14"
                  :class="{ 'queue-item-expand--open': expandedItem === item.id }"
                />
              </button>
              <button class="queue-item-remove" title="Убрать" @click="remove(item.id)">
                <HfIcon name="close" :size="14" />
              </button>
            </div>

            <div v-if="item.tags?.length" class="queue-item-tags">
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="queue-tag"
              >
                {{ tag }}
                <button class="queue-tag-remove" @click="removeTag(item.id, tag)">
                  <HfIcon name="close" :size="10" />
                </button>
              </span>
            </div>

            <Transition name="queue-expand">
              <div v-if="expandedItem === item.id" class="queue-item-detail">
                <textarea
                  class="queue-note-input"
                  placeholder="Заметка по кандидату…"
                  :value="item.note || ''"
                  @input="setNote(item.id, ($event.target as HTMLTextAreaElement).value)"
                  rows="2"
                />
                <div class="queue-tag-add">
                  <input
                    class="queue-tag-input"
                    type="text"
                    placeholder="Добавить тег + Enter"
                    v-model="newTagInput[item.id]"
                    @keydown.enter.prevent="handleTagEnter(item.id, $event)"
                  />
                </div>
                <div v-if="allTags.length" class="queue-tag-suggestions">
                  <button
                    v-for="tag in allTags.filter((t) => !item.tags?.includes(t))"
                    :key="tag"
                    class="queue-tag-suggestion"
                    @click="addTag(item.id, tag)"
                  >
                    + {{ tag }}
                  </button>
                </div>
              </div>
            </Transition>

            <span class="queue-item-time">{{ fmtTime(item.addedAt) }}</span>
            <span class="queue-item-status">{{ statusLabel(item.status) }}</span>
          </li>
        </ul>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.queue-panel {
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  overflow: hidden;
}

.queue-header {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-3);
  border: none;
  background: transparent;
  cursor: pointer;
  user-select: none;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-header:hover { background: var(--hf-surface-hover); }

.queue-header__title {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  font-size: 13px;
  font-weight: 600;
  color: var(--hf-fg);
}

.queue-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--hf-fg-on-accent);
  background: var(--hf-accent);
  border-radius: 9px;
}

.queue-header__meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--hf-fg-muted);
}

.queue-header__chevron {
  color: var(--hf-fg-muted);
  transition: transform var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-header__chevron--open { transform: rotate(180deg); }

.queue-body { padding: var(--hf-s-2); }

.queue-toolbar {
  display: flex;
  gap: var(--hf-s-1);
  margin-bottom: var(--hf-s-2);
  flex-wrap: wrap;
}

.queue-empty {
  margin: 0;
  padding: var(--hf-s-3);
  text-align: center;
  font-size: 12px;
  color: var(--hf-fg-muted);
  line-height: 1.5;
}

.queue-empty kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--hf-mono, ui-monospace, monospace);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: 4px;
}

.queue-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-1);
}

.queue-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-1);
  border-radius: var(--hf-r-md);
  padding: var(--hf-s-2);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border-subtle, var(--hf-border));
  animation: hf-card-in var(--hf-dur-base) var(--hf-ease-out) both;
  animation-delay: calc(var(--hf-i, 0) * 30ms);
}

:global(.dark) .queue-item {
  background: var(--hf-surface-raised);
}

.queue-item--done { opacity: 0.6; }
.queue-item--error { border-color: var(--hf-err); }

.queue-item-row {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
}

.queue-item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 2px 0;
}

.queue-item-name {
  font-size: 13px;
  font-weight: 550;
  color: var(--hf-fg);
  line-height: 1.3;
}

.queue-item-src {
  font-size: 11px;
  color: var(--hf-fg-muted);
}

.queue-item-expand,
.queue-item-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--hf-fg-muted);
  cursor: pointer;
  transition: background var(--hf-dur-fast) var(--hf-ease-out),
              color var(--hf-dur-fast) var(--hf-ease-out);
}

.queue-item-expand:hover,
.queue-item-remove:hover {
  background: var(--hf-surface-hover);
  color: var(--hf-fg);
}

.queue-item-expand--open { transform: rotate(180deg); }
.queue-item-expand { transition: transform var(--hf-dur-fast) var(--hf-ease-out),
                     background var(--hf-dur-fast) var(--hf-ease-out),
                     color var(--hf-dur-fast) var(--hf-ease-out); }

.queue-item-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.queue-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 500;
  color: var(--hf-accent-fg, var(--hf-fg));
  background: var(--hf-surface-sunken);
  border-radius: 5px;
}

:global(.dark) .queue-tag {
  background: var(--hf-surface-sunken);
}

.queue-tag-remove {
  display: flex;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  opacity: 0.6;
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-tag-remove:hover { opacity: 1; }

.queue-item-detail {
  display: flex;
  flex-direction: column;
  gap: var(--hf-s-1);
  padding-top: var(--hf-s-1);
}

.queue-note-input {
  width: 100%;
  padding: 7px 9px;
  font-size: 12px;
  font-family: inherit;
  color: var(--hf-fg);
  background: var(--hf-surface);
  border: 1px solid var(--hf-border);
  border-radius: 6px;
  resize: vertical;
  min-height: 36px;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-note-input:focus {
  outline: none;
  border-color: var(--hf-accent);
}
.queue-note-input::placeholder { color: var(--hf-fg-muted); }

.queue-tag-input {
  width: 100%;
  padding: 5px 9px;
  font-size: 12px;
  font-family: inherit;
  color: var(--hf-fg);
  background: var(--hf-surface);
  border: 1px solid var(--hf-border);
  border-radius: 6px;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-tag-input:focus {
  outline: none;
  border-color: var(--hf-accent);
}
.queue-tag-input::placeholder { color: var(--hf-fg-muted); }

.queue-tag-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.queue-tag-suggestion {
  border: 1px dashed var(--hf-border);
  background: transparent;
  color: var(--hf-fg-muted);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  cursor: pointer;
  transition: all var(--hf-dur-fast) var(--hf-ease-out);
}
.queue-tag-suggestion:hover {
  border-color: var(--hf-accent);
  color: var(--hf-accent);
}

.queue-item-time,
.queue-item-status {
  font-size: 10px;
  color: var(--hf-fg-subtle, var(--hf-fg-muted));
}
.queue-item-status {
  position: absolute;
  bottom: 6px;
  right: 8px;
}

.queue-expand-enter-active,
.queue-expand-leave-active {
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out),
              max-height var(--hf-dur-base) var(--hf-ease-out);
  overflow: hidden;
  max-height: 500px;
}
.queue-expand-enter-from,
.queue-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

@media (prefers-reduced-motion: reduce) {
  .queue-item { animation: none !important; }
  .queue-header__chevron,
  .queue-item-expand { transition: none !important; }
}
</style>
