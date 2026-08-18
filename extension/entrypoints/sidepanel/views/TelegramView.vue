<script setup lang="ts">
/**
 * TelegramView — модуль Telegram-интеграции.
 *
 * Три подраздела:
 *  • Каналы — список отслеживаемых каналов, добавление
 *  • Лента — парсенные сообщения с подсветкой контактов
 *  • Аутрич — поиск по @username, шаблон первого сообщения
 */
import { ref, computed, watch } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfButton from '../ui/HfButton.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useTelegram, type MessageType } from '../composables/useTelegram'
import { useQueue } from '../composables/useQueue'
import { useToast } from '../composables/useToast'

const {
  botInfo, connected, connecting, channels, messages, polling,
  hasContacts, messagesByType,
  connectBot, addChannel, removeChannel,
  startPolling, stopPolling,
  sendTelegram, exportContactsCsv, clearMessages,
  typeLabel,
} = useTelegram()

const { add: addToQueue } = useQueue()
const { toast } = useToast()

type Tab = 'channels' | 'feed' | 'outreach'
const tab = ref<Tab>('channels')

// Подключение бота
const tokenInput = ref('')
const showTokenInput = ref(!connected.value)

// Добавление канала
const channelInput = ref('')

// Аутрич
const handleInput = ref('')
const outreachBody = ref('Здравствуйте! У нас есть интересная вакансия. Подскажите, открыт(а) ли к разговору?')

const feedFilter = ref<MessageType | 'all'>('all')

const filteredMessages = computed(() => {
  if (feedFilter.value === 'all') return messages.value
  return messages.value.filter((m) => m.type === feedFilter.value)
})

watch(connected, (c) => {
  showTokenInput.value = !c
  if (c) {
    startPolling()
  } else {
    stopPolling()
  }
}, { immediate: true })

async function onConnect() {
  if (!tokenInput.value.trim()) return
  const ok = await connectBot(tokenInput.value.trim())
  if (ok) {
    tokenInput.value = ''
  }
}

function onAddChannel() {
  if (!channelInput.value.trim()) return
  addChannel(channelInput.value.trim())
  channelInput.value = ''
}

function onSendTelegram() {
  if (!handleInput.value.trim()) return
  const url = sendTelegram(handleInput.value.trim(), outreachBody.value)
  window.open(url, '_blank', 'noopener')
  toast('Открываю Telegram…', 'success')
}

function onExportCsv() {
  const csv = exportContactsCsv()
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tg-contacts-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast('Контакты экспортированы', 'success')
}

function onAddToQueue(url: string, source: string) {
  addToQueue({ url, source: `TG: ${source}` })
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  return `${Math.floor(hr / 24)} д назад`
}

const filterTabs = [
  { id: 'all' as const, label: 'Все' },
  { id: 'vacancy' as const, label: 'Вакансии' },
  { id: 'resume' as const, label: 'Резюме' },
  { id: 'contact' as const, label: 'Контакты' },
]
</script>

