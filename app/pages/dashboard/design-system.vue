<script setup lang="ts">
/**
 * Huntfork UI · Дизайн-система Showcase
 *
 * Внутренняя витрина базовых компонентов и токенов. Используется для:
 *  - визуальной регрессии (один взгляд — и видно, всё ли консистентно)
 *  - быстрого ознакомления новых разработчиков
 *  - отладки тёмной темы
 *
 * Доступно по адресу /dashboard/_design-system
 * (страница начинается с `_` — не индексируется и не попадает в навигацию)
 */
import { ref } from 'vue'
import { Mail, Search, User, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard',
  middleware: ['auth', 'require-org'],
})

useHead({ title: () => 'Design System — Huntfork' })

// State
const inputVal = ref('')
const inputErrorVal = ref('bad@')
const selectVal = ref<string | null>(null)
const showModal = ref(false)
const showDrawer = ref(false)

const fruitOptions = [
  { label: 'Активна', value: 'active' },
  { label: 'На паузе', value: 'paused' },
  { label: 'Закрыта', value: 'closed' },
]
</script>

<template>
  <div class="space-y-10 max-w-6xl">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold text-surface-900 dark:text-surface-100">
        Huntfork UI · Дизайн-система
      </h1>
      <p class="text-sm text-surface-500 dark:text-surface-400">
        Витрина токенов и базовых компонентов. Все компоненты доступны как
        <code class="px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-800 text-xs">&lt;UiButton&gt;</code>,
        <code class="px-1 py-0.5 rounded bg-surface-100 dark:bg-surface-800 text-xs">&lt;UiInput&gt;</code>
        и т.д. — без импорта.
      </p>
    </header>

    <!-- ====== Цветовые токены ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">
        Цветовые токены
      </h2>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div v-for="tone in ['brand', 'accent', 'success', 'warning', 'danger', 'info', 'surface']" :key="tone">
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-1.5 capitalize">{{ tone }}</p>
          <div class="flex flex-col rounded-lg overflow-hidden border border-surface-200 dark:border-surface-800">
            <div
              v-for="step in [100, 300, 500, 700, 900]"
              :key="step"
              :class="`bg-${tone}-${step}`"
              class="h-8 flex items-center px-2 text-[10px] font-mono"
              :style="step >= 500 ? 'color: white' : 'color: #111'"
            >
              {{ tone }}-{{ step }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ====== UiButton ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiButton</h2>

      <div class="space-y-4">
        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Варианты</p>
          <div class="flex flex-wrap gap-2">
            <UiButton variant="primary">Основная</UiButton>
            <UiButton variant="secondary">Вторичная</UiButton>
            <UiButton variant="outline">Контурная</UiButton>
            <UiButton variant="ghost">Прозрачная</UiButton>
            <UiButton variant="danger">Опасная</UiButton>
            <UiButton variant="success">Успех</UiButton>
          </div>
        </div>

        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Размеры</p>
          <div class="flex flex-wrap items-center gap-2">
            <UiButton size="xs">XS</UiButton>
            <UiButton size="sm">SM</UiButton>
            <UiButton size="md">MD</UiButton>
            <UiButton size="lg">LG</UiButton>
          </div>
        </div>

        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Состояния</p>
          <div class="flex flex-wrap gap-2">
            <UiButton :icon-left="Mail">С иконкой</UiButton>
            <UiButton loading>Загрузка</UiButton>
            <UiButton disabled>Заблокировано</UiButton>
            <UiButton block>На всю ширину</UiButton>
          </div>
        </div>
      </div>
    </section>

    <!-- ====== UiInput ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiInput</h2>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <UiInput
          v-model="inputVal"
          label="Имя"
          placeholder="Иван Петров"
          :icon-left="User"
          hint="Как обращаться к кандидату"
        />
        <UiInput
          v-model="inputErrorVal"
          label="Email"
          type="email"
          :icon-left="Mail"
          error-message="Некорректный email"
        />
        <UiInput
          label="Поиск"
          placeholder="Найти вакансию…"
          :icon-left="Search"
          size="sm"
        />
        <UiInput
          label="Большой инпут"
          placeholder="Введите текст"
          size="lg"
        />
        <UiInput
          label="Заблокировано"
          placeholder="—"
          disabled
        />
        <UiInput
          label="Загрузка"
          loading
          placeholder="Идёт сохранение…"
        />
      </div>
    </section>

    <!-- ====== UiSelect ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiSelect</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
        <UiSelect
          v-model="selectVal"
          label="Статус вакансии"
          placeholder="Выберите…"
          :options="fruitOptions"
          clearable
        />
        <UiSelect
          label="Маленький"
          size="sm"
          placeholder="—"
          :options="['Москва', 'СПб', 'Казань']"
        />
        <UiSelect
          label="С ошибкой"
          placeholder="—"
          :options="fruitOptions"
          error-message="Обязательное поле"
        />
      </div>
    </section>

    <!-- ====== UiBadge ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiBadge</h2>
      <div class="space-y-4">
        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Мягкий (по умолчанию)</p>
          <div class="flex flex-wrap gap-2">
            <UiBadge tone="neutral">Нейтральный</UiBadge>
            <UiBadge tone="brand">Бренд</UiBadge>
            <UiBadge tone="success" :icon="CheckCircle2">Успех</UiBadge>
            <UiBadge tone="warning" :icon="AlertTriangle">Внимание</UiBadge>
            <UiBadge tone="danger">Ошибка</UiBadge>
            <UiBadge tone="info" :icon="Info">Инфо</UiBadge>
            <UiBadge tone="accent">Акцент</UiBadge>
          </div>
        </div>
        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Заливка / Контур</p>
          <div class="flex flex-wrap gap-2">
            <UiBadge variant="solid" tone="brand">Заливка, брендовый</UiBadge>
            <UiBadge variant="solid" tone="success">Заливка, успех</UiBadge>
            <UiBadge variant="outline" tone="brand">Контур, брендовый</UiBadge>
            <UiBadge variant="outline" tone="danger">Контур, опасность</UiBadge>
          </div>
        </div>
        <div>
          <p class="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">С точкой / удаляемый / размер md</p>
          <div class="flex flex-wrap gap-2 items-center">
            <UiBadge dot tone="success">Активен</UiBadge>
            <UiBadge dot tone="warning">На паузе</UiBadge>
            <UiBadge dot tone="danger">Закрыта</UiBadge>
            <UiBadge size="md" tone="brand" removable>Тег</UiBadge>
          </div>
        </div>
      </div>
    </section>

    <!-- ====== UiCard ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiCard</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UiCard>
          <h3 class="font-semibold text-surface-900 dark:text-surface-100">Обычная</h3>
          <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">Базовая карточка с рамкой и фоном.</p>
        </UiCard>
        <UiCard variant="elevated">
          <h3 class="font-semibold text-surface-900 dark:text-surface-100">С тенью</h3>
          <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">Без рамки, с тенью.</p>
        </UiCard>
        <UiCard variant="dashed" tone="brand">
          <h3 class="font-semibold text-surface-900 dark:text-surface-100">Пунктир (пустое состояние)</h3>
          <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">Пунктирная рамка, для пустых состояний.</p>
        </UiCard>
        <UiCard variant="tinted" tone="warning">
          <h3 class="font-semibold text-warning-700 dark:text-warning-300">С оттенком предупреждения</h3>
          <p class="text-sm text-warning-600 dark:text-warning-400 mt-1">Заливка под предупреждение.</p>
        </UiCard>
        <UiCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h3 class="font-semibold text-surface-900 dark:text-surface-100">С header + footer</h3>
              <UiBadge tone="success" dot>Onlайн</UiBadge>
            </div>
          </template>
          <p class="text-sm text-surface-700 dark:text-surface-300">Контент карточки.</p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UiButton variant="ghost" size="sm">Отмена</UiButton>
              <UiButton size="sm">Сохранить</UiButton>
            </div>
          </template>
        </UiCard>
      </div>
    </section>

    <!-- ====== UiModal / UiDrawer ====== -->
    <section>
      <h2 class="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-4">UiModal / UiDrawer</h2>
      <div class="flex flex-wrap gap-2">
        <UiButton @click="showModal = true">Открыть Modal</UiButton>
        <UiButton variant="outline" @click="showDrawer = true">Открыть Drawer</UiButton>
      </div>

      <UiModal v-model="showModal" title="Подтверждение" description="Пример диалога с фокус-трапом и закрытием на ESC.">
        <p class="text-sm text-surface-700 dark:text-surface-300">
          Содержимое модального окна. Попробуйте Tab — фокус циклически перемещается внутри.
        </p>
        <UiInput class="mt-3" label="Email" placeholder="you@example.com" :icon-left="Mail" />
        <template #footer>
          <UiButton variant="ghost" @click="showModal = false">Отмена</UiButton>
          <UiButton @click="showModal = false">Подтвердить</UiButton>
        </template>
      </UiModal>

      <UiDrawer v-model="showDrawer" title="Боковая панель" description="Пример Drawer справа.">
        <p class="text-sm text-surface-700 dark:text-surface-300">
          Здесь может быть карточка кандидата, форма редактирования и т.п.
        </p>
        <template #footer>
          <UiButton variant="ghost" @click="showDrawer = false">Закрыть</UiButton>
          <UiButton @click="showDrawer = false">Готово</UiButton>
        </template>
      </UiDrawer>
    </section>
  </div>
</template>
