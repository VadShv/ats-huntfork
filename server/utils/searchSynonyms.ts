/**
 * Sprint 5: словарь синонимов для FTS-поиска кандидатов.
 *
 * Применяется при сборе текста для search_tsv (см. candidateSearchText.ts).
 * Если в тексте встречается любое слово из группы — в индекс добавляются
 * все остальные слова группы.
 *
 * Пример:
 *   В резюме: «опыт работы с Python 5 лет»
 *   После expandSynonyms: «опыт работы с Python 5 лет питон»
 *   Запрос «питон» → находит, запрос «python» → находит (через основной токен).
 *
 * Архитектурные решения (Sprint 5, обсуждено перед реализацией):
 *   1. Однословные синонимы — мультисловы вроде «large language model» отброшены
 *      (tokenizer всё равно разорвёт). При необходимости отдельный спринт.
 *   2. Case-insensitive: сравнение по lower(). 'Python', 'PYTHON', 'python' → одинаково.
 *   3. Hardcoded в TS-модуле — под Git, без БД/UI. Перенос в БД — при необходимости.
 *   4. Применяется ТОЛЬКО к индексу. Запрос остаётся как есть (websearch_to_tsquery
 *      найдёт по обогащённому tsv).
 *
 * Производительность:
 *   • Один Map<string, string[]> строится единожды при импорте модуля.
 *   • expandSynonyms делает один pass по словам входа, O(n) с хешированной проверкой.
 *   • Лексические единицы добавляются в КОНЕЦ строки, не нарушая позиций оригинала
 *     (ts_rank_cd по фразам не пострадает на ключевых полях).
 *
 * Расширение: добавь новую группу в SYNONYM_GROUPS, перезапусти backfill.
 */

/**
 * Группы синонимов. Внутри каждой группы все слова считаются эквивалентными.
 * Слова — однословные токены ([a-zа-я0-9]+), сохраняем в lowercase.
 *
 * Группировка по доменам — только для читабельности кода, runtime их не различает.
 */
const SYNONYM_GROUPS: string[][] = [
  // ── Языки программирования ──
  ['питон', 'python'],
  ['джава', 'java'],
  ['голанг', 'go', 'golang'],
  ['котлин', 'kotlin'],
  ['скала', 'scala'],
  ['руби', 'ruby'],
  ['свифт', 'swift'],
  ['раст', 'rust'],
  ['сишарп', 'csharp'], // 'c#' нельзя — не токен
  ['сиплюсплюс', 'cpp'], // 'c++' нельзя — не токен
  ['тайпскрипт', 'typescript', 'ts'],
  ['джаваскрипт', 'javascript', 'js'],
  ['пхп', 'php'],
  ['эрланг', 'erlang'],
  ['элксир', 'elixir'],
  ['перл', 'perl'],
  ['хаскель', 'haskell'],
  ['баш', 'bash', 'shell'],
  ['пауэршелл', 'powershell', 'ps'],

  // ── Фреймворки / runtime ──
  ['реакт', 'react'],
  ['вью', 'vue', 'vuejs'],
  ['ангуляр', 'angular'],
  ['свелт', 'svelte'],
  ['некст', 'next', 'nextjs'],
  ['нукст', 'nuxt'],
  ['нода', 'node', 'nodejs'],
  ['деноу', 'deno'],
  ['спринг', 'spring', 'springboot'],
  ['джанго', 'django'],
  ['фласк', 'flask'],
  ['фастапи', 'fastapi'],
  ['рейлс', 'rails', 'ror'],
  ['ларавель', 'laravel'],
  ['дотнет', 'dotnet'],
  ['аспнет', 'aspnet'],
  ['квартус', 'quarkus'],
  ['гин', 'gin'],
  ['фибер', 'fiber'],
  ['экспресс', 'express'],
  ['нест', 'nestjs'],

  // ── Базы данных ──
  ['постгрес', 'postgres', 'postgresql', 'pg'],
  ['mysql', 'майэскюэль'],
  ['мариа', 'mariadb'],
  ['оракл', 'oracle'],
  ['монго', 'mongo', 'mongodb'],
  ['редис', 'redis'],
  ['эластик', 'elastic', 'elasticsearch', 'es'],
  ['кликхаус', 'clickhouse', 'ch'],
  ['кассандра', 'cassandra'],
  ['динамо', 'dynamodb', 'dynamo'],
  ['ковбейс', 'couchbase'],
  ['скайла', 'scylladb', 'scylla'],
  ['тарантул', 'tarantool'],
  ['сикуэлайт', 'sqlite'],
  ['скуэл', 'sql'],
  ['ноуэскуэл', 'nosql'],

  // ── Очереди / брокеры ──
  ['кафка', 'kafka'],
  ['раббит', 'rabbit', 'rabbitmq'],
  ['наце', 'nats'],
  ['актив', 'activemq'],
  ['зукипер', 'zookeeper'],

  // ── Облака ──
  ['аэвээс', 'aws', 'амазон'],
  ['гцп', 'gcp'],
  ['азур', 'azure'],
  ['селектел', 'selectel'],
  ['крок', 'croc'],
  ['яндексклауд', 'yc'], // компаунд без пробелов; через дефис: 'yandex-cloud' раскроет Sprint 4.5
  ['сберклауд', 'sbercloud'],

  // ── DevOps / контейнеризация ──
  ['докер', 'docker'],
  ['кубер', 'k8s', 'kubernetes', 'кубернетес'],
  ['хелм', 'helm'],
  ['терраформ', 'terraform', 'tf'],
  ['ансибл', 'ansible'],
  ['пакер', 'packer'],
  ['вагрант', 'vagrant'],
  ['номад', 'nomad'],
  ['консул', 'consul'],
  ['ваулт', 'vault'],
  ['прометей', 'prometheus', 'promql'],
  ['графана', 'grafana'],
  ['кибана', 'kibana'],
  ['локи', 'loki'],
  ['дженкинс', 'jenkins'],
  ['гитлаб', 'gitlab', 'gitlabci'],
  ['гитхаб', 'github'],
  ['аргоси', 'argo', 'argocd'],
  ['тэкин', 'tekton'],
  ['тимсити', 'teamcity'],

  // ── Российский импортозамещаемый стек (Группа Астра — релевантно) ──
  ['астралинукс', 'astralinux'], // 'astra linux' через дефис: 'astra-linux' раскроет 4.5
  ['редос', 'redos'],
  ['альтлинукс', 'altlinux', 'alt'],
  ['роса', 'rosa'],
  ['опенсорс', 'oss'],
  ['криптопро', 'cryptopro'],
  ['постгреспро', 'postgrespro'],
  ['битрикс', 'bitrix'],
  ['мойофис', 'myoffice'],
  ['р7офис', 'r7office'],
  ['рутокен', 'rutoken'],

  // ── ОС / системное ──
  ['линукс', 'linux'],
  ['винда', 'windows', 'виндоус'],
  ['макос', 'macos', 'mac'],
  ['центос', 'centos'],
  ['дебиан', 'debian'],
  ['убунту', 'ubuntu'],
  ['федора', 'fedora'],
  ['рхел', 'rhel', 'redhat'],
  ['сусе', 'suse'],
  ['бзд', 'bsd', 'freebsd'],
  ['сапер', 'systemd'],
  ['ядро', 'kernel'],

  // ── Сети / безопасность ──
  ['нгинкс', 'nginx'],
  ['апач', 'apache', 'httpd'],
  ['хапрокси', 'haproxy'],
  ['енвой', 'envoy'],
  ['истио', 'istio'],
  ['линкерд', 'linkerd'],
  ['сиско', 'cisco'],
  ['файрвол', 'firewall', 'брандмауэр'],
  ['впн', 'vpn'],
  ['тлс', 'tls', 'ssl'],
  ['сзи', 'ибез'],
  ['пентест', 'pentest', 'pentesting'],
  ['сок', 'soc'],
  ['сиэм', 'siem'],

  // ── ML / AI ──
  ['нейросеть', 'нейросети'],
  ['ллм', 'llm'],
  ['рэг', 'rag'],
  ['пайторч', 'pytorch', 'torch'],
  ['тензорфлоу', 'tensorflow'],
  ['хагингфейс', 'huggingface', 'hf'],
  ['лангчейн', 'langchain'],
  ['оллама', 'ollama'],
  ['тритон', 'triton'],
  ['вллм', 'vllm'],

  // ── Роли ──
  ['фронтенд', 'frontend', 'фронт'],
  ['бэкенд', 'backend', 'бэк'],
  ['фуллстек', 'fullstack'],
  ['девопс', 'devops'],
  ['сре', 'sre'],
  ['сеньор', 'senior'],
  ['джуниор', 'junior', 'джун'],
  ['мидл', 'middle', 'мид'],
  ['тимлид', 'teamlead'],
  ['техлид', 'techlead'],
  ['архитектор', 'architect'],
  ['кьюэй', 'qa', 'тестировщик'],
  ['аналитик', 'analyst'],
  ['сисадмин', 'sysadmin'],
  ['сетевик', 'networker'],
]

