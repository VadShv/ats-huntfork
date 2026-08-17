<script setup lang="ts">
/** VfQuestions — Блок Е. Вопросы к интервью.
 *  Карточки: бейдж методики (STAR/CARE/PARLA), персонализированный текст,
 *  раскрываемый «что слушать», копирование (иконка→галочка+тост),
 *  «добавить в сценарий». Отдельный блок «вопрос-зонд». */
import { ref } from 'vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useToast } from '../../composables/useToast'
import { useVerification } from '../../composables/useVerification'

const { questions, copyQuestion, addToScenario, removeFromScenario, scenarioQuestionIds } = useVerification()
const { toast } = useToast()

const copiedId = ref<string | null>(null)
const expandedId = ref<string | null>(null)

const METHOD_COLOR: Record<string, string> = {
  STAR: 'star', CARE: 'care', PARLA: 'parla',
}

async function onCopy(id: string, text: string) {
  copyQuestion({ id, method: 'STAR', text, listenFor: '', isProbe: false } as any)
  try { await navigator.clipboard?.writeText(text) } catch {}
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, 1400)
  toast('Вопрос скопирован', 'success')
}

function toggleScenario(id: string) {
  if (scenarioQuestionIds.value.includes(id)) {
    removeFromScenario(id)
    toast('Убрано из сценария', 'info')
  } else {
    addToScenario(id)
    toast('Добавлено в сценарий', 'success')
  }
}
</script>

