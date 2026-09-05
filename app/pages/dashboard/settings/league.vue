<script setup lang="ts">
import type { Component } from 'vue'
import { Trophy, Info, TrendingUp, Users, ShoppingBag } from 'lucide-vue-next'

useSeoMeta({ title: 'Лига рекрутеров', description: 'Геймификация: HuntPass, ранги, квесты, команды, дуэли, рефералы, kudos, магазин' })

const route = useRoute()
const router = useRouter()

/** Active inner tab, synced with ?tab= query for deep-links and legacy redirects. */
type TabKey = 'progress' | 'team' | 'shop'
const tabs: { key: TabKey; label: string; icon: Component; hint: string }[] = [
  { key: 'progress', label: 'Прогресс', icon: TrendingUp, hint: 'Ваш личный прогресс: сезонный трек, ранг, ежедневные цели и вечные достижения.' },
  { key: 'team', label: 'Команда', icon: Users, hint: 'Сотрудничество и соревнование с коллегами: лига команд, дуэли, рефералы, kudos и управление командами.' },
  { key: 'shop', label: 'Магазин', icon: ShoppingBag, hint: 'Монеты и косметика: тратьте заработанное на рамки аватара, титулы и акцентные цвета.' },
]

/** Map query (incl. legacy ?tab=teams) → active tab. */
function normalizeTab(t: unknown): TabKey {
  if (t === 'team' || t === 'teams') return 'team'
  if (t === 'shop') return 'shop'
  return 'progress'
}
const activeTab = ref<TabKey>(normalizeTab(route.query.tab))
watch(() => route.query.tab, (t) => { activeTab.value = normalizeTab(t) })
function setTab(key: TabKey) {
  activeTab.value = key
  router.replace({ query: key === 'progress' ? {} : { tab: key } })
}

/** Section metadata: title + rules explanation. Widget rendered in the slot. */
interface Section { key: string, title: string, rule: string }

const progressSections: Section[] = [
  { key: 'huntpass', title: 'HuntPass — сезонный трек', rule: 'Сезон = календарный квартал. Копите очки сезона (SXP) за результаты — наймы, офферы, интервью, закрытые вакансии — и продвигаетесь по 30 тирам, забирая награды. SXP за найм умножается на грейд вакансии (Junior…Lead) и качество (доля принятых офферов). В конце сезона SXP обнуляется — свежий старт.' },
  { key: 'rank', title: 'Ранг и дивизионы', rule: 'Соревновательный рейтинг RP = объём × качество × скорость. Дивизионы Бронза→Легенда. Чтобы подняться — держите RP выше порога несколько недель подряд (промо-серия); при простое ранг мягко падает (decay). Новичок проходит калибровку. Награждает эффективность, а не только количество.' },
  { key: 'quests', title: 'Квесты дня', rule: 'Ежедневные (3) и недельные цели, направляющие на приоритетные действия: быстрый ответ, разбор входящих, продвижение по воронке. Выполнение даёт SXP и монеты. В наборе всегда есть «качественный» квест. Обновляются каждый день/неделю.' },
  { key: 'achievements', title: 'Достижения', rule: 'Вечные ачивки за накопленные результаты (наймы, офферы, интервью, стрики, скорость, кооперация). Дают XP и уровни. В отличие от сезонного HuntPass — не сбрасываются.' },
]

const teamSections: Section[] = [
  { key: 'league', title: 'Лига команд', rule: 'Рекрутеры объединяются в команды (создаются ниже, в блоке «Управление командами»). Лига считается по среднему RP на участника — честно к размеру команды. Соревнование команд за сезон.' },
  { key: 'duels', title: 'Дуэли 1v1', rule: 'Вызовите коллегу на недельную дуэль по метрике (наймы/офферы/интервью/продвижения). Кто наберёт больше за 7 дней — победил. Победитель получает бонус SXP и монеты. До 3 активных дуэлей.' },
  { key: 'referrals', title: 'Рефералы — передача кандидатов', rule: 'Кандидат не подходит вам, но полезен коллеге? Передайте его (кнопка «Передать» в карточке кандидата). Если коллега примет и в итоге наймёт — вы получите ассист: SXP + монеты + прогресс ачивки «Командный игрок». Превращает отказы в наймы.' },
  { key: 'kudos', title: 'Kudos — признание коллег', rule: 'Поблагодарите коллегу за помощь (лимит 5 в неделю — чтобы признание было ценным). Получатель получает монеты и признание. За полученные kudos — ачивки «Признанный/Уважаемый/Душа команды».' },
]

