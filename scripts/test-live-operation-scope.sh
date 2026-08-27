#!/usr/bin/env bash
set -euo pipefail

# Local-only PostgreSQL; no production credentials, ports or schema mutations.
for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
scope_test_dir=$(mktemp -d /tmp/atlas-live-scope.XXXXXX)
scope_repo_dir=$(cd "$(dirname "$0")/.." && pwd)
trap 'pg_ctl -D "$scope_test_dir/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$scope_test_dir/data" --auth=trust --no-locale >/dev/null
pg_ctl -D "$scope_test_dir/data" -l "$scope_test_dir/postgres.log" -o "-F -k $scope_test_dir -c listen_addresses=''" -w start >/dev/null
psql -X -h "$scope_test_dir" -d postgres -v ON_ERROR_STOP=1 \
  -f "$scope_repo_dir/tests/fixtures/workspace-rls.sql" \
  -f "$scope_repo_dir/tests/fixtures/live-operation-scope.sql" \
  -f "$scope_repo_dir/supabase/migrations/20260827195953_scope_live_operations_by_supervisor.sql" \
  -f "$scope_repo_dir/tests/fixtures/live-operation-scope-assertions.sql"
echo "Live operation scope passed. Isolated data retained at $scope_test_dir (server stopped on exit)."
