/**
 * AI Provider Abstraction Layer
 *
 * Supports OpenAI, Anthropic, and custom OpenAI-compatible endpoints.
 * Credentials are decrypted per-request from the organization's AI config.
 * Never logs or stores raw API keys — only encrypted values in the database.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject, NoObjectGeneratedError, streamObject, streamText } from 'ai'
import type { z } from 'zod'
import { decrypt } from '../encryption'
import { createYandexFetch } from './yandexFetch'
import { createCloudRuFetch, thinkingFamilyFor } from './cloudRuFetch'

export type SupportedProvider = 'openai' | 'anthropic' | 'google' | 'openai_compatible' | 'yandex' | 'cloud_ru'

export interface ProviderConfig {
  provider: SupportedProvider
  model: string
  apiKeyEncrypted: string
  baseUrl?: string | null
  maxTokens: number
}

/** Detailed info about a single model (presentation + suggested defaults). */
export interface ModelInfo {
  /** Provider-recognised model id, e.g. `gpt-4.1-mini`. */
  id: string
  /** Human label shown in dropdowns, e.g. `GPT‑4.1 Mini`. */
  label: string
  /** One-line plain-English description for non-experts. */
  description: string
  /** Suggested USD price per 1M input tokens — used to pre-fill the form. */
  inputPricePer1m?: number
  /** Suggested USD price per 1M output tokens — used to pre-fill the form. */
  outputPricePer1m?: number
  /** Optional badge: `recommended`, `fast`, `powerful`, `cheap`. */
  badge?: 'recommended' | 'fast' | 'powerful' | 'cheap'
}

