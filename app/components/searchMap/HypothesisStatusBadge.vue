<script setup lang="ts">
const props = defineProps<{ status: string }>()

const variants: Record<string, string> = {
  untested: 'surface',
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
  <UiBadge :variant="(variants[props.status] as any) ?? 'surface'">
    {{ labels[props.status] ?? props.status }}
  </UiBadge>
</template>
