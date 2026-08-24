<script setup lang="ts">
/**
 * Карточка интервью (П6): реальная генерация через серверный ИИ
 * по резюме со страницы. Честные состояния, без моков.
 * Старый демо-прототип — за флагом «Экспериментальное».
 */
import { computed, defineAsyncComponent, ref } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfButton from '../ui/HfButton.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import PrototypeBadge from '../ui/PrototypeBadge.vue'
import { useInterviewCardRun } from '../composables/useInterviewCardRun'
import { useDevPrototypes } from '../composables/useDevPrototypes'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'

// Демо-прототип — только за флагом, лениво (моки вне основного бандла).
const InterviewCardDemoView = defineAsyncComponent(() => import('./InterviewCardDemoView.vue'))

const {
  state, card, meta, errorMsg, savingNote, noteSaved,
  hasText, canSaveToAts, run, reset, saveToAts, copyCard,
} = useInterviewCardRun()
const { devPrototypes } = useDevPrototypes()
const { capturing, phase } = useSidekick()
const { grabPage } = useSidekickActions()

const showDemo = ref(false)
const noSession = computed(() => phase.value === 'no-session')

async function readPageAndRun() {
  await grabPage()
  if (hasText.value) await run()
}
</script>

<template>
  <div class="icr hf-scroll">
    <template v-if="devPrototypes && showDemo">
      <div class="icr-demo-bar">
        <HfButton variant="ghost" size="sm" @click="showDemo = false">
          <HfIcon name="chevron-down" :size="14" /> К реальной карточке
        </HfButton>
      </div>
      <InterviewCardDemoView />
    </template>

    <template v-else>
      <div class="icr-header">
        <h3 class="icr-title">Карточка интервью</h3>
        <HfButton
          v-if="devPrototypes" variant="ghost" size="sm"
          title="Демо-прототип — данные не настоящие" @click="showDemo = true"
        >
          <PrototypeBadge label="Демо" />
        </HfButton>
      </div>

      <HfEmpty
        v-if="noSession" icon="help" title="Нужен вход в Huntfork"
        subtitle="Карточка составляется ИИ-контуром организации на сервере."
      />

      <!-- Idle / error -->
      <div v-else-if="state === 'idle' || state === 'error'" class="icr-start">
        <HfEmpty
          icon="help"
          :title="hasText ? 'Готово к составлению' : 'Считайте страницу с резюме'"
          :subtitle="hasText
            ? 'По тексту резюме ИИ составит вопросы по компетенциям (STAR): что спросить, что слушать в ответе и какие ред-флаги отмечать.'
            : 'Откройте резюме кандидата и считайте страницу — карточка строится по его опыту.'"
        />
        <p v-if="state === 'error' && errorMsg" class="icr-error">{{ errorMsg }}</p>
        <div class="icr-actions icr-actions--center">
          <HfButton v-if="!hasText" variant="primary" :disabled="capturing" @click="readPageAndRun">
            <HfIcon name="sourcing" :size="14" />
            {{ capturing ? 'Читаю страницу…' : 'Считать страницу и составить' }}
          </HfButton>
          <HfButton v-else variant="primary" @click="run">
            <HfIcon name="help" :size="14" /> Составить карточку
          </HfButton>
        </div>
      </div>

      <!-- Running -->
      <div v-else-if="state === 'running'" class="icr-running">
        <p class="icr-running-label">Составляю карточку…</p>
        <div v-for="i in 4" :key="i" class="icr-skel"><HfSkeleton :lines="2" /></div>
      </div>

      <!-- Done -->
      <div v-else-if="state === 'done' && card" class="icr-card">
        <p class="icr-role"><HfIcon name="target" :size="14" /> {{ card.role }}</p>

        <section v-if="card.intro.length" class="icr-block">
          <h4 class="icr-block-title"><HfIcon name="chat" :size="14" /> Вводные вопросы</h4>
          <ul class="icr-list">
            <li v-for="(q, i) in card.intro" :key="i">{{ q }}</li>
          </ul>
        </section>

        <section v-for="(b, bi) in card.blocks" :key="bi" class="icr-block icr-comp">
          <h4 class="icr-comp-title">{{ b.competency }}</h4>
          <p class="icr-rationale">{{ b.rationale }}</p>
          <div v-for="(q, qi) in b.questions" :key="qi" class="icr-q">
            <p class="icr-q-text">{{ qi + 1 }}. {{ q.question }}</p>
            <p class="icr-q-listen"><strong>Слушать:</strong> {{ q.listenFor }}</p>
            <p v-if="q.redFlag" class="icr-q-flag"><strong>Ред-флаг:</strong> {{ q.redFlag }}</p>
          </div>
        </section>

        <section v-if="card.finalChecks.length" class="icr-block">
          <h4 class="icr-block-title"><HfIcon name="list-checks" :size="14" /> Финальные проверки</h4>
          <ul class="icr-list">
            <li v-for="(q, i) in card.finalChecks" :key="i">{{ q }}</li>
          </ul>
        </section>

        <div class="icr-actions">
          <HfButton
            v-if="canSaveToAts" variant="primary" size="sm"
            :disabled="savingNote || noteSaved" @click="saveToAts"
          >
            <HfIcon name="note" :size="14" />
            {{ noteSaved ? 'Сохранено в ATS' : savingNote ? 'Сохраняю…' : 'Сохранить в ATS' }}
          </HfButton>
          <HfButton variant="ghost" size="sm" @click="copyCard">
            <HfIcon name="copy" :size="14" /> Копировать
          </HfButton>
          <HfButton variant="ghost" size="sm" @click="reset">
            <HfIcon name="refresh" :size="14" /> Новая карточка
          </HfButton>
        </div>

        <p v-if="meta" class="icr-meta">
          {{ meta.provider || 'ИИ' }}{{ meta.model ? ` · ${meta.model}` : '' }}{{ meta.totalMs ? ` · ${(meta.totalMs / 1000).toFixed(1).replace('.', ',')} с` : '' }}
          · карточка не сохраняется на сервере
        </p>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'InterviewCardView' }
