<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import { useSidekick } from '../composables/useSidekick'

const {
  chatInput, chatStreaming, currentSiteLabel, isPdfPage, promptChips,
} = useSidekick()
const emit = defineEmits<{ send: []; slash: [string] }>()

const taEl = ref<HTMLTextAreaElement | null>(null)
const showSlash = ref(false)
const slashQuery = ref('')

const canSend = computed(() => chatInput.value.trim().length > 0 && !chatStreaming.value)

/** Авторост: подстраиваем высоту под контент, 88–200px. */
function autogrow() {
  const el = taEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(200, Math.max(88, el.scrollHeight)) + 'px'
}

watch(chatInput, () => nextTick(autogrow))

function onKeydown(e: KeyboardEvent) {
  // ⌘L / Ctrl+L — фокус уже здесь
  if (e.key === '/' && chatInput.value === '') {
    showSlash.value = true
    slashQuery.value = ''
    e.preventDefault()
    return
  }
  if (showSlash.value) {
    if (e.key === 'Escape') { showSlash.value = false; return }
    if (e.key === 'Enter') {
      const match = filteredChips.value[0]
      if (match) { pickSlash(match) }
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault() }
  }
  if (e.key === 'Enter' && !e.shiftKey && !showSlash.value) {
    e.preventDefault()
    submit()
  }
}

const filteredChips = computed(() => {
  const q = slashQuery.value.toLowerCase()
  return promptChips.value.filter(p => p.label.toLowerCase().includes(q))
})

function onInput() {
  if (showSlash.value) {
    slashQuery.value = chatInput.value.replace(/^\//, '')
  }
}

function pickSlash(p: any) {
  showSlash.value = false
  chatInput.value = ''
  emit('slash', p.mode)
}

function submit() {
  if (!canSend.value) return
  emit('send')
}

const contextLabel = computed(() => isPdfPage.value ? 'PDF' : currentSiteLabel.value)
</script>

<template>
  <div class="composer">
    <!-- Меню слэш-команд -->
    <Transition name="hf-pop">
      <div v-if="showSlash" class="slash-menu hf-popover-in hf-scroll">
        <div class="slash-head">Быстрые команды</div>
        <button
          v-for="p in filteredChips" :key="p.id"
          class="slash-row"
          @click="pickSlash(p)"
        >
          <HfIcon name="sparkle" :size="16" />
          <span>{{ p.label }}</span>
        </button>
        <div v-if="!filteredChips.length" class="slash-empty">Ничего не найдено</div>
      </div>
    </Transition>

    <!-- Чипы контекста -->
    <div class="composer-chips">
      <HfChip tone="primary">
        <HfIcon name="target" :size="12" /> {{ contextLabel }}
      </HfChip>
    </div>

    <div class="composer-row">
     <textarea
       ref="taEl"
       v-model="chatInput"
       class="composer-ta"
       :class="{ 'hf-ring-spin': chatStreaming }"
       rows="1"
       placeholder="Спросите о странице…  / — команды"
       :disabled="chatStreaming"
        aria-label="Поле ввода сообщения"
       @keydown="onKeydown"
       @input="onInput"
     />
     <button
       class="composer-send"
       :class="{ 'composer-send--active': canSend, 'composer-send--stop': chatStreaming }"
       :disabled="!canSend && !chatStreaming"
       :title="chatStreaming ? 'Остановить' : 'Отправить (Enter)'"
        :aria-label="chatStreaming ? 'Остановить генерацию' : 'Отправить сообщение'"
       @click="chatStreaming ? $emit('send') : submit()"
     >
        <HfIcon :name="chatStreaming ? 'stop' : 'send'" :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  position: relative;
  flex-shrink: 0;
  padding: var(--hf-s-3) var(--hf-s-4) var(--hf-s-4);
  background: var(--hf-surface);
  border-top: 1px solid var(--hf-border);
}
.composer-chips { display: flex; gap: var(--hf-s-2); margin-bottom: var(--hf-s-2); min-height: 22px; }
.composer-row { display: flex; align-items: flex-end; gap: var(--hf-s-2); }
.composer-ta {
  flex: 1;
  resize: none;
  min-height: 40px;
  max-height: 200px;
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface-sunken);
  font-size: var(--hf-t-md);
  line-height: var(--hf-lh-normal);
  color: var(--hf-fg);
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out), box-shadow var(--hf-dur-fast) var(--hf-ease-out);
}
.composer-ta:focus {
  outline: none;
  border-color: var(--hf-primary);
  box-shadow: var(--hf-glow);
  background: var(--hf-surface);
}
.composer-ta::placeholder { color: var(--hf-fg-subtle); }

/* Conic-рамка при стриминге: поверхность из polish .hf-ring-spin,
   scoped-override чтобы побороть специфичность [data-v]. */
.composer-ta.hf-ring-spin {
  background:
    linear-gradient(var(--hf-surface-sunken), var(--hf-surface-sunken)) padding-box,
    conic-gradient(from var(--hf-ring-angle), var(--hf-primary) 0%, var(--hf-match-low) 25%, transparent 50%, transparent 75%, var(--hf-primary) 100%) border-box;
  border-color: transparent;
  animation: hf-ring-rotate 3s linear infinite;
}

.composer-send {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px;
  border-radius: var(--hf-r-pill);
  background: var(--hf-surface-sunken);
  color: var(--hf-fg-subtle);
  flex-shrink: 0;
  transition: background var(--hf-dur-fast) var(--hf-ease-out),
              color var(--hf-dur-fast) var(--hf-ease-out),
              transform var(--hf-dur-fast) var(--hf-ease-spring),
              border-radius var(--hf-dur-fast) var(--hf-ease-spring);
}
.composer-send--active {
  background: var(--hf-primary);
  color: var(--hf-fg-on-accent);
}
.composer-send--active:hover { background: var(--hf-primary-hover); transform: scale(1.05); }
.composer-send--stop {
  background: var(--hf-err);
  color: var(--hf-fg-on-accent);
  border-radius: var(--hf-r-md);
}

/* Слэш-меню */
.slash-menu {
  position: absolute;
  bottom: 100%;
  left: var(--hf-s-4);
  right: var(--hf-s-4);
  margin-bottom: var(--hf-s-2);
  background: var(--hf-surface-raised);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  box-shadow: var(--hf-shadow-lg);
  padding: var(--hf-s-2);
  max-height: 260px;
  overflow-y: auto;
  z-index: 10;
}
.slash-head { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); padding: var(--hf-s-1) var(--hf-s-2); text-transform: uppercase; letter-spacing: 0.04em; }
.slash-row {
  display: flex; align-items: center; gap: var(--hf-s-2);
  width: 100%; padding: var(--hf-s-2); border-radius: var(--hf-r-md);
  color: var(--hf-fg); font-size: var(--hf-t-sm);
  transition: background var(--hf-dur-instant) var(--hf-ease-out);
}
.slash-row:hover { background: var(--hf-primary-muted); color: var(--hf-primary); }
.slash-empty { padding: var(--hf-s-3); text-align: center; font-size: var(--hf-t-sm); color: var(--hf-fg-subtle); }

.hf-pop-enter-active, .hf-pop-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out), transform var(--hf-dur-fast) var(--hf-ease-out); }
.hf-pop-enter-from, .hf-pop-leave-to { opacity: 0; transform: scale(0.96) translateY(4px); }
</style>
