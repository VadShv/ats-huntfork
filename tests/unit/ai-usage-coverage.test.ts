import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Защита от «невидимых» трат (docs/tz-ai-usage.md §12, §14): каждый файл server/,
 * который вызывает модель, должен задавать операцию через withAiOperation/withAiTrace.
 * Если вызов уходит в общий util, обёртка ставится в самом util. Новый вызов без
 * атрибуции попадёт в «Без атрибуции» — этот тест не даст его закоммитить.
 */
const ROOT = join(__dirname, '../../server')
const CALL = /\b(generateStructuredOutput|streamTextOutput|streamStructuredOutput|generateText|streamText|generateObject|streamObject)\(/
const WRAP = /\b(withAiOperation|withAiTrace)\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('атрибуция ИИ-вызовов', () => {
  const files = walk(ROOT)
  const callers = files.filter(f => CALL.test(readFileSync(f, 'utf8')))

  it('в коде есть вызовы модели (sanity)', () => {
    expect(callers.length).toBeGreaterThan(10)
  })

  it('каждый файл с вызовом модели задаёт операцию', () => {
    const missing = callers
      .filter(f => !WRAP.test(readFileSync(f, 'utf8')))
      .map(f => relative(ROOT, f))
    expect(missing, `Нет withAiOperation/withAiTrace: ${missing.join(', ')}`).toEqual([])
  })

  it('все очереди pg-boss выполняются в фоновом контексте', () => {
    const queue = readFileSync(join(ROOT, 'plugins/queue.ts'), 'utf8')
    const workers = queue.match(/boss\.work\(/g)?.length ?? 0
    const wrapped = queue.match(/withQueueAiContext\(/g)?.length ?? 0
    expect(workers).toBeGreaterThan(0)
    // +1 — объявление самой функции-обёртки
    expect(wrapped).toBeGreaterThanOrEqual(workers)
  })
})
