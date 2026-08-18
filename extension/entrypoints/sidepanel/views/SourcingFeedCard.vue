<script setup lang="ts">
/**
 * SourcingFeedCard — карточка кандидата сорсинга в ленте.
 *
 * Показывает анонимизированный snapshot: заголовок, опыт, навыки, зарплатные
 * ожидания, existingCandidate-бейдж. Действия: одобрить / отклонить / в воронку.
 */
import { computed, ref } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfIcon from '../ui/HfIcon.vue'
import type { SourcingCandidate } from '../composables/useSourcingFeed'

const props = defineProps<{
  candidate: SourcingCandidate
  actionState?: { action: string, state: string, msg: string }
}>()

const emit = defineEmits<{
  approve: [id: string]
  reject: [id: string]
  import: [id: string]
  saveNote: [id: string, note: string]
  (e: 'enrich', id: string): void
}>()

const expanded = ref(false)
const noteOpen = ref(false)
const noteDraft = ref(props.candidate.reviewNote ?? '')

const snap = computed(() => props.candidate.snapshot)
const initials = computed(() => {
  const t = snap.value?.title ?? ''
  return t.slice(0, 2).toUpperCase() || '??'
})
const stateLabel = computed(() => {
  const map: Record<string, string> = {
    new: 'Новый',
    reviewed: 'Просмотрен',
    approved: 'Одобрен',
    rejected: 'Отклонён',
    imported: 'В воронке',
    contacted: 'Контакт',
  }
  return map[props.candidate.state] ?? props.candidate.state
})
const stateTone = computed(() => {
  const map: Record<string, string> = {
    new: 'primary',
    approved: 'high',
    rejected: 'low',
    imported: 'mid',
    reviewed: 'mid',
    contacted: 'mid',
  }
  return map[props.candidate.state] ?? 'default'
})
const salaryText = computed(() => {
  const a = snap.value?.salaryAmount
  if (!a) return ''
  const cur = snap.value?.salaryCurrency === 'RUR' ? '₽' : (snap.value?.salaryCurrency ?? '')
  return `${a.toLocaleString('ru-RU')} ${cur}`
})
const expText = computed(() => {
  const y = snap.value?.experienceYears
  if (y == null) return ''
  const yr = Math.floor(y)
  const mo = Math.round((y - yr) * 12)
  if (yr && mo) return `${yr} г ${mo} мес`
  if (yr) return `${yr} ${yr === 1 ? 'год' : 'лет'}`
  return mo ? `${mo} мес` : ''
})
const topSkills = computed(() => (snap.value?.skills ?? []).slice(0, 6))
const moreSkills = computed(() => Math.max(0, (snap.value?.skills ?? []).length - 6))
const experienceList = computed(() => snap.value?.experience ?? [])
const isImported = computed(() => props.candidate.state === 'imported')
const isRejected = computed(() => props.candidate.state === 'rejected')
const isApproved = computed(() => props.candidate.state === 'approved')
const existing = computed(() => props.candidate.existingCandidate)
const busy = computed(() => props.actionState?.state === 'pending')

function toggleExpand() {
  expanded.value = !expanded.value
  // Ленивое дообогащение: в поисковой выдаче hh нет обязанностей — тянем из полного резюме
  if (expanded.value && !snap.value?.enrichedAt && !experienceList.value.some(e => e.description))
    emit('enrich', props.candidate.id)
}
function toggleNote() {
  noteDraft.value = props.candidate.reviewNote ?? ''
  noteOpen.value = !noteOpen.value
}
function saveNote() {
  emit('saveNote', props.candidate.id, noteDraft.value)
  noteOpen.value = false
}
</script>

