<script setup lang="ts">
const i18nHead = useLocaleHead({
  seo: true,
})

useHead(() => ({
  htmlAttrs: i18nHead.value.htmlAttrs,
  link: i18nHead.value.link,
  meta: i18nHead.value.meta,
}))

// Blocking inline script to apply dark mode before first paint (prevents white
// flash). The nonce attribute is required by the nonce-based CSP set in
// server/middleware/csp.ts — without it the script would be blocked by the
// Content Security Policy (CSP).
const _nonce = import.meta.server ? (useRequestEvent()?.context?.nonce ?? '') : ''
useHead({
  script: [
    {
      key: 'dark-mode-init',
      innerHTML: '(function(){try{var s=localStorage.getItem("reqcore-color-mode");var m=s||(window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");document.documentElement.classList.toggle("dark",m==="dark");document.documentElement.style.colorScheme=m}catch(e){}})()',
      tagPosition: 'head',
      ...(_nonce ? { nonce: _nonce } : {}),
    },
  ],
})

// Sync Better Auth session → PostHog identity & org group
await usePostHogIdentity()

// titleTemplate и favicons — runtime-переключение по флагу NUXT_PUBLIC_ASTRA_BRAND.
// Не в nuxt.config.ts, чтобы не было билд-временного фриза.
const isAstraBrand = useAstraBrand()
useHead(() => ({
  titleTemplate: (chunk?: string) => {
    const brand = isAstraBrand.value ? 'ReqCore Astra' : 'Reqcore'
    return chunk ? `${chunk} — ${brand}` : brand
  },
  link: isAstraBrand.value
    ? [
        { rel: 'icon', type: 'image/png', href: '/favicon-32-astra.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon-astra.png' },
      ]
    : [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
}))
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ConfirmDialog />
    <ClientOnly>
      <ConsentBanner />
    </ClientOnly>
  </div>
</template>