<template>
  <div class="vf-q">
    <div v-if="!questions.length" class="vf-q-empty">
      <HfIcon name="help" :size="14" /> Вопросы сгенерируются по находкам
    </div>

    <!-- Вопрос-зонд отдельно -->
    <div v-if="questions.some(q => q.isProbe)" class="vf-q-probe-group">
      <div class="vf-q-probe-lbl">Вопрос-зонд</div>
      <div v-for="q in questions.filter(x => x.isProbe)" :key="q.id" class="vf-q-card vf-q-card--probe">
        <div class="vf-q-head">
          <span class="vf-q-method" :class="`vf-q-method--${METHOD_COLOR[q.method]}`">{{ q.method }}</span>
          <span class="vf-q-probe-tag"><HfIcon name="target" :size="10" /> зонд</span>
        </div>
        <p class="vf-q-text">{{ q.text }}</p>
        <button class="vf-q-listen" @click="expandedId = expandedId === q.id ? null : q.id">
          <HfIcon name="chevron-down" :size="11" :class="{ 'vf-q-chev--open': expandedId === q.id }" />
          Что слушать в ответе
        </button>
        <Transition name="vf-grid">
          <p v-if="expandedId === q.id" class="vf-q-listen-body">{{ q.listenFor }}</p>
        </Transition>
        <div class="vf-q-actions">
          <button class="vf-q-act" @click="onCopy(q.id, q.text)">
            <HfIcon :name="copiedId === q.id ? 'check' : 'copy'" :size="12" />{{ copiedId === q.id ? 'Скопировано' : 'Копировать' }}
          </button>
          <button class="vf-q-act" :class="{ 'vf-q-act--on': scenarioQuestionIds.includes(q.id) }" @click="toggleScenario(q.id)">
            <HfIcon :name="scenarioQuestionIds.includes(q.id) ? 'check' : 'plus'" :size="12" />
            {{ scenarioQuestionIds.includes(q.id) ? 'В сценарии' : 'В сценарий' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Обычные вопросы -->
    <div class="vf-q-list">
      <div v-for="q in questions.filter(x => !x.isProbe)" :key="q.id" class="vf-q-card">
        <div class="vf-q-head">
          <span class="vf-q-method" :class="`vf-q-method--${METHOD_COLOR[q.method]}`">{{ q.method }}</span>
          <span class="vf-q-method-struct">{{
            q.method === 'STAR' ? 'Situation · Task · Action · Result' :
            q.method === 'CARE' ? 'Context · Action · Role · Evaluation' :
            'Problem · Action · Result · Learned · Applied'
          }}</span>
        </div>
        <p class="vf-q-text">{{ q.text }}</p>
        <button class="vf-q-listen" @click="expandedId = expandedId === q.id ? null : q.id">
          <HfIcon name="chevron-down" :size="11" :class="{ 'vf-q-chev--open': expandedId === q.id }" />
          Что слушать в ответе
        </button>
        <Transition name="vf-grid">
          <p v-if="expandedId === q.id" class="vf-q-listen-body">{{ q.listenFor }}</p>
        </Transition>
        <div class="vf-q-actions">
          <button class="vf-q-act" @click="onCopy(q.id, q.text)">
            <HfIcon :name="copiedId === q.id ? 'check' : 'copy'" :size="12" />{{ copiedId === q.id ? 'Скопировано' : 'Копировать' }}
          </button>
          <button class="vf-q-act" :class="{ 'vf-q-act--on': scenarioQuestionIds.includes(q.id) }" @click="toggleScenario(q.id)">
            <HfIcon :name="scenarioQuestionIds.includes(q.id) ? 'check' : 'plus'" :size="12" />
            {{ scenarioQuestionIds.includes(q.id) ? 'В сценарии' : 'В сценарий' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vf-q { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.vf-q-empty { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-3); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }

.vf-q-probe-group { display: flex; flex-direction: column; gap: var(--hf-s-1); margin-bottom: var(--hf-s-1); padding-bottom: var(--hf-s-2); border-bottom: 1px dashed var(--hf-border); }
.vf-q-probe-lbl { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-match-mid); }

.vf-q-list { display: flex; flex-direction: column; gap: var(--hf-s-1); }

.vf-q-card { border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface); padding: var(--hf-s-3); }
.vf-q-card--probe { border-color: var(--hf-match-mid); background: var(--hf-match-mid-muted); }

.vf-q-head { display: flex; align-items: center; gap: var(--hf-s-2); margin-bottom: var(--hf-s-1); }
.vf-q-method { font-size: 10px; font-weight: var(--hf-fw-bold); padding: 2px 7px; border-radius: var(--hf-r-sm); letter-spacing: 0.03em; }
.vf-q-method--star { background: var(--hf-primary-muted); color: var(--hf-primary); }
.vf-q-method--care { background: var(--hf-info-muted); color: var(--hf-info); }
.vf-q-method--parla { background: var(--hf-match-high-muted); color: var(--hf-match-high); }
.vf-q-method-struct { font-size: 9px; color: var(--hf-fg-subtle); }
.vf-q-probe-tag { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; font-size: 9px; padding: 1px 6px; border-radius: var(--hf-r-pill); background: var(--hf-match-mid-muted); color: var(--hf-match-mid); }

.vf-q-text { margin: 0 0 var(--hf-s-2); font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: var(--hf-lh-normal); }

.vf-q-listen { display: flex; align-items: center; gap: 4px; padding: 0; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); background: none; }
.vf-q-chev--open { transform: rotate(180deg); }
.vf-q-listen-body { margin: var(--hf-s-1) 0 0; padding: var(--hf-s-2); border-radius: var(--hf-r-sm); background: var(--hf-surface-sunken); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }

.vf-q-actions { display: flex; gap: var(--hf-s-1); margin-top: var(--hf-s-2); }
.vf-q-act { display: inline-flex; align-items: center; gap: 4px; padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--spring-bouncy); }
.vf-q-act:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.vf-q-act:active { transform: scale(0.96); }
.vf-q-act--on { background: var(--hf-match-high-muted); color: var(--hf-match-high); }

.vf-grid-enter-active, .vf-grid-leave-active { transition: opacity var(--hf-dur-base) var(--hf-ease-out); overflow: hidden; }
.vf-grid-enter-from, .vf-grid-leave-to { opacity: 0; }
</style>
