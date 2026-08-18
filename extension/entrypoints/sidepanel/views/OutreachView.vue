<script setup lang="ts">
/**
 * OutreachView — черновики сообщений кандидатам и шаблоны аутрича.
 *
 * Переработано на useOutreach composable. Две вкладки:
 *  • Черновики — список с раскрытием тела, отправка через каналы
 *  • Шаблоны — встроенные + пользовательские, создание/редактирование
 */
import { ref, computed } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfButton from '../ui/HfButton.vue'
import HfChip from '../ui/HfChip.vue'
import HfCard from '../ui/HfCard.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useOutreach, type OutreachChannel } from '../composables/useOutreach'
import { useOnline } from '../composables/usePanelWidth'

const {
  drafts, templates, activeDrafts, customTemplates,
  createDraft, updateDraft, removeDraft, sendDraft,
  addTemplate, removeTemplate, applyTemplate,
  channelLabel, fmtRelative, BUILTIN_TEMPLATES,
} = useOutreach()

const { online } = useOnline()

type Tab = 'drafts' | 'templates'
const tab = ref<Tab>('drafts')

const expanded = ref<string | null>(null)
const loading = ref(true)
setTimeout(() => { loading.value = false }, 300)

// Создание черновика
const showCreateForm = ref(false)
const createName = ref('')
const createRole = ref('')
const createHandle = ref('')
const createSkill = ref('')
const createTemplateId = ref(BUILTIN_TEMPLATES[0].id)

// Создание шаблона
const showTemplateForm = ref(false)
const tplName = ref('')
const tplChannel = ref<OutreachChannel>('telegram')
const tplBody = ref('')

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
}

function channelIcon(ch: OutreachChannel): string {
  if (ch === 'telegram') return 'telegram'
  if (ch === 'email') return 'outreach'
  return 'external'
}

function onCreateDraft() {
  if (!createName.value.trim() || !createRole.value.trim()) return
  const draft = createDraft(
    {
      name: createName.value.trim(),
      role: createRole.value.trim(),
      handle: createHandle.value.trim() || undefined,
      skill: createSkill.value.trim() || undefined,
    },
    createTemplateId.value
  )
  showCreateForm.value = false
  createName.value = ''
  createRole.value = ''
  createHandle.value = ''
  createSkill.value = ''
  expanded.value = draft.id
}

function onSendDraft(id: string) {
  const result = sendDraft(id)
  if (result) {
    window.open(result.url, '_blank', 'noopener')
  }
}

function onEditDraft(id: string, body: string) {
  updateDraft(id, body)
}

function onAddTemplate() {
  if (!tplName.value.trim() || !tplBody.value.trim()) return
  addTemplate({
    name: tplName.value.trim(),
    channel: tplChannel.value,
    body: tplBody.value.trim(),
  })
  showTemplateForm.value = false
  tplName.value = ''
  tplBody.value = ''
}

function previewTemplate(body: string): string {
  return applyTemplate(
    { body, channel: 'telegram', id: 'preview', name: '', isBuiltIn: false },
    { name: 'Анна', role: 'Frontend', company: 'Acme', skill: 'Vue 3' }
  ).slice(0, 120)
}
</script>

