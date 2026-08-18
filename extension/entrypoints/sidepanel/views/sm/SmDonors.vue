<script setup lang="ts">
/** SmDonors — секция «Компании-доноры» (блок 1 спецификации).
 *  Раскрываемые карточки с тиром, продуктами, стеком, географией,
 *  сигналами момента, риском, ожидаемым грейдом. Действие «Исключить». */
import { ref } from 'vue'
import HfChip from '../../ui/HfChip.vue'
import HfIcon from '../../ui/HfIcon.vue'
import { useSearchMap, type Donor } from '../../composables/useSearchMap'

const { visibleDonors, excludedDonors, excludeDonor, restoreDonor, TIER_META } = useSearchMap()
const openId = ref<string | null>(null)

function toggle(id: string) {
  openId.value = openId.value === id ? null : id
}
</script>

<template>
  <div class="sm-donors">
    <div
      v-for="(d, i) in visibleDonors"
      :key="d.id"
      class="sm-donor hf-cascade"
      :class="{ 'sm-donor--open': openId === d.id }"
      :style="{ '--hf-i': Math.min(i, 7), '--tier-color': TIER_META[d.tier].color, '--tier-muted': TIER_META[d.tier].muted }"
    >
      <button class="sm-donor-head" @click="toggle(d.id)">
        <span class="sm-donor-stripe" />
        <HfIcon name="building" :size="16" class="sm-donor-icon" />
        <span class="sm-donor-name">{{ d.name }}</span>
        <span class="sm-donor-tier">{{ TIER_META[d.tier].label }}</span>
        <span class="sm-donor-count" :title="`Найдено: ${d.foundCount}, откликнулись: ${d.responseCount}`">{{ d.foundCount }}</span>
        <HfIcon :name="openId === d.id ? 'chevron-up' : 'chevron-down'" :size="14" class="sm-donor-chev" />
      </button>

      <Transition name="sm-accordion">
        <div v-if="openId === d.id" class="sm-donor-body">
          <div class="sm-donor-grid">
            <div class="sm-field">
              <div class="sm-field-label">Обоснование</div>
              <p class="sm-field-text">{{ d.justification }}</p>
            </div>
            <div class="sm-field">
              <div class="sm-field-label">Продукты и проекты</div>
              <div class="sm-chips"><HfChip v-for="p in d.products" :key="p">{{ p }}</HfChip></div>
            </div>
            <div class="sm-field">
              <div class="sm-field-label">Внутренние названия ролей</div>
              <div class="sm-chips"><HfChip v-for="r in d.internalRoles" :key="r" tone="primary">{{ r }}</HfChip></div>
            </div>
            <div class="sm-field">
              <div class="sm-field-label">Технологический стек</div>
              <div class="sm-chips"><HfChip v-for="t in d.techStack" :key="t" tone="high">{{ t }}</HfChip></div>
            </div>
            <div class="sm-field">
              <div class="sm-field-label">География</div>
              <div class="sm-chips"><span v-for="g in d.geography" :key="g" class="sm-geo">{{ g }}</span></div>
            </div>
            <div class="sm-field sm-field--full">
              <div class="sm-field-label">Культурная близость</div>
              <p class="sm-field-text">{{ d.culturalFit }}</p>
            </div>
            <div class="sm-field" v-if="d.timingSignals.length">
              <div class="sm-field-label">Сигналы момента</div>
              <ul class="sm-list">
                <li v-for="s in d.timingSignals" :key="s">{{ s }}</li>
              </ul>
            </div>
            <div class="sm-field">
              <div class="sm-field-label sm-field-label--risk">Риск</div>
              <p class="sm-field-text sm-field-text--risk">{{ d.risk }}</p>
            </div>
            <div class="sm-field">
              <div class="sm-field-label">Ожидаемый уровень</div>
              <p class="sm-field-text sm-field-text--grade">{{ d.expectedGrade }}</p>
            </div>
          </div>
          <div class="sm-donor-stats">
            <span class="sm-stat">Найдено: <strong>{{ d.foundCount }}</strong></span>
            <span class="sm-stat">Откликнулись: <strong>{{ d.responseCount }}</strong></span>
          </div>
          <button class="sm-donor-exclude" @click="excludeDonor(d.id)">
            <HfIcon name="ban" :size="14" /> Исключить донора
          </button>
        </div>
      </Transition>
    </div>

    <div v-if="excludedDonors.length" class="sm-donors-excluded">
      <div class="sm-donors-excluded-title">Исключённые ({{ excludedDonors.length }})</div>
      <div class="sm-donors-excluded-list">
        <button v-for="d in excludedDonors" :key="d.id" class="sm-donor-excluded" @click="restoreDonor(d.id)" :title="`Вернуть ${d.name}`">
          {{ d.name }} <HfIcon name="refresh" :size="12" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sm-donors { display: flex; flex-direction: column; gap: var(--hf-s-2); }
