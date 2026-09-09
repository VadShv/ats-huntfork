<script setup lang="ts">
/**
 * Центр аналитики: единая client-only обёртка над ECharts.
 *
 * .client — ECharts трогает DOM/canvas и не должен рендериться на сервере
 * (иначе hydration-ошибки). Импорты tree-shakeable через echarts/core,
 * регистрируем только нужные charts/компоненты (Canvas renderer — без eval,
 * совместимо с nonce-CSP без unsafe-eval / worker-src).
 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  LineChart,
  BarChart,
  SankeyChart,
  HeatmapChart,
  PieChart,
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  TitleComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import type { EChartsOption } from 'echarts'

use([
  CanvasRenderer,
  LineChart,
  BarChart,
  SankeyChart,
  HeatmapChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  TitleComponent,
])

const props = withDefaults(defineProps<{
  /** Готовые опции ECharts (уже с применённой темой через baseCartesianOption). */
  option: EChartsOption
  /** Высота контейнера (число px или CSS-строка). */
  height?: number | string
  /** Показывать оверлей загрузки. */
  loading?: boolean
  /** Автообновление размера при ресайзе контейнера. */
  autoresize?: boolean
}>(), {
  height: 320,
  loading: false,
  autoresize: true,
})

const { isDark } = useColorMode()

const heightStyle = computed(() =>
  typeof props.height === 'number' ? `${props.height}px` : props.height,
)

const loadingOptions = computed(() => ({
  text: '',
  color: '#6366f1',
  maskColor: isDark.value ? 'rgba(24,24,27,0.5)' : 'rgba(255,255,255,0.6)',
}))
</script>

<template>
  <div :style="{ height: heightStyle, width: '100%' }">
    <VChart
      :option="option"
      :loading="loading"
      :loading-options="loadingOptions"
      :autoresize="autoresize"
    />
  </div>
</template>
