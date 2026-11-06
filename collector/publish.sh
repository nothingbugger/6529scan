#!/bin/bash
# Collect public network data and push it to the site repository when cycles change.
# Usage: publish.sh /path/to/repo-clone
# Pushes at most every 6 hours when only the freshness timestamp changed.
set -euo pipefail
REPO="${1:?usage: publish.sh /path/to/repo-clone}"
cd "$REPO"

git pull --quiet --rebase origin main
/usr/bin/python3 collector/collect.py --out docs/data

git add docs/data
if git diff --cached --quiet -- docs/data/cycles; then
  # Only network.json changed: refresh it on the site at most every 6 hours.
  last=$(git log -1 --format=%ct -- docs/data/network.json 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -lt 21600 ]; then
    git reset --quiet -- docs/data
    git checkout --quiet -- docs/data/network.json 2>/dev/null || true
    exit 0
  fi
fi
git diff --cached --quiet && exit 0
git commit --quiet -m "data: $(date -u +%Y-%m-%dT%H:%MZ)"
git push --quiet origin main
echo "pushed $(date -u +%H:%MZ)"
