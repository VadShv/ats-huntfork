<script setup lang="ts">
/**
 * HubView — хаб рекрутера (Daily Hub).
 *
 * Стартовый раздел: сегоднящние задачи, ожидание ответов,
 * последние действия, мини-статистика дня, календарь с активностью.
 */
import { ref, computed, onMounted } from 'vue'
import HfIcon from '../ui/HfIcon.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfSkeleton from '../ui/HfSkeleton.vue'
import { useQueue } from '../composables/useQueue'
import { useHistory, type ActionType } from '../composables/useHistory'
import { useOutreach } from '../composables/useOutreach'
import { useSidekick } from '../composables/useSidekick'

const { pendingCount, queue } = useQueue()
const { recent, getStats, getByDay, getActiveDays } = useHistory()
const { activeDrafts } = useOutreach()
const { sessionUser } = useSidekick()

const loading = ref(true)
const selectedDay = ref<number | null>(null)
const calendarMonth = ref(new Date())

onMounted(() => {
  setTimeout(() => { loading.value = false }, 300)
})

const today = new Date()
today.setHours(0, 0, 0, 0)
const todayTs = today.getTime()

const todayStats = computed(() => getStats(todayTs))
const recentActions = computed(() => recent(8))
const activeDays = computed(() => getActiveDays(calendarMonth.value))

const pendingQueue = computed(() => queue.value.filter((q) => q.status === 'pending'))
const sentDrafts = computed(() => activeDrafts.value.filter((d) => d.status === 'sent'))

const greeting = computed(() => {
  const hr = new Date().getHours()
  if (hr < 6) return 'Доброй ночи'
  if (hr < 12) return 'Доброе утро'
  if (hr < 18) return 'Добрый день'
  return 'Добрый вечер'
})

const userName = computed(() => sessionUser.value?.name || sessionUser.value?.email || 'рекрутер')

const statItems = computed(() => {
  const s = todayStats.value
  return [
    { label: 'Захвачено', value: s.capture ?? 0, icon: 'sourcing', tone: 'primary' as const },
    { label: 'Импортировано', value: s.import ?? 0, icon: 'import', tone: 'ok' as const },
    { label: 'Проверено', value: s.verify ?? 0, icon: 'fingerprint', tone: 'info' as const },
    { label: 'Отправлено', value: s.outreach_send ?? 0, icon: 'send', tone: 'warn' as const },
  ]
})

const calendarDays = computed(() => {
  const year = calendarMonth.value.getFullYear()
  const month = calendarMonth.value.getMonth()
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startWeekday = (first.getDay() + 6) % 7 // понедельник = 0
  const daysInMonth = last.getDate()
  const cells: Array<{ day: number | null; active: boolean; isToday: boolean }> = []
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null, active: false, isToday: false })
  const active = new Set(activeDays.value)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      day: d,
      active: active.has(d),
      isToday: d === today.getDate() && month === today.getMonth() && year === today.getFullYear(),
    })
  }
  return cells
})

const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const monthLabel = computed(() =>
  calendarMonth.value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
)

function prevMonth() {
  calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() - 1, 1)
}
function nextMonth() {
  calendarMonth.value = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth() + 1, 1)
}

const selectedDayActions = computed(() => {
  if (selectedDay.value == null) return []
  const dayTs = new Date(calendarMonth.value.getFullYear(), calendarMonth.value.getMonth(), selectedDay.value).getTime()
  return getByDay(dayTs)
})

const actionLabels: Record<ActionType, string> = {
  capture: 'Захват',
  import: 'Импорт',
  summary: 'Сводка',
  verify: 'Верификация',
  queue_add: 'В очередь',
  outreach_send: 'Отправка',
  telegram_parse: 'TG-парсинг',
  note_save: 'Заметка',
  settings_change: 'Настройки',
  telegram_connect: 'TG-подключение',
}