/** Well-known providers with links for obtaining API keys and curated model lists. */
export const PROVIDER_REGISTRY: Record<string, {
  name: string
  /** Short tagline describing the provider for the UI. */
  tagline: string
  modelsUrl: string
  apiKeyUrl: string
  /** Optional docs link explaining how to get started. */
  signupUrl?: string
  /** Whether a custom Base URL field should be exposed. */
  supportsBaseUrl: boolean
  defaultModel: string
  models: ModelInfo[]
}> = {
  openai: {
    name: 'OpenAI',
    tagline: 'Industry-leading GPT models. The safest default for most teams.',
    modelsUrl: 'https://platform.openai.com/docs/models',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    signupUrl: 'https://platform.openai.com/signup',
    supportsBaseUrl: false,
    defaultModel: 'gpt-4.1-mini',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Flagship model — highest accuracy for complex reasoning.', inputPricePer1m: 2.0, outputPricePer1m: 8.0, badge: 'powerful' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Best balance of price, speed and quality. Recommended default.', inputPricePer1m: 0.4, outputPricePer1m: 1.6, badge: 'recommended' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', description: 'Fastest and cheapest GPT-4.1. Great for high-volume scoring.', inputPricePer1m: 0.1, outputPricePer1m: 0.4, badge: 'cheap' },
      { id: 'gpt-4o', label: 'GPT-4o', description: 'Multimodal flagship from the GPT-4o family.', inputPricePer1m: 2.5, outputPricePer1m: 10.0 },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Older small model — keep for cost compatibility.', inputPricePer1m: 0.15, outputPricePer1m: 0.6 },
      { id: 'o3', label: 'o3', description: 'Reasoning model — slow but excellent at multi-step problems.', inputPricePer1m: 2.0, outputPricePer1m: 8.0 },
      { id: 'o4-mini', label: 'o4 Mini', description: 'Smaller reasoning model — good price/quality for scoring.', inputPricePer1m: 1.1, outputPricePer1m: 4.4 },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    tagline: 'Claude models — strong at long-form analysis and nuanced writing.',
    modelsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    signupUrl: 'https://console.anthropic.com/',
    supportsBaseUrl: false,
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', description: 'Anthropic\'s most capable model. Best for the toughest analyses.', inputPricePer1m: 15.0, outputPricePer1m: 75.0, badge: 'powerful' },
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'The sweet spot — strong reasoning at a sensible price.', inputPricePer1m: 3.0, outputPricePer1m: 15.0, badge: 'recommended' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: 'Fast and inexpensive. Great for chat and quick scoring.', inputPricePer1m: 0.8, outputPricePer1m: 4.0, badge: 'fast' },
    ],
  },
  google: {
    name: 'Google AI (Gemini)',
    tagline: 'Gemini models — generous free tier and very fast inference.',
    modelsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    signupUrl: 'https://aistudio.google.com/',
    supportsBaseUrl: false,
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Google\'s top model — strong at reasoning and long contexts.', inputPricePer1m: 1.25, outputPricePer1m: 10.0, badge: 'powerful' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Excellent quality at a very low price. Recommended default.', inputPricePer1m: 0.3, outputPricePer1m: 2.5, badge: 'recommended' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Previous-gen fast model. Still solid and very cheap.', inputPricePer1m: 0.1, outputPricePer1m: 0.4, badge: 'cheap' },
      { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', description: 'Cheapest Gemini option for high-volume light tasks.', inputPricePer1m: 0.075, outputPricePer1m: 0.3, badge: 'cheap' },
    ],
  },
  openai_compatible: {
    name: 'OpenAI-Compatible (Custom)',
    tagline: 'Connect any OpenAI-compatible endpoint: Ollama, LM Studio, OpenRouter, Groq, Together AI, vLLM, …',
    modelsUrl: '',
    apiKeyUrl: '',
    supportsBaseUrl: true,
    defaultModel: '',
    models: [],
  },
  yandex: {
    name: 'Yandex Cloud',
    tagline: 'Модели Yandex Foundation Models — российский провайдер, хостинг в РФ, OpenAI-совместимый endpoint.',
    modelsUrl: 'https://yandex.cloud/ru/docs/foundation-models/concepts/yandexgpt/models',
    apiKeyUrl: 'https://yandex.cloud/ru/docs/iam/operations/api-key/create',
    signupUrl: 'https://console.yandex.cloud/',
    supportsBaseUrl: false,
    defaultModel: 'gpt://__FOLDER_ID__/yandexgpt/latest',
    models: [
      { id: 'gpt://__FOLDER_ID__/yandexgpt/latest', label: 'YandexGPT Pro', description: 'Флагманская модель Yandex — лучшее качество для сложных задач. Контекст 32 K токенов.', inputPricePer1m: 1.20, outputPricePer1m: 1.20, badge: 'recommended' },
      { id: 'gpt://__FOLDER_ID__/yandexgpt-lite/latest', label: 'YandexGPT Lite', description: 'Быстрая и бюджетная модель для массовых задач. Контекст 32 K токенов.', inputPricePer1m: 0.20, outputPricePer1m: 0.20, badge: 'cheap' },
      { id: 'gpt://__FOLDER_ID__/yandexgpt-32k/latest', label: 'YandexGPT 32k', description: 'Расширенное контекстное окно для длинных резюме и профилей.', inputPricePer1m: 1.20, outputPricePer1m: 1.20 },
      { id: 'gpt://__FOLDER_ID__/deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'MoE-модель 284B (13B активных) с контекстом 1M токенов. Сильный tool calling, низкая цена. Рекомендована для чат-ассистента.', badge: 'recommended' },
      { id: 'gpt://__FOLDER_ID__/qwen3-235b-a22b-fp8/latest', label: 'Qwen3 235B', description: 'Мощная open-source MoE-модель в Yandex Cloud. Хороша для рассуждений и скрининга резюме.', badge: 'powerful' },
      { id: 'gpt://__FOLDER_ID__/llama-3.3-70b-instruct/latest', label: 'Llama 3.3 70B Instruct', description: 'Meta Llama в Yandex Cloud. Альтернатива YandexGPT для экспериментов.' },
    ],
  },
  cloud_ru: {
    name: 'Cloud.ru Foundation Models',
    tagline: 'Evolution Foundation Models — российский провайдер (cloud.ru): GLM-5.2, DeepSeek V4, Qwen3-Coder, GigaChat 3.5, Kimi K2.6. OpenAI-совместимый endpoint, хостинг в РФ.',
    modelsUrl: 'https://cloud.ru/products/evolution-ai-factory/catalog-foundation-models',
    apiKeyUrl: 'https://console.cloud.ru/ai-factory/foundation-models/keys',
    signupUrl: 'https://cloud.ru/products/evolution-foundation-models',
    supportsBaseUrl: false,
    defaultModel: 'zai-org/GLM-5.2',
    // Цены пересчитаны из тарифов Cloud.ru (руб/1M токенов с НДС) по курсу ≈90 руб/$.
    // Пересматривай при существенном изменении курса — это только подсказка для формы, точный биллинг в личном кабинете.
    models: [
      { id: 'zai-org/GLM-5.2', label: 'GLM-5.2', description: 'Флагман Z.ai: сильна в кодинге и агентных задачах. Reasoning, контекст 1M. Рекомендованный дефолт для скрининга.', inputPricePer1m: 2.7, outputPricePer1m: 11.2, badge: 'recommended' },
      { id: 'zai-org/GLM-5.1', label: 'GLM-5.1', description: 'Предыдущее поколение GLM. Хороший баланс цена/качество, контекст 200K.', inputPricePer1m: 2.2, outputPricePer1m: 8.9 },
      { id: 'zai-org/GLM-4.7', label: 'GLM-4.7', description: 'Быстрая и дешёвая модель GLM. Reasoning, контекст 200K.', inputPricePer1m: 2.0, outputPricePer1m: 8.1 },
      { id: 'deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek V4 Pro', description: 'Флагман DeepSeek: reasoning, tool calling, контекст 1M токенов. Отличен для сложного анализа резюме.', inputPricePer1m: 3.9, outputPricePer1m: 5.3, badge: 'powerful' },
      { id: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash', description: 'Быстрая версия DeepSeek V4 с контекстом 1M. Хороша для массового скоринга.', inputPricePer1m: 0.2, outputPricePer1m: 0.4, badge: 'cheap' },
      { id: 'ai-sage/GigaChat3.5-432B-A28B', label: 'GigaChat 3.5 Ultra', description: 'Флагман Сбера: 432B параметров, контекст 262K. Function Calling, Structured Output. Полностью российская модель.', inputPricePer1m: 1.1, outputPricePer1m: 3.2 },
      { id: 'ai-sage/GigaChat3-10B-A1.8B', label: 'GigaChat 3 Lite', description: 'Быстрая и дешёвая версия GigaChat. Хороша для чат-бота и лёгких задач.', inputPricePer1m: 0.15, outputPricePer1m: 0.6, badge: 'cheap' },
      { id: 'Qwen/Qwen3-Coder-Next', label: 'Qwen3-Coder', description: 'Специализирована на коде и структурированных данных. Полезна для парсинга резюме и генерации JSON.', inputPricePer1m: 0.5, outputPricePer1m: 0.9 },
      { id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen3.5 397B', description: 'Крупная MoE-модель Alibaba: reasoning, vision, контекст 262K.', inputPricePer1m: 3.9, outputPricePer1m: 8.1 },
      { id: 'Qwen/Qwen3.6-35B-A3B', label: 'Qwen3.6 35B', description: 'Компактная MoE-модель Qwen: reasoning, vision, дешёвая. Хорошо для чат-ассистента.', inputPricePer1m: 0.2, outputPricePer1m: 1.0, badge: 'fast' },
      { id: 'moonshotai/Kimi-K2.6', label: 'Kimi K2.6', description: 'Открытая MoE от Moonshot AI: reasoning, vision, tool calling, контекст 262K.', inputPricePer1m: 0.8, outputPricePer1m: 3.4 },
      { id: 'MiniMaxAI/MiniMax-M3', label: 'MiniMax M3', description: 'Флагман MiniMax: reasoning, контекст 524K. Полезна для длинных документов.', inputPricePer1m: 0.6, outputPricePer1m: 2.4 },
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', description: 'Открытая модель OpenAI: reasoning, function calling. Контекст 131K.', inputPricePer1m: 0.4, outputPricePer1m: 1.6 },
    ],
  },
}

/**
 * Create a language model instance from encrypted config.
 * Decrypts the API key just-in-time and never persists it in memory beyond the call.
 */
export function createLanguageModel(config: ProviderConfig) {
  const secret = env.BETTER_AUTH_SECRET
  const apiKey = decrypt(config.apiKeyEncrypted, secret)

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Не удалось расшифровать ключ API ИИ. Возможно, ключ повреждён',
    })
  }

  switch (config.provider) {
    case 'openai':
    case 'openai_compatible': {
      const openai = createOpenAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return openai(config.model)
    }
    case 'cloud_ru': {
      // Cloud.ru Foundation Models: OpenAI-совместимый endpoint, хостинг в РФ.
      // Использует Chat Completions API (`/v1/chat/completions`), не Responses API.
      const openai = createOpenAI({
        apiKey,
        baseURL: config.baseUrl || 'https://foundation-models.api.cloud.ru/v1',
      })
      return openai.chat(config.model)
    }
    case 'yandex': {
      // Yandex Foundation Models exposes an OpenAI-compatible endpoint.
      // The Authorization header accepts both `Bearer <key>` and `Api-Key <key>` formats.
      // IMPORTANT: use the legacy Chat Completions API (`.chat()`), not the new Responses API
      // (default for `openai(model)`), since Yandex does not implement `/v1/responses`.
      // Wrap fetch to repair non-conformant SSE tool-call deltas Yandex emits
      // for Qwen3-family models (empty `type` / `id` first chunk). See
      // server/utils/ai/yandexFetch.ts for the full rationale.
      const openai = createOpenAI({
        apiKey,
        baseURL: config.baseUrl || 'https://llm.api.cloud.yandex.net/v1',
        fetch: createYandexFetch(),
      })
      return openai.chat(config.model)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return anthropic(config.model)
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      })
      return google(config.model)
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: `Неподдерживаемый поставщик ИИ: ${config.provider}`,
      })
  }
}

