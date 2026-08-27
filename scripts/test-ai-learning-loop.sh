#!/usr/bin/env bash
set -euo pipefail
# Isolated Unix socket only. Never reads environment files or production secrets.
for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
loop_test_dir=$(mktemp -d /tmp/atlas-learning-loop.XXXXXX)
loop_repo_dir=$(cd "$(dirname "$0")/.." && pwd)
trap 'pg_ctl -D "$loop_test_dir/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$loop_test_dir/data" --auth=trust --no-locale >/dev/null
pg_ctl -D "$loop_test_dir/data" -l "$loop_test_dir/postgres.log" -o "-F -k $loop_test_dir -c listen_addresses=''" -w start >/dev/null
psql -X -h "$loop_test_dir" -d postgres -v ON_ERROR_STOP=1 \
  -f "$loop_repo_dir/tests/fixtures/workspace-rls.sql" \
  -f "$loop_repo_dir/tests/fixtures/ai-learning-loop.sql" \
  -f "$loop_repo_dir/supabase/migrations/20260827205310_ai_learning_loop_shadow.sql" \
  -f "$loop_repo_dir/tests/fixtures/ai-learning-loop-assertions.sql"
node --experimental-strip-types "$loop_repo_dir/scripts/test-learning-loop-worker.ts" "$loop_test_dir"
echo "Learning loop SQL passed. Local fixture at $loop_test_dir; server stopped on exit."
