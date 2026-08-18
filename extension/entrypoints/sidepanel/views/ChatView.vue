<script setup lang="ts">
/**
 * ChatView — AI-чат первого раздела.
 * Анализирует любую страницу, поддерживает пресеты, рассуждение,
 * выбор вакансии и сохранение переписок.
 */
import { ref, watch, nextTick, computed } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import Composer from '../layout/Composer.vue'
import ConversationDrawer from '../layout/ConversationDrawer.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'
import { useConversations } from '../composables/useConversations'
import { useScrollMemory } from '../composables/usePanelWidth'

const {
  phase, chatMessages, chatStreaming, chatListEl, copiedMsg,
  aiMode, aiText, aiRunning, aiError, aiHtml, copied,
  promptChips, currentSiteLabel, isPdfPage,
  reasoningEnabled, CHAT_PRESETS,
  jobs, selectedJobId,
} = useSidekick()
const {
  sendChat, abortAi, copyAi, copyChatMsg, openChat, mdToHtml, runSummary, runPrompt,
  setReasoning, setJob, runPreset, newConversation,
} = useSidekickActions()

const { save: saveScroll, restore: restoreScroll } = useScrollMemory()
const SCROLL_KEY = 'chat'
const showJump = ref(false)
const SCROLL_THRESHOLD = 40
const drawerOpen = ref(false)
const jobMenuOpen = ref(false)

const isIdle = computed(() => phase.value === 'idle')
const isSummary = computed(() => phase.value === 'summary' && aiMode.value !== 'fit')
const isChat = computed(() => phase.value === 'chat')
const isEmpty = computed(() => isChat.value && chatMessages.value.length === 0)

const selectedJob = computed(() => jobs.value.find(j => j.id === selectedJobId.value))