<template>
  <article class="sf-card" :class="{ 'sf-card--imported': isImported, 'sf-card--rejected': isRejected }">
    <header class="sf-head">
      <div class="sf-avatar">{{ initials }}</div>
      <div class="sf-head-info">
        <div class="sf-title">{{ snap?.title || 'Без должности' }}</div>
        <div class="sf-sub">
          <span v-if="snap?.lastPosition">{{ snap.lastPosition }}</span>
          <span v-if="snap?.lastCompany"> · {{ snap.lastCompany }}</span>
          <span v-if="snap?.areaName"> · {{ snap.areaName }}</span>
        </div>
      </div>
      <span class="sf-state" :data-tone="stateTone">{{ stateLabel }}</span>
    </header>

    <!-- existing candidate banner -->
    <div v-if="existing" class="sf-existing">
      <HfIcon name="check" :size="14" />
      <span>Уже в базе: <strong>{{ existing.lastName }} {{ existing.firstName }}</strong></span>
      <span v-if="existing.applicationCount" class="sf-existing-count">{{ existing.applicationCount }} {{ existing.applicationCount === 1 ? 'заявка' : 'заявок' }}</span>
    </div>

    <!-- meta row -->
    <div class="sf-meta">
      <span v-if="expText" class="sf-meta-item">
        <HfIcon name="gauge" :size="13" /> {{ expText }}
      </span>
      <span v-if="salaryText" class="sf-meta-item">
        <HfIcon name="target" :size="13" /> {{ salaryText }}
      </span>
      <span v-if="snap?.age" class="sf-meta-item">
        {{ snap.age }} лет
      </span>
    </div>

    <!-- skills -->
    <div v-if="topSkills.length" class="sf-skills">
      <span v-for="s in topSkills" :key="s" class="sf-skill">{{ s }}</span>
      <span v-if="moreSkills" class="sf-skill sf-skill--more">+{{ moreSkills }}</span>
    </div>

    <!-- expandable experience -->
    <button v-if="experienceList.length" class="sf-expand-btn" @click="toggleExpand">
      <HfIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="13" />
      {{ experienceList.length }} {{ experienceList.length === 1 ? 'место работы' : 'мест работы' }}
    </button>
    <div v-if="expanded && experienceList.length" class="sf-exp">
      <div v-for="(e, i) in experienceList" :key="i" class="sf-exp-item">
        <span class="sf-exp-dot" />
        <div>
          <div class="sf-exp-pos">{{ e.position || '—' }}</div>
          <div class="sf-exp-co">{{ e.company }}<span v-if="e.durationMonths"> · {{ e.durationMonths }} мес</span></div>
          <div v-if="e.description" class="sf-exp-desc">{{ e.description }}</div>
        </div>
      </div>
    </div>

    <!-- note -->
    <div v-if="candidate.reviewNote && !noteOpen" class="sf-note-preview" @click="toggleNote">
      <HfIcon name="note" :size="13" /> {{ candidate.reviewNote }}
    </div>
    <div v-if="noteOpen" class="sf-note-edit">
      <textarea v-model="noteDraft" class="sf-note-input" rows="2" placeholder="Заметка по кандидату…" />
      <div class="sf-note-actions">
        <HfButton variant="ghost" size="sm" @click="noteOpen = false">Отмена</HfButton>
        <HfButton variant="primary" size="sm" :disabled="busy" @click="saveNote">Сохранить</HfButton>
      </div>
    </div>

    <!-- actions -->
    <footer class="sf-actions" v-if="!isImported">
      <HfButton variant="ghost" size="sm" :disabled="busy" @click="toggleNote">
        <HfIcon name="note" :size="13" /> Заметка
      </HfButton>
      <HfButton v-if="!isRejected" variant="ghost" size="sm" :disabled="busy"
        :class="{ 'sf-btn-active--reject': isRejected }" @click="emit('reject', candidate.id)">
        <HfIcon name="ban" :size="13" /> Отклонить
      </HfButton>
      <HfButton v-if="!isApproved && !isRejected" variant="subtle" size="sm" :disabled="busy"
        @click="emit('approve', candidate.id)">
        <HfIcon name="check" :size="13" /> Одобрить
      </HfButton>
      <HfButton v-if="!isRejected" variant="primary" size="sm" :disabled="busy"
        @click="emit('import', candidate.id)">
        <HfIcon name="import" :size="13" /> В воронку
      </HfButton>
    </footer>
    <footer v-else class="sf-actions sf-actions--done">
      <HfIcon name="check" :size="14" />
      <span>Импортирован в воронку</span>
    </footer>

    <div v-if="actionState?.state === 'err'" class="sf-err">{{ actionState.msg }}</div>
  </article>
</template>

<script lang="ts">
export default { name: 'SourcingFeedCard' }
</script>

