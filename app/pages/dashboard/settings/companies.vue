<script setup lang="ts">
// Управление компаниями перенесено в единый раздел «Оргструктура».
// Сохраняем маршрут для обратной совместимости старых ссылок/закладок.
await navigateTo('/dashboard/settings/org-structure', { redirectCode: 302 })
</script>

<template>
  <div />
</template>