// ─── Устойчивый парсинг structured output ─────────────────────────

/** JSON.parse с одной мягкой починкой: убрать хвостовые запятые перед } и ]. */
function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  }
  catch { /* пробуем починить */ }
  try {
    return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'))
  }
  catch {
    return undefined
  }
}

/**
 * Извлечь валидный JSON из «грязного» ответа модели:
 * 1) содержимое ```json …```-ограждений (частая привычка моделей);
 * 2) первая сбалансированная JSON-структура ({…} или […]) в тексте;
 * 3) голый массив опционально оборачивается через `wrapBareArray`
 *    (когда схема ожидает объект-обёртку, а модель вернула массив).
 * Возвращает строку с валидным JSON или null, если восстановить нечего.
 */
export function extractJsonPayload(
  raw: string,
  wrapBareArray?: (items: unknown[]) => unknown,
): string | null {
  let text = raw.trim()
  if (!text) return null

  const fence = text.match(/```[a-z]*\s*\n?([\s\S]*?)```/i)
  if (fence?.[1]?.trim()) text = fence[1].trim()

  const objStart = text.indexOf('{')
  const arrStart = text.indexOf('[')
  if (objStart === -1 && arrStart === -1) return null
  const start = objStart === -1
    ? arrStart
    : arrStart === -1
      ? objStart
      : Math.min(objStart, arrStart)
  const close = text[start] === '{' ? '}' : ']'
  const end = text.lastIndexOf(close)
  if (end <= start) return null

  const parsed = tryParseJson(text.slice(start, end + 1))
  if (parsed === undefined) return null
  if (Array.isArray(parsed) && wrapBareArray) {
    return JSON.stringify(wrapBareArray(parsed))
  }
  return JSON.stringify(parsed)
}

