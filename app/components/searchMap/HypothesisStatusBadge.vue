<script setup lang="ts">
const props = defineProps<{ status: string }>()

const variants: Record<string, string> = {
  untested: 'neutral',
  in_progress: 'info',
  working: 'success',
  rejected: 'danger',
}

const labels: Record<string, string> = {
  untested: 'Не проверена',
  in_progress: 'В работе',
  working: 'Работает',
  rejected: 'Отклонена',
}
</script>

<template>
  <UiBadge :tone="(variants[props.status] as any) ?? 'neutral'">
    {{ labels[props.status] ?? props.status }}
  </UiBadge>
</template>
