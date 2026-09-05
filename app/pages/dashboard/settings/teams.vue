<script setup lang="ts">
// Управление командами перенесено во вкладку «Лига рекрутеров» → «Команды».
// Сохраняем маршрут для обратной совместимости старых ссылок/закладок.
await navigateTo('/dashboard/settings/league?tab=teams', { redirectCode: 302 })
</script>

<template>
  <div />
</template>
