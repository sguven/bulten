#!/usr/bin/env bash
# The single command the scheduled tasks call: validate -> write -> commit -> push.
#   bash scripts/publish_and_push.sh /path/veri.json flas      # or: aksam
# Optional 3rd and 4th arguments: date (YYYY-MM-DD) and time (HH:MM). Defaults to now in New York time.
set -euo pipefail

VERI="${1:?veri.json yolu gerekli}"
TYPE="${2:?tür gerekli: flas | aksam}"
DATE="${3:-}"
TIME="${4:-}"
cd "$(dirname "$0")/.."

ARGS=("$VERI" --type "$TYPE")
[[ -n "$DATE" ]] && ARGS+=(--date "$DATE")
[[ -n "$TIME" ]] && ARGS+=(--time "$TIME")

python3 scripts/publish.py "${ARGS[@]}" --check
[[ -n "${GUNDEM_SKIP_PULL:-}" ]] || git pull --rebase --quiet origin main || true  # GUNDEM_SKIP_PULL is for tests only
python3 scripts/publish.py "${ARGS[@]}"

git config user.name  >/dev/null || git config user.name  "Gundem Bot"
git config user.email >/dev/null || git config user.email "gundem-bot@users.noreply.github.com"

git add data/
if git diff --cached --quiet; then
  echo "Değişiklik yok, push atlanıyor."
  exit 0
fi
ID=$(python3 -c "import json;print(json.load(open('data/index.json'))['latest'])")
git commit --quiet -m "Yayın: ${ID}"

for i in 1 2 3; do
  if git push --quiet origin HEAD:main; then
    echo "OK: yayımlandı -> ${ID}"
    exit 0
  fi
  echo "Push reddedildi (deneme $i); uzaktaki değişiklikler alınıp yeniden deneniyor…" >&2
  sleep $((i * 2))
  git fetch --quiet origin main
  if ! git rebase --quiet origin/main; then
    # Two issues at the same time: the only conflict is in data/index.json -> rebuild it
    python3 scripts/publish.py --rebuild >/dev/null
    git add data/index.json
    GIT_EDITOR=true git rebase --continue || { git rebase --abort; echo "HATA: çözülemeyen çakışma" >&2; exit 1; }
  fi
  python3 scripts/publish.py --rebuild >/dev/null
  if ! git diff --quiet -- data/index.json; then
    git add data/index.json && git commit --quiet -m "Dizin yeniden üretildi"
  fi
done
echo "HATA: push 3 denemede başarısız oldu" >&2
exit 1
