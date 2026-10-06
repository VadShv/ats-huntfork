import { describe, it, expect } from 'vitest'
import { AI_OPERATIONS } from '../../shared/aiUsage/catalog'

/**
 * Банк промптов = каталог ИИ-операций (docs/tz-ai-usage.md §2, §8.4): каждой операции
 * соответствует запись реестра промптов, иначе карточка операции не покажет промпт.
 */
const { getAllPromptIds } = await import('../../server/utils/ai/promptRegistry')

describe('реестр промптов покрывает каталог операций', () => {
  const ids = new Set(getAllPromptIds())

  it('у каждой операции есть промпт в реестре', () => {
    const missing = AI_OPERATIONS
      .filter(o => o.key !== 'unattributed' && o.key !== 'system.testConnection')
      .map(o => o.promptId ?? o.key)
      .filter(id => !ids.has(id))
    expect(missing).toEqual([])
  })

  it('чат-бот ссылается на базовый системный промпт', () => {
    const chat = AI_OPERATIONS.find(o => o.key === 'chatbot.chat')
    expect(chat?.promptId).toBe('chatbot.baseSystemPrompt')
  })

  it('ключи операций уникальны', () => {
    const keys = AI_OPERATIONS.map(o => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