.sm-donor {
  position: relative;
  border: 1px solid var(--hf-border);
  border-radius: var(--hf-r-md);
  background: var(--hf-surface);
  overflow: hidden;
}
.sm-donor-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tier-color); }
.sm-donor-head {
  display: flex; align-items: center; gap: var(--hf-s-2);
  width: 100%; padding: var(--hf-s-3) var(--hf-s-3) var(--hf-s-3) var(--hf-s-4);
  background: var(--hf-surface-raised);
  color: var(--hf-fg);
  font-size: var(--hf-t-sm);
  text-align: left;
  transition: background var(--hf-dur-fast) var(--hf-ease-out);
}
.sm-donor-head:hover { background: var(--hf-surface-sunken); }
.sm-donor-icon { color: var(--tier-color); flex-shrink: 0; }
.sm-donor-name { font-weight: var(--hf-fw-semibold); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-donor-tier { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); flex-shrink: 0; }
.sm-donor-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 6px;
  border-radius: var(--hf-r-pill);
  background: var(--tier-muted); color: var(--tier-color);
  font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold);
  flex-shrink: 0;
}
.sm-donor-chev { color: var(--hf-fg-subtle); flex-shrink: 0; }

.sm-donor-body { padding: var(--hf-s-3) var(--hf-s-4); border-top: 1px solid var(--hf-border); }
.sm-donor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-3) var(--hf-s-4); }
.sm-field { min-width: 0; }
.sm-field--full { grid-column: 1 / -1; }
.sm-field-label { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); margin-bottom: var(--hf-s-1); }
.sm-field-label--risk { color: var(--hf-warn); }
.sm-field-text { font-size: var(--hf-t-sm); line-height: var(--hf-lh-normal); color: var(--hf-fg); margin: 0; }
.sm-field-text--risk { color: var(--hf-warn); }
.sm-field-text--grade { font-weight: var(--hf-fw-medium); }
.sm-chips { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.sm-geo { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.sm-geo:not(:last-child)::after { content: '·'; margin-left: var(--hf-s-1); }
.sm-list { margin: 0; padding-left: var(--hf-s-4); font-size: var(--hf-t-sm); color: var(--hf-fg-muted); line-height: var(--hf-lh-normal); }
.sm-donor-stats { display: flex; gap: var(--hf-s-4); margin-top: var(--hf-s-3); padding-top: var(--hf-s-3); border-top: 1px solid var(--hf-border); }
.sm-stat { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }
.sm-stat strong { color: var(--hf-fg); }
.sm-donor-exclude {
  display: inline-flex; align-items: center; gap: var(--hf-s-1);
  margin-top: var(--hf-s-3); padding: var(--hf-s-1) var(--hf-s-3);
  border-radius: var(--hf-r-sm);
  font-size: var(--hf-t-xs); color: var(--hf-fg-subtle);
  transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out);
}
.sm-donor-exclude:hover { background: var(--hf-err-muted); color: var(--hf-err); }

.sm-donors-excluded { margin-top: var(--hf-s-3); padding: var(--hf-s-2); border-radius: var(--hf-r-md); background: var(--hf-surface-sunken); }
.sm-donors-excluded-title { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); margin-bottom: var(--hf-s-1); }
.sm-donors-excluded-list { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); }
.sm-donor-excluded { display: inline-flex; align-items: center; gap: 3px; font-size: var(--hf-t-xs); padding: 2px var(--hf-s-2); border-radius: var(--hf-r-pill); color: var(--hf-fg-subtle); opacity: 0.7; transition: opacity var(--hf-dur-fast); }
.sm-donor-excluded:hover { opacity: 1; color: var(--hf-primary); }

.sm-accordion-enter-active, .sm-accordion-leave-active { transition: opacity var(--hf-dur-fast) var(--hf-ease-out); overflow: hidden; }
.sm-accordion-enter-from, .sm-accordion-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .sm-donor { animation: none !important; } }
</style>