/** Пресеты: рекрутерские сначала на страницах профилей, универсальные всегда. */
const visiblePresets = computed(() => {
  const isProfilePage = /(linkedin\.com\/in|github\.com\/[^/?#]+\/?$|hh\.ru|habr|t\.me)/i.test(currentSiteLabel.value || '')
  if (isProfilePage) return CHAT_PRESETS
  return CHAT_PRESETS.filter(p => !p.recruiter)
})

function onPreset(preset: typeof CHAT_PRESETS[number]) {
  runPreset(preset)
}

/** Умный автоскролл: липнет к низу, если пользователь уже внизу. */
function onScroll() {
  const el = chatListEl.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
  showJump.value = !atBottom && chatMessages.value.length > 0
}

function jumpToBottom() {
  const el = chatListEl.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

watch(phase, async (p) => {
  if (p === 'chat') {
    await nextTick()
    const el = chatListEl.value
    if (el) restoreScroll(SCROLL_KEY, el)
  }
})

watch(chatMessages, async () => {
  await nextTick()
  const el = chatListEl.value
  if (!el) return
  if (!showJump.value) el.scrollTop = el.scrollHeight
}, { deep: true })

function handleSend() {
  if (chatStreaming.value) abortAi()
  else sendChat()
}

function onSlash(mode: string) {
  runSummary(mode)
}

function onDrawerPick() {
  drawerOpen.value = false
}

function toggleReasoning() {
  setReasoning(!reasoningEnabled.value)
}

function toggleJobMenu() {
  jobMenuOpen.value = !jobMenuOpen.value
}

function pickJob(id: string) {
  setJob(id)
  jobMenuOpen.value = false
}

function onNewChat() {
  newConversation()
}

const contextLabel = computed(() => isPdfPage.value ? 'PDF' : currentSiteLabel.value)
</script>

<template>
  <div class="chat-view">
    <!-- Шапка чата: drawer, вакансия, reasoning -->
    <div class="chat-head">
      <button class="chat-head-btn" title="Переписки" aria-label="Список переписок" @click="drawerOpen = true">
        <HfIcon name="menu" :size="18" />
      </button>

      <div class="chat-head-job">
        <button class="job-trigger" :class="{ 'job-trigger--set': !!selectedJob }" @click="toggleJobMenu">
          <HfIcon name="briefcase" :size="14" />
          <span class="job-trigger-label">{{ selectedJob ? selectedJob.title : 'Вакансия не выбрана' }}</span>
          <HfIcon name="chevron-down" :size="12" />
        </button>
        <Transition name="hf-pop">
          <div v-if="jobMenuOpen" class="job-menu hf-popover-in hf-scroll">
            <div class="job-menu-head">Выбрать вакансию</div>
            <button v-if="!jobs.length" class="job-menu-empty" disabled>Нет активных вакансий</button>
            <button
              v-for="j in jobs"
              :key="j.id"
              class="job-menu-row"
              :class="{ 'job-menu-row--active': j.id === selectedJobId }"
              @click="pickJob(j.id)"
            >
              <span class="job-menu-title">{{ j.title }}</span>
              <span class="job-menu-status">{{ j.status }}</span>
            </button>
            <button v-if="selectedJob" class="job-menu-clear" @click="pickJob('')">
              Сбросить выбор
            </button>
          </div>
        </Transition>
      </div>

      <button
        class="chat-head-btn"
        :class="{ 'chat-head-btn--on': reasoningEnabled }"
        :title="reasoningEnabled ? 'Глубокий анализ включён' : 'Включить глубокий анализ'"
        :aria-label="reasoningEnabled ? 'Выключить рассуждение' : 'Включить рассуждение'"
        @click="toggleReasoning"
      >
        <HfIcon name="brain" :size="18" />
      </button>
    </div>

    <!-- Стартовый экран: фаза idle -->
    <div v-if="isIdle" class="chat-start hf-scroll">
      <div class="chat-start-hero">
        <div class="chat-start-orb"><HfIcon name="logo" :size="22" /></div>
        <h2 class="chat-start-title">Чем помочь?</h2>
        <p class="chat-start-sub">
          Спросите о странице или выберите пресет. Контекст «{{ contextLabel }}» подхватывается автоматически.
        </p>
      </div>

      <div class="actions-grid">
        <button
          v-for="(t, i) in visiblePresets"
          :key="t.id"
          class="action-tile hf-cascade"
          :style="{ '--hf-i': i }"
          @click="onPreset(t)"
        >
          <span class="action-tile-ico"><HfIcon :name="t.icon" :size="18" /></span>
          <span class="action-tile-label">{{ t.label }}</span>
          <span class="action-tile-desc">{{ t.desc }}</span>
        </button>
      </div>
    </div>

    <!-- Summary-фаза (сводка/карточка/вопросы/перевод/fragment) -->
    <div v-else-if="isSummary" class="chat-summary hf-scroll" aria-live="polite">
      <div v-if="aiText" class="md" :class="{ 'md--streaming': aiRunning }" v-html="aiHtml" />
      <span v-if="aiRunning && aiText" class="hf-caret" />
      <div v-if="aiRunning && !aiText" class="chat-loading">
        <HfSkeleton :lines="3" width="50%" />
      </div>
      <div v-if="aiError" class="chat-flash-err hf-shake">{{ aiError }}</div>
      <div v-if="!aiRunning && aiText" class="chat-summary-actions">
        <button class="msg-act" @click="copyAi()">
          <HfIcon :name="copied ? 'check' : 'copy'" :size="14" />
          {{ copied ? 'Скопировано' : 'Копировать' }}
        </button>
        <button class="msg-act" @click="openChat()">
          <HfIcon name="chat" :size="14" /> Задать вопрос
        </button>
      </div>
    </div>

    <!-- Чат: список сообщений -->
    <div v-else ref="chatListEl" class="chat-list hf-scroll" @scroll="onScroll">
      <div v-if="isEmpty" class="chat-empty">
        <HfIcon name="chat" :size="32" />
        <p>Напишите вопрос или выберите пресет</p>
      </div>
      <template v-else>
        <div
          v-for="(m, i) in chatMessages"
          :key="i"
          class="msg"
          :class="m.role === 'user' ? 'msg--user' : 'msg--ai'"
        >
          <div class="msg-avatar">
            <HfIcon :name="m.role === 'user' ? 'logo' : 'sparkle'" :size="14" />
          </div>
          <div class="msg-body">
            <div v-if="m.role === 'user'" class="msg-bubble msg-bubble--user">{{ m.content }}</div>
            <div v-else class="msg-bubble msg-bubble--ai">
              <span v-if="m.content.startsWith('⚠️')" class="chat-err-text">{{ m.content }}</span>
              <div v-else class="md" v-html="mdToHtml(m.content)"></div>
            </div>
            <div v-if="m.role === 'assistant' && m.content && !m.content.startsWith('⚠️')" class="msg-actions">
              <button
                class="msg-act"
                :title="copiedMsg === i ? 'Скопировано' : 'Копировать'"
                :aria-label="copiedMsg === i ? 'Скопировано' : 'Копировать сообщение'"
                @click="copyChatMsg(i)"
              >
                <HfIcon :name="copiedMsg === i ? 'check' : 'copy'" :size="14" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Плавающая кнопка «новые сообщения» -->
    <Transition name="hf-pop">
      <button v-if="showJump" class="jump-btn hf-popover-in" aria-label="К новым сообщениям" @click="jumpToBottom">
        <HfIcon name="arrow-down" :size="16" /> Новые
      </button>
    </Transition>

    <Composer @send="handleSend" @slash="onSlash" />

    <!-- Боковой drawer со списком переписок -->
    <ConversationDrawer :open="drawerOpen" @close="drawerOpen = false" />
  </div>
</template>

<script lang="ts">
export default { name: 'ChatView' }
</script>

<style scoped>
.chat-view { display: flex; flex-direction: column; height: 100%; position: relative; }

/* Шапка чата */
.chat-head {
  display: flex;
  align-items: center;
  gap: var(--hf-s-2);
  padding: var(--hf-s-2) var(--hf-s-3);
  border-bottom: 1px solid var(--hf-border);
  background: var(--hf-surface);
  flex-shrink: 0;
}
.chat-head-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--hf-r-md);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out);
  flex-shrink: 0;
}
.chat-head-btn:hover { background: var(--hf-hover); color: var(--hf-fg); }
.chat-head-btn--on {
  background: var(--hf-primary);
  color: var(--hf-fg-on-accent);
}
.chat-head-btn--on:hover { background: var(--hf-primary-hover); color: var(--hf-fg-on-accent); }

