<script setup lang="ts">
import { ShoppingBag, Coins, Check } from 'lucide-vue-next'

useSeoMeta({ title: 'Магазин', description: 'Магазин косметики за монеты' })

interface Item {
  key: string; type: string; name: string; description: string
  cost: number; value: string; icon: string; owned: boolean; equipped: boolean
}
interface ShopResponse { balance: number; items: Item[] }

const { data, refresh } = useFetch<ShopResponse>('/api/shop', { headers: useRequestHeaders(['cookie']) })
const toast = useToast()
const busy = ref<string | null>(null)

const balance = computed(() => data.value?.balance ?? 0)
const groups = computed(() => {
  const items = data.value?.items ?? []
  return [
    { type: 'frame', label: 'Рамки аватара', items: items.filter(i => i.type === 'frame') },
    { type: 'title', label: 'Титулы', items: items.filter(i => i.type === 'title') },
    { type: 'accent', label: 'Акцентные цвета', items: items.filter(i => i.type === 'accent') },
  ]
})

async function buy(item: Item) {
  busy.value = item.key
  try {
    await $fetch('/api/shop/purchase', { method: 'POST', body: { key: item.key } })
    toast.success(`Куплено: ${item.name}`)
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Не удалось купить') }
  finally { busy.value = null }
}
async function equip(item: Item) {
  busy.value = item.key
  try {
    await $fetch('/api/shop/equip', { method: 'POST', body: { key: item.key, equip: !item.equipped } })
    await refresh()
  } catch (e: any) { toast.error(e?.data?.statusMessage || 'Ошибка') }
  finally { busy.value = null }
}
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold text-surface-900 dark:text-surface-50 flex items-center gap-2">
          <ShoppingBag class="size-5 text-brand-500" /> Магазин
        </h1>
        <p class="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Косметика за монеты, заработанные в квестах, дуэлях и HuntPass.</p>
      </div>
      <div class="flex items-center gap-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-amber-700 dark:text-amber-400 font-semibold">
        <Coins class="size-4" /> {{ balance }}
      </div>
    </div>

    <div v-if="data" class="space-y-6">
      <section v-for="g in groups" :key="g.type">
        <h2 class="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">{{ g.label }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div v-for="item in g.items" :key="item.key" class="rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4 flex flex-col">
            <!-- Preview -->
            <div class="flex items-center justify-center h-16 mb-2">
              <div v-if="item.type === 'frame'" class="size-12 rounded-full p-[3px]" :style="{ background: item.value }">
                <div class="size-full rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-lg">{{ item.icon }}</div>
              </div>
              <div v-else-if="item.type === 'accent'" class="size-10 rounded-lg" :style="{ backgroundColor: item.value }" />
              <span v-else class="text-sm font-semibold px-2 py-1 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300">{{ item.value }}</span>
            </div>
            <p class="text-xs font-medium text-surface-900 dark:text-surface-100 text-center truncate">{{ item.name }}</p>
            <div class="mt-auto pt-2">
              <button
                v-if="!item.owned"
                type="button"
                :disabled="busy === item.key || balance < item.cost"
                class="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-1.5"
                @click="buy(item)"
              >
                <Coins class="size-3" /> {{ item.cost }}
              </button>
              <button
                v-else
                type="button"
                :disabled="busy === item.key"
                class="w-full inline-flex items-center justify-center gap-1 rounded-lg text-xs py-1.5 border"
                :class="item.equipped ? 'border-success-400 text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-950/30' : 'border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800'"
                @click="equip(item)"
              >
                <Check v-if="item.equipped" class="size-3" /> {{ item.equipped ? 'Надето' : 'Надеть' }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