<template>
  <div class="tg-view hf-scroll">
    <!-- Подразделы -->
    <div class="hf-subtabs" role="tablist">
      <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'channels' }" role="tab" :aria-selected="tab === 'channels'" @click="tab = 'channels'">
        <HfIcon name="channel" :size="14" /> Каналы
      </button>
      <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'feed' }" role="tab" :aria-selected="tab === 'feed'" @click="tab = 'feed'">
        <HfIcon name="chat" :size="14" /> Лента
        <HfChip v-if="messages.length" tone="primary" :size="'xs'">{{ messages.length }}</HfChip>
      </button>
      <button class="hf-subtab" :class="{ 'hf-subtab--active': tab === 'outreach' }" role="tab" :aria-selected="tab === 'outreach'" @click="tab = 'outreach'">
        <HfIcon name="send" :size="14" /> Аутрич
      </button>
    </div>

    <!-- Не подключён -->
    <div v-if="!connected && tab !== 'outreach'" class="tg-connect">
      <div class="tg-connect-card">
        <div class="tg-connect-icon"><HfIcon name="telegram" :size="32" /></div>
        <h3 class="tg-connect-title">Подключите Telegram-бота</h3>
        <p class="tg-connect-desc">
          Создайте бота через <span class="tg-mono">@BotFather</span>, получите токен
          и вставьте его ниже. Бот будет читать каналы и искать контакты.
        </p>
        <div class="tg-token-input">
          <input
            v-model="tokenInput"
            type="password"
            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            class="tg-input"
            @keydown.enter="onConnect"
          />
          <HfButton :loading="connecting" @click="onConnect">Подключить</HfButton>
        </div>
      </div>
    </div>

    <!-- Каналы -->
    <template v-else-if="tab === 'channels'">
      <div class="tg-section">
        <div class="tg-add-channel">
          <input
            v-model="channelInput"
            type="text"
            placeholder="@username канала"
            class="tg-input"
            @keydown.enter="onAddChannel"
          />
          <HfButton size="sm" @click="onAddChannel">
            <HfIcon name="plus" :size="14" /> Добавить
          </HfButton>
        </div>

        <div v-if="channels.length" class="tg-channels">
          <div v-for="ch in channels" :key="ch.id" class="tg-channel">
            <div class="tg-channel-info">
              <span class="tg-channel-icon"><HfIcon name="channel" :size="16" /></span>
              <div>
                <p class="tg-channel-title">{{ ch.title }}</p>
                <p class="tg-channel-handle">@{{ ch.username }}</p>
              </div>
            </div>
            <div class="tg-channel-meta">
              <span v-if="ch.memberCount" class="tg-channel-count">{{ ch.memberCount }} подп.</span>
              <button class="tg-channel-remove" @click="removeChannel(ch.id)" aria-label="Удалить">
                <HfIcon name="close" :size="14" />
              </button>
            </div>
          </div>
        </div>
        <HfEmpty v-else icon="channel" title="Нет каналов"
          subtitle="Добавьте @username канала, чтобы начать парсинг." />

        <!-- Статус бота -->
        <div class="tg-bot-status">
          <span class="tg-bot-pulse" :class="{ 'tg-bot-pulse--on': polling }" />
          <span class="tg-bot-text">
            {{ botInfo ? `@${botInfo.username}` : 'Бот' }} ·
            {{ polling ? 'опрос активен' : 'опрос остановлен' }}
          </span>
          <button class="tg-bot-toggle" @click="polling ? stopPolling() : startPolling()">
            {{ polling ? 'Стоп' : 'Старт' }}
          </button>
        </div>
      </div>
    </template>

    <!-- Лента -->
    <template v-else-if="tab === 'feed'">
      <div class="tg-feed-controls">
        <div class="tg-feed-filters">
          <button
            v-for="f in filterTabs"
            :key="f.id"
            class="tg-filter"
            :class="{ 'tg-filter--active': feedFilter === f.id }"
            @click="feedFilter = f.id"
          >{{ f.label }}</button>
        </div>
        <div class="tg-feed-actions">
          <button v-if="hasContacts" class="tg-feed-act" @click="onExportCsv" title="Экспорт CSV">
            <HfIcon name="download" :size="14" />
          </button>
          <button v-if="messages.length" class="tg-feed-act" @click="clearMessages" title="Очистить">
            <HfIcon name="close" :size="14" />
          </button>
        </div>
      </div>

      <div v-if="filteredMessages.length" class="tg-feed">
        <article v-for="msg in filteredMessages" :key="msg.id" class="tg-msg">
          <header class="tg-msg-head">
            <HfChip :tone="msg.type === 'vacancy' ? 'primary' : msg.type === 'resume' ? 'ok' : msg.type === 'contact' ? 'warn' : 'mid'">
              {{ typeLabel(msg.type) }}
            </HfChip>
            <span class="tg-msg-channel">{{ msg.channelTitle }}</span>
            <span class="tg-msg-time">{{ fmtTime(msg.timestamp) }}</span>
          </header>
          <p class="tg-msg-text">{{ msg.text.slice(0, 400) }}{{ msg.text.length > 400 ? '…' : '' }}</p>

          <div v-if="msg.contacts.telegrams.length || msg.contacts.emails.length || msg.contacts.phones.length || msg.contacts.links.length" class="tg-msg-contacts">
            <HfChip v-for="t in msg.contacts.telegrams" :key="t" tone="primary" size="xs">
              <HfIcon name="telegram" :size="11" /> {{ t }}
            </HfChip>
            <HfChip v-for="e in msg.contacts.emails" :key="e" tone="info" size="xs">{{ e }}</HfChip>
            <HfChip v-for="p in msg.contacts.phones" :key="p" tone="mid" size="xs">{{ p }}</HfChip>
          </div>

          <footer v-if="msg.contacts.links.length" class="tg-msg-foot">
            <button
              v-for="l in msg.contacts.links.slice(0, 3)"
              :key="l"
              class="tg-msg-link"
              @click="onAddToQueue(l, msg.channelTitle)"
            >
              <HfIcon name="plus" :size="11" /> В очередь
            </button>
          </footer>
        </article>
      </div>
      <HfEmpty v-else icon="chat" title="Лента пуста"
        subtitle="Сообщения из отслеживаемых каналов появятся здесь." />
    </template>

    <!-- Аутрич -->
    <template v-else-if="tab === 'outreach'">
      <div class="tg-outreach">
        <h3 class="tg-out-title">Аутрич через Telegram</h3>
        <p class="tg-out-desc">Введите @username кандидата — откроется чат с готовым сообщением.</p>

        <div class="tg-out-form">
          <input
            v-model="handleInput"
            type="text"
            placeholder="@username"
            class="tg-input"
            @keydown.enter="onSendTelegram"
          />
          <textarea
            v-model="outreachBody"
            class="tg-textarea"
            rows="4"
            placeholder="Текст сообщения…"
          />
          <HfButton @click="onSendTelegram" :disabled="!handleInput.trim()">
            <HfIcon name="send" :size="14" /> Открыть в Telegram
          </HfButton>
        </div>

        <div v-if="messages.length" class="tg-out-contacts">
          <h4 class="tg-out-subtitle">Контакты из ленты</h4>
          <div class="tg-out-list">
            <button
              v-for="msg in messages.filter(m => m.contacts.telegrams.length).slice(0, 10)"
              :key="msg.id"
              class="tg-out-contact"
              @click="handleInput = msg.contacts.telegrams[0]"
            >
              <HfIcon name="telegram" :size="12" />
              {{ msg.contacts.telegrams[0] }}
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'TelegramView' }
</script>

