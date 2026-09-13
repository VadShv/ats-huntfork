#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# RBAC v2 — Scope coverage audit
# Находит эндпоинты с данными (candidate/application/job/interview/
# document/sourcing/conversation), которые работают с существующим
# объектом по [id], но НЕ имеют scope-guard.
#
# «Покрытым» считается файл, где встречается любой из scope-хелперов.
# Исключаются create/index (создание — нет «чужого» объекта) и файлы
# из явного org-wide списка (docs/rbac-v2-org-wide-endpoints.md).
#
# Использование:  bash scripts/audit-scope-coverage.sh
# Exit 0 — 0 непокрытых; exit 1 — есть непокрытые (печатает список).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

API_DIR="server/api"

# Группы, где данные требуют scope
GROUPS_RE='candidate|application|job|interview|document|sourcing|conversation'

# Хелперы/признаки scope-покрытия
SCOPE_RE='requireCandidateInScope|requireApplicationInScope|requireJobInScope|requireConversationInScope|isCandidateInScope|isJobInScope|getScopeJobIds|effectiveJobIds|candidateScopeCondition|applicationScopeCondition|documentScopeCondition|resolveRecruiterScope|canWriteConversation|requireChatbotAccess|requireHm'

# Файлы, которым scope НЕ нужен (создание/списки/статические)
SKIP_RE='index\.post\.ts$|index\.get\.ts$|/index\.ts$|create|preview\.post\.ts$|commit\.post\.ts$|check-duplicates|webhooks/|/info/'

missing=()

while IFS= read -r f; do
  # только файлы, оперирующие [id] (существующий объект)
  if [[ "$f" =~ \[.*id.*\] ]] || [[ "$f" =~ \[id\] ]]; then
    # пропускаем create/index/webhooks/static
    if [[ "$f" =~ $SKIP_RE ]]; then continue; fi
    # группа с данными?
    if [[ "$f" =~ $GROUPS_RE ]]; then
      if ! grep -qE "$SCOPE_RE" "$f"; then
        gate=$(grep -oE "requirePermission\(event, \{[^}]+\}\)|requireAuth" "$f" | head -1)
        missing+=("${f#"$API_DIR"/}  |  ${gate:-<нет гейта>}")
      fi
    fi
  fi
done < <(find "$API_DIR" -name "*.ts" | sort)

echo "=== Scope coverage audit ==="
echo "Всего API-файлов: $(find "$API_DIR" -name '*.ts' | wc -l)"
if [ ${#missing[@]} -eq 0 ]; then
  echo "✅ 0 непокрытых [id]-эндпоинтов с данными (кроме create/index/org-wide)."
  exit 0
else
  echo "⚠️  Непокрытых: ${#missing[@]}"
  printf '  %s\n' "${missing[@]}"
  echo ""
  echo "Каждый: либо добавить scope-guard, либо внести в org-wide список с обоснованием."
  exit 1
fi
