// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";
import { readEnvFlagOverrides } from "./shared/feature-flags";

const railwayEnvironmentName =
  process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() ?? "";
const railwayPublicDomain =
  process.env.RAILWAY_PUBLIC_DOMAIN?.toLowerCase() ?? "";
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL || "https://reqcore.com";
const i18nDefaultLocale = "ru";
// Система моноязычная: интерфейс только на русском, переключатель языков убран.
const i18nLocales = [
  {
    code: "ru",
    language: "ru-RU",
    name: "Русский",
    file: "ru.json",
  },
];

const localizedPublicRouteRules = Object.fromEntries(
  i18nLocales
    .filter((locale) => locale.code !== i18nDefaultLocale)
    .flatMap((locale) => [
      [`/${locale.code}/jobs`, { isr: 3600 }],
      [`/${locale.code}/jobs/**`, { isr: 3600 }],
    ]),
);

// Allow search-engine indexing for localized job board pages
const localizedJobsRobotsRules = Object.fromEntries(
  i18nLocales
    .filter((locale) => locale.code !== i18nDefaultLocale)
    .flatMap((locale) => [
      [
        `/${locale.code}/jobs`,
        { headers: { "X-Robots-Tag": "index, follow" } },
      ],
      [
        `/${locale.code}/jobs/**`,
        { headers: { "X-Robots-Tag": "index, follow" } },
      ],
    ]),
);

// titleTemplate и favicons управляются в app/app.vue через useHead+useRuntimeConfig
// (даёт runtime-переключение, build не обязателен)

