#!/usr/bin/env bash
# Validate -> write -> commit -> push.   bash scripts/publish_and_push.sh /path/veri.json
set -euo pipefail
VERI="${1:?path to veri.json required}"
cd "$(dirname "$0")/.."
python3 scripts/publish.py "$VERI" --check
git pull --rebase --quiet origin main || true
python3 scripts/publish.py "$VERI"
git add data/
if git diff --cached --quiet; then echo "No changes."; exit 0; fi
ID=$(python3 -c "import json;print(json.load(open('data/world.json'))['latest'])")
git -c user.name="World Brief Bot" -c user.email="29234447+sguven@users.noreply.github.com" commit --quiet -m "Publish: ${ID}"
for i in 1 2 3; do
  if git push --quiet origin HEAD:main; then echo "OK: published -> ${ID}"; exit 0; fi
  sleep $((i * 2)); git fetch --quiet origin main
  git rebase --quiet origin/main || { python3 scripts/publish.py --rebuild >/dev/null; git add data/world.json; GIT_EDITOR=true git rebase --continue; }
  python3 scripts/publish.py --rebuild >/dev/null
  git diff --quiet -- data/world.json || { git add data/world.json; git -c user.name="World Brief Bot" -c user.email="29234447+sguven@users.noreply.github.com" commit --quiet -m "Rebuild index"; }
done
echo "ERROR: push failed 3 times" >&2; exit 1
