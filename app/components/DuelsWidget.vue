<script setup lang="ts">
import { Swords, Plus, Check, X } from 'lucide-vue-next'

interface Duel {
  id: string; status: string; metric: string; metricLabel: string
  challengerId: string; challengerName: string; opponentId: string; opponentName: string
  challengerScore: number; opponentScore: number; winnerId: string | null
  endsAt: string | null; isChallenger: boolean; isIncoming: boolean
}
interface DuelsResponse {
  duels: Duel[]; winSxp: number
  metrics: { key: string; label: string }[]
  opponents: { userId: string; name: string }[]
}

const { data, refresh } = useFetch<DuelsResponse>('/api/duels', { headers: useRequestHeaders(['cookie']) })
const toast = useToast()

const active = computed(() => data.value?.duels.filter(d => d.status === 'active') ?? [])
const incoming = computed(() => data.value?.duels.filter(d => d.isIncoming) ?? [])
const recent = computed(() => data.value?.duels.filter(d => d.status === 'completed').slice(0, 2) ?? [])

const showCreate = ref(false)
const oppId = ref('')
const metric = ref('')
async function createDuel() {
  if (!oppId.value || !metric.value) return
  try {
    await $fetch('/api/duels', { method: 'POST', body: { opponentId: oppId.value, metric: metric.value } })
    toast.success('Вызов отправлен'); showCreate.value = false; oppId.value = ''; metric.value = ''
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Не удалось создать дуэль') }
}
async function respond(id: string, accept: boolean) {
  try {
    await $fetch(`/api/duels/${id}/respond`, { method: 'POST', body: { accept } })
    toast.success(accept ? 'Дуэль началась!' : 'Вызов отклонён')
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
}

const inputCls = 'rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-xs bg-white dark:bg-surface-900 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500'
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <Swords class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Дуэли</span>
      </div>
      <button type="button" class="text-xs text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-0.5" @click="showCreate = !showCreate">
        <Plus class="size-3" /> Вызвать
      </button>
    </div>

    <!-- Create -->
    <div v-if="showCreate" class="mb-3 flex items-center gap-2">
      <select v-model="oppId" :class="inputCls" class="flex-1">
        <option value="">Соперник…</option>
        <option v-for="o in data.opponents" :key="o.userId" :value="o.userId">{{ o.name }}</option>
      </select>
      <select v-model="metric" :class="inputCls">
        <option value="">Метрика…</option>
        <option v-for="m in data.metrics" :key="m.key" :value="m.key">{{ m.label }}</option>
      </select>
      <button type="button" class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs px-2 py-1.5" @click="createDuel"><Check class="size-3.5" /></button>
    </div>

    <!-- Incoming challenges -->
    <div v-for="d in incoming" :key="d.id" class="mb-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
      <p class="text-xs text-surface-700 dark:text-surface-300 mb-1.5"><b>{{ d.challengerName }}</b> вызывает на дуэль: {{ d.metricLabel }}</p>
      <div class="flex gap-2">
        <button type="button" class="flex-1 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs py-1" @click="respond(d.id, true)">Принять</button>
        <button type="button" class="rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-xs px-3" @click="respond(d.id, false)"><X class="size-3.5" /></button>
      </div>
    </div>

    <!-- Active duels -->
    <div v-for="d in active" :key="d.id" class="mb-2 flex items-center gap-2 text-xs">
      <span class="truncate flex-1 text-right" :class="d.isChallenger ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-surface-600 dark:text-surface-400'">{{ d.challengerName }}</span>
      <span class="font-bold text-surface-900 dark:text-surface-100 shrink-0">{{ d.challengerScore }}:{{ d.opponentScore }}</span>
      <span class="truncate flex-1" :class="!d.isChallenger ? 'font-semibold text-brand-600 dark:text-brand-400' : 'text-surface-600 dark:text-surface-400'">{{ d.opponentName }}</span>
    </div>
    <p v-if="active.length" class="text-[10px] text-surface-400 mb-2">{{ active[0].metricLabel }} · победа +{{ data.winSxp }} SXP</p>

    <!-- Recent -->
    <div v-if="recent.length" class="pt-2 border-t border-surface-100 dark:border-surface-800 space-y-1">
      <div v-for="d in recent" :key="d.id" class="flex items-center justify-between text-[11px] text-surface-400">
        <span class="truncate">{{ d.challengerName }} {{ d.challengerScore }}:{{ d.opponentScore }} {{ d.opponentName }}</span>
        <span v-if="d.winnerId" class="shrink-0 text-success-600 dark:text-success-400">🏆 {{ d.winnerId === d.challengerId ? d.challengerName : d.opponentName }}</span>
        <span v-else class="shrink-0">ничья</span>
      </div>
    </div>

    <p v-if="!active.length && !incoming.length && !recent.length" class="text-xs text-surface-400 text-center py-2">Нет активных дуэлей — вызовите коллегу!</p>
  </div>
</template>