const isRailwayPreview =
  railwayEnvironmentName.startsWith("pr") ||
  railwayEnvironmentName.includes("pr-") ||
  railwayEnvironmentName.includes("pull request") ||
  railwayEnvironmentName.includes("pull-request") ||
  railwayEnvironmentName.includes("preview") ||
  railwayPublicDomain.includes("-pr-");

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  modules: [
    "@nuxtjs/i18n",
    "@nuxtjs/mdc",
    // Only load PostHog module when the API key is available;
    // the SDK crashes during prerender/build if the key is empty.
    ...(process.env.POSTHOG_PUBLIC_KEY ? ["@posthog/nuxt" as const] : []),
  ],

  css: ["~/assets/css/main.css"],

  // ────────────────────────────────────────────
  // Components auto-import — фундамент дизайн-системы
  // ────────────────────────────────────────────
  // Базовые UI-компоненты в app/components/ui/ именуются по образцу Ui*
  // (UiButton.vue, UiInput.vue и т.д.). Чтобы Nuxt не добавлял лишний префикс
  // из имени папки (получилось бы <UiUiButton>), выключаем pathPrefix.
  // Другие папки (например candidate/, application/) остаются по дефолту
  // — Nuxt всё равно сканирует app/components/** рекурсивно.
  components: [
    // Без префикса: файлы в app/components/ui/ уже именуются Ui*.
    { path: '~/components/ui', pathPrefix: false },
    // Остальные папки — дефолтное поведение: <CandidateXxx>, <ApplicationXxx> и т.д.
    { path: '~/components' },
  ],

  // ─────────────────────────────────────────────
  // PostHog — privacy-focused product analytics & feature flags
  // ─────────────────────────────────────────────
  // Enable source maps so PostHog error tracking can display readable stack traces
  sourcemap: { client: "hidden" },

  // @ts-ignore - posthogConfig types only available when @posthog/nuxt module is loaded
  posthogConfig: {
    publicKey: process.env.POSTHOG_PUBLIC_KEY || "",
    host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com",
    clientConfig: {
      // ── Reverse proxy: route PostHog through reqcore.com to bypass ad blockers ──
      // Requests to /ingest/** are proxied by Nitro to eu.i.posthog.com
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      // ── Privacy: disable invasive features ──
      autocapture: false,
      disable_session_recording: true,
      enable_recording_console_log: false,
      disable_surveys: true,
      capture_pageview: true,
      capture_pageleave: true,
      // ── Error tracking: capture unhandled errors and rejections ──
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // ── Cookieless tracking — default for visitors who haven't accepted ──
      // `persistence: 'sessionStorage'` keeps the distinct_id in the tab's
      // sessionStorage only.  Nothing is written to cookies or persistent
      // localStorage, and the id is wiped when the tab closes — there is no
      // cross-session tracking and no cross-site identifier (sessionStorage
      // is per-origin, per-tab).
      //
      // We deliberately avoid `persistence: 'memory'` here: with memory
      // persistence every page navigation regenerates the distinct_id,
      // which silently shatters any multi-page funnel (signup → onboarding
      // → dashboard → jobs) for unconsented users — every step is attributed
      // to a different anonymous person, so funnel conversion appears as 0.
      //
      // `person_profiles: 'identified_only'` means anonymous visitors flow as
      // events without creating person profiles, while logged-in users get a
      // stable profile keyed by their auth user-id (via posthog.identify()).
      // This gives us reliable funnel + retention analytics for real users
      // without persistently tracking anonymous visitors across sessions.
      persistence: "sessionStorage",
      person_profiles: "identified_only",
      // ── GDPR: drop IP address from events ──
      // PostHog uses $ip server-side for GeoIP, but we do not need it for the
      // SaaS analytics use case.  Denylisting it minimises personal data sent.
      property_denylist: ["$ip", "$initial_ip"],
    },
    serverConfig: {
      // Disabled: the @posthog/nuxt Nitro plugin captures ALL errors
      // (including 404s from bot scanners). We use a filtered error hook
      // in server/plugins/posthog.ts instead.
      enableExceptionAutocapture: false,
    },
  },

  i18n: {
    baseUrl: siteUrl,
    defaultLocale: i18nDefaultLocale,
    strategy: "prefix_except_default",
    locales: i18nLocales,
    langDir: "locales",
    // Disabled: this self-hosted Astra Group deployment defaults to Russian.
    // Users can still switch via the language picker; the choice is then remembered.
    detectBrowserLanguage: false,
    vueI18n: "./i18n.config.ts",
  },

  // ─────────────────────────────────────────────
  // Global <head> — lang, title template, favicon
  // ─────────────────────────────────────────────
  app: {
    head: {
      // titleTemplate и favicons задаются в app/app.vue через useHead
      // (runtime-условие на NUXT_PUBLIC_ASTRA_BRAND)
      meta: [
        { name: "theme-color", content: "#09090b" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1.0, maximum-scale=5.0",
        },
      ],
      // Dark-mode init script is injected in app/app.vue via useHead() with
      // the per-request nonce so it is allowed by the nonce-based CSP.
      // Plausible removed — PostHog handles all analytics
    },
  },

  runtimeConfig: {
    public: {
      /** Base URL of the marketing site (reqcore-web) for cross-domain links */
      marketingUrl:
        process.env.NUXT_PUBLIC_MARKETING_URL || "https://reqcore.com",
      /** Cookie domain for cross-subdomain sharing (e.g. '.reqcore.com') */
      cookieDomain: process.env.NUXT_PUBLIC_COOKIE_DOMAIN || "",
      // PostHog runtimeConfig is managed by @posthog/nuxt via posthogConfig above.
      // Override at runtime with NUXT_PUBLIC_POSTHOG_PUBLIC_KEY / NUXT_PUBLIC_POSTHOG_HOST.
      /** When set, the dashboard shows a read-only demo banner for this org slug */
      demoOrgSlug:
        process.env.DEMO_ORG_SLUG || (isRailwayPreview ? "reqcore-demo" : ""),
      /** Public live-demo account email used to prefill sign-in */
      liveDemoEmail: (() => {
        const email =
          process.env.LIVE_DEMO_EMAIL ||
          process.env.DEMO_EMAIL ||
          "demo@reqcore.com";
        // Guard against stale applirank.com domain from old env vars
        if (email.endsWith("@applirank.com")) {
          console.warn(
            "[config] Stale demo email detected (applirank.com domain) — falling back to demo@reqcore.com",
          );
          return "demo@reqcore.com";
        }
        return email;
      })(),
      /** Public live-demo passcode used to prefill sign-in */
      liveDemoPasscode:
        process.env.LIVE_DEMO_SECRET || process.env.DEMO_PASSWORD || "demo1234",
      /** Whether in-app feedback via GitHub Issues is enabled */
      feedbackEnabled: !!(
        process.env.GITHUB_FEEDBACK_TOKEN && process.env.GITHUB_FEEDBACK_REPO
      ),
      /** Whether OIDC SSO is enabled (all three OIDC env vars are set) */
      oidcEnabled: !!(
        process.env.OIDC_CLIENT_ID &&
        process.env.OIDC_CLIENT_SECRET &&
        process.env.OIDC_DISCOVERY_URL
      ),
      /** Display name for the SSO provider button */
      oidcProviderName: process.env.OIDC_PROVIDER_NAME || "SSO",
      /**
       * Feature flag overrides forced by env vars (FEATURE_FLAG_*).
       * Self-hosters use these to enable/disable flags without running PostHog.
       * See `shared/feature-flags.ts` for the full registry and resolution order.
       */
      // Cast: Nuxt narrows public runtime config from the registry's literal
      // `defaultValue` types (boolean here), but env overrides can also be
      // multivariate strings — and entries are partial. The override map is
      // validated at runtime by `parseFlagOverride`, so the cast is safe.
      featureFlagOverrides: readEnvFlagOverrides() as Record<
        string,
        boolean | string
      >,
      /** Включить брендинг Astra Group (графит + сокол + PT Astra Fact) */
      astraBrand: process.env.NUXT_PUBLIC_ASTRA_BRAND === '1',
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  // ─────────────────────────────────────────────
  // Route rules — ISR for public job pages
  // ─────────────────────────────────────────────
  routeRules: {
    // ── PostHog reverse proxy ──
    // Handled by server/routes/ingest/[...path].ts (which routes /ingest/static/**
    // to eu-assets.i.posthog.com and everything else to eu.i.posthog.com).
    // Defining routeRules here would be shadowed by the server route, so we
    // intentionally do not declare them.
    "/jobs": { isr: 3600 },
    "/jobs/**": { isr: 3600 },
    ...localizedPublicRouteRules,
  },

  nitro: {
    // ──────────────────────────────────────────
    // Scheduled tasks (cron)
    // ──────────────────────────────────────────
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // Каждые 5 минут: синк откликов hh.ru
      '*/5 * * * *': ['hh:sync'],
      // Каждую минуту: тик сорсинг-воркера (выбирает поиски с nextRunAt <= now)
      '* * * * *': ['hh:sourcing'],
    },
    routeRules: {
      "/**": {
        headers: {
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
          // HSTS принудительно сброшен (max-age=0): деплой HTTP-only на :8080,
          // а ранее уже отдавали HSTS — браузеры закэшировали политику и
          // апгрейдят запросы в HTTPS, валится ERR_ALPN_NEGOTIATION_FAILED.
          // max-age=0 заставит браузер очистить HSTS-кэш для этого хоста.
          // Включить обратно при появлении TLS.
          "Strict-Transport-Security": "max-age=0",
          // Content-Security-Policy is set dynamically with a per-request
          // nonce in server/middleware/csp.ts — do NOT add a static CSP here
          // as it would override the nonce and break the XSS protection.
          // Block indexing for all non-public routes by default;
          // overridden below for /jobs/** which should be indexable.
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
      // Public job board pages — allow indexing
      "/jobs/**": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      "/jobs": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      // Localized job board pages — allow indexing
      ...localizedJobsRobotsRules,
      // Allow same-origin framing for inline PDF preview in the sidebar iframe
      "/api/documents/*/preview": {
        headers: {
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    },
  },
});
