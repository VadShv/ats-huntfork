<script setup lang="ts">
/** Единый набор иконок, толщина штриха 1.5px. SVG inline — без зависимостей. */
const props = defineProps<{ name: string; size?: number }>()
const sz = () => (props.size ?? 22)
</script>

<template>
  <svg
    :width="sz()" :height="sz()" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Ассистент: чат-баббл -->
    <template v-if="name === 'chat'">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </template>
    <!-- Сорсинг: лупа + человек -->
    <template v-else-if="name === 'sourcing'">
      <circle cx="11" cy="8" r="4" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M5 21v-2a4 4 0 0 1 4-4h4" />
    </template>
    <!-- Скрининг: щит-галка -->
    <template v-else-if="name === 'screening'">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </template>
    <!-- Аутрич: конверт-искра -->
    <template v-else-if="name === 'outreach'">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
      <path d="M12 2v2M9 4l3-2 3 2" opacity="0.6" />
    </template>
    <!-- Пайплайн: канбан -->
    <template v-else-if="name === 'pipeline'">
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="11" rx="1" />
      <rect x="17" y="4" width="4" height="7" rx="1" />
    </template>
    <!-- Библиотека: закладка -->
    <template v-else-if="name === 'library'">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </template>
    <!-- Прочие -->
    <template v-else-if="name === 'send'">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </template>
    <template v-else-if="name === 'note'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M18 6L6 18M6 6l12 12" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="M20 6L9 17l-5-5" />
    </template>
    <template v-else-if="name === 'arrow-down'">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </template>
    <template v-else-if="name === 'arrow-left'">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </template>
    <template v-else-if="name === 'import'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </template>
    <template v-else-if="name === 'sparkle'">
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </template>
    <template v-else-if="name === 'target'">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" />
    </template>
    <template v-else-if="name === 'scissors'">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
    </template>
    <template v-else-if="name === 'external'">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
    </template>
    <template v-else-if="name === 'command'">
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
    </template>
    <template v-else-if="name === 'chevron'">
      <path d="M9 18l6-6-6-6" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="M6 9l6 6 6-6" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <path d="M18 15l-6-6-6 6" />
    </template>
    <template v-else-if="name === 'pin'">
      <path d="M12 17v5M9 10.76V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4.76a2 2 0 0 0 .59 1.41l2.41 2.41a1 1 0 0 1-.7 1.71H6.7a1 1 0 0 1-.7-1.71l2.41-2.41a2 2 0 0 0 .59-1.41z" />
    </template>
    <template v-else-if="name === 'logo'">
      <path d="M5 3v7a4 4 0 0 0 4 4h1v7h4v-7h1a4 4 0 0 0 4-4V3h-3v7a1 1 0 0 1-1 1h-1V3h-4v8H9a1 1 0 0 1-1-1V3H5z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'map'">
      <path d="M9 3l-6 3v15l6-3 6 3 6-3V3l-6 3-6-3z" />
      <path d="M9 3v15M15 6v15" />
    </template>
    <template v-else-if="name === 'layers'">
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" opacity="0.55" />
    </template>
    <template v-else-if="name === 'ban'">
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </template>
    <template v-else-if="name === 'clipboard-check'">
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M9 14l2 2 4-4" />
    </template>
    <template v-else-if="name === 'building'">
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
      <path d="M10 21v-3h4v3" />
    </template>
    <template v-else-if="name === 'list-checks'">
      <path d="M11 6h10M11 12h10M11 18h10" />
      <path d="M3 6l1.5 1.5L7 4M3 12l1.5 1.5L7 10M3 18l1.5 1.5L7 16" />
    </template>
    <template v-else-if="name === 'gauge'">
      <path d="M12 14l4-4" />
      <path d="M3.5 18a9 9 0 1 1 17 0" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'route'">
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H14a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h5.5" />
    </template>
    <template v-else-if="name === 'filter'">
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" />
    </template>
    <template v-else-if="name === 'alert'">
      <path d="M12 3l9 16H3l9-16z" />
      <path d="M12 10v4M12 17.5v.5" />
    </template>
    <template v-else-if="name === 'history'">
      <path d="M3 3v6h6" />
      <path d="M3.5 9a9 9 0 1 1-1 5" />
      <path d="M12 8v4l3 2" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </template>
    <template v-else-if="name === 'timeline'">
      <path d="M3 6h6M3 12h10M3 18h14" />
      <path d="M9 4v4M13 10v4M17 16v4" />
    </template>
    <template v-else-if="name === 'scale'">
      <path d="M12 3v18M5 8h14" />
      <path d="M5 8l-2.5 6h5L5 8zM19 8l-2.5 6h5L19 8z" />
    </template>
    <template v-else-if="name === 'fingerprint'">
      <path d="M12 11a2 2 0 0 0-2 2c0 2 .5 4 1 5.5" />
      <path d="M8 7a6 6 0 0 1 8 0" />
      <path d="M6 13a6 6 0 0 1 2-4.5" />
      <path d="M18 13c0 2-.5 4-1.5 6" />
      <path d="M12 14c0 2 .5 3.5 1 5" />
    </template>
    <template v-else-if="name === 'github'">
      <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
    </template>
    <template v-else-if="name === 'radar'">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" opacity="0.5" />
      <path d="M12 12l6-3" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'help'">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" />
      <path d="M12 17.5v.5" />
    </template>
    <template v-else-if="name === 'circle'">
      <circle cx="12" cy="12" r="9" />
    </template>
    <!-- Волкодав: силуэт головы волка с ушами и глазами -->
    <template v-else-if="name === 'wolf'">
      <path d="M4 6l3 2V14c0 3 2 5 5 5s5-2 5-5V8l3-2-1.5 7.5C18 19 15 21 12 21s-6-2-6.5-5.5L4 6z" />
      <path d="M9 12c0-1.5 1.3-2.5 3-2.5s3 1 3 2.5" opacity="0.5" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
    </template>
    <!-- Telegram: бумажный самолётик -->
    <template v-else-if="name === 'telegram'">
      <defs>
        <pattern id="hf-tg-hatch" patternUnits="userSpaceOnUse" width="2.5" height="2.5" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="2.5" stroke="#2AABEE" stroke-width="1.1" />
        </pattern>
      </defs>
      <path d="M21.5 4.5L2.5 12.5l5 2 2 5 3.5-3.5 5 3.5 3-15z" fill="url(#hf-tg-hatch)" stroke="#2AABEE" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <path d="M9.5 14.5l5-5" stroke="#2AABEE" stroke-width="1.3" stroke-linecap="round" opacity="0.6" />
    </template>
    <!-- Канал: хэштег -->
    <template v-else-if="name === 'channel'">
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </template>
    <!-- Настройки: шестерёнка -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </template>
    <!-- Календарь -->
    <template v-else-if="name === 'calendar'">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </template>
    <!-- Часы -->
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </template>
    <!-- Журнал/история -->
    <template v-else-if="name === 'history'">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </template>
    <!-- Шаблон -->
    <template v-else-if="name === 'template'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18M3 9h6" />
    </template>
    <!-- Хаб -->
    <template v-else-if="name === 'hub'">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
   </template>
  <template v-else-if="name === 'download'">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </template>
  <template v-else-if="name === 'trash'">
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </template>
  <template v-else-if="name === 'check'">
    <path d="M20 6L9 17l-5-5" />
  </template>
  <template v-else-if="name === 'brain'">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
  </template>
  <template v-else-if="name === 'menu'">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </template>
  <template v-else-if="name === 'briefcase'">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
  </template>
  <template v-else-if="name === 'edit'">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
   <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
 </template>
  <template v-else-if="name === 'play'">
    <polygon points="5 3 19 12 5 21 5 3" />
  </template>
  <template v-else-if="name === 'spinner'">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </template>
 <template v-else>
     <circle cx="12" cy="12" r="9" />
   </template>
  </svg>
</template>
