<script setup lang="ts">
import { Handshake, Check, X } from 'lucide-vue-next'

interface Ref {
  id: string; status: string; candidateId: string; candidateName: string
  fromUserId: string; fromName: string; toUserId: string; toName: string; note: string | null
}
interface ReferralsResponse { incoming: Ref[]; sent: Ref[] }
interface Job { id: string; title: string; status: string }

const { data, refresh } = useFetch<ReferralsResponse>('/api/referrals', { headers: useRequestHeaders(['cookie']) })
const { data: jobsData } = useFetch<{ jobs?: Job[] } | Job[]>('/api/jobs', { headers: useRequestHeaders(['cookie']) })
const toast = useToast()

const incoming = computed(() => data.value?.incoming ?? [])
const sentActive = computed(() => (data.value?.sent ?? []).filter(r => r.status === 'pending' || r.status === 'accepted').slice(0, 3))
const openJobs = computed<Job[]>(() => {
  const j: any = jobsData.value
  const list: Job[] = Array.isArray(j) ? j : (j?.jobs ?? [])
  return list.filter(x => x.status === 'open' || x.status === 'draft')
})

const pickJob = ref<Record<string, string>>({})
const busy = ref<string | null>(null)

async function accept(r: Ref) {
  const jobId = pickJob.value[r.id]
  if (!jobId) { toast.error('Выберите вакансию'); return }
  busy.value = r.id
  try {
    await $fetch(`/api/referrals/${r.id}/respond`, { method: 'POST', body: { accept: true, jobId } })
    toast.success('Кандидат принят на вакансию')
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
  finally { busy.value = null }
}
async function decline(r: Ref) {
  busy.value = r.id
  try {
    await $fetch(`/api/referrals/${r.id}/respond`, { method: 'POST', body: { accept: false } })
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
  finally { busy.value = null }
}

const statusLabel: Record<string, string> = { pending: 'ожидает', accepted: 'принят', hired: 'нанят 🎉', declined: 'отклонён' }
</script>

<template>
  <div v-if="data && (incoming.length || sentActive.length)" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-5">
    <div class="flex items-center gap-2 mb-3">
      <Handshake class="size-5 text-brand-500" />
      <span class="text-sm font-semibold text-surface-900 dark:text-surface-100">Рефералы</span>
      <span v-if="incoming.length" class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-600 text-white">{{ incoming.length }} входящих</span>
    </div>

    <!-- Incoming -->
    <div v-for="r in incoming" :key="r.id" class="mb-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
      <p class="text-xs text-surface-700 dark:text-surface-300 mb-1"><b>{{ r.fromName }}</b> передаёт: {{ r.candidateName }}</p>
      <p v-if="r.note" class="text-[11px] text-surface-500 dark:text-surface-400 italic mb-1.5">«{{ r.note }}»</p>
      <div class="flex items-center gap-1.5">
        <select v-model="pickJob[r.id]" class="flex-1 rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1 text-xs bg-white dark:bg-surface-900">
          <option value="">Вакансия…</option>
          <option v-for="j in openJobs" :key="j.id" :value="j.id">{{ j.title }}</option>
        </select>
        <button type="button" :disabled="busy === r.id" class="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs px-2 py-1" @click="accept(r)"><Check class="size-3.5" /></button>
        <button type="button" :disabled="busy === r.id" class="rounded-lg bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 text-xs px-2 py-1" @click="decline(r)"><X class="size-3.5" /></button>
      </div>
    </div>

    <!-- Sent -->
    <div v-if="sentActive.length" class="space-y-1 pt-1">
      <p class="text-[11px] text-surface-400">Отправленные:</p>
      <div v-for="r in sentActive" :key="r.id" class="flex items-center justify-between text-[11px] text-surface-500 dark:text-surface-400">
        <span class="truncate">→ {{ r.toName }}: {{ r.candidateName }}</span>
        <span class="shrink-0">{{ statusLabel[r.status] || r.status }}</span>
      </div>
    </div>
  </div>
</template>
