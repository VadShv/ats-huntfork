<script setup lang="ts">
// Управление командами перенесено во вкладку «Лига рекрутеров» → «Команда».
// Сохраняем маршрут для обратной совместимости старых ссылок/закладок.
await navigateTo('/dashboard/settings/league?tab=team', { redirectCode: 302 })
</script>

<template>
  <div />
</template>
