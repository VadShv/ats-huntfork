<script setup lang="ts">
import { computed } from 'vue'
import { ref } from 'vue'
import HfButton from '../ui/HfButton.vue'
import HfChip from '../ui/HfChip.vue'
import HfEmpty from '../ui/HfEmpty.vue'
import HfIcon from '../ui/HfIcon.vue'
import { useSidekick, useSidekickActions } from '../composables/useSidekick'
import { useDedup } from '../composables/useDedup'
import ProfileDiff from './ProfileDiff.vue'
import QueuePanel from '../layout/QueuePanel.vue'
import SearchMapView from './SearchMapView.vue'

const {
  phase, errorMsg, currentUrl, resumeId, isHhPage, isListPage, canCapture, isPdfPage,
  currentSite, currentSiteLabel, lookupInfo, jobs, selectedJobId,
  importing, capturing, captureStep, saving, parsedFull, capMeta, capDupes,
  savedInfo, existsInfo, forceAvailable, blockedExact,
  dFirstName, dLastName, dTitle, dCity, dEmail, dPhone, dTelegram,
  dLinkedin, dGithub, dAbout, dSkills, dSkillsList, candInitials,
  HUNTFORK_BASE,
} = useSidekick()
const {
  refresh, doImport, openHuntfork, startCapture, saveDraft, cancelDraft,
  capturePdf, summarizePdf, fmtDate,
} = useSidekickActions()

const { fieldMatches, fieldClass } = useDedup()

const isBusy = computed(() => importing.value || capturing.value || saving.value)

/** Внутренний подраздел Sourcing: «Захват» (по умолчанию) или «Карта поиска». */
const sourcingTab = ref<'capture' | 'map'>('capture')
</script>

