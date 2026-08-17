<!--
  IcCareBadge.vue — цветной круг-маркер этапа CARE.
  ТЗ «Опросная карта» §7.2.

  C=Content --hf-info, A=Action --hf-primary, R=Role --hf-match-mid, E=Effect --hf-match-high.
  Цвета одинаковы во всех картах — интервьюер запоминает их без чтения подписей.
-->
<script setup lang="ts">
import type { CareStage } from '../../composables/useInterviewCard'

defineProps<{
  stage: CareStage
}>()

const STAGE_COLOR: Record<CareStage, string> = {
  C: 'ic-care--c',
  A: 'ic-care--a',
  R: 'ic-care--r',
  E: 'ic-care--e',
}

const STAGE_LABEL: Record<CareStage, string> = {
  C: 'Content',
  A: 'Action',
  R: 'Role',
  E: 'Effect',
}
</script>

<template>
  <span
    class="ic-care"
    :class="STAGE_COLOR[stage]"
    :title="STAGE_LABEL[stage]"
  >{{ stage }}</span>
</template>

<style scoped>
.ic-care {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--hf-r-pill);
  font-size: 10px;
  font-weight: var(--hf-fw-bold);
  color: var(--hf-fg-on-accent);
  flex-shrink: 0;
}

.ic-care--c { background: var(--hf-info); }
.ic-care--a { background: var(--hf-primary); }
.ic-care--r { background: var(--hf-match-mid); }
.ic-care--e { background: var(--hf-match-high); }
</style>
