<script setup lang="ts">
/**
 * Decision poll card — renders question + options with vote counts.
 * Slash command /poll creates a poll; this card renders it inline.
 */
import { ref, computed, onMounted } from 'vue'
import { Vote } from 'lucide-vue-next'

const props = defineProps<{
  applicationId: string
  pollId: string
  question: string
  options: Array<{ key: string, label: string, emoji: string }>
  currentUserId: string
  readOnly?: boolean
}>()

const { t } = useI18n()
const toast = useToast()

interface VoteRow { userId: string, optionKey: string }
const votes = ref<VoteRow[]>([])
const loading = ref(true)
const voting = ref(false)

async function fetchVotes() {
  loading.value = true
  try {
    const res = await $fetch<{ votes: VoteRow[] }>(`/api/applications/${props.applicationId}/polls/${props.pollId}/votes`)
    votes.value = res.votes ?? []
  } catch {
    votes.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchVotes)

const myVote = computed(() => votes.value.find(v => v.userId === props.currentUserId)?.optionKey ?? null)

const voteCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const v of votes.value) {
    counts[v.optionKey] = (counts[v.optionKey] ?? 0) + 1
  }
  return counts
})

const totalVotes = computed(() => votes.value.length)

async function castVote(optionKey: string) {
  if (props.readOnly || voting.value) return
  voting.value = true
  try {
    await $fetch(`/api/applications/${props.applicationId}/polls/${props.pollId}/vote`, {
      method: 'POST',
      body: { optionKey },
    })
    await fetchVotes()
  } catch {
    toast.error('Не удалось проголосовать')
  } finally {
    voting.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 p-3">
    <div class="mb-2 flex items-center gap-1.5">
      <Vote class="size-3.5 text-brand-500" />
      <span class="text-xs font-semibold text-surface-700 dark:text-surface-200">{{ question }}</span>
    </div>
    <div class="space-y-1.5">
      <button
        v-for="opt in options"
        :key="opt.key"
        type="button"
        :disabled="readOnly || voting"
        class="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors"
        :class="myVote === opt.key
          ? 'border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20'
          : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 hover:border-surface-300 dark:hover:border-surface-600'"
        @click="castVote(opt.key)"
      >
        <span class="text-sm">{{ opt.emoji }}</span>
        <span class="flex-1 text-left text-surface-700 dark:text-surface-200">{{ opt.label }}</span>
        <span v-if="totalVotes > 0" class="tabular-nums text-surface-400">
          {{ voteCounts[opt.key] ?? 0 }} ({{ Math.round(((voteCounts[opt.key] ?? 0) / totalVotes) * 100) }}%)
        </span>
        <span v-if="myVote === opt.key" class="text-brand-500">✓</span>
      </button>
    </div>
    <p v-if="totalVotes > 0" class="mt-1.5 text-[10px] text-surface-400">
      {{ t('comments.poll_votes', { n: totalVotes }) }}
    </p>
  </div>
</template>