<template>
  <div class="sourcing-view hf-scroll">
    <!-- Подраздел: Захват / Карта поиска -->
    <div class="src-subtabs">
      <button class="src-subtab" :class="{ 'src-subtab--active': sourcingTab === 'capture' }" @click="sourcingTab = 'capture'">
        <HfIcon name="sourcing" :size="14" /> Захват
      </button>
      <button class="src-subtab" :class="{ 'src-subtab--active': sourcingTab === 'map' }" @click="sourcingTab = 'map'">
        <HfIcon name="map" :size="14" /> Карта поиска
      </button>
    </div>

    <SearchMapView v-if="sourcingTab === 'map'" />
    <template v-else>
    <QueuePanel />

    <!-- Boot / checking -->
    <div v-if="phase === 'boot' || phase === 'checking'" class="src-loading">
      <span class="hf-pulse-orb" style="width:10px;height:10px;border-radius:50%;background:var(--hf-primary)" />
      <span>Проверяем…</span>
    </div>

    <!-- No session / error -->
    <HfEmpty v-else-if="phase === 'no-session'" icon="sourcing" title="Нужен вход в Huntfork"
      subtitle="Войдите на huntfork.ru — панель подхватит сессию автоматически."
      action-label="Открыть huntfork.ru" @action="openHuntfork()" />
    <div v-else-if="phase === 'error'" class="src-error hf-shake">
      <HfIcon name="refresh" :size="20" />
      <p>{{ errorMsg }}</p>
      <HfButton variant="ghost" size="sm" @click="refresh">Повторить</HfButton>
    </div>

    <!-- Idle: контекстная подсказка -->
    <div v-else-if="phase === 'idle'" class="src-idle">
      <template v-if="isListPage">
        <HfEmpty icon="sourcing" title="Список резюме"
          subtitle="Откройте резюме кандидата — панель проверит его и предложит импорт. Бейджи «В Huntfork» отображаются прямо в списке." />
      </template>
      <template v-else-if="isHhPage">
        <HfEmpty icon="sourcing" title="hh.ru"
          subtitle="Откройте страницу резюме (hh.ru/resume/…), чтобы добавить кандидата в Huntfork." />
      </template>
      <template v-else-if="canCapture">
        <!-- S6: уже в базе -->
        <div v-if="lookupInfo?.exists" class="lookup-banner">
          <HfIcon name="check" :size="18" />
          <span>Уже в базе: <strong>{{ lookupInfo.candidate?.name || 'Кандидат' }}</strong></span>
          <HfButton variant="ghost" size="sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${lookupInfo.candidate?.id}`)">Открыть</HfButton>
        </div>

       <template v-if="isPdfPage">
          <div class="hf-empty hf-empty-in src-pdf-empty">
            <svg class="hf-empty-ill" width="64" height="64" viewBox="0 0 64 64" fill="none"
              stroke="var(--hf-fg-subtle)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="26" cy="24" r="10" /><path d="M52 52l-12-12" />
              <path d="M14 52v-4a8 8 0 0 1 8-8h8" />
            </svg>
            <div class="hf-empty-title">PDF-документ</div>
            <p class="hf-empty-sub">Панель извлечёт текст из PDF и разберёт его как резюме либо подготовит сводку.</p>
            <div class="src-pdf-actions">
              <HfButton variant="primary" size="sm" @click="capturePdf">Импортировать</HfButton>
              <HfButton variant="ghost" size="sm" @click="summarizePdf">Сводка</HfButton>
            </div>
          </div>
       </template>
        <template v-else>
          <HfEmpty icon="sourcing" title="Импорт кандидата"
            :subtitle="`Сводка и импорт со ${currentSite === 'generic' ? 'страницы' : currentSiteLabel}. Выделите фрагмент текста — панель будет работать только с ним.`"
            action-label="Импортировать" @action="startCapture" />
        </template>
      </template>
      <HfEmpty v-else icon="sourcing" title="Источник не определён"
        subtitle="Откройте страницу резюме на hh.ru, LinkedIn, GitHub или PDF-документ." />
    </div>

    <!-- Capturing -->
    <div v-else-if="phase === 'capturing'" class="src-capturing">
      <HfIcon name="import" :size="24" />
      <p>{{ captureStep === 'parse' ? 'Разбираем резюме…' : 'Извлекаем контент…' }}</p>
    </div>

    <!-- Draft: форма -->
    <div v-else-if="phase === 'draft'" class="src-draft">
      <div class="draft-head">
        <div class="avatar">{{ candInitials }}</div>
        <div>
          <div class="draft-name">{{ [dFirstName, dLastName].filter(Boolean).join(' ') || 'Кандидат' }}</div>
          <div class="draft-src">{{ capMeta?.site }} · {{ capMeta?.sourceUrl }}</div>
        </div>
      </div>

      <!-- Дубли -->
      <div v-if="capDupes?.social?.length" class="dup-block dup-soft">
        <div class="dup-title">Совпадение профиля</div>
        <div v-for="(x, i) in capDupes.social" :key="'s'+i" class="dup-row">
          <span>{{ x.candidateName }}</span>
          <HfButton variant="ghost" size="sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</HfButton>
        </div>
      </div>
      <div v-if="capDupes?.fuzzy?.length" class="dup-block dup-soft">
        <div class="dup-title">Возможные дубли</div>
        <div v-for="(x, i) in capDupes.fuzzy" :key="'f'+i" class="dup-row">
          <span>{{ x.candidateName }} — {{ x.score }}%</span>
          <HfButton variant="ghost" size="sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</HfButton>
        </div>
      </div>

      <!-- Дифф профиля -->
      <ProfileDiff />

      <!-- Кандидат -->
      <section class="form-section">
        <div class="form-label">Кандидат</div>
        <div class="hf-field-wrap">
          <div class="form-grid">
            <input v-model="dFirstName" class="hf-input" :class="fieldClass('name')" placeholder="Имя">
            <input v-model="dLastName" class="hf-input" placeholder="Фамилия">
          </div>
          <div v-if="fieldMatches.name" class="hf-field-markers">
            <a
              v-for="(m, i) in fieldMatches.name"
              :key="i"
              class="hf-field-marker"
              :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined"
              target="_blank"
              rel="noopener"
              :title="m.candidateName ? `Открыть: ${m.candidateName}` : ''"
            >⚠ {{ m.label }}</a>
          </div>
        </div>
        <div class="form-grid">
          <input v-model="dTitle" class="hf-input" placeholder="Должность">
          <input v-model="dCity" class="hf-input" placeholder="Город">
        </div>
      </section>

      <!-- Контакты -->
      <section class="form-section">
        <div class="form-label">Контакты</div>
        <div class="hf-field-wrap">
          <input v-model="dPhone" class="hf-input" :class="fieldClass('phone')" placeholder="Телефон">
          <div v-if="fieldMatches.phone" class="hf-field-markers">
            <a v-for="(m, i) in fieldMatches.phone" :key="i" class="hf-field-marker" :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined" target="_blank" rel="noopener"
              :title="m.candidateName ? `Открыть: ${m.candidateName}` : ''">⚠ {{ m.label }}</a>
          </div>
        </div>
        <div class="hf-field-wrap">
          <input v-model="dEmail" class="hf-input" :class="fieldClass('email')" type="email" placeholder="Email">
          <div v-if="fieldMatches.email" class="hf-field-markers">
            <a v-for="(m, i) in fieldMatches.email" :key="i" class="hf-field-marker" :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined" target="_blank" rel="noopener"
              :title="m.candidateName ? `Открыть: ${m.candidateName}` : ''">⚠ {{ m.label }}</a>
          </div>
        </div>
        <div class="form-grid">
          <input v-model="dTelegram" class="hf-input" :class="fieldClass('telegram')" placeholder="@telegram">
          <input v-model="dLinkedin" class="hf-input" :class="fieldClass('linkedin')" placeholder="linkedin.com/in/…">
        </div>
        <div class="hf-field-wrap">
          <div v-if="fieldMatches.telegram || fieldMatches.linkedin" class="hf-field-markers">
            <a v-for="(m, i) in fieldMatches.telegram" :key="'tg'+i" class="hf-field-marker" :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined" target="_blank" rel="noopener">⚠ {{ m.label }}</a>
            <a v-for="(m, i) in fieldMatches.linkedin" :key="'li'+i" class="hf-field-marker" :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined" target="_blank" rel="noopener">⚠ {{ m.label }}</a>
          </div>
        </div>
        <div class="hf-field-wrap">
          <input v-model="dGithub" class="hf-input" :class="fieldClass('github')" placeholder="github.com/…">
          <div v-if="fieldMatches.github" class="hf-field-markers">
            <a v-for="(m, i) in fieldMatches.github" :key="i" class="hf-field-marker" :class="`hf-field-marker--${m.kind}`"
              :href="m.candidateId ? `${HUNTFORK_BASE}/dashboard/candidates/${m.candidateId}` : undefined" target="_blank" rel="noopener">⚠ {{ m.label }}</a>
          </div>
        </div>
      </section>

      <!-- Навыки -->
      <section class="form-section">
        <div class="form-label">Навыки</div>
        <div v-if="dSkillsList.length" class="tags">
          <HfChip v-for="(s, i) in dSkillsList" :key="i">{{ s }}</HfChip>
        </div>
        <input v-model="dSkills" class="hf-input" placeholder="Python, SQL, Docker">
      </section>

      <!-- Опыт -->
      <section v-if="parsedFull?.experience?.length" class="form-section">
        <div class="form-label">Опыт ({{ parsedFull.experience.length }})</div>
        <div class="exp-timeline">
          <div v-for="(e, i) in parsedFull.experience.slice(0, 5)" :key="i" class="exp-item">
            <div class="exp-dot" />
            <div>
              <div class="exp-position">{{ e.position || '—' }}</div>
              <div v-if="e.company" class="exp-company">{{ e.company }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- О кандидате -->
      <section class="form-section">
        <div class="form-label">О кандидате</div>
        <textarea v-model="dAbout" class="hf-input hf-textarea" rows="3" placeholder="Краткое описание" />
      </section>

      <!-- Вакансия -->
      <section class="form-section">
        <div class="form-label">Вакансия</div>
        <select v-model="selectedJobId" class="hf-input">
          <option value="">— Без привязки —</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}</option>
        </select>
      </section>

      <!-- Блокирующие дубли -->
      <div v-if="blockedExact.length" class="dup-block dup-hard">
        <div class="dup-title">Импорт заблокирован</div>
        <div v-for="(x, i) in blockedExact" :key="i" class="dup-row">
          <span>{{ x.candidateName }} — {{ x.kind }} уже в базе</span>
          <HfButton variant="ghost" size="sm" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${x.candidateId}`)">Открыть</HfButton>
        </div>
      </div>

      <div v-if="errorMsg" class="flash-err">{{ errorMsg }}</div>

      <div class="form-actions">
        <HfButton variant="primary" :disabled="saving" @click="saveDraft(forceAvailable)">
          {{ saving ? 'Импортируем…' : (forceAvailable ? 'Импортировать всё равно' : 'Импортировать') }}
        </HfButton>
        <HfButton variant="ghost" :disabled="saving" @click="cancelDraft">Назад</HfButton>
      </div>
    </div>

    <!-- Saved -->
    <div v-else-if="phase === 'saved'" class="src-saved">
      <div class="saved-icon"><HfIcon name="check" :size="32" /></div>
      <div class="saved-name">{{ savedInfo?.candidateName || 'Кандидат' }}</div>
      <div class="saved-sub">добавлен в базу</div>
      <div v-if="savedInfo?.applicationCreated" class="saved-hint">Создана заявка на вакансию</div>
      <HfButton variant="primary" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${savedInfo?.candidateId}`)">Открыть карточку</HfButton>
      <HfButton variant="ghost" @click="cancelDraft">Готово</HfButton>
    </div>

    <!-- Exists (hh) -->
    <div v-else-if="phase === 'exists'" class="src-exists">
      <div class="saved-icon"><HfIcon name="check" :size="32" /></div>
      <div class="saved-name">{{ existsInfo?.candidateName || 'Кандидат' }}</div>
      <div class="saved-sub">в базе с {{ fmtDate(existsInfo?.addedAt) }}</div>
      <div v-if="existsInfo?.applications?.length" class="apps">
        <div v-for="a in existsInfo.applications" :key="a.jobTitle" class="app-row">
          <span>{{ a.jobTitle }}</span>
          <HfChip v-if="a.currentStageName">{{ a.currentStageName }}</HfChip>
        </div>
      </div>
      <HfButton variant="primary" @click="openHuntfork(`${HUNTFORK_BASE}/dashboard/candidates/${existsInfo?.candidateId}`)">Открыть карточку</HfButton>
      <ProfileDiff />
    </div>

    <!-- New (hh) -->
    <div v-else-if="phase === 'new'" class="src-new">
      <HfEmpty icon="sourcing" title="Импорт с hh.ru"
        subtitle="Резюме будет загружено через официальный API и сохранено в базе."
        action-label="Импортировать" @action="doImport" />
      <div v-if="jobs.length" class="form-section">
        <div class="form-label">Вакансия</div>
        <select v-model="selectedJobId" class="hf-input">
          <option value="">— Без привязки —</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.title }}{{ j.status !== 'open' ? ` (${j.status})` : '' }}</option>
        </select>
      </div>
      <div v-if="errorMsg" class="flash-err">{{ errorMsg }}</div>
    </div>
    </template>
  </div>
