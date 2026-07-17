#!/usr/bin/env bash
set -euo pipefail

expected_commit="${1:-}"
if [[ ! "${expected_commit}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Uso: bash ops/deploy-backend-phase5.sh <commit-sha40-aprovado>" >&2
  exit 2
fi

repo_dir="$(git rev-parse --show-toplevel)"
cd "${repo_dir}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deploy bloqueado: worktree da VPS possui alterações." >&2
  exit 3
fi

git fetch origin main --prune
git checkout main
git pull --ff-only origin main

actual_commit="$(git rev-parse HEAD)"
if [[ "${actual_commit}" != "${expected_commit}" ]]; then
  echo "Deploy bloqueado: commit atual não corresponde ao aprovado." >&2
  exit 4
fi

npm ci
npm run lint
npm test
npm run build

export GIT_COMMIT="${actual_commit}"
export APP_VERSION="$(node -p "require('./package.json').version")"
export BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export FACE_BACKFILL_ENABLED=false
export INTEGRITY_RECONCILIATION_LOCKED=true
export INTEGRITY_AUTO_RECONCILE_ENABLED=false

pm2 describe funpace-media >/dev/null
pm2 restart funpace-media --update-env
pm2 save

sleep 2
health="$(curl --fail --silent --show-error https://api.funpace.media/api/health)"
node -e 'const p=JSON.parse(process.argv[1]); const expected=process.argv[2]; if(!p.ok||p.commit!==expected) process.exit(1)' "${health}" "${actual_commit}"

echo "Deploy concluído e commit confirmado: ${actual_commit}"
