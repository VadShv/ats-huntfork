import { and, eq } from 'drizzle-orm'
import * as schema from '../database/schema'
import { STAGE_COLORS } from './pipeline-colors'

// Accept any Drizzle DB instance that has the required tables.
// This keeps the function compatible with both the server Proxy-wrapped
// db instance and the raw drizzle() instance used in scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

// ─────────────────────────────────────────────────────────────
// Presets: «Простой» (legacy, 6 stages) и «Стандартный hh.ru» (1-в-1 с Talantix, 17 stages)
// ─────────────────────────────────────────────────────────────

export const SIMPLE_PRESET_NAME = 'Простой'
const HH_STANDARD_PRESET_NAME = 'Стандартный hh.ru'

/**
 * «Простой» пресет — 6 этапов, повторяет старый applicationStatusEnum.
 * Оставлен для оргов, которым не нужна расширенная модель hh.ru.
 */
export type StageSeed = Omit<typeof schema.pipelineStage.$inferInsert, 'id' | 'organizationId' | 'pipelineId' | 'createdAt' | 'updatedAt'> & {
  /** Локальный ключ для матчинга родитель→подстатус в пределах одного пресета */
  key: string
  /** Если задан — этап становится подстатусом этапа с указанным `key` */
  parentKey?: string
}

export const SIMPLE_STAGES: StageSeed[] = [
  { key: 'new',      name: 'Новый',    type: 'new',        color: STAGE_COLORS.new,        displayOrder: 0, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'screen',   name: 'Скрининг', type: 'screening',  color: STAGE_COLORS.screening,  displayOrder: 1, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'iv',       name: 'Интервью', type: 'interview',  color: STAGE_COLORS.interview,  displayOrder: 2, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'offer',    name: 'Оффер',    type: 'offer',      color: STAGE_COLORS.offer,      displayOrder: 3, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'hired',    name: 'Принят',   type: 'hired',      color: STAGE_COLORS.hired,      displayOrder: 4, bucket: 'working',  isTerminal: true,  isSystemStage: true },
  { key: 'rej',      name: 'Отказ',    type: 'not_fit',    color: STAGE_COLORS.not_fit,    displayOrder: 5, bucket: 'rejected', isTerminal: true,  isSystemStage: true },
]

/**
 * «Стандартный hh.ru» пресет — 1-в-1 с Talantix.
 * Working (12): Все неразобранные → (Подходящие); Подумать → (Вернуться позже);
 *   Первичный контакт → (Звонок, Мессенджер, Связаться ещё раз); Тестовое задание;
 *   Интервью; Предложение о работе; Выход на работу.
 * Rejected (Спринт 22): родитель «Отказ» (type='rejected') → подэтапы-причины:
 *   Не подходит, Кандидат отказался, Не выходит на связь,
 *   Вакансия закрыта, Перевод на другую вакансию.
 * Итого 18 записей (8 базовых + 4 подстатуса + родитель «Отказ» + 5 причин).
 */
export const HH_STANDARD_STAGES: StageSeed[] = [
  // ── Working bucket ──
  { key: 'unsorted',  name: 'Все неразобранные', type: 'new',        color: STAGE_COLORS.new,        displayOrder: 0,  bucket: 'working',  isTerminal: false, isSystemStage: true },
  // ТЗ hm-review-substage: очередь нанимающего менеджера — подэтап между корнем и «Подходящими»
  { key: 'hm_review', name: 'На рассмотрении',   type: 'new',        color: STAGE_COLORS.new,        displayOrder: 1,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'unsorted' },
  { key: 'suitable',  name: 'Подходящие',        type: 'new',        color: STAGE_COLORS.new,        displayOrder: 2,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'unsorted' },
  { key: 'onhold',    name: 'Подумать',          type: 'on_hold',    color: STAGE_COLORS.on_hold,    displayOrder: 3,  bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'later',     name: 'Вернуться позже',   type: 'on_hold',    color: STAGE_COLORS.on_hold,    displayOrder: 4,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'onhold' },
  { key: 'contact',   name: 'Первичный контакт', type: 'contact',    color: STAGE_COLORS.contact,    displayOrder: 5,  bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'call',      name: 'Звонок',            type: 'contact',    color: STAGE_COLORS.contact,    displayOrder: 6,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'contact' },
  { key: 'messenger', name: 'Мессенджер',        type: 'contact',    color: STAGE_COLORS.contact,    displayOrder: 7,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'contact' },
  { key: 'retry',     name: 'Связаться ещё раз', type: 'contact',    color: STAGE_COLORS.contact,    displayOrder: 8,  bucket: 'working',  isTerminal: false, isSystemStage: true, parentKey: 'contact' },
  { key: 'test',      name: 'Тестовое задание',  type: 'assessment', color: STAGE_COLORS.assessment, displayOrder: 9,  bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'interview', name: 'Интервью',          type: 'interview',  color: STAGE_COLORS.interview,  displayOrder: 10, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'offer',     name: 'Предложение о работе', type: 'offer',   color: STAGE_COLORS.offer,      displayOrder: 11, bucket: 'working',  isTerminal: false, isSystemStage: true },
  { key: 'hired',     name: 'Выход на работу',   type: 'hired',      color: STAGE_COLORS.hired,      displayOrder: 12, bucket: 'working',  isTerminal: true,  isSystemStage: true },
  // ── Rejected bucket (Спринт 22: родитель «Отказ» + подэтапы-причины) ──
  { key: 'reject',    name: 'Отказ',                 type: 'rejected',    color: STAGE_COLORS.rejected,    displayOrder: 13, bucket: 'rejected', isTerminal: true, isSystemStage: true },
  { key: 'notfit',    name: 'Не подходит',           type: 'not_fit',     color: STAGE_COLORS.not_fit,     displayOrder: 14, bucket: 'rejected', isTerminal: true, isSystemStage: true, parentKey: 'reject' },
  { key: 'withdrawn', name: 'Кандидат отказался',    type: 'withdrawn',   color: STAGE_COLORS.withdrawn,   displayOrder: 15, bucket: 'rejected', isTerminal: true, isSystemStage: true, parentKey: 'reject' },
  { key: 'noshow',    name: 'Не выходит на связь',   type: 'no_show',     color: STAGE_COLORS.no_show,     displayOrder: 16, bucket: 'rejected', isTerminal: true, isSystemStage: true, parentKey: 'reject' },
  { key: 'closed',    name: 'Вакансия закрыта',      type: 'job_closed',  color: STAGE_COLORS.job_closed,  displayOrder: 17, bucket: 'rejected', isTerminal: true, isSystemStage: true, parentKey: 'reject' },
  { key: 'transfer',  name: 'Перевод на другую вакансию', type: 'transferred', color: STAGE_COLORS.transferred, displayOrder: 18, bucket: 'rejected', isTerminal: true, isSystemStage: true, parentKey: 'reject' },
]