</template>

<script lang="ts">
export default { name: 'SourcingView' }
</script>

<style scoped>
.sourcing-view { height: 100%; overflow-y: auto; padding: var(--hf-s-4); }
.src-subtabs { display: flex; gap: var(--hf-s-1); margin-bottom: var(--hf-s-4); padding: var(--hf-s-1); background: var(--hf-surface-sunken); border-radius: var(--hf-r-md); }
.src-subtab { display: inline-flex; align-items: center; gap: var(--hf-s-1); padding: var(--hf-s-1) var(--hf-s-3); border-radius: var(--hf-r-sm); font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); color: var(--hf-fg-muted); transition: background var(--hf-dur-fast) var(--hf-ease-out), color var(--hf-dur-fast) var(--hf-ease-out); }
.src-subtab:hover { color: var(--hf-fg); }
.src-subtab--active { background: var(--hf-surface); color: var(--hf-primary); box-shadow: var(--hf-shadow-sm); }
.src-loading, .src-capturing { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--hf-s-3); padding: var(--hf-s-8); color: var(--hf-fg-muted); font-size: var(--hf-t-sm); }
.src-error { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-6); text-align: center; color: var(--hf-err); }
.src-idle { height: 100%; display: flex; flex-direction: column; }

.lookup-banner { display: flex; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-3); background: var(--hf-ok-muted); border-radius: var(--hf-r-lg); color: var(--hf-ok); margin-bottom: var(--hf-s-4); font-size: var(--hf-t-sm); }

