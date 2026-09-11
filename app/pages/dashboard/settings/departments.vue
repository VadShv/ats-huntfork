<script setup lang="ts">
// Управление подразделениями перенесено в единый раздел «Оргструктура».
// Сохраняем маршрут для обратной совместимости старых ссылок/закладок.
await navigateTo('/dashboard/settings/org-structure', { redirectCode: 302 })
</script>

<template>
  <div />
</template>