<template>
  <div class="outreach-view hf-scroll">
    <div class="ov-header">
      <h2 class="ov-title">Аутрич</h2>
      <HfChip tone="primary">{{ activeDrafts.length }} активных</HfChip>
    </div>

    <div class="hf-subtabs" role="tablist">
      <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'drafts' }" role="tab" :aria-selected="tab === 'drafts'" @click="tab = 'drafts'">
        <HfIcon name="outreach" :size="14" /> Черновики
      </button>
      <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'templates' }" role="tab" :aria-selected="tab === 'templates'" @click="tab = 'templates'">
        <HfIcon name="template" :size="14" /> Шаблоны
      </button>
    </div>

    <!-- Offline -->
    <div v-if="!online" class="ov-banner hf-banner-in">
      <HfIcon name="refresh" :size="16" /> Нет соединения — показаны сохранённые черновики
    </div>

    <!-- Черновики -->
    <template v-if="tab === 'drafts'">
      <div class="ov-actions">
        <HfButton variant="ghost" size="sm" @click="showCreateForm = !showCreateForm">
          <HfIcon name="plus" :size="14" /> Создать черновик
        </HfButton>
      </div>

      <!-- Форма создания -->
      <div v-if="showCreateForm" class="ov-create">
        <div class="ov-create-grid">
          <input v-model="createName" type="text" placeholder="Имя кандидата" class="ov-field" />
          <input v-model="createRole" type="text" placeholder="Роль" class="ov-field" />
          <input v-model="createHandle" type="text" placeholder="@username (опц.)" class="ov-field" />
          <input v-model="createSkill" type="text" placeholder="Ключевой навык (опц.)" class="ov-field" />
        </div>
        <select v-model="createTemplateId" class="ov-select">
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <div class="ov-create-actions">
          <HfButton variant="ghost" size="sm" @click="showCreateForm = false">Отмена</HfButton>
          <HfButton size="sm" @click="onCreateDraft" :disabled="!createName.trim() || !createRole.trim()">
            <HfIcon name="check" :size="14" /> Создать
          </HfButton>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="ov-list">
        <div v-for="i in 3" :key="i" class="ov-skel">
          <HfSkeleton :lines="2" />
        </div>
      </div>

      <!-- Список черновиков -->
      <div v-else-if="drafts.length" class="ov-list">
        <HfCard
          v-for="(d, i) in drafts"
          :key="d.id"
          :match="d.match"
          :index="i"
          :title="d.candidateName"
          :subtitle="d.role"
        >
          <template #meta>
            <HfChip tone="mid">{{ d.match }}%</HfChip>
            <HfChip :tone="d.status === 'sent' ? 'ok' : 'mid'" size="xs">
              <HfIcon :name="channelIcon(d.channel)" :size="11" /> {{ channelLabel(d.channel) }}
            </HfChip>
          </template>

          <button class="ov-row" @click="toggle(d.id)">
            <span class="ov-preview">{{ d.preview }}</span>
            <HfIcon name="chevron" :size="16" class="ov-chev" :class="{ 'ov-chev--open': expanded === d.id }" />
          </button>

          <div class="ov-expand" :class="{ 'ov-expand--open': expanded === d.id }">
            <div class="ov-expand-inner">
              <textarea
                class="ov-body-edit"
                :value="d.body"
                @input="onEditDraft(d.id, ($event.target as HTMLTextAreaElement).value)"
                rows="6"
              />
              <div class="ov-expand-foot">
                <span class="ov-updated">{{ fmtRelative(d.updatedAt) }}</span>
                <div class="ov-expand-actions">
                  <button class="ov-act ov-act--remove" @click="removeDraft(d.id)" title="Удалить">
                    <HfIcon name="close" :size="14" />
                  </button>
                  <button class="ov-cta" @click="onSendDraft(d.id)">
                    <HfIcon name="send" :size="12" /> Отправить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </HfCard>
      </div>

      <HfEmpty v-else icon="outreach" title="Нет черновиков"
        subtitle="Создайте черновик из шаблона — сообщение подставится автоматически." />
    </template>

    <!-- Шаблоны -->
    <template v-if="tab === 'templates'">
      <div class="ov-actions">
        <HfButton variant="ghost" size="sm" @click="showTemplateForm = !showTemplateForm">
          <HfIcon name="plus" :size="14" /> Новый шаблон
        </HfButton>
      </div>

      <!-- Форма создания шаблона -->
      <div v-if="showTemplateForm" class="ov-create">
        <input v-model="tplName" type="text" placeholder="Название шаблона" class="ov-field" />
        <select v-model="tplChannel" class="ov-select">
          <option value="telegram">Telegram</option>
          <option value="email">Email</option>
          <option value="linkedin">LinkedIn</option>
        </select>
        <textarea v-model="tplBody" class="ov-body-edit" rows="5" placeholder="Текст шаблона. Переменные: {{name}}, {{role}}, {{company}}, {{skill}}" />
        <div class="ov-create-actions">
          <HfButton variant="ghost" size="sm" @click="showTemplateForm = false">Отмена</HfButton>
          <HfButton size="sm" @click="onAddTemplate" :disabled="!tplName.trim() || !tplBody.trim()">
            <HfIcon name="check" :size="14" /> Сохранить
          </HfButton>
        </div>
      </div>

      <!-- Список шаблонов -->
      <div class="ov-list">
        <div v-for="t in templates" :key="t.id" class="ov-tpl">
          <div class="ov-tpl-head">
            <div class="ov-tpl-info">
              <p class="ov-tpl-name">{{ t.name }}</p>
              <HfChip tone="mid" size="xs">
                <HfIcon :name="channelIcon(t.channel)" :size="11" /> {{ channelLabel(t.channel) }}
              </HfChip>
              <HfChip v-if="t.isBuiltIn" tone="primary" size="xs">Встроенный</HfChip>
            </div>
            <button v-if="!t.isBuiltIn" class="ov-act ov-act--remove" @click="removeTemplate(t.id)" title="Удалить">
              <HfIcon name="close" :size="14" />
            </button>
          </div>
          <p class="ov-tpl-preview">{{ previewTemplate(t.body) }}{{ t.body.length > 120 ? '…' : '' }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'OutreachView' }