.draft-head { display: flex; align-items: center; gap: var(--hf-s-3); margin-bottom: var(--hf-s-4); }
.avatar { width: 40px; height: 40px; border-radius: var(--hf-r-pill); background: var(--hf-primary-muted); color: var(--hf-primary); display: flex; align-items: center; justify-content: center; font-weight: var(--hf-fw-semibold); flex-shrink: 0; }
.draft-name { font-weight: var(--hf-fw-semibold); font-size: var(--hf-t-md); }
.draft-src { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }

.dup-block { border-radius: var(--hf-r-md); padding: var(--hf-s-3); margin-bottom: var(--hf-s-3); }
.dup-soft { background: var(--hf-warn-muted); }
.dup-hard { background: var(--hf-err-muted); }
.dup-title { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); margin-bottom: var(--hf-s-2); }
.dup-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-2); font-size: var(--hf-t-sm); padding: var(--hf-s-1) 0; }

.form-section { margin-bottom: var(--hf-s-4); }
.form-label { font-size: var(--hf-t-xs); font-weight: var(--hf-fw-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--hf-fg-muted); margin-bottom: var(--hf-s-2); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--hf-s-2); }
.tags { display: flex; flex-wrap: wrap; gap: var(--hf-s-1); margin-bottom: var(--hf-s-2); }