const shopSections: Section[] = [
  { key: 'shop', title: 'Монеты и магазин', rule: 'Монеты зарабатываются в квестах, дуэлях, за ассисты и тиры HuntPass. Тратятся в магазине на косметику: рамки аватара, титулы, акцентные цвета.' },
]

const activeHint = computed(() => tabs.find(t => t.key === activeTab.value)?.hint ?? '')
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <div class="mb-6">
      <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 flex items-center gap-2">
        <Trophy class="size-5 text-brand-500" /> Лига рекрутеров
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
        Геймификация подбора: прогресс, соревнование и сотрудничество. Всё считается автоматически из вашей реальной работы (ИИ-авто и этап «На рассмотрении» у НМ не засчитываются).
      </p>
    </div>

    <!-- Inner tabs -->
    <div class="mb-4 flex items-center gap-1 border-b border-surface-200 dark:border-surface-800">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === t.key
          ? 'border-brand-500 text-brand-700 dark:text-brand-300'
          : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200'"
        @click="setTab(t.key)"
      >
        <component :is="t.icon" class="size-4" />
        {{ t.label }}
      </button>
    </div>

    <!-- Active tab hint -->
    <p class="mb-6 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
      <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
      <span>{{ activeHint }}</span>
    </p>

    <!-- Progress: personal progression widgets -->
    <div v-if="activeTab === 'progress'" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <section v-for="s in progressSections" :key="s.key">
        <div class="mb-2">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ s.title }}</h2>
          <p class="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
            <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
            <span>{{ s.rule }}</span>
          </p>
        </div>
        <HuntPassWidget v-if="s.key === 'huntpass'" />
        <RankWidget v-else-if="s.key === 'rank'" />
        <QuestsWidget v-else-if="s.key === 'quests'" />
        <AchievementsWidget v-else-if="s.key === 'achievements'" />
      </section>
    </div>

    <!-- Team: cooperation & competition + team management -->
    <div v-else-if="activeTab === 'team'">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section v-for="s in teamSections" :key="s.key">
          <div class="mb-2">
            <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ s.title }}</h2>
            <p class="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
              <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
              <span>{{ s.rule }}</span>
            </p>
          </div>
          <TeamLeagueWidget v-if="s.key === 'league'" />
          <DuelsWidget v-else-if="s.key === 'duels'" />
          <ReferralsWidget v-else-if="s.key === 'referrals'" />
          <KudosWidget v-else-if="s.key === 'kudos'" />
        </section>
      </div>

      <!-- Team management -->
      <div class="mt-8 pt-6 border-t border-surface-200 dark:border-surface-800 max-w-3xl">
        <div class="mb-3">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200">Управление командами</h2>
          <p class="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
            <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
            <span>Создавайте команды и распределяйте рекрутеров. Здесь же настраиваются еженедельные MVP-пуши в Telegram.</span>
          </p>
        </div>
        <TeamsManager />
      </div>
    </div>

    <!-- Shop: coins & cosmetics -->
    <div v-else-if="activeTab === 'shop'" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <section v-for="s in shopSections" :key="s.key">
        <div class="mb-2">
          <h2 class="text-sm font-semibold text-surface-800 dark:text-surface-200">{{ s.title }}</h2>
          <p class="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
            <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
            <span>{{ s.rule }}</span>
          </p>
        </div>
        <ShopWidget v-if="s.key === 'shop'" />
      </section>
    </div>
  </div>
</template>
