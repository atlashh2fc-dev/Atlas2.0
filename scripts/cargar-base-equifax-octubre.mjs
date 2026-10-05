// Sube la base Equifax de octubre 2026 (score IA) a la tabla mig_eq_oct_base de Atlas 2.0.
// El archivo ya viene cruzado con Atlas y enriquecido con Bigdata (staging_equifax_oct.jsonl).
// La carga a leads la hace public.base_equifax_octubre_aplicar()
// (migración 20261001200000_base_equifax_octubre_score_ia.sql).
//
//   node scripts/cargar-base-equifax-octubre.mjs --archivo ~/Downloads/staging_equifax_oct.jsonl

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV =
  process.env.ATLAS_ENV_PATH ||
  [join(scriptDir, "..", ".env.local"), "/Users/hh/Claude/Projects/Atlas 2.0/.env.local"].find(existsSync);

const COLUMNS = [
  "rut_norm", "rut", "razon_social", "actividad", "rubro", "subrubro", "region", "comuna", "direccion",
  "trabajadores", "tramo_ventas", "tamano_empresa", "tendencia_ventas", "email", "email_fuente",
  "contacto_nombre", "contacto_cargo", "contacto_email", "contacto_fuente", "phone_primary", "phones",
  "n_tel_nuevos", "rank", "hoja_equifax", "orden_equifax", "score_ia_principal", "score_ia_independiente",
  "prioridad_comercial", "confianza_modelo", "contactabilidad", "accion_carga", "atlas_ult_tipif",
];

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, index)] = value;
  }
  return env;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function readBase(path) {
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const source = JSON.parse(line);
    const row = {};
    for (const column of COLUMNS) row[column] = source[column] ?? null;
    if (!row.rut_norm || !Number.isInteger(row.rank)) throw new Error(`Fila inválida: ${line.slice(0, 120)}`);
    rows.push(row);
  }
  const ruts = new Set(rows.map((row) => row.rut_norm));
  if (ruts.size !== rows.length) throw new Error("El archivo trae RUT repetidos.");
  return rows;
}

async function run() {
  const path = argument("--archivo");
  if (!path || !existsSync(path)) throw new Error("Falta --archivo con la ruta de staging_equifax_oct.jsonl.");

  const atlasEnv = loadEnv(ATLAS_ENV);
  const atlasUrl = atlasEnv.NEXT_PUBLIC_SUPABASE_URL || atlasEnv.SUPABASE_URL;
  if (!atlasUrl.includes("lxdclavsycdidmzlbaid")) throw new Error(`Destino inesperado: ${atlasUrl}`);
  const atlas = createClient(atlasUrl, atlasEnv.SUPABASE_SERVICE_ROLE_KEY || atlasEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = readBase(path);
  for (let index = 0; index < rows.length; index += 1000) {
    const { error } = await atlas.from("mig_eq_oct_base").upsert(rows.slice(index, index + 1000), { onConflict: "rut_norm" });
    if (error) throw new Error(`mig_eq_oct_base: ${error.message}`);
  }

  const { count, error } = await atlas.from("mig_eq_oct_base").select("rut_norm", { count: "exact", head: true });
  if (error) throw new Error(`mig_eq_oct_base: ${error.message}`);
  console.log(JSON.stringify({ filas_archivo: rows.length, filas_en_staging: count }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