/**
 * Map: lowercase слово → массив всех ОСТАЛЬНЫХ слов в его группе (без самого).
 * Строится один раз при импорте модуля.
 */
const SYNONYM_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>()
  for (const group of SYNONYM_GROUPS) {
    const lower = group.map((w) => w.toLowerCase())
    for (let i = 0; i < lower.length; i++) {
      const key = lower[i]
      const others = lower.filter((_, j) => j !== i)
      // Если ключ уже встречается в другой группе — мерджим (защита от человеческих ошибок).
      if (map.has(key)) {
        const existing = map.get(key)!
        const merged = Array.from(new Set([...existing, ...others]))
        map.set(key, merged)
      } else {
        map.set(key, others)
      }
    }
  }
  return map
})()

/** Сколько групп и сколько уникальных ключей в словаре (для диагностики). */
export function getSynonymStats(): { groups: number, keys: number } {
  return { groups: SYNONYM_GROUPS.length, keys: SYNONYM_MAP.size }
}

/**
 * Расширить текст синонимами. Для каждого встретившегося ключевого слова
 * добавляет в конец строки все его синонимы (без дубликатов в пределах
 * одного вызова — экономим байты для tsvector).
 *
 * Регекс выделяет токены [a-zа-я0-9]+ (после lower) — те же границы, что
 * tokenizer PostgreSQL для kириллицы/латиницы. Знаки препинания, дефисы,
 * подчёркивания являются разделителями.
 *
 * НЕ перезаписывает оригинальный текст — только добавляет в хвост. Это
 * сохраняет позиции для ts_rank_cd и работает совместимо с
 * expandHyphenCompounds (тот тоже добавляет в хвост).
 */
export function expandSynonyms(text: string): string {
  if (!text) return text
  const TOKEN_RE = /[a-zа-я0-9]+/g
  const added = new Set<string>()
  // lower текст один раз — для матчинга. Оригинал остаётся в выходе.
  const lower = text.toLowerCase()
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(lower)) !== null) {
    const word = m[0]
    const synonyms = SYNONYM_MAP.get(word)
    if (!synonyms) continue
    for (const s of synonyms) {
      if (!added.has(s)) added.add(s)
    }
  }
  if (added.size === 0) return text
  return text + ' ' + Array.from(added).join(' ')
}
