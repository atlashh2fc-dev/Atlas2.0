// Declara los agentes de Atlas Órbita de una empresa (y, si se quiere, sus
// eventos) en el monitor Órbita de Atlas.
//
// Lee un JSON con `{ "agentes": [...], "eventos": [...] }` (ver
// scripts/orbita-altius-agentes.json) y lo envía a POST /api/orbita/eventos,
// la misma puerta que usan los agentes: firma HMAC-SHA256 de
// `<timestamp>.<cuerpo>` con MARKETING_INGEST_SECRET. La empresa no la elige
// el script: está atada a la clave en el servidor (MARKETING_INGEST_ORG, por
// defecto "altius").
//
// Cada agente se identifica por su código: volver a correrlo con el mismo
// archivo actualiza los agentes, no los duplica. Los eventos, en cambio, se
// suman a la bitácora cada vez. Las horas sin zona ("2026-10-05 13:00") son
// de Chile.
//
//   node scripts/orbita-importar.mjs                                    (simula con los agentes de Altius)
//   node scripts/orbita-importar.mjs --archivo red.json                 (simula con otro archivo)
//   node scripts/orbita-importar.mjs --aplicar                          (envía a http://localhost:3000)
//   node scripts/orbita-importar.mjs --aplicar --url https://atlascrm.geimser.cl
//   node scripts/orbita-importar.mjs --demo                             (suma una ronda de eventos de muestra de "ahora";
//                                                                        cuentan en las cifras: no usar en producción)
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

/** Una ronda de muestra, con horas relativas a ahora, para ver la red viva. */
function eventosDeMuestra(codigos) {
  const hace = (minutos) => new Date(Date.now() - minutos * 60_000).toISOString();
  const muestra = [
    { agente: "8", tipo: "inicio", resumen: "Revisión de competencia y tendencias", ocurrido_at: hace(48) },
    { agente: "8", tipo: "fin", resumen: "3 ideas con evidencia: Reels de antes y después funcionan en dental", relacionado_con: "0", ocurrido_at: hace(41) },
    { agente: "0", tipo: "decision", resumen: "Foco del día: Veterinaria. Aprueba 4 piezas y rechaza 1 por tono", relacionado_con: "3", ocurrido_at: hace(35) },
    { agente: "0", tipo: "decision", resumen: "Encarga un Reel de antes y después para Dental", relacionado_con: "9", ocurrido_at: hace(8) },
    { agente: "1", tipo: "fin", resumen: "Publicado en 3 grupos de veterinarios", relacionado_con: "6", ocurrido_at: hace(26) },
    { agente: "2", tipo: "error", resumen: "El grupo «Pymes de Chile» pidió aprobación de admin", ocurrido_at: hace(19) },
    { agente: "G", tipo: "recuperacion", resumen: "Relanzó al agente 2 tras el error", relacionado_con: "2", ocurrido_at: hace(6) },
    { agente: "2", tipo: "inicio", resumen: "Reintento en otro grupo de la rotación", ocurrido_at: hace(5) },
    { agente: "3", tipo: "inicio", resumen: "Preparando el Reel corto de la agenda veterinaria", ocurrido_at: hace(3) },
    { agente: "7", tipo: "fin", resumen: "Reporte diario: alcance +18 %, 4 conversaciones nuevas", relacionado_con: "0", ocurrido_at: hace(4) },
    { agente: "6", tipo: "fin", resumen: "12 publicaciones verificadas, 1 resubida", relacionado_con: "7", ocurrido_at: hace(2) },
    { agente: "G", tipo: "alerta", estado: "atrasado", resumen: "El agente 5 no corrió a su hora", relacionado_con: "5", ocurrido_at: hace(1) },
    { agente: "G", tipo: "pulso", resumen: "Ronda de vigilancia: 10 de 11 al día", ocurrido_at: hace(0) },
  ];
  return muestra
    .filter((evento) => codigos.has(evento.agente) && (!evento.relacionado_con || codigos.has(evento.relacionado_con)))
    .map((evento) => ({ ...evento, detalle: { muestra: true } }));
}

const aplicar = process.argv.includes("--aplicar");
const demo = process.argv.includes("--demo");
const archivo = resolve(argument("--archivo") ?? join(scriptDir, "orbita-altius-agentes.json"));
const base = (argument("--url") ?? "http://localhost:3000").replace(/\/+$/, "");

const red = JSON.parse(readFileSync(archivo, "utf8"));
const agentes = Array.isArray(red.agentes) ? red.agentes : [];
const codigos = new Set(agentes.map((agente) => String(agente?.codigo ?? "").trim().toUpperCase()));
const eventos = [...(Array.isArray(red.eventos) ? red.eventos : []), ...(demo ? eventosDeMuestra(codigos) : [])];
if (agentes.length === 0 && eventos.length === 0) {
  console.error(`✗ ${archivo} no trae agentes ni eventos: se espera { "agentes": [...], "eventos": [...] }`);
  process.exit(1);
}

// Lo mínimo para no mandar algo que el servidor va a rechazar entero; la
// validación completa (catálogo, colores, conexiones) es la del servidor.
const sinCodigo = agentes.filter((agente) => !String(agente?.codigo ?? "").trim() || !String(agente?.nombre ?? "").trim());
if (sinCodigo.length > 0) {
  console.error(`✗ ${sinCodigo.length} agente(s) sin código o sin nombre.`);
  process.exit(1);
}

console.log(`${agentes.length} agentes y ${eventos.length} eventos en ${archivo}${demo ? " (con muestra)" : ""}`);
for (const agente of agentes) {
  const conexiones = (agente.conexiones ?? []).map((conexion) => `${conexion.tipo}→${conexion.a}`).join(", ");
  console.log(`  ${String(agente.codigo).padEnd(2)} ${String(agente.nombre).padEnd(34)} ${String(agente.horario ?? "").padEnd(36)} ${conexiones}`);
}
for (const evento of eventos) {
  console.log(`  · ${String(evento.ocurrido_at ?? "ahora").slice(0, 16).padEnd(16)} ${String(evento.agente).padEnd(2)} ${String(evento.tipo).padEnd(13)} ${evento.resumen ?? ""}`);
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

async function enviar(cuerpoObjeto) {
  const cuerpo = JSON.stringify(cuerpoObjeto);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const firma = createHmac("sha256", clave).update(`${timestamp}.${cuerpo}`).digest("hex");
  const respuesta = await fetch(`${base}/api/orbita/eventos`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-atlas-timestamp": timestamp, "x-atlas-signature": firma },
    body: cuerpo,
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    console.error(`✗ ${respuesta.status} ${datos.error ?? respuesta.statusText}`);
    for (const error of datos.detalle ?? []) {
      console.error(`   ${error.lista} #${error.indice} ${error.codigo ?? ""}: ${error.errores.join("; ")}`);
    }
    process.exit(1);
  }
  return datos;
}

// Primero los agentes (los eventos los necesitan declarados), después los eventos.
let guardados = { agentes: 0, eventos: 0 };
for (let inicio = 0; inicio < agentes.length; inicio += POR_ENVIO) {
  const datos = await enviar({ agentes: agentes.slice(inicio, inicio + POR_ENVIO) });
  guardados.agentes += datos.agentes ?? 0;
}
for (let inicio = 0; inicio < eventos.length; inicio += POR_ENVIO) {
  const datos = await enviar({ eventos: eventos.slice(inicio, inicio + POR_ENVIO) });
  guardados.eventos += datos.eventos ?? 0;
}

console.log(`\n✓ ${guardados.agentes} agentes y ${guardados.eventos} eventos guardados en ${base}/dashboard/orbita`);
