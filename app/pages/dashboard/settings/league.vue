<script setup lang="ts">
import type { Component } from 'vue'
import { Trophy, Info, Sparkles, Users } from 'lucide-vue-next'

useSeoMeta({ title: 'Лига рекрутеров', description: 'Геймификация: HuntPass, ранги, квесты, команды, дуэли, рефералы, kudos, магазин' })

const route = useRoute()
const router = useRouter()

/** Active inner tab, synced with ?tab= query for deep-links and legacy redirects. */
type TabKey = 'overview' | 'teams'
const tabs: { key: TabKey; label: string; icon: Component }[] = [
  { key: 'overview', label: 'Обзор', icon: Sparkles },
  { key: 'teams', label: 'Команды', icon: Users },
]
const activeTab = ref<TabKey>(route.query.tab === 'teams' ? 'teams' : 'overview')
watch(() => route.query.tab, (t) => { activeTab.value = t === 'teams' ? 'teams' : 'overview' })
function setTab(key: TabKey) {
  activeTab.value = key
  router.replace({ query: key === 'overview' ? {} : { tab: key } })
}

/** Section metadata: title + rules explanation. Widget rendered in the slot. */
const sections = [
  { key: 'huntpass', title: 'HuntPass — сезонный трек', rule: 'Сезон = календарный квартал. Копите очки сезона (SXP) за результаты — наймы, офферы, интервью, закрытые вакансии — и продвигаетесь по 30 тирам, забирая награды. SXP за найм умножается на грейд вакансии (Junior…Lead) и качество (доля принятых офферов). В конце сезона SXP обнуляется — свежий старт.' },
  { key: 'rank', title: 'Ранг и дивизионы', rule: 'Соревновательный рейтинг RP = объём × качество × скорость. Дивизионы Бронза→Легенда. Чтобы подняться — держите RP выше порога несколько недель подряд (промо-серия); при простое ранг мягко падает (decay). Новичок проходит калибровку. Награждает эффективность, а не только количество.' },
  { key: 'quests', title: 'Квесты дня', rule: 'Ежедневные (3) и недельные цели, направляющие на приоритетные действия: быстрый ответ, разбор входящих, продвижение по воронке. Выполнение даёт SXP и монеты. В наборе всегда есть «качественный» квест. Обновляются каждый день/неделю.' },
  { key: 'league', title: 'Лига команд', rule: 'Рекрутеры объединяются в команды (создаются во вкладке «Команды»). Лига считается по среднему RP на участника — честно к размеру команды. Соревнование команд за сезон.' },
  { key: 'duels', title: 'Дуэли 1v1', rule: 'Вызовите коллегу на недельную дуэль по метрике (наймы/офферы/интервью/продвижения). Кто наберёт больше за 7 дней — победил. Победитель получает бонус SXP и монеты. До 3 активных дуэлей.' },
  { key: 'referrals', title: 'Рефералы — передача кандидатов', rule: 'Кандидат не подходит вам, но полезен коллеге? Передайте его (кнопка «Передать» в карточке кандидата). Если коллега примет и в итоге наймёт — вы получите ассист: SXP + монеты + прогресс ачивки «Командный игрок». Превращает отказы в наймы.' },
  { key: 'kudos', title: 'Kudos — признание коллег', rule: 'Поблагодарите коллегу за помощь (лимит 5 в неделю — чтобы признание было ценным). Получатель получает монеты и признание. За полученные kudos — ачивки «Признанный/Уважаемый/Душа команды».' },
  { key: 'shop', title: 'Монеты и магазин', rule: 'Монеты зарабатываются в квестах, дуэлях, за ассисты и тиры HuntPass. Тратятся в магазине на косметику: рамки аватара, титулы, акцентные цвета.' },
  { key: 'achievements', title: 'Достижения', rule: 'Вечные ачивки за накопленные результаты (наймы, офферы, интервью, стрики, скорость, кооперация). Дают XP и уровни. В отличие от сезонного HuntPass — не сбрасываются.' },
]
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
    <div class="mb-6 flex items-center gap-1 border-b border-surface-200 dark:border-surface-800">
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

    <!-- Overview: gamification widgets with rules -->
    <div v-show="activeTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <section v-for="s in sections" :key="s.key">
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
        <TeamLeagueWidget v-else-if="s.key === 'league'" />
        <DuelsWidget v-else-if="s.key === 'duels'" />
        <ReferralsWidget v-else-if="s.key === 'referrals'" />
        <KudosWidget v-else-if="s.key === 'kudos'" />
        <ShopWidget v-else-if="s.key === 'shop'" />
        <AchievementsWidget v-else-if="s.key === 'achievements'" />
      </section>
    </div>

    <!-- Teams: management moved here from the former «Команды» tab -->
    <div v-show="activeTab === 'teams'" class="max-w-3xl">
      <p class="mb-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-surface-500 dark:text-surface-400">
        <Info class="size-3.5 shrink-0 mt-0.5 text-brand-400" />
        <span>Команды рекрутеров для лиги. Лига считается по среднему RP на участника — честно к размеру команды. Здесь же настраиваются еженедельные MVP-пуши в Telegram.</span>
      </p>
      <TeamsManager />
    </div>
  </div>
</template>
