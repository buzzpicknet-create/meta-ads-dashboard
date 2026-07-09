#!/usr/bin/env bash
set -euo pipefail

NEW_REMOTE="https://github.com/buzzpicknet-create/meta-ads-dashboard.git"

cd "$(git rev-parse --show-toplevel)"

STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== REPLIT -> GITHUB MAIN -> RENDER PRODUCTION ==="
echo "Stamp: $STAMP"

echo "=== CLEAN TEMP FILES ==="
rm -rf .chatgpt-audits
rm -f replit-meta-dashboard-audit-*.zip replit-meta-dashboard-audit-*.tar.gz

echo "=== ENSURE ORIGIN ==="
git remote remove origin 2>/dev/null || true
git remote add origin "$NEW_REMOTE"

echo "=== ENSURE MAIN BRANCH ==="
git branch -M main

echo "=== GIT IDENTITY ==="
git config user.name "Replit Sync Bot"
git config user.email "replit-sync@buzzpick.local"

echo "=== COMMIT CURRENT REPLIT CHANGES IF ANY ==="
git add -A
git reset -- .chatgpt-audits 2>/dev/null || true
git reset -- replit-meta-dashboard-audit-*.zip 2>/dev/null || true
git reset -- replit-meta-dashboard-audit-*.tar.gz 2>/dev/null || true

if git diff --cached --quiet; then
  echo "No local changes to commit."
else
  git commit -m "sync: replit update $STAMP"
fi

echo "=== FETCH GITHUB MAIN ==="
git fetch origin main --prune || true

if git show-ref --verify --quiet refs/remotes/origin/main; then
  if git merge-base --is-ancestor origin/main HEAD; then
    echo "Local main already contains GitHub main."
  else
    echo "GitHub main has changes not in Replit. Trying safe merge..."
    if ! git merge --no-edit origin/main; then
      echo ""
      echo "STOP: Merge conflict happened."
      echo "Nothing was pushed to production."
      git merge --abort || true
      echo "Send this output to ChatGPT."
      exit 20
    fi
  fi
fi

echo "=== PUSH TO GITHUB MAIN ==="
git push -u origin main

echo ""
echo "DONE: Latest Replit code pushed to GitHub main."
echo "Render should deploy automatically if connected to this repo/branch."
