<script setup lang="ts">
/**
 * ConversationDrawer — боковой список сохранённых переписок.
 * Выезжает слева поверх чата.
 */
import { computed } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import { useConversations } from '../composables/useConversations'
import { useSidekickActions } from '../composables/useSidekick'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { listConversations, deleteConversation, renameConversation } = useConversations()
const { loadConversationIntoChat, newConversation } = useSidekickActions()

const sorted = computed(() => listConversations())

function fmtDate(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function onPick(id: string) {
  loadConversationIntoChat(id)
  emit('close')
}

function onNew() {
  newConversation()
  emit('close')
}

function onDelete(id: string, e: Event) {
  e.stopPropagation()
  deleteConversation(id)
}

function onRename(id: string, currentTitle: string, e: Event) {
  e.stopPropagation()
  const title = prompt('Название переписки', currentTitle)
  if (title && title.trim()) renameConversation(id, title.trim())
}
</script>

<template>
  <Transition name="hf-drawer">
    <div v-if="props.open" class="conv-drawer-overlay" @click="emit('close')">
      <div class="conv-drawer" @click.stop>
        <div class="conv-drawer-head">
          <span class="conv-drawer-title">Переписки</span>
          <button class="conv-drawer-close" aria-label="Закрыть" @click="emit('close')">
            <HfIcon name="close" :size="18" />
          </button>
        </div>

        <button class="conv-new-btn" @click="onNew">
          <HfIcon name="plus" :size="18" />
          <span>Новый чат</span>
        </button>

        <div class="conv-list hf-scroll">
          <div v-if="!sorted.length" class="conv-empty">
            <HfIcon name="chat" :size="32" />
            <p>Нет сохранённых переписок</p>
          </div>
          <div
            v-for="c in sorted"
            :key="c.id"
            class="conv-item"
            @click="onPick(c.id)"
          >
            <div class="conv-item-main">
              <span class="conv-item-title">{{ c.title }}</span>
              <span class="conv-item-meta">
                {{ fmtDate(c.updatedAt) }} · {{ c.messages.length }} сообщ.
              </span>
              <span v-if="c.jobTitle" class="conv-item-job">
                <HfIcon name="briefcase" :size="11" /> {{ c.jobTitle }}
              </span>
            </div>
            <div class="conv-item-actions">
              <button class="conv-act" title="Переименовать" aria-label="Переименовать" @click="onRename(c.id, c.title, $event)">
                <HfIcon name="edit" :size="14" />
              </button>
              <button class="conv-act conv-act--del" title="Удалить" aria-label="Удалить" @click="onDelete(c.id, $event)">
                <HfIcon name="trash" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.conv-drawer-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.3);
}
.conv-drawer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 290px;
  background: var(--hf-surface);
  border-right: 1px solid var(--hf-border);
  display: flex;
  flex-direction: column;
}
.conv-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--hf-s-3) var(--hf-s-4);
  border-bottom: 1px solid var(--hf-border);
  flex-shrink: 0;
}
.conv-drawer-title {
  font-size: var(--hf-t-lg);
  font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg);
}
.conv-drawer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--hf-r-sm);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.conv-drawer-close:hover {
  background: var(--hf-hover);
  color: var(--hf-fg);
}

.conv-new-btn {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  margin: var(--hf-s-3);
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px dashed var(--hf-border-strong);
  border-radius: var(--hf-r-md);
  background: none;
  cursor: pointer;
  color: var(--hf-fg);
  font-size: var(--hf-t-md);
  transition: background var(--hf-dur-fast) var(--hf-ease-out), border-color var(--hf-dur-fast) var(--hf-ease-out);
  flex-shrink: 0;
}
.conv-new-btn:hover {
  background: var(--hf-hover);
  border-color: var(--hf-primary);
}

.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--hf-s-3) var(--hf-s-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--hf-s-2);
  padding: var(--hf-s-6);
  color: var(--hf-fg-subtle);
  text-align: center;
}
.conv-empty p {
  font-size: var(--hf-t-sm);
}

.conv-item {
  display: flex;
  align-items: flex-start;
  gap: var(--hf-s-2);
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  cursor: pointer;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.conv-item:hover {
  background: var(--hf-hover);
}
.conv-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.conv-item-title {
  font-size: var(--hf-t-sm);
  font-weight: var(--hf-fw-medium);
  color: var(--hf-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-item-meta {
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-subtle);
  font-variant-numeric: tabular-nums;
}
.conv-item-job {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--hf-t-xs);
  color: var(--hf-fg-muted);
}
.conv-item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--hf-dur-fast) var(--hf-ease-out);
}
.conv-item:hover .conv-item-actions {
  opacity: 1;
}
.conv-act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--hf-r-sm);
  color: var(--hf-fg-subtle);
  transition: background var(--hf-dur-instant) var(--hf-ease-out), color var(--hf-dur-instant) var(--hf-ease-out);
}
.conv-act:hover {
  background: var(--hf-surface-sunken);
  color: var(--hf-fg);
}
.conv-act--del:hover {
  color: var(--hf-err);
}

.hf-drawer-enter-active, .hf-drawer-leave-active {
  transition: opacity var(--hf-dur-base) var(--hf-ease-out);
}
.hf-drawer-enter-active .conv-drawer, .hf-drawer-leave-active .conv-drawer {
  transition: transform var(--spring-snappy-dur) var(--spring-snappy);
}
.hf-drawer-enter-from, .hf-drawer-leave-to {
  opacity: 0;
}
.hf-drawer-enter-from .conv-drawer, .hf-drawer-leave-to .conv-drawer {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .hf-drawer-enter-active, .hf-drawer-leave-active,
  .hf-drawer-enter-active .conv-drawer, .hf-drawer-leave-active .conv-drawer {
    transition-duration: 0.01ms !important;
  }
}
</style>
