#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REPO_URL="https://github.com/buzzpicknet-create/meta-ads-dashboard.git"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "STOP: GITHUB_TOKEN is missing in Replit Secrets"
  exit 10
fi

if [ -z "${GITHUB_USER:-}" ]; then
  echo "STOP: GITHUB_USER is missing in Replit Secrets"
  exit 11
fi

ASKPASS="/tmp/replit-github-askpass-$STAMP.sh"
cat > "$ASKPASS" <<'ASK'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf "%s" "$GITHUB_USER" ;;
  *Password*) printf "%s" "$GITHUB_TOKEN" ;;
  *) printf "" ;;
esac
ASK
chmod 700 "$ASKPASS"

cleanup() {
  rm -f "$ASKPASS"
}
trap cleanup EXIT

echo "=== REPLIT -> GITHUB MAIN -> RENDER PRODUCTION ==="
echo "Stamp: $STAMP"

echo "=== CLEAN TEMP FILES ==="
rm -rf .chatgpt-audits
rm -f replit-meta-dashboard-audit-*.zip replit-meta-dashboard-audit-*.tar.gz
rm -f final-push-meta-dashboard*.sh final-push-meta-dashboard*.log
rm -f final-push-meta-dashboard-auth*.sh final-push-meta-dashboard-auth*.log

echo "=== SAFE GIT CONFIG ==="
git config user.name "Replit Sync Bot"
git config user.email "replit-sync@buzzpick.local"
git remote set-url origin "$REPO_URL"
git branch -M main

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

echo "=== FETCH REMOTE MAIN IF EXISTS ==="
GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 git fetch origin main --prune || true

if git show-ref --verify --quiet refs/remotes/origin/main; then
  if git merge-base --is-ancestor origin/main HEAD; then
    echo "Local main already contains remote main."
  else
    echo "Remote main has changes not in Replit. Trying safe merge..."
    if ! git merge --no-edit origin/main; then
      echo ""
      echo "STOP: Merge conflict happened. Nothing was pushed."
      git merge --abort || true
      exit 20
    fi
  fi
fi

echo "=== PUSH TO GITHUB MAIN ==="
GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 git push -u origin main

echo "=== FINAL STATUS ==="
git status --short --branch
git log --oneline -5

echo ""
echo "DONE: Latest Replit code pushed to GitHub main."
echo "Render should deploy automatically if connected to this repo."
