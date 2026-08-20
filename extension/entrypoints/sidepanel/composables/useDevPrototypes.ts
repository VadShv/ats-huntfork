import { ref } from 'vue'

/**
 * П0: флаг экспериментальных прототипов.
 *
 * По умолчанию ВЫКЛЮЧЕН — обычный пользователь видит только реальные данные
 * и честные пустые состояния. Включается тумблером «Экспериментальное»
 * в Настройках; гейтит демо-сценарии, не подключённые к серверу.
 */
const DEV_PROTO_KEY = 'hf:devProto'

const devPrototypes = ref(false)
let loaded = false

async function loadDevPrototypes() {
  if (loaded) return
  loaded = true
  try {
    const stored = await chrome.storage.local.get(DEV_PROTO_KEY)
    devPrototypes.value = stored[DEV_PROTO_KEY] === true
  }
  catch {}
}

function setDevPrototypes(on: boolean) {
  devPrototypes.value = on
  try { chrome.storage.local.set({ [DEV_PROTO_KEY]: on }) } catch {}
}

export function useDevPrototypes() {
  loadDevPrototypes()
  return { devPrototypes, setDevPrototypes }
}