.chat-head-job { flex: 1; min-width: 0; position: relative; }
.job-trigger {
  display: flex;
  align-items: center;
  gap: var(--hf-s-1);
  width: 100%;
  padding: var(--hf-s-1) var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface-sunken);
  cursor: pointer;
  color: var(--hf-fg-muted);
  font-size: var(--hf-t-sm);
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out), background var(--hf-dur-fast) var(--hf-ease-out);
}
.job-trigger:hover { border-color: var(--hf-border-strong); background: var(--hf-surface); }
.job-trigger--set { color: var(--hf-fg); border-color: var(--hf-border-strong); }
.job-trigger-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.job-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  box-shadow: var(--hf-shadow-lg);
  padding: var(--hf-s-1);
  max-height: 280px;
  overflow-y: auto;
  z-index: 20;
}
.job-menu-head { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); padding: var(--hf-s-1) var(--hf-s-2); text-transform: uppercase; letter-spacing: 0.04em; }
.job-menu-empty, .job-menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hf-s-2);
  width: 100%;
  padding: var(--hf-s-2);
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--hf-r-sm);
  color: var(--hf-fg);
  font-size: var(--hf-t-sm);
  text-align: left;
  transition: background var(--hf-dur-instant) var(--hf-ease-out);
}
.job-menu-row:hover { background: var(--hf-hover); }
.job-menu-row--active { background: var(--hf-hover); font-weight: var(--hf-fw-semibold); }
.job-menu-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-menu-status { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); flex-shrink: 0; text-transform: capitalize; }
.job-menu-clear {
  width: 100%;
  padding: var(--hf-s-2);
  border: none;
  border-top: 1px solid var(--hf-border);
  background: none;
  cursor: pointer;
  color: var(--hf-fg-muted);
  font-size: var(--hf-t-sm);
  transition: color var(--hf-dur-fast) var(--hf-ease-out);
}
.job-menu-clear:hover { color: var(--hf-err); }

