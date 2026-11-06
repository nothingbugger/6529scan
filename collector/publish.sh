#!/bin/bash
# Collect public network data and push it to the site repository when cycles change.
# Usage: publish.sh /path/to/repo-clone
# Pushes at once when cycles change, otherwise at most once an hour (validators, freshness).
set -euo pipefail
REPO="${1:?usage: publish.sh /path/to/repo-clone}"
cd "$REPO"

# Start from the repository's state: data files are regenerated below.
git checkout --quiet -- docs/data 2>/dev/null || true
git clean -fdq -- docs/data
git pull --quiet --rebase origin main
/usr/bin/python3 collector/collect.py --out docs/data

git add docs/data
if git diff --cached --quiet -- docs/data/cycles; then
  # No new cycle data: refresh the other files on the site at most once an hour.
  last=$(git log -1 --format=%ct -- docs/data/network.json 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - last )) -lt 3600 ]; then
    git reset --quiet -- docs/data
    git checkout --quiet -- docs/data 2>/dev/null || true
    exit 0
  fi
fi
git diff --cached --quiet && exit 0
git commit --quiet -m "data: $(date -u +%Y-%m-%dT%H:%MZ)"
git push --quiet origin main
echo "pushed $(date -u +%H:%MZ)"
