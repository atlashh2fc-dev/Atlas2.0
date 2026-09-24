// Carga una base de discado de Equifax exportada desde Vocalcom (ClientExportation_*.csv)
// en la tabla mig_vc_base de Atlas 2.0. La razón social no viene en el export: se toma
// de Bigdata (empresas_master) por RUT. La carga a leads la hace
// public.base_discado_equifax_aplicar() (migración 20260924143506_base_discado_equifax_vocalcom.sql).
//
//   node scripts/cargar-base-discado-equifax.mjs --archivo ~/Downloads/ClientExportation_X.csv

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV =
  process.env.ATLAS_ENV_PATH ||
  [join(scriptDir, "..", ".env.local"), "/Users/hh/Claude/Projects/Atlas 2.0/.env.local"].find(existsSync);
const BIGDATA_ENV = process.env.BIGDATA_ENV_PATH || "/Users/hh/Projects/active/Bigdata/mdata/.env.production.local";

// Orden de preferencia del teléfono principal: el que Vocalcom marcó como usable primero.
const PHONE_COLUMNS = [
  "telefono_usable",
  "fuente_telefono_usable",
  "telefono_empresa",
  "fuente_telefono_empresa",
  "telefono_representante_o_socio",
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

// Vocalcom exporta UTF-8 pero con las Ñ ya perdidas (U+FFFD); en estos campos en
// mayúsculas la única letra que falta es la Ñ.
function repairText(value) {
  const clean = value.trim();
  return clean ? clean.replace(/\uFFFD/g, "Ñ") : null;
}

function parseLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ";") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeRut(value) {
  return value.toUpperCase().replace(/[^0-9K]/g, "").replace(/^0+/, "");
}

function normalizePhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("56") && digits.length === 11) digits = digits.slice(2);
  if (digits.length !== 9 || !/^[2-79]/.test(digits)) return null;
  return `+56${digits}`;
}

function calledAt(row) {
  const utc = (row.Stats_UtcDateTime ?? "").replace(/\D/g, "");
  if (utc.length < 12) return null;
  const iso = `${utc.slice(0, 4)}-${utc.slice(4, 6)}-${utc.slice(6, 8)}T${utc.slice(8, 10)}:${utc.slice(10, 12)}:${utc.slice(12, 14) || "00"}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function integerOrNull(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBase(path) {
  const lines = readFileSync(path, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = parseLine(lines[0]);
  const records = new Map();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const values = parseLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const rutNorm = normalizeRut(row.rut_empresa ?? "");
    const phones = [];
    for (const column of PHONE_COLUMNS) {
      const phone = normalizePhone(row[column]);
      if (phone && !phones.some((entry) => entry.value === phone)) phones.push({ value: phone, source: column });
    }
    if (!/^[0-9]{6,9}[0-9K]$/.test(rutNorm) || phones.length === 0) {
      skipped += 1;
      continue;
    }
    records.set(rutNorm, {
      rut_norm: rutNorm,
      rut: row.rut_empresa.trim(),
      razon_social: repairText(row.razon_social ?? ""),
      actividad: repairText(row.actividad ?? ""),
      rubro: repairText(row.rubro ?? ""),
      subrubro: repairText(row.subrubro ?? ""),
      comuna: repairText(row.comuna ?? ""),
      region: repairText(row.region ?? ""),
      trabajadores: repairText(row.trabajadores_2024 ?? ""),
      tramo_ventas: repairText(row.tramo_ventas_2024 ?? ""),
      phone_primary: phones[0].value,
      phones,
      vc_indice: integerOrNull(row.INDICE),
      vc_called_at: calledAt(row),
      vc_agent_name: repairText(row.Stats_AgentName ?? ""),
      vc_status_group: repairText(row.Stats_StatusGroup ?? ""),
      vc_status_code: repairText(row.Stats_StatusCode ?? ""),
      vc_status_text: repairText(row.Stats_StatusText ?? ""),
      vc_duration_seconds: integerOrNull(row.Stats_Duration),
      vc_comments: repairText(row.Comments ?? ""),
    });
  }
  return { records, total: lines.length - 1, skipped };
}

// Razón social desde Bigdata: su rutid es el RUT con ceros a la izquierda hasta 10 caracteres.
function companyNames(bigdataUrl, rutNorms, tempDir) {
  const listPath = join(tempDir, "ruts.csv");
  writeFileSync(listPath, rutNorms.map((rut) => rut.padStart(10, "0")).join("\n"));
  const sqlPath = join(tempDir, "nombres.sql");
  writeFileSync(
    sqlPath,
    `set statement_timeout = 0;
create temp table base_ruts (rutid text primary key);
\\copy base_ruts from '${listPath}'
select json_build_object('rutid', e.rutid, 'razon_social', btrim(e.razon_social))
from base_ruts b join public.empresas_master e on e.rutid = b.rutid
where nullif(btrim(e.razon_social), '') is not null;
`
  );
  const result = spawnSync("psql", [bigdataUrl, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", sqlPath], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Bigdata: ${result.stderr}`);
  const names = new Map();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    names.set(row.rutid.replace(/^0+/, ""), row.razon_social);
  }
  return names;
}

async function run() {
  const path = argument("--archivo");
  if (!path || !existsSync(path)) throw new Error("Falta --archivo con la ruta del CSV de Vocalcom.");

  const atlasEnv = loadEnv(ATLAS_ENV);
  const atlasUrl = atlasEnv.NEXT_PUBLIC_SUPABASE_URL || atlasEnv.SUPABASE_URL;
  if (!atlasUrl.includes("lxdclavsycdidmzlbaid")) throw new Error(`Destino inesperado: ${atlasUrl}`);
  const atlas = createClient(atlasUrl, atlasEnv.SUPABASE_SERVICE_ROLE_KEY || atlasEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bigdataEnv = loadEnv(BIGDATA_ENV);
  const bigdataUrl = (bigdataEnv.POSTGRES_URL_NON_POOLING || bigdataEnv.POSTGRES_URL || "").replace(/\?.*$/, "");
  if (!bigdataUrl.includes("tlnfkxufoczqxvhwahhc")) throw new Error("No encontré la conexión de Bigdata.");

  const { records, total, skipped } = readBase(path);
  const tempDir = mkdtempSync(join(process.env.MIG_TMPDIR || tmpdir(), "base-equifax-"));
  let named = 0;
  try {
    const names = companyNames(bigdataUrl, [...records.keys()], tempDir);
    for (const record of records.values()) {
      if (!record.razon_social && names.has(record.rut_norm)) {
        record.razon_social = names.get(record.rut_norm);
        named += 1;
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const rows = [...records.values()];
  for (let index = 0; index < rows.length; index += 1000) {
    const { error } = await atlas.from("mig_vc_base").upsert(rows.slice(index, index + 1000), { onConflict: "rut_norm" });
    if (error) throw new Error(`mig_vc_base: ${error.message}`);
  }

  console.log(JSON.stringify({ filas_archivo: total, descartadas: skipped, cargadas: rows.length, razon_social_bigdata: named }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
