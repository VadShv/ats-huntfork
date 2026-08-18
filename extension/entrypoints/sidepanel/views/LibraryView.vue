<script setup lang="ts">
/**
 * LibraryView — библиотека: сохранённые профили, промпты, шаблоны.
 *
 * Переработано: данные из useQueue + chrome.storage.local.
 * Редактор пользовательских промптов с переменными.
 */
import { ref, computed, onMounted } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useQueue } from '../composables/useQueue'
import { useOutreach } from '../composables/useOutreach'
import { useSidekick } from '../composables/useSidekick'
import { useOnline } from '../composables/usePanelWidth'
import { useToast } from '../composables/useToast'

type Tab = 'profiles' | 'prompts' | 'templates'

const tab = ref<Tab>('profiles')
const loading = ref(true)
const searchQuery = ref('')

const { queue } = useQueue()
const { templates, addTemplate, removeTemplate, channelLabel } = useOutreach()
const { prompts, FALLBACK_PROMPTS } = useSidekick()
const { online } = useOnline()
const { toast } = useToast()

// Пользовательские промпты
interface CustomPrompt {
  id: string
  title: string
  mode: string
  desc: string
  body: string
  isBuiltIn: boolean
}

const customPrompts = ref<CustomPrompt[]>([])
const PROMPTS_KEY = 'hf:custom-prompts'

onMounted(async () => {
  setTimeout(() => { loading.value = false }, 300)
  try {
    const result = await chrome.storage.local.get(PROMPTS_KEY)
    const builtIn = (prompts.value.length ? prompts.value : FALLBACK_PROMPTS).map((p) => ({
      id: p.id, title: p.label, mode: p.mode, desc: '', body: '', isBuiltIn: true,
    }))
    const custom = Array.isArray(result[PROMPTS_KEY]) ? result[PROMPTS_KEY] : []
    customPrompts.value = [...builtIn, ...custom]
  } catch {
    customPrompts.value = FALLBACK_PROMPTS.map((p) => ({
      id: p.id, title: p.label, mode: p.mode, desc: '', body: '', isBuiltIn: true,
    }))
  }
})

function persistPrompts() {
  const custom = customPrompts.value.filter((p) => !p.isBuiltIn)
  try { chrome.storage.local.set({ [PROMPTS_KEY]: custom }) } catch {}
}

// Форма создания промпта
const showPromptForm = ref(false)
const promptTitle = ref('')
const promptMode = ref('custom')
const promptDesc = ref('')
const promptBody = ref('')

function onAddPrompt() {
  if (!promptTitle.value.trim() || !promptBody.value.trim()) return
  const p: CustomPrompt = {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: promptTitle.value.trim(),
    mode: promptMode.value.trim() || 'custom',
    desc: promptDesc.value.trim(),
    body: promptBody.value.trim(),
    isBuiltIn: false,
  }
  customPrompts.value = [...customPrompts.value, p]
  persistPrompts()
  toast('Промпт создан', 'success')
  showPromptForm.value = false
  promptTitle.value = ''
  promptDesc.value = ''
  promptBody.value = ''
}

function onRemovePrompt(id: string) {
  customPrompts.value = customPrompts.value.filter((p) => p.id !== id || p.isBuiltIn)
  persistPrompts()
  toast('Промпт удалён', 'default')
}

// Сохранённые профили из очереди
const savedProfiles = computed(() => {
  const q = queue.value.filter((item) => item.status === 'done' || item.status === 'pending')
  if (!searchQuery.value) return q
  const sq = searchQuery.value.toLowerCase()
  return q.filter((item) =>
    item.source.toLowerCase().includes(sq) || item.url.toLowerCase().includes(sq)
  )
})

const filteredPrompts = computed(() => {
  if (!searchQuery.value) return customPrompts.value
  const sq = searchQuery.value.toLowerCase()
  return customPrompts.value.filter((p) =>
    p.title.toLowerCase().includes(sq) || p.desc.toLowerCase().includes(sq)
  )
})

const filteredTemplates = computed(() => {
  if (!searchQuery.value) return templates.value
  const sq = searchQuery.value.toLowerCase()
  return templates.value.filter((t) => t.name.toLowerCase().includes(sq))
})

function fmtTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  return `${Math.floor(hr / 24)} д назад`
}

function openUrl(url: string) {
  window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div class="library-view hf-scroll">
    <div class="lv-header">
      <h2 class="lv-title">Библиотека</h2>
      <div class="hf-subtabs" role="tablist">
        <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'profiles' }" role="tab" :aria-selected="tab === 'profiles'" @click="tab = 'profiles'">
          <HfIcon name="sourcing" :size="14" /> Профили
        </button>
        <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'prompts' }" role="tab" :aria-selected="tab === 'prompts'" @click="tab = 'prompts'">
          <HfIcon name="chat" :size="14" /> Промпты
        </button>
        <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'templates' }" role="tab" :aria-selected="tab === 'templates'" @click="tab = 'templates'">
          <HfIcon name="template" :size="14" /> Шаблоны
        </button>
      </div>
    </div>

    <!-- Поиск -->
    <div class="lv-search">
      <HfIcon name="search" :size="14" class="lv-search-ico" />
      <input v-model="searchQuery" type="text" placeholder="Поиск…" class="lv-search-input" />
    </div>

    <!-- Профили -->
    <template v-if="tab === 'profiles'">
      <div v-if="loading" class="lv-grid">
        <HfSkeleton v-for="i in 4" :key="i" :lines="2" />
      </div>
      <div v-else-if="savedProfiles.length" class="lv-grid">
        <button v-for="item in savedProfiles" :key="item.id" class="lv-card" @click="openUrl(item.url)">
          <div class="lv-card-head">
            <span class="lv-card-source">{{ item.source }}</span>
            <HfChip :tone="item.status === 'done' ? 'ok' : 'warn'" size="xs">
              {{ item.status === 'done' ? 'Готово' : 'В очереди' }}
            </HfChip>
          </div>
          <p class="lv-card-time">{{ fmtTime(item.addedAt) }}</p>
        </button>
      </div>
      <HfEmpty v-else icon="sourcing" title="Нет профилей"
        subtitle="Сохранённые и обработанные профили появятся здесь." />
    </template>

    <!-- Промпты -->
    <template v-if="tab === 'prompts'">
      <div class="lv-actions">
        <HfButton variant="ghost" size="sm" @click="showPromptForm = !showPromptForm">
          <HfIcon name="plus" :size="14" /> Новый промпт
        </HfButton>
      </div>

      <div v-if="showPromptForm" class="lv-form">
        <input v-model="promptTitle" type="text" placeholder="Название" class="lv-field" />
        <input v-model="promptDesc" type="text" placeholder="Описание (опц.)" class="lv-field" />
        <input v-model="promptMode" type="text" placeholder="Mode (custom, summary, …)" class="lv-field" />
        <textarea v-model="promptBody" class="lv-textarea" rows="4" placeholder="Текст промпта. Переменные: {{candidate_name}}, {{job_title}}, {{page_text}}" />
        <div class="lv-form-actions">
          <HfButton variant="ghost" size="sm" @click="showPromptForm = false">Отмена</HfButton>
          <HfButton size="sm" @click="onAddPrompt" :disabled="!promptTitle.trim() || !promptBody.trim()">
            <HfIcon name="check" :size="14" /> Сохранить
          </HfButton>
        </div>
      </div>

      <div v-if="filteredPrompts.length" class="lv-list">
        <div v-for="p in filteredPrompts" :key="p.id" class="lv-prompt">
          <div class="lv-prompt-head">
            <div>
              <p class="lv-prompt-title">{{ p.title }}</p>
              <p v-if="p.desc" class="lv-prompt-desc">{{ p.desc }}</p>
            </div>
            <div class="lv-prompt-meta">
              <HfChip tone="mid" size="xs">{{ p.mode }}</HfChip>
              <HfChip v-if="p.isBuiltIn" tone="primary" size="xs">Встроенный</HfChip>
              <button v-if="!p.isBuiltIn" class="lv-prompt-remove" @click="onRemovePrompt(p.id)" title="Удалить">
                <HfIcon name="close" :size="12" />
              </button>
            </div>
          </div>
          <p v-if="p.body" class="lv-prompt-body">{{ p.body.slice(0, 150) }}{{ p.body.length > 150 ? '…' : '' }}</p>
        </div>
      </div>
      <HfEmpty v-else icon="chat" title="Нет промптов"
        subtitle="Создайте пользовательский промпт с переменными." />
    </template>

    <!-- Шаблоны -->
    <template v-if="tab === 'templates'">
      <div v-if="filteredTemplates.length" class="lv-list">
        <div v-for="t in filteredTemplates" :key="t.id" class="lv-prompt">
          <div class="lv-prompt-head">
            <div>
              <p class="lv-prompt-title">{{ t.name }}</p>
            </div>
            <div class="lv-prompt-meta">
              <HfChip tone="mid" size="xs">{{ channelLabel(t.channel) }}</HfChip>
              <HfChip v-if="t.isBuiltIn" tone="primary" size="xs">Встроенный</HfChip>
              <button v-if="!t.isBuiltIn" class="lv-prompt-remove" @click="removeTemplate(t.id)" title="Удалить">
                <HfIcon name="close" :size="12" />
              </button>
            </div>
          </div>
          <p class="lv-prompt-body">{{ t.body.slice(0, 150) }}{{ t.body.length > 150 ? '…' : '' }}</p>
        </div>
      </div>
      <HfEmpty v-else icon="template" title="Нет шаблонов"
        subtitle="Создайте шаблон аутрича в разделе «Аутрич»." />
    </template>
  </div>
