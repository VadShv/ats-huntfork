<script setup lang="ts">
/**
 * Command Palette (⌘K): оверлей с фаззи-поиском, группировкой и клавиатурной навигацией.
 * Подсветка совпадений через <mark>. Переезжающий хайлайлет (top + height).
 */
import { ref, computed, watch, nextTick } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { VIEW_DEFS, prompts, chatMessages, currentUrl } = useSidekick()
const { selectView, runPrompt, openChat } = useSidekickActions()

interface CmdItem {
  id: string
  label: string
  hint?: string
  icon: string
  group: string
  run: () => void
}

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

/** Все команды, сгруппированные. */
const allItems = computed<CmdItem[]>(() => {
  const items: CmdItem[] = []

  // Разделы
  for (const v of VIEW_DEFS) {
    items.push({
      id: `view-${v.id}`, label: v.label, hint: `Раздел`, icon: v.icon, group: 'Разделы',
      run: () => selectView(v.id as any),
    })
  }
 // Действия
 items.push({ id: 'act-chat', label: 'Задать вопрос по странице', hint: '⌘L', icon: 'chat', group: 'Действия', run: () => openChat() })
 items.push({ id: 'act-screen', label: 'Оценить соответствие', icon: 'screening', group: 'Действия', run: () => { selectView('screening'); runPrompt({ id: 'fit', label: 'Оценка соответствия', mode: 'fit' }) } })
 items.push({ id: 'act-source', label: 'Импортировать кандидата', icon: 'sourcing', group: 'Действия', run: () => selectView('sourcing') })
  items.push({ id: 'act-tg', label: 'Открыть Telegram', icon: 'telegram', group: 'Действия', run: () => selectView('telegram' as any) })
  items.push({ id: 'act-outreach', label: 'Аутрич: черновики и шаблоны', icon: 'outreach', group: 'Действия', run: () => selectView('outreach' as any) })
  items.push({ id: 'act-library', label: 'Библиотека', icon: 'library', group: 'Действия', run: () => selectView('library' as any) })

  // Промпты
  const plist = prompts.value.length ? prompts.value : [
    { id: 'card', label: 'Карточка знаний', mode: 'card' },
    { id: 'questions', label: 'Вопросы для интервью', mode: 'questions' },
    { id: 'translate', label: 'Перевести на русский', mode: 'translate' },
  ]
  for (const p of plist) {
    items.push({
      id: `prompt-${p.id}`, label: p.label, hint: 'Промпт', icon: 'sparkle', group: 'Промпты',
      run: () => runPrompt(p as any),
    })
  }

  // Недавние чаты (мок из памяти)
  const recent = chatMessages.value.filter(m => m.role === 'user').slice(-3).reverse()
  for (const m of recent) {
    items.push({
      id: `recent-${m.content.slice(0, 20)}`, label: m.content.slice(0, 48), hint: 'Недавнее', icon: 'chat', group: 'Недавние',
      run: () => openChat(),
    })
  }

  return items
})

/** Простой фаззи-поиск: проверяем все символы запроса по порядку. */
function fuzzyMatch(text: string, q: string): boolean {
  if (!q) return true
  const t = text.toLowerCase()
  const qq = q.toLowerCase()
  let ti = 0
  for (let qi = 0; qi < qq.length; qi++) {
    ti = t.indexOf(qq[qi], ti)
    if (ti === -1) return false
    ti++
  }
  return true
}

/** Подсветка совпавших символов. */
function highlight(label: string): string {
  const q = query.value.toLowerCase()
  if (!q) return label
  const t = label.toLowerCase()
  let out = ''
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) { out += label.slice(ti); break }
    out += label.slice(ti, idx) + `<mark>${label[idx]}</mark>`
    ti = idx + 1
  }
  if (ti < label.length) out += label.slice(ti)
  return out
}

const filtered = computed(() => {
  const q = query.value
  return allItems.value.filter(it => fuzzyMatch(it.label, q) || fuzzyMatch(it.group, q))
})

/** Сгруппированный результат для рендера. */
const grouped = computed(() => {
  const map = new Map<string, CmdItem[]>()
  for (const it of filtered.value) {
    if (!map.has(it.group)) map.set(it.group, [])
    map.get(it.group)!.push(it)
  }
  return Array.from(map.entries())
})

/** Сгруппированный результат с предрассчитанным плоским индексом (без O(n²) в шаблоне). */
const groupedWithIndex = computed(() => {
  const result: Array<[string, Array<CmdItem & { idx: number }>]> = []
  let idx = 0
  for (const [group, items] of grouped.value) {
    result.push([group, items.map(it => ({ ...it, idx: idx++ }))])
  }
  return result
})

/** Плоский список (для индексации клавиатурой). */
const flatList = computed(() => filtered.value)

watch(() => props.open, async (open) => {
  if (open) {
    query.value = ''
    activeIndex.value = 0
    await nextTick()
    inputEl.value?.focus()
  }
})

watch(query, () => { activeIndex.value = 0 })

