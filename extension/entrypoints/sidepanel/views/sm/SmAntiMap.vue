<script setup lang="ts">
/** SmAntiMap — блок «Анти-карта» (блок 6.1).
 *  Кого НЕ надо искать: компании, роли-омонимы, сегменты. */
import { ref } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import HfChip from '../../ui/HfChip.vue'
import { useSearchMap } from '../../composables/useSearchMap'

const { antiMap } = useSearchMap()

const newLabel = ref('')
const newKind = ref<'company' | 'role' | 'segment'>('company')
const newReason = ref('')
const items = ref([...antiMap.value])
let seq = 1000

const KIND_META = {
  company: { label: 'Компания', icon: 'building' },
  role: { label: 'Роль-омоним', icon: 'alert' },
  segment: { label: 'Сегмент', icon: 'filter' },
} as const

function add() {
  if (!newLabel.value.trim()) return
  items.value.push({
    id: `a${++seq}`,
    kind: newKind.value,
    label: newLabel.value.trim(),
    reason: newReason.value.trim() || 'не указано',
    source: 'manual',
  })
  newLabel.value = ''
  newReason.value = ''
}
function remove(id: string) {
  const idx = items.value.findIndex(i => i.id === id)
  if (idx >= 0) items.value.splice(idx, 1)
}
</script>

<template>
  <div class="sm-anti">
    <p class="sm-anti-lead">Экономит больше времени, чем половина позитивных гипотез.</p>

    <div class="sm-anti-list">
      <div
        v-for="(item, i) in items"
        :key="item.id"
        class="sm-anti-item hf-cascade"
        :style="{ '--hf-i': Math.min(i, 7) }"
      >
        <HfIcon :name="KIND_META[item.kind].icon" :size="14" class="sm-anti-item-icon" />
        <div class="sm-anti-item-main">
          <div class="sm-anti-item-head">
            <span class="sm-anti-item-label">{{ item.label }}</span>
            <HfChip :tone="item.kind === 'company' ? 'low' : item.kind === 'role' ? 'mid' : 'default'">{{ KIND_META[item.kind].label }}</HfChip>
            <span class="sm-anti-item-src" :class="`sm-anti-item-src--${item.source}`">{{ item.source === 'ats' ? 'из ATS' : 'ручное' }}</span>
          </div>
          <p class="sm-anti-item-reason">{{ item.reason }}</p>
        </div>
        <button class="sm-anti-item-remove" @click="remove(item.id)"><HfIcon name="close" :size="13" /></button>
      </div>
    </div>

    <div class="sm-anti-add">
      <select v-model="newKind" class="hf-input sm-anti-kind">
        <option value="company">Компания</option>
        <option value="role">Роль-омоним</option>
        <option value="segment">Сегмент</option>
      </select>
      <input v-model="newLabel" class="hf-input sm-anti-label" placeholder="Кого исключить" @keydown.enter="add" />
      <input v-model="newReason" class="hf-input sm-anti-reason" placeholder="Почему" @keydown.enter="add" />
      <button class="sm-anti-add-btn" @click="add"><HfIcon name="plus" :size="14" /></button>
    </div>
  </div>
</template>

<style scoped>
.sm-anti-lead { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); margin: 0 0 var(--hf-s-3); line-height: var(--hf-lh-normal); }
.sm-anti-list { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.sm-anti-item { display: flex; align-items: flex-start; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface); }
.sm-anti-item-icon { color: var(--hf-match-low); margin-top: 2px; flex-shrink: 0; }
.sm-anti-item-main { flex: 1; min-width: 0; }
.sm-anti-item-head { display: flex; align-items: center; gap: var(--hf-s-2); flex-wrap: wrap; margin-bottom: 2px; }
.sm-anti-item-label { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg); }
.sm-anti-item-src { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.sm-anti-item-src--ats { color: var(--hf-primary); }
.sm-anti-item-reason { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); margin: 0; line-height: var(--hf-lh-normal); }
.sm-anti-item-remove { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--hf-r-sm); color: var(--hf-fg-subtle); flex-shrink: 0; transition: background var(--hf-dur-fast), color var(--hf-dur-fast); }
.sm-anti-item-remove:hover { background: var(--hf-err-muted); color: var(--hf-err); }

.sm-anti-add { display: flex; gap: var(--hf-s-1); margin-top: var(--hf-s-3); }
.sm-anti-kind { width: auto; flex-shrink: 0; }
.sm-anti-label { flex: 1; min-width: 0; }
.sm-anti-reason { flex: 1.5; min-width: 0; }
.sm-anti-add-btn { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--hf-r-md); background: var(--hf-primary); color: var(--hf-fg-on-accent); flex-shrink: 0; transition: background var(--hf-dur-fast); }
.sm-anti-add-btn:hover { background: var(--hf-primary-hover); }
@media (prefers-reduced-motion: reduce) { .sm-anti-item { animation: none !important; } }
</style>