function actionIcon(t: ActionType): string {
  const map: Record<ActionType, string> = {
    capture: 'sourcing', import: 'import', summary: 'sparkle', verify: 'fingerprint',
    queue_add: 'clipboard-check', outreach_send: 'send', telegram_parse: 'telegram',
    note_save: 'note', settings_change: 'settings', telegram_connect: 'telegram',
  }
  return map[t] ?? 'history'
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="hub-view hf-scroll">
    <!-- Приветствие -->
    <div class="hub-greet">
      <h2 class="hub-greet-title">{{ greeting }}, {{ userName }}!</h2>
      <p class="hub-greet-sub">{{ new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) }}</p>
    </div>

    <!-- Статистика дня -->
    <div v-if="!loading" class="hub-stats">
      <div v-for="s in statItems" :key="s.label" class="hub-stat">
        <span class="hub-stat-ico"><HfIcon :name="s.icon" :size="16" /></span>
        <span class="hub-stat-val">{{ s.value }}</span>
        <span class="hub-stat-label">{{ s.label }}</span>
      </div>
    </div>

    <!-- Две колонки: задачи + календарь -->
    <div class="hub-grid">
      <!-- Левая: задачи и очередь -->
      <div class="hub-col">
        <section class="hub-section">
          <h3 class="hub-section-title">
            <HfIcon name="clipboard-check" :size="14" /> Задачи
            <HfChip v-if="pendingQueue.length" tone="warn">{{ pendingQueue.length }}</HfChip>
          </h3>
          <div v-if="loading" class="hub-skel-list">
            <HfSkeleton v-for="i in 3" :key="i" :lines="1" />
          </div>
          <div v-else-if="pendingQueue.length" class="hub-tasks">
            <div v-for="item in pendingQueue.slice(0, 5)" :key="item.id" class="hub-task">
              <span class="hub-task-dot" />
              <span class="hub-task-text">{{ item.source }}</span>
              <span class="hub-task-time">{{ new Date(item.addedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) }}</span>
            </div>
          </div>
          <HfEmpty v-else icon="clipboard-check" title="Очередь пуста"
            subtitle="Добавляйте профили хоткеем ⌘⇧E при просмотре выдачи." />
        </section>

        <section class="hub-section">
          <h3 class="hub-section-title">
            <HfIcon name="send" :size="14" /> Ожидают ответа
            <HfChip v-if="sentDrafts.length" tone="mid">{{ sentDrafts.length }}</HfChip>
          </h3>
          <div v-if="loading" class="hub-skel-list">
            <HfSkeleton v-for="i in 2" :key="i" :lines="1" />
          </div>
          <div v-else-if="sentDrafts.length" class="hub-tasks">
            <div v-for="d in sentDrafts.slice(0, 5)" :key="d.id" class="hub-task">
              <span class="hub-task-dot hub-task-dot--sent" />
              <span class="hub-task-text">{{ d.candidateName }}</span>
              <span class="hub-task-time">{{ d.role }}</span>
            </div>
          </div>
          <HfEmpty v-else icon="send" title="Нет отправленных"
            subtitle="Черновики аутрича появятся здесь после отправки." />
        </section>

        <section class="hub-section">
          <h3 class="hub-section-title">
            <HfIcon name="history" :size="14" /> Последние действия
          </h3>
          <div v-if="loading" class="hub-skel-list">
            <HfSkeleton v-for="i in 4" :key="i" :lines="1" />
          </div>
          <div v-else-if="recentActions.length" class="hub-feed">
            <div v-for="a in recentActions" :key="a.id" class="hub-feed-item">
              <span class="hub-feed-ico"><HfIcon :name="actionIcon(a.type)" :size="12" /></span>
              <span class="hub-feed-desc">{{ a.description }}</span>
              <span class="hub-feed-time">{{ fmtTime(a.timestamp) }}</span>
            </div>
          </div>
          <HfEmpty v-else icon="history" title="Нет действий"
            subtitle="Журнал начнёт заполняться по мере работы." />
        </section>
      </div>

      <!-- Правая: календарь -->
      <div class="hub-col hub-col--calendar">
        <section class="hub-section hub-calendar">
          <div class="hub-cal-head">
            <button class="hub-cal-nav" @click="prevMonth" aria-label="Предыдущий месяц">
              <HfIcon name="chevron" :size="14" style="transform: rotate(180deg)" />
            </button>
            <span class="hub-cal-month">{{ monthLabel }}</span>
            <button class="hub-cal-nav" @click="nextMonth" aria-label="Следующий месяц">
              <HfIcon name="chevron" :size="14" />
            </button>
          </div>
          <div class="hub-cal-weekdays">
            <span v-for="w in weekdayLabels" :key="w" class="hub-cal-wd">{{ w }}</span>
          </div>
          <div class="hub-cal-grid">
            <button
              v-for="(cell, i) in calendarDays"
              :key="i"
              class="hub-cal-day"
              :class="{
                'hub-cal-day--active': cell.active,
                'hub-cal-day--today': cell.isToday,
                'hub-cal-day--selected': selectedDay === cell.day,
              }"
              :disabled="!cell.day"
              @click="cell.day && (selectedDay = selectedDay === cell.day ? null : cell.day)"
            >
              {{ cell.day || '' }}
              <span v-if="cell.active" class="hub-cal-dot" />
            </button>
          </div>

          <div v-if="selectedDayActions.length" class="hub-cal-detail">
            <h4 class="hub-cal-detail-title">{{ selectedDay }} {{ monthLabel.split(' ')[0] }}</h4>
            <div class="hub-cal-detail-list">
              <div v-for="a in selectedDayActions" :key="a.id" class="hub-cal-detail-item">
                <span class="hub-feed-ico"><HfIcon :name="actionIcon(a.type)" :size="11" /></span>
                <span class="hub-feed-desc">{{ a.description }}</span>
                <span class="hub-feed-time">{{ fmtTime(a.timestamp) }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
export default { name: 'HubView' }
</script>

<style scoped>
.hub-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); max-width: var(--hf-content-max); margin-inline: auto; }

