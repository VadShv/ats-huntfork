<script setup lang="ts">
import { Handshake, Check, X } from 'lucide-vue-next'

const props = defineProps<{ candidateId: string }>()

const open = ref(false)
const toUserId = ref('')
const note = ref('')
const sending = ref(false)
const toast = useToast()

// Reuse the duels endpoint's org-recruiter list (excludes self).
const { data } = useFetch<{ opponents: { userId: string; name: string }[] }>('/api/duels', {
  headers: useRequestHeaders(['cookie']),
})
const colleagues = computed(() => data.value?.opponents ?? [])

async function send() {
  if (!toUserId.value) return
  sending.value = true
  try {
    await $fetch('/api/referrals', {
      method: 'POST',
      body: { candidateId: props.candidateId, toUserId: toUserId.value, note: note.value || undefined },
    })
    toast.success('Кандидат передан коллеге')
    open.value = false; toUserId.value = ''; note.value = ''
  } catch (e: any) {
    toast.error(e?.data?.statusMessage || 'Не удалось передать')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-lg border border-surface-300 dark:border-surface-700 px-3 py-1.5 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
      @click="open = !open"
    >
      <Handshake class="size-3.5" />
      Передать
    </button>

    <div v-if="open" class="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-lg p-3">
      <p class="text-xs font-medium text-surface-700 dark:text-surface-300 mb-2">Передать кандидата коллеге</p>
      <select v-model="toUserId" class="w-full mb-2 rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900">
        <option value="">Выберите коллегу…</option>
        <option v-for="c in colleagues" :key="c.userId" :value="c.userId">{{ c.name }}</option>
      </select>
      <textarea v-model="note" rows="2" placeholder="Заметка (необязательно)" class="w-full mb-2 rounded-lg border border-surface-300 dark:border-surface-700 px-2 py-1.5 text-sm bg-white dark:bg-surface-900" />
      <div class="flex items-center gap-2">
        <button type="button" :disabled="sending || !toUserId" class="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm py-1.5" @click="send">
          <Check class="size-3.5" /> Передать
        </button>
        <button type="button" class="rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 px-2.5 py-1.5" @click="open = false"><X class="size-3.5" /></button>
      </div>
    </div>
  </div>
</template>