<style scoped>
.tg-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }

.tg-connect { display: flex; justify-content: center; padding: var(--hf-s-5) var(--hf-s-4); }
.tg-connect-card { max-width: 360px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-3); }
.tg-connect-icon { color: var(--hf-primary); }
.tg-connect-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.tg-connect-desc { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); line-height: var(--hf-lh-relaxed); }
.tg-mono { font-family: var(--hf-mono); font-size: var(--hf-t-sm); color: var(--hf-primary); }

.tg-token-input { display: flex; gap: var(--hf-s-2); width: 100%; margin-top: var(--hf-s-2); }
.tg-input {
  flex: 1;
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-sm);
  font-family: var(--hf-mono);
  color: var(--hf-fg);
  outline: none;
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.tg-input:focus { border-color: var(--hf-primary); }
.tg-textarea {
  width: 100%;
  padding: var(--hf-s-2) var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  font-size: var(--hf-t-sm);
  color: var(--hf-fg);
  outline: none;
  resize: vertical;
  font-family: var(--hf-font);
  transition: border-color var(--hf-dur-fast) var(--hf-ease-out);
}
.tg-textarea:focus { border-color: var(--hf-primary); }

.tg-section { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.tg-add-channel { display: flex; gap: var(--hf-s-2); }

.tg-channels { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.tg-channel {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--hf-s-3);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
}
.tg-channel-info { display: flex; align-items: center; gap: var(--hf-s-2); }
.tg-channel-icon { color: var(--hf-primary); display: flex; }
.tg-channel-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg); }
.tg-channel-handle { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); font-family: var(--hf-mono); }
.tg-channel-meta { display: flex; align-items: center; gap: var(--hf-s-2); }
.tg-channel-count { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.tg-channel-remove { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; background: none; cursor: pointer; border-radius: var(--hf-r-sm); color: var(--hf-fg-subtle); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.tg-channel-remove:hover { background: var(--hf-err-muted); color: var(--hf-err); }

.tg-bot-status { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-2) var(--hf-s-3); border: 1px solid var(--hf-border); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.tg-bot-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--hf-fg-subtle); transition: background var(--hf-dur-base) var(--hf-ease-out); }
.tg-bot-pulse--on { background: var(--hf-ok); animation: tg-pulse 2s var(--hf-ease-in-out) infinite; }
@keyframes tg-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.tg-bot-text { flex: 1; font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.tg-bot-toggle { border: none; background: none; cursor: pointer; font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); color: var(--hf-primary); padding: var(--hf-s-1) var(--hf-s-2); }