/**
 * Жёсткое требование формата, добавляется КО ВСЕМ structured-вызовам.
 * Часть моделей (YandexGPT, GLM, Qwen) любят заворачивать JSON в markdown —
 * инструкция снижает частоту, а extractJsonPayload добивает остальное.
 */
const JSON_ONLY_GUARD = '\n\nФОРМАТ ОТВЕТА (критически важно): верни ТОЛЬКО валидный JSON по заданной схеме. Без markdown-разметки, без ```-ограждений, без пояснений, без текста до или после JSON. Return ONLY raw valid JSON, no markdown fences, no commentary.'

/**
 * Fallback mapper for models that ignore the Zod schema and return their own
 * JSON structure (e.g. GLM-5.2 returns nested Russian-keyed objects).
 * Converts common field name / nesting variations to the structured_resume schema.
 */
function mapStructuredResumeResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const pi = (raw.personal_info ?? raw.personalInfo ?? {}) as Record<string, unknown>
  const dj = (raw.desired_job ?? raw.desiredJob ?? {}) as Record<string, unknown>
  const skills = (raw.skills ?? {}) as Record<string, unknown>
  const salary = (dj.salary ?? raw.salary ?? {}) as Record<string, unknown>

  const genderRaw = String(pi.gender ?? raw.gender ?? '').toLowerCase()
  const gender = genderRaw.includes('муж') ? 'male' : genderRaw.includes('жен') ? 'female' : 'unknown'

  const contacts: Array<{ type: string; value: string }> = []
  if (pi.phone) contacts.push({ type: 'phone', value: String(pi.phone) })
  if (pi.email) contacts.push({ type: 'email', value: String(pi.email) })
  if (pi.telegram) contacts.push({ type: 'telegram', value: String(pi.telegram) })
  if (pi.linkedin) contacts.push({ type: 'linkedin', value: String(pi.linkedin) })
  if (pi.github) contacts.push({ type: 'github', value: String(pi.github) })

  const exp = Array.isArray(raw.experience) ? raw.experience.map((e: Record<string, unknown>) => ({
    company: String(e.company ?? e.company_name ?? ''),
    position: String(e.position ?? ''),
    start: String(e.start ?? e.start_date ?? ''),
    end: String(e.end ?? e.end_date ?? ''),
    description: String(e.description ?? ''),
  })) : []

  const edu = Array.isArray(raw.education) ? raw.education.map((e: Record<string, unknown>) => ({
    organization: String(e.organization ?? e.institution ?? ''),
    name: String(e.name ?? e.faculty ?? e.specialty ?? ''),
    result: String(e.result ?? e.level ?? ''),
    year: Number(e.year ?? 0) || 0,
  })) : []

  const skillArrays = [
    ...(Array.isArray(skills.hard_skills ?? skills.hardSkills) ? (skills.hard_skills ?? skills.hardSkills) as unknown[] : []),
    ...(Array.isArray(skills.soft_skills ?? skills.softSkills) ? (skills.soft_skills ?? skills.softSkills) as unknown[] : []),
    ...(Array.isArray(raw.skill_set) ? raw.skill_set as unknown[] : []),
  ]
  const skillStrings = skillArrays.map(s => String(s)).filter(Boolean)

  const languages = Array.isArray(skills.languages)
    ? skills.languages.map((l: Record<string, unknown>) => ({ name: String(l.name ?? ''), level: String(l.level ?? '') }))
    : Array.isArray(raw.language)
      ? raw.language.map((l: Record<string, unknown>) => ({ name: String(l.name ?? ''), level: String((l.level as Record<string, unknown>)?.name ?? l.level ?? '') }))
      : []

  return {
    firstName: String(pi.first_name ?? pi.firstName ?? raw.first_name ?? raw.firstName ?? ''),
    lastName: String(pi.last_name ?? pi.lastName ?? raw.last_name ?? raw.lastName ?? ''),
    middleName: String(pi.middle_name ?? pi.middleName ?? raw.middle_name ?? raw.middleName ?? ''),
    title: String(dj.position ?? raw.title ?? ''),
    birthDate: String(pi.birth_date ?? pi.birthDate ?? raw.birth_date ?? ''),
    gender,
    area: String(pi.location ?? pi.area ?? raw.area ?? ''),
    salaryAmount: Number(salary.amount ?? raw.salaryAmount ?? 0) || 0,
    salaryCurrency: String(salary.currency ?? raw.salaryCurrency ?? ''),
    totalExperienceMonths: Number(raw.totalExperienceMonths ?? 0) || 0,
    experience: exp,
    education: edu,
    skills: skillStrings,
    about: String(raw.about_me ?? raw.about ?? skills.about ?? ''),
    languages,
    contacts,
  }
}

