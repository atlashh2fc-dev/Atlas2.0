#!/usr/bin/env bash
set -euo pipefail

# Fresh local-only Postgres with Unix socket; no env file, credentials, network,
# production database or Supabase CLI connection is used by this test.
for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
rls_test_dir=$(mktemp -d /tmp/atlas-workspace-rls.XXXXXX)
rls_repo_dir=$(cd "$(dirname "$0")/.." && pwd)
trap 'pg_ctl -D "$rls_test_dir/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$rls_test_dir/data" --auth=trust --no-locale >/dev/null
pg_ctl -D "$rls_test_dir/data" -l "$rls_test_dir/postgres.log" -o "-F -k $rls_test_dir -c listen_addresses=''" -w start >/dev/null
psql -X -h "$rls_test_dir" -d postgres -v ON_ERROR_STOP=1 \
  -f "$rls_repo_dir/tests/fixtures/workspace-rls.sql" \
  -f "$rls_repo_dir/tests/fixtures/workspace-status-scope.sql" \
  -f "$rls_repo_dir/supabase/migrations/20260827195355_separate_whatsapp_workspace_content_permissions.sql" \
  -f "$rls_repo_dir/tests/fixtures/workspace-rls-assertions.sql"
echo "Workspace RLS passed. Isolated test data retained at $rls_test_dir (server stopped on exit)."
