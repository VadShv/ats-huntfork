export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (config.public.astraBrand) {
    document.documentElement.classList.add('astra-brand')
  }
})