/**
 * Generate a structured JSON response from the AI provider.
 * Uses Vercel AI SDK's `generateObject` for reliable schema-conformant output.
 *
 * Надёжность: если модель вернула JSON в markdown/фенсах или голым массивом,
 * ответ восстанавливается через extractJsonPayload + повторную валидацию схемой,
 * прежде чем пробрасывать ошибку наверх.
 */
export async function generateStructuredOutput<T>(
  config: ProviderConfig,
  options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
    schemaDescription?: string
    /** Как обернуть голый массив, если схема ожидает объект: items => ({ criteria: items }) */
    wrapBareArray?: (items: unknown[]) => unknown
    /** Sampling temperature. Для детерминированного разбора (резюме) передавайте 0. */
    temperature?: number
  },
): Promise<{ object: T; usage: { promptTokens: number; completionTokens: number }; responseModel: string | null }> {
  const model = createLanguageModel(config)

  try {
    // Внимание: НЕ передаём maxOutputTokens. У reasoning-моделей (GLM, Qwen)
    // «размышления» тратят выходной бюджет, и обрезка структурированного ответа
    // гарантированно ломает парсинг. config.maxTokens применяется в стриминговых
    // вызовах (streamTextOutput/streamStructuredOutput), где обрезка не фатальна.
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(new Error('AI structured output timed out after 180s')), 180_000)
    let result
    try {
      result = await generateObject({
        model,
        system: options.system + JSON_ONLY_GUARD,
        prompt: options.prompt,
        schema: options.schema,
        schemaName: options.schemaName,
        schemaDescription: options.schemaDescription,
        temperature: options.temperature ?? 0.1,
        abortSignal: abortController.signal,
      })
    }
    finally {
      clearTimeout(timeoutHandle)
    }

    return {
      object: result.object,
      usage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
      },
      // Фактическая модель из ответа API — телеметрия «кто реально отвечает»
      responseModel: result.response?.modelId ?? null,
    }
  }
  catch (err) {
    // Модель ответила, но не чистым JSON (markdown, ```json-фенсы, голый массив,
    // хвостовые запятые) — пытаемся восстановить и провалидировать схемой.
    if (NoObjectGeneratedError.isInstance(err) && typeof err.text === 'string' && err.text) {
      const repairedJson = extractJsonPayload(err.text, options.wrapBareArray)
      if (repairedJson !== null) {
        const validated = options.schema.safeParse(JSON.parse(repairedJson))
        if (validated.success) {
          console.warn(`[ai] structured output (${options.schemaName}) восстановлен из неструктурированного ответа модели ${config.model}`)
          return {
            object: validated.data,
            usage: {
              promptTokens: err.usage?.inputTokens ?? 0,
              completionTokens: err.usage?.outputTokens ?? 0,
            },
            responseModel: err.response?.modelId ?? null,
          }
        }
        console.warn(`[ai] восстановленный JSON (${options.schemaName}) не прошёл валидацию схемы: ${validated.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        // Fallback: map non-schema-conformant response (e.g. GLM-5.2 nested Russian keys)
        if (options.schemaName === 'structured_resume') {
          const mapped = mapStructuredResumeResponse(JSON.parse(repairedJson))
          const mappedValidated = options.schema.safeParse(mapped)
          if (mappedValidated.success) {
            console.warn(`[ai] structured output (${options.schemaName}) восстановлен через маппер полей`)
            return {
              object: mappedValidated.data,
              usage: { promptTokens: err.usage?.inputTokens ?? 0, completionTokens: err.usage?.outputTokens ?? 0 },
              responseModel: err.response?.modelId ?? null,
            }
          }
        }
      }
    }
    throw err
  }
}

/**
 * Стриминговая генерация свободного текста (Sidekick: саммари, чат).
 * Тот же provider/config-контур, что generateStructuredOutput;
 * скрининговый код не затрагивается.
 */
/**
 * Стрим-модель для Cloud.ru через @ai-sdk/openai-compatible:
 * в отличие от @ai-sdk/openai, он парсит `reasoning_content` из Chat Completions
 * в reasoning-дельты («мысли» модели становятся видимы в fullStream),
 * а при reasoning=false обёртка fetch отключает thinking-фазу целиком.
 * Используется ТОЛЬКО в streamTextOutput — скрининг (generateStructuredOutput)
 * продолжает ходить через прежний клиент.
 */
function createCloudRuStreamModel(config: ProviderConfig, reasoningOn: boolean) {
  const secret = env.BETTER_AUTH_SECRET
  const apiKey = decrypt(config.apiKeyEncrypted, secret)
  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Не удалось расшифровать ключ API ИИ. Возможно, ключ повреждён',
    })
  }
  const provider = createOpenAICompatible({
    name: 'cloud-ru',
    apiKey,
    baseURL: config.baseUrl || 'https://foundation-models.api.cloud.ru/v1',
    includeUsage: true,
    fetch: createCloudRuFetch(reasoningOn ? null : thinkingFamilyFor(config.model)),
  })
  return provider.chatModel(config.model)
}

export function streamTextOutput(
  config: ProviderConfig,
  options: {
    system: string
    prompt?: string
    messages?: Array<{ role: 'user' | 'assistant', content: string }>
    /**
     * Тумблер «Глубокий анализ» из панели: false/undefined — thinking-фаза
     * reasoning-моделей Cloud.ru отключается (быстрый первый токен),
     * true — модель думает, а «мысли» стримятся как reasoning-дельты.
     */
    reasoning?: boolean
    /** П5: потолок генерации под задачу — короче ответ, быстрее финал. По умолчанию — лимит конфига. */
    maxOutputTokens?: number
  },
) {
  const model = config.provider === 'cloud_ru'
    ? createCloudRuStreamModel(config, options.reasoning === true)
    : createLanguageModel(config)

  return streamText({
    model,
    system: options.system,
    ...(options.messages ? { messages: options.messages } : { prompt: options.prompt ?? '' }),
    maxOutputTokens: options.maxOutputTokens ?? config.maxTokens,
    temperature: 0.3,
  })
}

/**
 * П4: стриминговая генерация структурированного JSON (верификация,
 * карточка интервью в Sidekick). Возвращает результат `streamObject` целиком:
 * `partialObjectStream` для прогрессивной отрисовки и `object` для финальной
 * валидации по схеме. Идёт через тот же клиент, что generateStructuredOutput
 * (для cloud_ru — createOpenAI().chat), поэтому структурный вывод идентичен
 * блокирующему пути. Скрининговый контур (generateStructuredOutput) не тронут.
 */
export function streamStructuredOutput<T>(
  config: ProviderConfig,
  options: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    schemaName: string
    schemaDescription?: string
    /** П5: потолок генерации под задачу. По умолчанию — лимит конфига. */
    maxOutputTokens?: number
    /** Обрыв генерации при уходе клиента (экономия токенов). */
    abortSignal?: AbortSignal
  },
) {
  const model = createLanguageModel(config)

  return streamObject({
    model,
    system: options.system,
    prompt: options.prompt,
    schema: options.schema,
    schemaName: options.schemaName,
    schemaDescription: options.schemaDescription,
    maxOutputTokens: options.maxOutputTokens ?? config.maxTokens,
    temperature: 0.1,
    abortSignal: options.abortSignal,
  })
}
