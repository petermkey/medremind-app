#!/usr/bin/env bash
# git-state-check.sh — проверка git-состояния перед стартом (мульти-агентная работа).
# Ловит: дрейф worktree, расхождение с origin, незакоммиченные файлы, конфликтные маркеры.
# Запуск: bash scripts/git-state-check.sh  (из корня любого репо)
set -uo pipefail

echo "=== git state check: $(pwd) ==="
git fetch origin --quiet 2>/dev/null || echo "WARN: fetch origin не удался (офлайн?)"

echo "--- ветка и расхождение ---"
BR=$(git rev-parse --abbrev-ref HEAD)
echo "HEAD: $BR"
if git rev-parse --verify -q "origin/$BR" >/dev/null; then
  AHEAD=$(git rev-list --count "origin/$BR..HEAD")
  BEHIND=$(git rev-list --count "HEAD..origin/$BR")
  echo "ahead=$AHEAD behind=$BEHIND vs origin/$BR"
  [ "$BEHIND" -gt 0 ] && echo "WARN: ветка отстала — сначала git pull --ff-only"
else
  echo "INFO: origin/$BR нет (локальная ветка)"
fi

echo "--- worktrees ---"
git worktree list
STALE=$(git worktree list --porcelain | grep -c 'prunable' || true)
[ "$STALE" -gt 0 ] && echo "WARN: $STALE prunable worktree(s) — git worktree prune"

echo "--- незакоммиченное ---"
git status --short | head -20
N=$(git status --short | wc -l | tr -d ' ')
echo "($N файлов)"

echo "--- конфликтные маркеры в tracked-файлах ---"
if git grep -l -E '^(<{7}|>{7}|={7})( |$)' -- ':!*.md' 2>/dev/null | head -5 | grep .; then
  echo "FAIL: есть неразрешённые конфликты"
  exit 1
fi
echo "OK: маркеров конфликтов нет"