</script>

<style scoped>
.outreach-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.ov-header { display: flex; align-items: center; gap: var(--hf-s-3); margin-bottom: var(--hf-s-4); }
.ov-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }

.ov-actions { margin-bottom: var(--hf-s-3); }

.ov-list { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.ov-skel { padding: var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); }

.ov-banner {
  display: flex; align-items: center; gap: var(--hf-s-2);
  padding: var(--hf-s-2) var(--hf-s-3); margin-bottom: var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-info-muted);
  color: var(--hf-info);
  font-size: var(--hf-t-sm);
}

.ov-create {
  display: flex; flex-direction: column; gap: var(--hf-s-2);
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  margin-bottom: var(--hf-s-3);
}
.ov-create-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-2); }
@media (max-width: 420px) { .ov-create-grid { grid-template-columns: 1fr; } }
.ov-field {
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-sm);
  color: var(--hf-fg);
  outline: none;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.ov-field:focus { border-color: var(--hf-primary); }
.ov-select {
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-sm);
  color: var(--hf-fg);
  outline: none;
  cursor: pointer;
}
.ov-create-actions { display: flex; justify-content: flex-end; gap: var(--hf-s-2); }

.ov-row {
  display: flex; align-items: center; gap: var(--hf-s-3);
  width: 100%; text-align: left;
}
.ov-preview { flex: 1; font-size: var(--hf-t-sm); color: var(--hf-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ov-chev { color: var(--hf-fg-subtle); transition: transform var(--hf-dur-fast) var(--hf-ease-out); flex-shrink: 0; }
.ov-chev--open { transform: rotate(90deg); }

.ov-expand {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--hf-dur-base) var(--hf-ease-out);
}
.ov-expand--open { grid-template-rows: 1fr; }
.ov-expand-inner { overflow: hidden; }
.ov-expand--open .ov-expand-inner { overflow: visible; }
.ov-body-edit {
  width: 100%;
  padding: var(--hf-s-2);
  margin-top: var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-sm);
  line-height: var(--hf-lh-relaxed);
  color: var(--hf-fg);
  resize: vertical;
  font-family: var(--hf-font);
  outline: none;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.ov-body-edit:focus { border-color: var(--hf-primary); }
.ov-expand-foot { display: flex; align-items: center; justify-content: space-between; margin-top: var(--hf-s-2); }
.ov-updated { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.ov-expand-actions { display: flex; gap: var(--hf-s-2); }
.ov-act { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--hf-border); background: var(--hf-surface); border-radius: var(--hf-r-sm); color: var(--hf-fg-muted); cursor: pointer; transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.ov-act--remove:hover { border-color: var(--hf-err); color: var(--hf-err); }
.ov-cta { display: flex; align-items: center; gap: var(--hf-s-1); padding: var(--hf-s-1) var(--hf-s-3); border: none; background: var(--hf-primary); color: var(--hf-fg-on-accent); border-radius: var(--hf-r-md); font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); cursor: pointer; transition: background var(--hf-dur-fast) var(--hf-ease-out); }
.ov-cta:hover { background: var(--hf-primary-hover); }

.ov-tpl { border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); padding: var(--hf-s-3); }
.ov-tpl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--hf-s-2); margin-bottom: var(--hf-s-2); }
.ov-tpl-info { display: flex; align-items: center; gap: var(--hf-s-1); flex-wrap: wrap; }
.ov-tpl-name { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.ov-tpl-preview { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-relaxed); }
</style>