<style scoped>
.sf-card { background: var(--hf-surface); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-3); transition: border-color var(--hf-dur-fast) var(--hf-ease-out), box-shadow var(--hf-dur-fast) var(--hf-ease-out); }
.sf-card:hover { border-color: var(--hf-border-strong); }
.sf-card--imported { border-color: var(--hf-match-mid); background: var(--hf-match-mid-muted); }
.sf-card--rejected { opacity: 0.65; }

.sf-head { display: flex; align-items: flex-start; gap: var(--hf-s-3); }
.sf-avatar { width: 36px; height: 36px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); display: flex; align-items: center; justify-content: center; font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); flex-shrink: 0; }
.sf-head-info { flex: 1; min-width: 0; }
.sf-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); line-height: var(--hf-lh-tight); overflow: hidden; text-overflow: ellipsis; }
.sf-sub { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sf-state { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); padding: 2px 8px; border-radius: var(--hf-r-pill); flex-shrink: 0; background: var(--hf-surface-sunken); color: var(--hf-fg-muted); }
.sf-state[data-tone="primary"] { background: var(--hf-primary-muted, var(--hf-surface-sunken)); color: var(--hf-primary); }
.sf-state[data-tone="high"] { background: var(--hf-match-high-muted); color: var(--hf-match-high); }
.sf-state[data-tone="mid"] { background: var(--hf-match-mid-muted); color: var(--hf-match-mid); }
.sf-state[data-tone="low"] { background: var(--hf-match-low-muted); color: var(--hf-match-low); }

.sf-existing { display: flex; align-items: center; gap: var(--hf-s-1); font-size: var(--hf-t-xs); color: var(--hf-match-mid); padding: var(--hf-s-1) var(--hf-s-2); background: var(--hf-match-mid-muted); border-radius: var(--hf-r-sm); }
.sf-existing-count { margin-left: auto; font-weight: var(--hf-fw-semibold); }

.sf-meta { display: flex; flex-wrap: wrap; gap: var(--hf-s-2) var(--hf-s-3); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.sf-meta-item { display: inline-flex; align-items: center; gap: 3px; }

.sf-skills { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.sf-skill { font-size: var(--hf-t-xs); padding: 1px 7px; border-radius: var(--hf-r-pill); background: var(--hf-surface-sunken); color: var(--hf-fg-muted); line-height: 18px; }
.sf-skill--more { color: var(--hf-fg-subtle); }

.sf-expand-btn { display: inline-flex; align-items: center; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); background: none; border: none; padding: 0; cursor: pointer; align-self: flex-start; }
.sf-expand-btn:hover { color: var(--hf-fg); }

.sf-exp { display: flex; flex-direction: column; gap: var(--hf-s-2); padding-left: 4px; }
.sf-exp-item { display: flex; gap: var(--hf-s-2); }
.sf-exp-desc { margin-top: 2px; font-size: 11px; line-height: 1.45; color: var(--hf-text-3, var(--hf-text-2)); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.sf-exp-dot { width: 6px; height: 6px; border-radius: var(--hf-r-pill); background: var(--hf-primary); margin-top: 6px; flex-shrink: 0; }
.sf-exp-pos { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-medium); }
.sf-exp-co { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.sf-note-preview { display: flex; align-items: center; gap: 4px; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); padding: var(--hf-s-1) var(--hf-s-2); background: var(--hf-surface-sunken); border-radius: var(--hf-r-sm); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-note-edit { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.sf-note-input { width: 100%; font-family: var(--hf-font); font-size: var(--hf-t-sm); padding: var(--hf-s-2); border: 1px solid var(--hf-border-strong); border-radius: var(--hf-r-sm); background: var(--hf-surface); color: var(--hf-fg); resize: vertical; }
.sf-note-input:focus { outline: none; border-color: var(--hf-primary); }
.sf-note-actions { display: flex; justify-content: flex-end; gap: var(--hf-s-2); }

.sf-actions { display: flex; flex-wrap: wrap; gap: var(--hf-s-2); align-items: center; padding-top: var(--hf-s-2); border-top: 1px solid var(--hf-border); }
.sf-actions--done { color: var(--hf-match-mid); font-size: var(--hf-t-xs); border-top-color: var(--hf-match-mid); }
.sf-btn-active--reject { color: var(--hf-match-low); }

.sf-err { font-size: var(--hf-t-xs); color: var(--hf-err); padding: var(--hf-s-1) var(--hf-s-2); background: var(--hf-err-muted); border-radius: var(--hf-r-sm); }
</style>