/* Стартовый экран */
.chat-start { flex: 1; overflow-y: auto; padding: var(--hf-s-6) var(--hf-s-4); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--hf-s-6); }
.chat-start-hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); }
.chat-start-orb {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: var(--hf-r-pill);
  background: var(--hf-primary-muted); color: var(--hf-primary);
}
.chat-start-title { font-size: var(--hf-t-xl); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.chat-start-sub { font-size: var(--hf-t-md); color: var(--hf-fg-muted); max-width: var(--hf-content-max); line-height: var(--hf-lh-normal); }

.actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-3); width: 100%; max-width: var(--hf-content-max); }
.action-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--hf-s-1);
  padding: var(--hf-s-3); border-radius: var(--hf-r-lg);
  border: 1px solid var(--hf-border); background: var(--hf-surface);
  text-align: left;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out),
              transform var(--hf-dur-fast) var(--hf-ease-out),
              background var(--hf-dur-fast) var(--hf-ease-out);
}
.action-tile:hover { border-color: var(--hf-border-strong); background: var(--hf-surface-raised); transform: translateY(-1px); }
.action-tile-ico { display: flex; color: var(--hf-primary); margin-bottom: var(--hf-s-1); }
.action-tile-label { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.action-tile-desc { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }

.chat-summary { flex: 1; overflow-y: auto; padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-3); max-width: var(--hf-content-max); margin-inline: auto; width: 100%; }
.chat-summary-actions { display: flex; gap: var(--hf-s-2); }
.chat-list { flex: 1; overflow-y: auto; padding: var(--hf-s-4); display: flex; flex-direction: column; gap: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; width: 100%; }
.chat-loading { padding: var(--hf-s-4); }
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--hf-s-2);
  color: var(--hf-fg-subtle);
}
.chat-empty p { font-size: var(--hf-t-sm); }

.msg { display: flex; gap: var(--hf-s-3); max-width: 100%; }
.msg--user { flex-direction: row-reverse; }
.msg-avatar {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--hf-r-pill);
  background: var(--hf-surface-sunken); color: var(--hf-fg-muted); flex-shrink: 0;
}
.msg--ai .msg-avatar { background: var(--hf-primary-muted); color: var(--hf-primary); }
.msg-body { display: flex; flex-direction: column; gap: var(--hf-s-1); min-width: 0; max-width: calc(100% - 40px); }
.msg--user .msg-body { align-items: flex-end; }

.msg-bubble {
  padding: var(--hf-s-2) var(--hf-s-3);
  border-radius: var(--hf-r-lg);
  font-size: var(--hf-t-md);
  line-height: var(--hf-lh-relaxed);
  word-wrap: break-word;
}
.msg-bubble--user { background: var(--hf-primary); color: var(--hf-fg-on-accent); border-bottom-right-radius: var(--hf-r-sm); }
.msg-bubble--ai { background: var(--hf-surface-sunken); border-bottom-left-radius: var(--hf-r-sm); }

.msg-actions { display: flex; gap: var(--hf-s-1); }
.msg-act {
  display: flex; align-items: center; gap: var(--hf-s-1);
  padding: var(--hf-s-1) var(--hf-s-2); border-radius: var(--hf-r-sm);
  font-size: var(--hf-t-xs); color: var(--hf-fg-subtle);
  transition: background var(--hf-dur-instant) var(--hf-ease-out), color var(--hf-dur-instant) var(--hf-ease-out);
  cursor: pointer;
  border: none;
  background: none;
}
.msg-act:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }

.chat-flash-err { padding: var(--hf-s-2) var(--hf-s-3); background: var(--hf-err-muted); color: var(--hf-err); border-radius: var(--hf-r-md); font-size: var(--hf-t-sm); }
.chat-err-text { color: var(--hf-err); font-size: var(--hf-t-sm); }

.jump-btn {
  position: absolute; bottom: 110px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: var(--hf-s-1);
  padding: var(--hf-s-1) var(--hf-s-3);
  border-radius: var(--hf-r-pill);
  background: var(--hf-surface-raised);
  box-shadow: var(--hf-shadow-lg);
  color: var(--hf-primary);
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-medium);
  z-index: 5;
}

.hf-pop-enter-active, .hf-pop-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--hf-ease-out); }
.hf-pop-enter-from, .hf-pop-leave-to { opacity: 0; transform: scale(0.96) translateY(4px); }
</style>
