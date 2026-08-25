#!/usr/bin/env bash

set -euo pipefail

readonly ATLAS2_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ATLAS2_OFFICIAL_DOMAIN="atlascrm.geimser.cl"
readonly ATLAS2_VERCEL_PROJECT="atlas2-0"
readonly ATLAS2_VERCEL_SCOPE="team_IJlj5eIFM7pBtOCDNOQN0eZs"
readonly ATLAS2_SUPABASE_PROJECT="lxdclavsycdidmzlbaid"

cd "$ATLAS2_REPO_DIR"

echo "Atlas 2.0 DR preflight (solo lectura)"
echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Supabase: $ATLAS2_SUPABASE_PROJECT"
echo "Vercel project: $ATLAS2_VERCEL_PROJECT"
echo "Official domain: $ATLAS2_OFFICIAL_DOMAIN"
echo "Git SHA: $(git rev-parse HEAD)"
echo "Branch: $(git branch --show-current)"

echo
echo "Working tree:"
git status --short

echo
echo "Latest local migrations:"
find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print \
  | LC_ALL=C sort \
  | tail -n 10

echo
echo "Official production domain:"
npx vercel inspect "https://$ATLAS2_OFFICIAL_DOMAIN" \
  --scope "$ATLAS2_VERCEL_SCOPE"

echo
echo "Production environment variable names (values are not printed):"
npx vercel env ls production --scope "$ATLAS2_VERCEL_SCOPE"

echo
echo "Preflight completed without modifying database, variables, aliases or deployments."