interface PresetDefinition {
  name: string
  description: string
  stages: StageSeed[]
  /** Если true — становится дефолтным для новых оргов. */
  isDefault: boolean
}

const PRESETS: PresetDefinition[] = [
  {
    name: HH_STANDARD_PRESET_NAME,
    description: 'Полная воронка 1-в-1 с hh.ru / Talantix. Включает 8 базовых этапов и родительский этап «Отказ» с 5 причинами.',
    stages: HH_STANDARD_STAGES,
    isDefault: true,
  },
  // Спринт 22 (M3): «Простой» пресет больше НЕ сидится новым организациям —
  // остаётся доступным только через явное создание (POST /api/pipelines, preset='simple').
]

/**
 * Создаёт один системный пресет воронки для организации.
 * Идемпотентно — если пресет с таким именем уже существует, ничего не делает.
 *
 * Возвращает id созданной воронки или null, если пресет уже был.
 */
async function seedPresetForOrg(
  db: DB,
  organizationId: string,
  preset: PresetDefinition,
): Promise<string | null> {
  // Проверяем есть ли уже такой пресет в этой орг (по имени)
  const [existing] = await db
    .select({ id: schema.pipeline.id })
    .from(schema.pipeline)
    .where(
      and(
        eq(schema.pipeline.organizationId, organizationId),
        eq(schema.pipeline.name, preset.name),
      ),
    )
    .limit(1)

  if (existing) {
    return null
  }

  const pipelineId = crypto.randomUUID()

  await db.insert(schema.pipeline).values({
    id: pipelineId,
    organizationId,
    name: preset.name,
    description: preset.description,
    isSystem: true,
    isDefault: preset.isDefault,
    isArchived: false,
  })

  // Сначала генерируем id для всех этапов, чтобы parentStageId мог ссылаться
  const keyToId = new Map<string, string>()
  for (const stage of preset.stages) {
    keyToId.set(stage.key, crypto.randomUUID())
  }

  const stageRows = preset.stages.map((stage) => {
    const { key, parentKey, ...rest } = stage
    return {
      ...rest,
      id: keyToId.get(key)!,
      organizationId,
      pipelineId,
      parentStageId: parentKey ? keyToId.get(parentKey) ?? null : null,
      // ТЗ hm-review-substage: machine-readable ключ пресета для серверной логики
      presetKey: key,
    }
  })

  await db.insert(schema.pipelineStage).values(stageRows)

  return pipelineId
}

/**
 * Сидит все системные пресеты воронок для организации.
 *
 * Идемпотентно — каждый пресет проверяется отдельно, пропускается если уже создан.
 * Порядок: сначала «Стандартный hh.ru» (становится default если нет других воронок),
 * затем «Простой» (как альтернатива, не-default).
 *
 * Retro-compat: если у орга уже есть pipeline (например, старая «Стандартная» из прошлого сида),
 * новый «Стандартный hh.ru» и «Простой» всё равно добавятся как дополнительные варианты,
 * но isDefault=true применится только если у орга ещё нет defaultPipeline.
 */
export async function seedSystemPipelineForOrg(db: DB, organizationId: string): Promise<void> {
  // Есть ли у орга уже дефолтная воронка? Если да, новые пресеты идут не-дефолтными.
  const [existingDefault] = await db
    .select({ id: schema.pipeline.id })
    .from(schema.pipeline)
    .where(
      and(
        eq(schema.pipeline.organizationId, organizationId),
        eq(schema.pipeline.isDefault, true),
      ),
    )
    .limit(1)

  const hasDefault = Boolean(existingDefault)

  for (const preset of PRESETS) {
    // Если у орга уже есть какая-то дефолтная воронка — не переопределяем её
    const effectivePreset: PresetDefinition = hasDefault
      ? { ...preset, isDefault: false }
      : preset

    await seedPresetForOrg(db, organizationId, effectivePreset)
  }
}
