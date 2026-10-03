// Carga el plan de marketing de una empresa en el calendario de Atlas.
//
// Lee un JSON con `{ "items": [...] }` (ver scripts/marketing-altius-semana-41.json)
// y lo envía a POST /api/marketing/items, la misma puerta que usan los demás
// alimentadores: firma HMAC-SHA256 de `<timestamp>.<cuerpo>` con
// MARKETING_INGEST_SECRET. La empresa no la elige el script: está atada a la
// clave en el servidor (MARKETING_INGEST_ORG, por defecto "altius").
//
// Cada pieza se identifica por (source, external_id): volver a correrlo con el
// mismo archivo actualiza las piezas, no las duplica. Las horas sin zona
// ("2026-10-05 13:00") son de Chile.
//
//   node scripts/marketing-importar.mjs                                    (simula con el plan de ejemplo)
//   node scripts/marketing-importar.mjs --archivo plan.json                (simula con otro archivo)
//   node scripts/marketing-importar.mjs --aplicar                          (envía a http://localhost:3000)
//   node scripts/marketing-importar.mjs --aplicar --url https://atlascrm.geimser.cl
//
// La clave se toma de MARKETING_INGEST_SECRET en el entorno o, si no está, de
// .env.local (o de ATLAS_ENV_PATH).

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const POR_ENVIO = 200;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

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

function secreto() {
  if (process.env.MARKETING_INGEST_SECRET?.trim()) return process.env.MARKETING_INGEST_SECRET.trim();
  const ruta = process.env.ATLAS_ENV_PATH || [join(scriptDir, "..", ".env.local")].find(existsSync);
  return ruta ? loadEnv(ruta).MARKETING_INGEST_SECRET?.trim() || null : null;
}

const aplicar = process.argv.includes("--aplicar");
const archivo = resolve(argument("--archivo") ?? join(scriptDir, "marketing-altius-semana-41.json"));
const base = (argument("--url") ?? "http://localhost:3000").replace(/\/+$/, "");

const plan = JSON.parse(readFileSync(archivo, "utf8"));
const items = Array.isArray(plan) ? plan : plan.items;
if (!Array.isArray(items) || items.length === 0) {
  console.error(`✗ ${archivo} no trae piezas: se espera { "items": [...] }`);
  process.exit(1);
}

// Lo mínimo para no mandar algo que el servidor va a rechazar entero; la
// validación completa (catálogo, fechas, enlaces) es la del servidor.
const sinId = items.filter((item) => typeof item?.external_id !== "string" || !item.external_id.trim());
if (sinId.length > 0) {
  console.error(`✗ ${sinId.length} pieza(s) sin external_id: sin él no se pueden actualizar después.`);
  process.exit(1);
}

console.log(`${items.length} piezas en ${archivo}`);
const porDia = new Map();
for (const item of items) {
  const dia = String(item.scheduled_at ?? "sin fecha").slice(0, 10);
  porDia.set(dia, [...(porDia.get(dia) ?? []), item]);
}
for (const [dia, lista] of [...porDia.entries()].sort()) {
  console.log(`  ${dia}`);
  for (const item of lista.sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))) {
    console.log(`    ${String(item.scheduled_at ?? "").slice(11, 16) || "--:--"}  ${String(item.channel).padEnd(14)} ${String(item.status ?? "borrador").padEnd(10)} ${item.title}`);
  }
}

if (!aplicar) {
  console.log(`\nSimulación: no se envió nada. Agrega --aplicar para cargarlo en ${base}.`);
  process.exit(0);
}

const clave = secreto();
if (!clave) {
  console.error("✗ Falta MARKETING_INGEST_SECRET (en el entorno o en .env.local).");
  process.exit(1);
}

let guardadas = 0;
for (let inicio = 0; inicio < items.length; inicio += POR_ENVIO) {
  const cuerpo = JSON.stringify({ items: items.slice(inicio, inicio + POR_ENVIO) });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const firma = createHmac("sha256", clave).update(`${timestamp}.${cuerpo}`).digest("hex");
  const respuesta = await fetch(`${base}/api/marketing/items`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-atlas-timestamp": timestamp, "x-atlas-signature": firma },
    body: cuerpo,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    console.error(`✗ ${respuesta.status} ${datos.error ?? respuesta.statusText}`);
    for (const pieza of datos.piezas ?? []) {
      console.error(`   #${pieza.indice} ${pieza.external_id ?? ""}: ${pieza.errores.join("; ")}`);
    }
    process.exit(1);
  }
  guardadas += datos.guardadas ?? 0;
}

console.log(`\n✓ ${guardadas} piezas guardadas en ${base}/dashboard/marketing`);
