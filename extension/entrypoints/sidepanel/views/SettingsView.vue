<script setup lang="ts">
/**
 * SettingsView — панель настроек.
 *
 * Модальное окно: тема, анимации, ширина панели, Telegram,
 * FAB, управление данными, журнал действий.
 */
import { ref, computed, onMounted } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfButton from '../ui/HfButton.vue'
import HfChip from '../ui/HfChip.vue'
import { useTheme, useReducedMotion } from '../composables/useTheme'
import { usePanelWidth } from '../composables/usePanelWidth'
import { useHistory } from '../composables/useHistory'
import { useFab } from '../composables/useFab'
import { useTelegram } from '../composables/useTelegram'
import { useQueue } from '../composables/useQueue'
import { useToast } from '../composables/useToast'
import { useDevPrototypes } from '../composables/useDevPrototypes'

const emit = defineEmits<{ close: [] }>()

const { theme, toggle: toggleTheme } = useTheme()
const { reducedMotionOverride, setOverride: setReducedMotion } = useReducedMotion()
const { panelWidth, MIN, MAX, setWidth } = usePanelWidth()
const { clearHistory, history } = useHistory()
const { fabEnabled, setEnabled: setFabEnabled } = useFab()
const { connected, botInfo, disconnectBot } = useTelegram()
const { clear: clearQueue } = useQueue()
const { toast } = useToast()
const { devPrototypes, setDevPrototypes } = useDevPrototypes()

type Tab = 'general' | 'telegram' | 'data' | 'log'
const tab = ref<Tab>('general')

const widthPresets = [
  { label: 'Компактная', value: 380 },
  { label: 'Стандарт', value: 420 },
  { label: 'Широкая', value: 560 },
  { label: 'Максимум', value: 680 },
]

const motionOptions = [
  { label: 'Системная', value: null },
  { label: 'Включены', value: false },
  { label: 'Отключены', value: true },
]

function setTheme(t: 'light' | 'dark') {
  if (theme.value !== t) toggleTheme()
}

function setMotion(v: boolean | null) {
  setReducedMotion(v)
}

function setWidthPreset(w: number) {
  setWidth(w)
}

function onClearHistory() {
  clearHistory()
  toast('История очищена', 'success')
}

function onClearQueue() {
  clearQueue()
  toast('Очередь очищена', 'success')
}

async function onResetAll() {
  try {
    await chrome.storage.local.clear()
  } catch {}
  toast('Все данные сброшены. Перезагрузите панель.', 'success')
  setTimeout(() => location.reload(), 1500)
}

function onDisconnectBot() {
  disconnectBot()
  toast('Telegram-бот отключён', 'default')
}

const historyCount = computed(() => history.value.length)
</script>

