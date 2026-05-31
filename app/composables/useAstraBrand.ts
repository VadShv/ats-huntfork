export function useAstraBrand() {
  const config = useRuntimeConfig()
  return computed(() => Boolean(config.public.astraBrand))
}