.exp-timeline { display: flex; flex-direction: column; gap: var(--hf-s-3); }
.exp-item { display: flex; gap: var(--hf-s-3); }
.exp-dot { width: 8px; height: 8px; border-radius: var(--hf-r-pill); background: var(--hf-primary); margin-top: 6px; flex-shrink: 0; }
.exp-position { font-size: var(--hf-t-sm); font-weight: var(--hf-fw-medium); }
.exp-company { font-size: var(--hf-t-xs); color: var(--hf-fg-muted); }

.form-actions { display: flex; flex-direction: column; gap: var(--hf-s-2); margin-top: var(--hf-s-4); }

.src-saved, .src-exists { display: flex; flex-direction: column; align-items: center; gap: var(--hf-s-2); padding: var(--hf-s-8); text-align: center; }
.saved-icon { width: 64px; height: 64px; border-radius: var(--hf-r-pill); background: var(--hf-ok-muted); color: var(--hf-ok); display: flex; align-items: center; justify-content: center; margin-bottom: var(--hf-s-2); }
.saved-name { font-size: var(--hf-t-lg); font-weight: var(--hf-fw-semibold); }
.saved-sub { font-size: var(--hf-t-sm); color: var(--hf-fg-muted); }
.saved-hint { font-size: var(--hf-t-xs); color: var(--hf-fg-subtle); }
.apps { width: 100%; display: flex; flex-direction: column; gap: var(--hf-s-2); margin: var(--hf-s-3) 0; }
.app-row { display: flex; align-items: center; justify-content: space-between; gap: var(--hf-s-2); padding: var(--hf-s-2); background: var(--hf-surface-sunken); border-radius: var(--hf-r-md); font-size: var(--hf-t-sm); }

.flash-err { padding: var(--hf-s-2) var(--hf-s-3); background: var(--hf-err-muted); color: var(--hf-err); border-radius: var(--hf-r-md); font-size: var(--hf-t-sm); margin-top: var(--hf-s-2); }
</style>
<style>
.src-pdf-empty .src-pdf-actions { display: flex; gap: var(--hf-s-2); margin-top: var(--hf-s-2); }
</style>
