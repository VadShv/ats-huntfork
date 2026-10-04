<script setup lang="ts">
/**
 * VersionDiffView — сравнение двух версий (added/removed/changed).
 */
const props = defineProps<{
  diff: {
    sections: { title: string; added: string[]; removed: string[] }[]
    donors: { added: any[]; removed: any[]; changed: any[] }
    segments: { added: any[]; removed: any[]; changed: any[] }
  }
}>()
</script>

<template>
  <div class="space-y-4">
    <!-- Sections diff -->
    <div v-if="diff.sections.length">
      <h4 class="mb-2 text-sm font-semibold">Секции</h4>
      <div class="space-y-2">
        <div v-for="s in diff.sections" :key="s.title" class="rounded border border-surface-200 p-2 dark:border-surface-800">
          <p class="text-sm font-medium">{{ s.title }}</p>
          <div v-if="s.added.length" class="mt-1">
            <span class="text-xs text-success-600">+ </span>
            <span v-for="a in s.added" :key="a" class="mr-1 text-xs text-success-600">{{ a }}</span>
          </div>
          <div v-if="s.removed.length" class="mt-1">
            <span class="text-xs text-danger-600">− </span>
            <span v-for="r in s.removed" :key="r" class="mr-1 text-xs text-danger-600">{{ r }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Donors diff -->
    <div v-if="diff.donors.added.length || diff.donors.removed.length || diff.donors.changed.length">
      <h4 class="mb-2 text-sm font-semibold">Доноры</h4>
      <div v-if="diff.donors.added.length" class="text-xs text-success-600">
        + {{ diff.donors.added.map((d: any) => d.donorCompanyId).join(', ') }}
      </div>
      <div v-if="diff.donors.removed.length" class="text-xs text-danger-600">
        − {{ diff.donors.removed.map((d: any) => d.donorCompanyId).join(', ') }}
      </div>
      <div v-if="diff.donors.changed.length" class="text-xs text-warning-600">
        ~ {{ diff.donors.changed.length }} изменено
      </div>
    </div>

    <!-- Segments diff -->
    <div v-if="diff.segments.added.length || diff.segments.removed.length || diff.segments.changed.length">
      <h4 class="mb-2 text-sm font-semibold">Сегменты</h4>
      <div v-if="diff.segments.added.length" class="text-xs text-success-600">
        + {{ diff.segments.added.map((s: any) => s.name).join(', ') }}
      </div>
      <div v-if="diff.segments.removed.length" class="text-xs text-danger-600">
        − {{ diff.segments.removed.map((s: any) => s.name).join(', ') }}
      </div>
      <div v-if="diff.segments.changed.length" class="text-xs text-warning-600">
        ~ {{ diff.segments.changed.map((s: any) => s.name).join(', ') }}
      </div>
    </div>

    <div v-if="!diff.sections.length && !diff.donors.added.length && !diff.donors.removed.length && !diff.segments.added.length && !diff.segments.removed.length" class="py-4 text-center text-sm text-surface-400">
      Нет изменений
    </div>
  </div>
</template>
