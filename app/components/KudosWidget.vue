<script setup lang="ts">
import { ThumbsUp, Send, Check } from 'lucide-vue-next'

interface KudosResponse {
  totalReceived: number
  remaining: number
  weeklyLimit: number
  received: { fromName: string; reason: string | null; createdAt: string }[]
  colleagues: { userId: string; name: string }[]
}

const { data, refresh } = useFetch<KudosResponse>('/api/kudos', { headers: useRequestHeaders(['cookie']) })
const toast = useToast()

const open = ref(false)
const toUserId = ref('')
const reason = ref('')
const sending = ref(false)

const remaining = computed(() => data.value?.remaining ?? 0)
const received = computed(() => data.value?.received ?? [])

async function send() {
  if (!toUserId.value) return
  sending.value = true
  try {
    await $fetch('/api/kudos', { method: 'POST', body: { toUserId: toUserId.value, reason: reason.value || undefined } })
    toast.success('Kudos отправлен! 👍')
    open.value = false; toUserId.value = ''; reason.value = ''
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Не удалось отправить') }
  finally { sending.value = false }
}
</script>

<template>
  <div v-if="data" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <ThumbsUp class="size-5 text-brand-500" />
        <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Kudos</span>
      </div>
      <span class="text-xs text-surface-400">получено {{ data.totalReceived }}</span>
    </div>

    <button
      type="button"
      class="w-full mb-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm py-1.5"
      :disabled="remaining === 0"
      @click="open = !open"
    >
      <Send class="size-3.5" /> Поблагодарить коллегу
      <span class="text-[10px] opacity-80">· осталось {{ remaining }}/{{ data.weeklyLimit }}</span>
    </button>

    <div v-if="open" class="mb-3 space-y-2">
      <select v-model="toUserId" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900">
        <option value="">Выберите коллегу…</option>
        <option v-for="c in data.colleagues" :key="c.userId" :value="c.userId">{{ c.name }}</option>
      </select>
      <input v-model="reason" type="text" placeholder="За что? (необязательно)" class="w-full rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900">
      <button type="button" :disabled="sending || !toUserId" class="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm py-1.5" @click="send">
        <Check class="size-3.5" /> Отправить
      </button>
    </div>

    <div v-if="received.length" class="space-y-1.5 pt-2 border-t border-surface-100 dark:border-surface-800">
      <div v-for="(k, i) in received.slice(0, 4)" :key="i" class="text-[11px]">
        <span class="text-surface-700 dark:text-surface-300">👍 <b>{{ k.fromName }}</b></span>
        <span v-if="k.reason" class="text-surface-400"> — {{ k.reason }}</span>
      </div>
    </div>
    <p v-else class="text-[11px] text-surface-400">Пока нет полученных kudos.</p>
  </div>
</template>