.hub-greet { margin-bottom: var(--hf-s-4); }
.hub-greet-title { font-size: var(--hf-t-xl); font-weight: var(--hf-fw-bold); color: var(--hf-fg); text-wrap: balance; }
.hub-greet-sub { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); margin-top: var(--hf-s-1); text-transform: capitalize; }

.hub-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--hf-s-2);
  margin-bottom: var(--hf-s-4);
}
.hub-stat {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: var(--hf-s-3) var(--hf-s-2);
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
}
.hub-stat-ico { color: var(--hf-fg-subtle); }
.hub-stat-val { font-size: var(--hf-t-xl); font-weight: var(--hf-fw-bold); color: var(--hf-fg); font-variant-numeric: tabular-nums; }
.hub-stat-label { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }

.hub-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-4); }
.hub-col { display: flex; flex-direction: column; gap: var(--hf-s-4); }

.hub-section {
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-lg);
  background: var(--hf-surface);
  padding: var(--hf-s-3);
}
.hub-section-title {
  display: flex; align-items: center; gap: var(--hf-s-2);
  font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold);
  color: var(--hf-fg-muted);
  margin-bottom: var(--hf-s-3);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.hub-skel-list { display: flex; flex-direction: column; gap: var(--hf-s-2); }

.hub-tasks { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.hub-task {
  display: flex; align-items: center; gap: var(--hf-s-2);
  padding: var(--hf-s-2);
  border-radius: var(--hf-r-md);
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.hub-task:hover { background: var(--hf-surface-sunken); }
.hub-task-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hf-warn); flex-shrink: 0; }
.hub-task-dot--sent { background: var(--hf-info); }
.hub-task-text { flex: 1; font-size: var(--hf-t-sm); color: var(--hf-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-task-time { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); flex-shrink: 0; }

.hub-feed { display: flex; flex-direction: column; gap: var(--hf-s-1); }
.hub-feed-item, .hub-cal-detail-item {
  display: flex; align-items: center; gap: var(--hf-s-2);
  padding: var(--hf-s-1) var(--hf-s-2);
}
.hub-feed-ico { color: var(--hf-fg-subtle); flex-shrink: 0; display: flex; }
.hub-feed-desc { flex: 1; font-size: var(--hf-t-xs); color: var(--hf-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hub-feed-time { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); font-variant-numeric: tabular-nums; flex-shrink: 0; }

.hub-calendar { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.hub-cal-head { display: flex; align-items: center; justify-content: space-between; }
.hub-cal-nav {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border: none; background: none; cursor: pointer;
  border-radius: var(--hf-r-sm);
  color: var(--hf-fg-muted);
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.hub-cal-nav:hover { background: var(--hf-surface-sunken); color: var(--hf-fg); }
.hub-cal-month { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); text-transform: capitalize; }

.hub-cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.hub-cal-wd { text-align: center; font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); padding: var(--hf-s-1) 0; }

.hub-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.hub-cal-day {
  position: relative;
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; cursor: pointer;
  border-radius: var(--hf-r-sm);
  font-size: var(--hf-t-xs); color: var(--hf-fg);
  font-variant-numeric: tabular-nums;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.hub-cal-day:hover:not(:disabled) { background: var(--hf-surface-sunken); }
.hub-cal-day:disabled { cursor: default; }
.hub-cal-day--today { font-weight: var(--hf-fw-bold); color: var(--hf-primary); }
.hub-cal-day--active { font-weight: var(--hf-fw-semibold); }
.hub-cal-day--selected { background: var(--hf-primary-muted); color: var(--hf-primary); }
.hub-cal-dot {
  position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%);
  width: 4px; height: 4px; border-radius: 50%; background: var(--hf-primary);
}

.hub-cal-detail { margin-top: var(--hf-s-2); padding-top: var(--hf-s-2); border-top: 1px solid var(--hf-border); }
.hub-cal-detail-title { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-semibold); color: var(--hf-fg); margin-bottom: var(--hf-s-2); text-transform: capitalize; }
.hub-cal-detail-list { display: flex; flex-direction: column; gap: var(--hf-s-1); max-height: 200px; overflow-y: auto; }

@media (max-width: 520px) {
  .hub-grid { grid-template-columns: 1fr; }
  .hub-stats { grid-template-columns: repeat(2, 1fr); }
}
</style>
