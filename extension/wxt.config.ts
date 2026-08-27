import { defineConfig } from 'wxt'

// Huntfork Sidekick — конфиг WXT (MV3)
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Huntfork Sidekick',
    description:
      'Боковая панель рекрутера: импорт с hh.ru, захват кандидатов с LinkedIn, Хабр Карьеры, GitHub и любых сайтов в Huntfork.',
    permissions: ['storage', 'sidePanel', 'tabs', 'scripting'],
    host_permissions: [
      'https://hh.ru/*',
      'https://*.hh.ru/*',
      'https://huntfork.ru/*',
    ],
    // Доступ к остальным сайтам — только по явному запросу при первом
    // захвате на конкретном origin (chrome.permissions.request из панели).
    optional_host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Huntfork Sidekick — открыть панель',
    },
  },
})