<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="emit('close')">
      <div class="settings-modal hf-scroll">
        <header class="settings-head">
          <h2 class="settings-title">Настройки</h2>
          <button class="settings-close" @click="emit('close')" aria-label="Закрыть">
            <HfIcon name="close" :size="18" />
          </button>
        </header>

        <div class="settings-tabs">
          <button class="settings-tab" :class="{ 'settings-tab--active': tab === 'general' }" @click="tab = 'general'">
            <HfIcon name="settings" :size="14" /> Общие
          </button>
          <button class="settings-tab" :class="{ 'settings-tab--active': tab === 'telegram' }" @click="tab = 'telegram'">
            <HfIcon name="telegram" :size="14" /> Telegram
          </button>
          <button class="settings-tab" :class="{ 'settings-tab--active': tab === 'data' }" @click="tab = 'data'">
            <HfIcon name="download" :size="14" /> Данные
          </button>
          <button class="settings-tab" :class="{ 'settings-tab--active': tab === 'log' }" @click="tab = 'log'">
            <HfIcon name="history" :size="14" /> Журнал
          </button>
        </div>

        <div class="settings-body">
          <!-- Общие -->
          <div v-if="tab === 'general'" class="settings-section">
            <div class="settings-group">
              <label class="settings-label">Тема оформления</label>
              <div class="settings-options">
                <button
                  v-for="t in [{ l: 'Светлая', v: 'light' }, { l: 'Тёмная', v: 'dark' }] as const"
                  :key="t.v"
                  class="settings-opt"
                  :class="{ 'settings-opt--active': theme === t.v }"
                  @click="setTheme(t.v)"
                >{{ t.l }}</button>
              </div>
            </div>

            <div class="settings-group">
              <label class="settings-label">Анимации</label>
              <div class="settings-options">
                <button
                  v-for="m in motionOptions"
                  :key="String(m.value)"
                  class="settings-opt"
                  :class="{ 'settings-opt--active': reducedMotionOverride === m.value }"
                  @click="setMotion(m.value)"
                >{{ m.label }}</button>
              </div>
            </div>

            <div class="settings-group">
              <label class="settings-label">Ширина панели</label>
              <div class="settings-options">
                <button
                  v-for="w in widthPresets"
                  :key="w.value"
                  class="settings-opt"
                  :class="{ 'settings-opt--active': panelWidth === w.value }"
                  @click="setWidthPreset(w.value)"
                >{{ w.label }} · {{ w.value }}px</button>
              </div>
            </div>

            <div class="settings-group">
              <label class="settings-label">Плавающая кнопка (FAB)</label>
              <div class="settings-toggle-row">
                <span class="settings-toggle-desc">Показывать FAB на LinkedIn, GitHub и других сайтах</span>
                <button
                  class="settings-toggle"
                  :class="{ 'settings-toggle--on': fabEnabled }"
                  @click="setFabEnabled(!fabEnabled)"
                  :aria-pressed="fabEnabled"
                >
                  <span class="settings-toggle-knob" />
                </button>
              </div>
            </div>

            <div class="settings-group">
              <label class="settings-label">Экспериментальное</label>
              <div class="settings-toggle-row">
                <span class="settings-toggle-desc">Показывать демо-прототипы (помечены бейджем «Прототип», данные не настоящие)</span>
                <button
                  class="settings-toggle"
                  :class="{ 'settings-toggle--on': devPrototypes }"
                  @click="setDevPrototypes(!devPrototypes)"
                  :aria-pressed="devPrototypes"
                >
                  <span class="settings-toggle-knob" />
                </button>
              </div>
            </div>
          </div>

          <!-- Telegram -->
          <div v-if="tab === 'telegram'" class="settings-section">
            <div v-if="connected && botInfo" class="settings-tg-connected">
              <div class="settings-tg-bot">
                <HfIcon name="telegram" :size="20" />
                <div>
                  <p class="settings-tg-name">{{ botInfo.firstName }}</p>
                  <p class="settings-tg-handle">@{{ botInfo.username }}</p>
                </div>
              </div>
              <HfButton variant="ghost" size="sm" @click="onDisconnectBot">Отключить</HfButton>
            </div>
            <div v-else class="settings-tg-disconnected">
              <HfIcon name="telegram" :size="24" />
              <p class="settings-tg-hint">Бот не подключён.</p>
              <p class="settings-tg-sub">Подключение доступно в разделе «Telegram» на панели.</p>
            </div>
          </div>

          <!-- Данные -->
          <div v-if="tab === 'data'" class="settings-section">
            <div class="settings-data-row">
              <div>
                <p class="settings-data-label">Очередь профилей</p>
                <p class="settings-data-sub">Очищает список профилей, ожидающих обработки</p>
              </div>
              <HfButton variant="ghost" size="sm" @click="onClearQueue">Очистить</HfButton>
            </div>
            <div class="settings-data-row">
              <div>
                <p class="settings-data-label">История действий ({{ historyCount }})</p>
                <p class="settings-data-sub">Журнал всех действий рекрутера</p>
              </div>
              <HfButton variant="ghost" size="sm" @click="onClearHistory">Очистить</HfButton>
            </div>
            <div class="settings-data-row settings-data-row--danger">
              <div>
                <p class="settings-data-label">Сбросить все данные</p>
                <p class="settings-data-sub">Удаляет все настройки, очередь, историю, шаблоны</p>
              </div>
              <HfButton variant="danger" size="sm" @click="onResetAll">Сбросить всё</HfButton>
            </div>
          </div>

          <!-- Журнал -->
          <div v-if="tab === 'log'" class="settings-section">
            <div v-if="history.length" class="settings-log">
              <div v-for="h in history.slice(0, 50)" :key="h.id" class="settings-log-item">
                <span class="settings-log-time">{{ new Date(h.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
                <span class="settings-log-desc">{{ h.description }}</span>
              </div>
            </div>
            <div v-else class="settings-log-empty">
              <HfIcon name="history" :size="24" />
              <p>Журнал пуст</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts">
export default { name: 'SettingsView' }
</script>

<style scoped>
.settings-overlay {
  position: fixed; inset: 0;
  background: rgba(10, 10, 10, 0.65);
  z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: var(--hf-s-4);
  animation: settings-fade-in 0.15s var(--hf-ease-out);
}
:root.light .settings-overlay { background: rgba(10, 10, 10, 0.4); }

@keyframes settings-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.settings-modal {
  width: 100%; max-width: 460px; max-height: 80vh;
  background: var(--hf-surface);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-xl);
  box-shadow: var(--hf-shadow-lg);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: settings-slide-in 0.2s var(--spring-gentle);
}

@keyframes settings-slide-in {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.settings-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--hf-s-4);
  border-bottom: 1px solid var(--hf-border);
}
.settings-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.settings-close {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px;
  border: none; background: none; cursor: pointer;
  border-radius: var(--hf-r-md);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.settings-close:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }

.settings-tabs {
  display: flex; gap: var(--hf-s-1);
  padding: var(--hf-s-2) var(--hf-s-4);
  border-bottom: 1px solid var(--hf-border);
  overflow-x: auto;
}
.settings-tab {
  display: flex; align-items: center; gap: var(--hf-s-1);
  padding: var(--hf-s-2) var(--hf-s-3);
  border: none; background: none; cursor: pointer;
  border-radius: var(--hf-r-md);
  font-size: var(--hf-t-sm); color: var(--hf-fg-muted);
  white-space: nowrap;
  transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out);
}
.settings-tab:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.settings-tab--active { background: var(--hf-primary-muted); color: var(--hf-primary); font-weight: var(--hf-fw-medium); }

