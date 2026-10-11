<script setup lang="ts">
/**
 * Карточка «Передать коллеге» в ленте обсуждения (docs/tz-discussion-referral.md §2.3).
 * kind = 'system_event', payloadJson.event = 'referral'. Без пузыря, в стиле событий этапа:
 * точка на рельсе + строка «кто → кому · вакансия · статус» и комментарий ниже.
 * role 'source' — тред, откуда передали (статус живёт здесь); role 'target' — тред целевого отклика.
 */
import { computed } from 'vue'
import { Handshake, ExternalLink } from 'lucide-vue-next'
import type { ThreadComment } from '~/composables/useApplicationComments'
import { isReferralEventPayload, type ReferralEventPayload } from '~~/shared/referrals/event'

const props = defineProps<{ comment: ThreadComment, applicationId: string }>()

const { t, locale } = useI18n()
const localePath = useLocalePath()

const payload = computed<ReferralEventPayload | null>(() => (isReferralEventPayload(props.comment.payloadJson) ? props.comment.payloadJson : null))
const isTarget = computed(() => payload.value?.role === 'target')
const status = computed(() => payload.value?.status ?? 'pending')

const statusTone = computed(() => {
  switch (status.value) {
    case 'accepted':
    case 'hired':
      return 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300'
    case 'declined':
    case 'expired':
      return 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
    default:
      return 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300'
  }
})

const dotColor = computed(() => {
  switch (status.value) {
    case 'accepted':
    case 'hired': return 'bg-success-500'
    case 'declined':
    case 'expired': return 'bg-surface-400'
    default: return 'bg-warning-500'
  }
})

/** Ссылка на «другой» тред: из источника — в целевой отклик, из цели — обратно в источник. */
const crossLink = computed(() => {
  const p = payload.value
  if (!p) return null
  const other = isTarget.value ? p.sourceApplicationId : p.targetApplicationId
  if (!other || other === props.applicationId) return null
  return { to: localePath(`/dashboard/applications/${other}`), label: isTarget.value ? t('referral.open_source') : t('referral.open_target') }
})

function profilePath(userId: string) {
  return localePath(`/dashboard/people/${userId}`)
}

function formatTime(d: string | Date) {
  return new Date(d).toLocaleTimeString(locale.value === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div v-if="payload" :id="`comment-${comment.id}`" class="relative z-[1] my-2.5 flex items-start gap-2.5 disc-rise">
    <!-- Точка на рельсе -->
    <div class="flex w-7 flex-shrink-0 justify-center pt-1">
      <span class="block size-2.5 rounded-full ring-[3px] ring-white dark:ring-surface-900" :class="dotColor" />
    </div>
    <div class="min-w-0 flex-1 rounded-xl border border-dashed border-surface-200 dark:border-surface-700 bg-surface-50/60 dark:bg-surface-800/40 px-3 py-2 text-xs text-surface-600 dark:text-surface-300">
      <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Handshake class="size-3.5 text-brand-600 dark:text-brand-300" />
        <template v-if="isTarget">
          <span class="font-semibold text-surface-800 dark:text-surface-100">{{ t('referral.card_target') }}</span>
          <span>{{ t('referral.card_by') }}</span>
          <NuxtLink :to="profilePath(payload.fromUserId)" class="font-semibold text-surface-800 dark:text-surface-100 hover:underline">{{ payload.fromUserName }}</NuxtLink>
          <span>→</span>
          <NuxtLink :to="profilePath(payload.toUserId)" class="font-semibold text-surface-800 dark:text-surface-100 hover:underline">{{ payload.toUserName }}</NuxtLink>
        </template>
        <template v-else>
          <NuxtLink :to="profilePath(payload.fromUserId)" class="font-semibold text-surface-800 dark:text-surface-100 hover:underline">{{ payload.fromUserName }}</NuxtLink>
          <span>{{ t('referral.card_source') }}</span>
          <NuxtLink :to="profilePath(payload.toUserId)" class="font-semibold text-surface-800 dark:text-surface-100 hover:underline">{{ payload.toUserName }}</NuxtLink>
          <template v-if="payload.jobTitle">
            <span>· {{ t('referral.card_job') }}</span>
            <span class="font-semibold text-surface-800 dark:text-surface-100">«{{ payload.jobTitle }}»</span>
          </template>
          <span v-else class="text-surface-400">· {{ t('referral.card_no_job') }}</span>
        </template>
        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" :class="statusTone">
          {{ t(`referral.status_${status}`) }}
        </span>
        <span class="ml-auto whitespace-nowrap text-[11px] tabular-nums text-surface-400">{{ formatTime(comment.createdAt) }}</span>
      </div>
      <p v-if="payload.note" class="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-surface-700 dark:text-surface-200">
        «{{ payload.note }}»
      </p>
      <NuxtLink
        v-if="crossLink"
        :to="crossLink.to"
        class="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-300"
      >
        <ExternalLink class="size-3" />
        {{ crossLink.label }}
      </NuxtLink>
    </div>
  </div>
</template>