</script>

<style scoped>
.icr { padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }
.icr-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--hf-s-3); }
.icr-title { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.icr-demo-bar { padding: var(--hf-s-2) var(--hf-s-4) 0; }

.icr-start { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.icr-actions { display: flex; gap: var(--hf-s-2); flex-wrap: wrap; }
.icr-actions--center { justify-content: center; }
.icr-error {
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-md);
  background: var(--hf-err-muted);
  color: var(--hf-err);
  font-size: var(--hf-t-sm);
  text-align: center;
}

.icr-running { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.icr-running-label { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.icr-skel { padding: var(--hf-s-3); background: var(--hf-surface-raised); border-radius: var(--hf-r-md); }

.icr-card { display: flex; flex-direction: column; gap: var(--hf-s-4); }
.icr-role {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg);
}
.icr-block { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.icr-block-title {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold);
  text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted);
}
.icr-list { display: flex; flex-direction: column; gap: var(--hf-s-2); padding-left: 1.1em; margin: 0; font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.5; }

.icr-comp {
  padding: var(--hf-s-3);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
}
.icr-comp-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.icr-rationale { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: 1.5; }
.icr-q { display: flex; flex-direction: column; gap: 3px; padding-top: var(--hf-s-2); }
.icr-q + .icr-q { border-top: 1px solid var(--hf-border); margin-top: var(--hf-s-2); }
.icr-q-text { font-size: var(--hf-t-sm); color: var(--hf-fg); line-height: 1.5; font-weight: var(--hf-fw-medium); }
.icr-q-listen { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); line-height: 1.5; }
.icr-q-flag { font-size: var(--hf-t-xs); color: var(--hf-err); line-height: 1.5; }

.icr-meta { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); text-align: center; }
</style>