.settings-body { padding: var(--hf-s-4); overflow-y: auto; }

.settings-section { display: flex; flex-direction: column; gap: var(--hf-s-4); }

.settings-group { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.settings-label { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.settings-options { display: flex; flex-wrap: wrap; gap: var(--hf-s-2); }
.settings-opt {
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  background: var(--hf-surface);
  border-radius: var(--hf-r-md);
  font-size: var(--hf-t-sm); color: var(--hf-fg-muted);
  cursor: pointer;
  transition: all var(--hf-dur-fast) var(--hf-ease-out);
}
.settings-opt:hover { border-color: var(--hf-border-strong); color: var(--hf-fg); }
.settings-opt--active { border-color: var(--hf-primary); background: var(--hf-primary-muted); color: var(--hf-primary); font-weight: var(--hf-fw-medium); }

.settings-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-3); }
.settings-toggle-desc { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); flex: 1; }
.settings-toggle {
  position: relative;
  width: 40px; height: 22px;
  border: none; border-radius: var(--hf-r-pill);
  background: var(--hf-border-strong);
  cursor: pointer;
  transition: background var(--hf-dur-base) var(--hf-ease-out);
  flex-shrink: 0;
}
.settings-toggle--on { background: var(--hf-primary); }
.settings-toggle-knob {
  position: absolute; top: 2px; left: 2px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--hf-surface);
  box-shadow: var(--hf-shadow-sm);
  transition: transform var(--hf-dur-base) var(--spring-bouncy);
}
.settings-toggle--on .settings-toggle-knob { transform: translateX(18px); }

.settings-tg-connected { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-3); padding: var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); }
.settings-tg-bot { display: flex; align-items: center; gap: var(--hf-s-3); color: var(--hf-primary); }
.settings-tg-name { font-size: var(--hf-t-md); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.settings-tg-handle { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.settings-tg-disconnected { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-5); text-align: center; color: var(--hf-fg-subtle); }
.settings-tg-hint { font-size: var(--hf-t-md); font-weight: var(--hf-fw-medium); color: var(--hf-fg); }
.settings-tg-sub { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }

.settings-data-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-3); padding: var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); }
.settings-data-row--danger { border-color: var(--hf-err-muted); }
.settings-data-label { font-size: var(--hf-t-md); font-weight: var(--hf-fw-medium); color: var(--hf-fg); }
.settings-data-sub { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); margin-top: 2px; }

.settings-log { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.settings-log-item { display: flex; gap: var(--hf-s-3); padding: var(--hf-s-2); border-radius: var(--hf-r-md); }
.settings-log-item:hover { background: var(--hf-surface-sunken); }
.settings-log-time { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-variant-numeric: tabular-nums; white-space: nowrap; flex-shrink: 0; }
.settings-log-desc { font-size: var(--hf-t-sm); color: var(--hf-fg); }
.settings-log-empty { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-5); color: var(--hf-fg-subtle); }
</style>
