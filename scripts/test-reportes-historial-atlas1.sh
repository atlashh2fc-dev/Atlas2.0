#!/usr/bin/env bash
set -euo pipefail

# Ejecuta los reportes del supervisor contra un PostgreSQL local y desechable:
# una migrada de 3 días, una descartada con su interacción, una nativa de 90 s
# a las 22:30 de Chile y ventas falsas por texto. Nada toca producción.
# En macOS, postgres se niega a partir si hereda un locale inválido (es_CL sin LC_ALL).
export LC_ALL=C
for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Falta $executable" >&2; exit 1; }
done
test_dir=$(mktemp -d /tmp/atlas-reportes-a1.XXXXXX)
repo_dir=$(cd "$(dirname "$0")/.." && pwd)
trap 'pg_ctl -D "$test_dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$test_dir"' EXIT
initdb -D "$test_dir/data" --auth=trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$test_dir/data" -l "$test_dir/postgres.log" -o "-F -k $test_dir -c listen_addresses=''" -w start >/dev/null

migraciones=(
  "$repo_dir/supabase/migrations/20260924183000_reportes_reglas_de_tmo_y_cotizacion.sql"
  "$repo_dir/supabase/migrations/20260924183100_reporte_supervisor_sin_distorsion_de_atlas1.sql"
  "$repo_dir/supabase/migrations/20260924183400_reportes_ventas_reales_salud_de_cola_y_tipificaciones.sql"
)
psql_args=(-X -q -h "$test_dir" -d postgres -v ON_ERROR_STOP=1)
psql "${psql_args[@]}" -f "$repo_dir/tests/fixtures/reportes-historial-atlas1.sql"
# Dos pasadas: las migraciones tienen que poder volver a aplicarse.
for pasada in 1 2; do
  for migracion in "${migraciones[@]}"; do
    psql "${psql_args[@]}" -1 -f "$migracion"
  done
done
# Solo se muestran los avisos «ok: …»; un fallo aborta con su motivo.
psql "${psql_args[@]}" -o /dev/null -f "$repo_dir/tests/fixtures/reportes-historial-atlas1-assertions.sql"
echo "Reportes con historial de Atlas 1: OK"