.tg-feed-controls { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-2); margin-bottom: var(--hf-s-3); }
.tg-feed-filters { display: flex; gap: var(--hf-s-1); }
.tg-filter { padding: var(--hf-s-1) var(--hf-s-2); border: 1px solid var(--hf-border); background: var(--hf-surface); border-radius: var(--hf-r-pill); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); cursor: pointer; transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.tg-filter:hover { border-color: var(--hf-border-strong); color: var(--hf-fg); }
.tg-filter--active { background: var(--hf-primary-muted); border-color: var(--hf-primary); color: var(--hf-primary); }
.tg-feed-actions { display: flex; gap: var(--hf-s-1); }
.tg-feed-act { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--hf-border); background: var(--hf-surface); border-radius: var(--hf-r-sm); color: var(--hf-fg-muted); cursor: pointer; transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.tg-feed-act:hover { border-color: var(--hf-border-strong); color: var(--hf-fg); }

.tg-feed { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.tg-msg { border: 1px solid var(--hf-border); border-radius: var(--hf-r-lg); background: var(--hf-surface); padding: var(--hf-s-3); }
.tg-msg-head { display: flex; align-items: center; gap: var(--hf-s-2); margin-bottom: var(--hf-s-2); }
.tg-msg-channel { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); flex: 1; }
.tg-msg-time { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.tg-msg-text { font-size: var(--hf-t-sm); line-height: var(--hf-lh-relaxed); color: var(--hf-fg); white-space: pre-wrap; text-wrap: pretty; }
.tg-msg-contacts { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); margin-top: var(--hf-s-2); }
.tg-msg-foot { display: flex; gap: var(--hf-s-2); margin-top: var(--hf-s-2); padding-top: var(--hf-s-2); border-top: 1px solid var(--hf-border); }
.tg-msg-link { display: flex; align-items: center; gap: 3px; border: none; background: none; cursor: pointer; font-size: var(--hf-t-xs); color: var(--hf-primary); padding: 2px var(--hf-s-1); border-radius: var(--hf-r-sm); transition: background var(--hf-dur-fast) var(--hf-ease-out); }
.tg-msg-link:hover { background: var(--hf-primary-muted); }

.tg-outreach { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.tg-out-title { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); }
.tg-out-desc { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.tg-out-form { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.tg-out-contacts { margin-top: var(--hf-s-3); }
.tg-out-subtitle { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg-muted); margin-bottom: var(--hf-s-2); text-transform: uppercase; letter-spacing: 0.03em; }
.tg-out-list { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.tg-out-contact { display: flex; align-items: center; gap: 3px; padding: var(--hf-s-1) var(--hf-s-2); border: 1px solid var(--hf-border); background: var(--hf-surface); border-radius: var(--hf-r-pill); font-size: var(--hf-t-xs); color: var(--hf-fg-muted); cursor: pointer; font-family: var(--hf-mono); transition: all var(--hf-dur-fast) var(--hf-ease-out); }
.tg-out-contact:hover { border-color: var(--hf-primary); color: var(--hf-primary); }
</style>
