/**
 * Фикс воспроизводимости сборки на чистом клоне.
 *
 * Сборщик (rolldown-vite/oxc) подхватывает корневой tsconfig.json репозитория,
 * который ссылается на генерируемые Nuxt-файлы .nuxt/tsconfig.*.json.
 * На чистом клоне их нет (создаются только `nuxt prepare` / `nuxt dev`),
 * и сборка расширения падает с TSCONFIG_ERROR.
 *
 * Скрипт создаёт минимальные заглушки, только если файлы отсутствуют.
 * Настоящий `nuxt prepare` потом перезапишет их полноценными версиями.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const nuxtDir = join(repoRoot, '.nuxt')
const stubs = ['tsconfig.app.json', 'tsconfig.server.json', 'tsconfig.shared.json', 'tsconfig.node.json']

if (!existsSync(join(repoRoot, 'nuxt.config.ts'))) {
  // Расширение собирают вне монорепо — заглушки не нужны.
  process.exit(0)
}

mkdirSync(nuxtDir, { recursive: true })
for (const name of stubs) {
  const path = join(nuxtDir, name)
  if (!existsSync(path)) {
    writeFileSync(path, '{"compilerOptions":{}}\n')
    console.log(`[ensure-root-tsconfig] создана заглушка .nuxt/${name}`)
  }
}
