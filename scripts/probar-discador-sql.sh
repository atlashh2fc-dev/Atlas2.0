#!/usr/bin/env bash
# Prueba de comportamiento de las migraciones del discador (horario, esperas,
# no llamar, claim) en un Postgres desechable. Nunca toca producción.
#
#   bash scripts/probar-discador-sql.sh
#
# Con DISCADOR_PG_URL apunta a una base vacía ya levantada (CI con un servicio
# postgres). Sin ella, levanta un clúster temporal con initdb/pg_ctl en un
# puerto libre y lo borra al terminar.
#
# Pasos: stub del esquema -> historial previo -> migraciones dos veces (tienen
# que ser idempotentes) -> escenarios.sql, que aborta en la primera regla que
# no se cumple.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
PRUEBAS="$RAIZ/tests/sql/discador"
MIGRACIONES=(
  20260924181000_discador_horario_y_politica_de_reintentos.sql
  20260924181100_lista_no_llamar.sql
  20260924181200_espera_por_lead_y_por_telefono.sql
  20260924181300_claim_respeta_horario_esperas_y_no_llamar.sql
  20260924181400_voz_ia_respeta_no_llamar.sql
  20260924230000_causa_q850_clasifica_intentos.sql
  20260926120000_numero_sin_ruta_sale_de_la_cola.sql
  20260926130000_abandono_real_y_meta_en_porcentaje.sql
)

TEMPORAL=""
limpiar() {
  if [ -n "$TEMPORAL" ]; then
    pg_ctl -D "$TEMPORAL/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$TEMPORAL"
  fi
}
trap limpiar EXIT

if [ -n "${DISCADOR_PG_URL:-}" ]; then
  URL="$DISCADOR_PG_URL"
else
  for binario in initdb pg_ctl psql; do
    command -v "$binario" >/dev/null || { echo "Falta $binario (instala PostgreSQL o define DISCADOR_PG_URL)" >&2; exit 2; }
  done
  TEMPORAL="$(mktemp -d)"
  PUERTO="$(( 20000 + RANDOM % 20000 ))"
  # Sin configuración regional: la del sistema (p. ej. es_CL) puede no existir.
  export LC_ALL=C LANG=C
  initdb -D "$TEMPORAL/data" -U postgres -A trust --no-sync --no-locale -E UTF8 >/dev/null
  pg_ctl -D "$TEMPORAL/data" -o "-p $PUERTO -k $TEMPORAL -c listen_addresses=''" -l "$TEMPORAL/log" -w start >/dev/null
  URL="postgresql://postgres@/postgres?host=$TEMPORAL&port=$PUERTO"
fi

PSQL=(psql "$URL" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$PRUEBAS/stub.sql"
"${PSQL[@]}" -f "$PRUEBAS/historial.sql"
for pasada in 1 2; do
  for migracion in "${MIGRACIONES[@]}"; do
    echo "== pasada $pasada: $migracion"
    PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -1 -f "$RAIZ/supabase/migrations/$migracion"
  done
done
SALIDA="$(mktemp)"
if ! "${PSQL[@]}" -o /dev/null -f "$PRUEBAS/escenarios.sql" >"$SALIDA" 2>&1; then
  grep -v 'NOTICE:  ok:' "$SALIDA" >&2 || true
  rm -f "$SALIDA"
  exit 1
fi
echo "ESCENARIOS OK: $(grep -c 'NOTICE:  ok:' "$SALIDA") reglas comprobadas"
rm -f "$SALIDA"