</template>

<script lang="ts">
import HfButton from '../ui/HfButton.vue'
export default { name: 'LibraryView', components: { HfButton } }
</script>

<style scoped>
.library-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.lv-header { margin-bottom: var(--hf-s-3); }
.lv-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); margin-bottom: var(--hf-s-3); }

.lv-search { position: relative; margin-bottom: var(--hf-s-3); }
.lv-search-ico { position: absolute; left: var(--hf-s-2); top: 50%; transform: translateY(-50%); color: var(--hf-fg-subtle); }
.lv-search-input {
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-2) var(--hf-s-2) var(--hf-s-7);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-sm);
  color: var(--hf-fg);
  outline: none;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.lv-search-input:focus { border-color: var(--hf-primary); }

.lv-actions { margin-bottom: var(--hf-s-3); }

.lv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-2); }
@media (max-width: 420px) { .lv-grid { grid-template-columns: 1fr; } }

.lv-card {
  display: flex; flex-direction: column; gap: var(--hf-s-1);
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  cursor: pointer;
  text-align: left;
  transition: all var(--hf-dur-fast) var(--hf-ease-out);
}
.lv-card:hover { border-color: var(--hf-border-strong); background: var(--hf-surface-raised); }
.lv-card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-1); }
.lv-card-source { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lv-card-time { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.lv-form { display: flex; flex-direction: column; gap: var(--hf-s-2); padding: var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); margin-bottom: var(--hf-s-3); }
.lv-field { padding: var(--hf-s-2) var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); font-size: var(--hf-t-sm); color: var(--hf-fg); outline: none; transition: border-color var(--hf-dur-fast) var(--hf-ease-out); }
.lv-field:focus { border-color: var(--hf-primary); }
.lv-textarea { padding: var(--hf-s-2) var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); font-size: var(--hf-t-sm); color: var(--hf-fg); outline: none; resize: vertical; font-family: var(--hf-font); transition: border-color var(--hf-dur-fast) var(--hf-ease-out); }
.lv-textarea:focus { border-color: var(--hf-primary); }
.lv-form-actions { display: flex; justify-content: flex-end; gap: var(--hf-s-2); }

.lv-list { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.lv-prompt { border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); padding: var(--hf-s-3); }
.lv-prompt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--hf-s-2); }
.lv-prompt-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.lv-prompt-desc { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); margin-top: 2px; }
.lv-prompt-meta { display: flex; align-items: center; gap: var(--hf-s-1); flex-shrink: 0; }
.lv-prompt-remove { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: none; cursor: pointer; color: var(--hf-fg-subtle); border-radius: var(--hf-r-sm); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.lv-prompt-remove:hover { color: var(--hf-err); background: var(--hf-err-muted); }
.lv-prompt-body { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-relaxed); margin-top: var(--hf-s-2); }
</style>