/** Перемещение по списку + авто-скролл. */
function move(delta: number) {
  if (!flatList.value.length) return
  activeIndex.value = (activeIndex.value + delta + flatList.value.length) % flatList.value.length
  nextTick(() => {
    const el = listEl.value?.querySelector(`[data-idx="${activeIndex.value}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function activate() {
  const item = flatList.value[activeIndex.value]
  if (item) { item.run(); emit('close') }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); activate() }
  else if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}

/** Позиция хайлайлета по активному индексу. */
const highlightStyle = computed(() => {
  // 38px высота строки
  return { transform: `translateY(${activeIndex.value * 38}px)` }
})
</script>

<template>
  <Transition name="hf-backdrop">
    <div v-if="open" class="cmd-backdrop hf-backdrop-in" @click="emit('close')">
      <div class="cmd-modal hf-modal-in" @click.stop>
        <div class="cmd-input-wrap">
          <HfIcon name="command" :size="18" class="cmd-input-ico" />
          <input
            ref="inputEl"
            v-model="query"
            class="cmd-input"
            placeholder="Команды, разделы, промпты…"
            @keydown="onKeydown"
          />
          <kbd class="cmd-esc">ESC</kbd>
        </div>

        <div ref="listEl" class="cmd-list hf-scroll">
         <!-- Переезжающий хайлайлет -->
         <div class="cmd-highlight" :style="highlightStyle" />

         <template v-for="([group, items]) in groupedWithIndex" :key="group">
           <div class="cmd-group">{{ group }}</div>
           <button
             v-for="it in items"
             :key="it.id"
             :data-idx="it.idx"
             class="cmd-row"
             :class="{ 'cmd-row--active': it.idx === activeIndex }"
             @click="activeIndex = it.idx; activate()"
             @mouseenter="activeIndex = it.idx"
           >
             <span class="cmd-row-ico"><HfIcon :name="it.icon" :size="16" /></span>
             <span class="cmd-row-label" v-html="highlight(it.label)" />
             <kbd v-if="it.hint" class="cmd-hint">{{ it.hint }}</kbd>
           </button>
         </template>

          <div v-if="!flatList.length" class="cmd-empty">
            Ничего не найдено по «{{ query }}»
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts">
export default { name: 'CommandPalette' }
</script>

<style scoped>
.cmd-backdrop {
  position: fixed; inset: 0;
  background: rgba(10, 10, 10, 0.5);
  z-index: 100;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.cmd-modal {
  width: calc(100% - var(--hf-s-6));
  max-width: 480px;
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-xl);
  box-shadow: var(--hf-shadow-lg);
  overflow: hidden;
  display: flex; flex-direction: column;
  max-height: 70vh;
}

.cmd-input-wrap {
  display: flex; align-items: center; gap: var(--hf-s-3);
  padding: var(--hf-s-3) var(--hf-s-4);
  border-bottom: 1px solid var(--hf-border);
}
.cmd-input-ico { color: var(--hf-fg-subtle); flex-shrink: 0; }
.cmd-input {
  flex: 1; border: none; background: transparent; outline: none;
  font-size: var(--hf-t-md); color: var(--hf-fg);
  font-family: var(--hf-font);
}
.cmd-input::placeholder { color: var(--hf-fg-subtle); }
.cmd-esc {
  font-family: var(--hf-mono); font-size: 10px;
  padding: 2px var(--hf-s-2); border-radius: var(--hf-r-sm);
  border: 1px solid var(--hf-border); color: var(--hf-fg-subtle);
  background: var(--hf-surface-sunken);
}

.cmd-list { position: relative; overflow-y: auto; padding: var(--hf-s-2); }
.cmd-highlight {
  position: absolute; left: var(--hf-s-2); right: var(--hf-s-2);
  height: 38px; border-radius: var(--hf-r-md);
  background: var(--hf-primary-muted);
  transition: transform var(--hf-dur-fast) var(--hf-ease-out);
  pointer-events: none;
}
.cmd-group {
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--hf-fg-subtle);
  padding: var(--hf-s-2) var(--hf-s-3) var(--hf-s-1);
}
.cmd-row {
  position: relative; z-index: 1;
  display: flex; align-items: center; gap: var(--hf-s-3);
  width: 100%; height: 38px; padding: 0 var(--hf-s-3);
  border-radius: var(--hf-r-md);
  font-size: var(--hf-t-sm); color: var(--hf-fg);
}
.cmd-row-ico { display: flex; color: var(--hf-fg-muted); flex-shrink: 0; }
.cmd-row--active .cmd-row-ico { color: var(--hf-primary); }
.cmd-row-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-row-label :deep(mark) { background: transparent; color: var(--hf-primary); font-weight: var(--hf-fw-semibold); }
.cmd-hint {
  font-family: var(--hf-mono); font-size: 10px;
  padding: 2px var(--hf-s-1); border-radius: var(--hf-r-sm);
  border: 1px solid var(--hf-border); color: var(--hf-fg-subtle);
  background: var(--hf-surface-sunken);
}
.cmd-empty { padding: var(--hf-s-6); text-align: center; font-size: var(--hf-t-sm); color: var(--hf-fg-subtle); }

.hf-backdrop-enter-active, .hf-backdrop-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out); }
.hf-backdrop-enter-from, .hf-backdrop-leave-to { opacity: 0; }

/* Инерция закрытия модалки ⌘K: замах по оси Z (§7 ТЗ «Фирменные детали»).
   scale(1 → 1.015 → 0.97) — ощущение массы и качества сборки. */
.hf-backdrop-leave-active .cmd-modal {
  animation: cmd-modal-out 240ms var(--hf-ease-in-out) both;
}
@keyframes cmd-modal-out {
  0%   { transform: scale(1); opacity: 1; }
  18%  { transform: scale(1.015); opacity: 1; }
  100% { transform: scale(0.97); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .hf-backdrop-leave-active .cmd-modal {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
