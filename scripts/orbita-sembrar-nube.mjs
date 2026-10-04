// Pasa agentes de Atlas Órbita a la nube de Atlas y carga su memoria inicial.
//
// Para cada agente indicado fija su motor ('ceo', 'lider', 'inteligencia',
// 'guardian') y su ficha (`instrucciones`), tomada de un archivo Markdown sin
// las secciones que solo sirven en el equipo local (latido, comandos). Además
// carga la memoria compartida (estrategia, reglas, competidores) como notas,
// sin duplicar las que ya existen con el mismo título.
//
//   node scripts/orbita-sembrar-nube.mjs --desde /ruta/altius-marketing              (simula)
//   node scripts/orbita-sembrar-nube.mjs --desde /ruta/altius-marketing --aplicar
//
// Usa NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del entorno o de
// .env.local (o de ATLAS_ENV_PATH). La empresa es --empresa (por defecto altius).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
};

const desde = argumento("--desde");
if (!desde) {
  console.error("✗ Falta --desde <carpeta del sistema de marketing de la empresa>");
  process.exit(1);
}
const empresa = argumento("--empresa") ?? "altius";
const aplicar = process.argv.includes("--aplicar");

// Qué agentes pasan a la nube y de qué archivo sale su ficha.
const AGENTES = [
  { codigo: "0", motor: "ceo", ficha: "contenido/grupos/agentes/0-ceo-marketing.md", duracion: 20 },
  { codigo: "7", motor: "lider", ficha: "contenido/grupos/agentes/7-lider-resultados.md", duracion: 20 },
  { codigo: "8", motor: "inteligencia", ficha: "contenido/grupos/agentes/8-inteligencia.md", duracion: 25 },
  { codigo: "G", motor: "guardian", ficha: null, duracion: 5, cron: "*/5 * * * *", horario: "Cada 5 min, en la nube de Atlas" },
];

// La memoria compartida inicial.
const NOTAS = [
  { tipo: "estrategia", titulo: "Estrategia paraguas", archivo: "contenido/grupos/estrategia-paraguas.md" },
  { tipo: "reglas", titulo: "Reglas y riesgos", archivo: "sistema/reglas-y-riesgos.md" },
  { tipo: "competidores", titulo: "Competidores y referentes", archivo: "inteligencia/competidores.md" },
];

function cargarEnv() {
  const ruta = process.env.ATLAS_ENV_PATH || [join(scriptDir, "..", ".env.local")].find(existsSync);
  if (!ruta || !existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#") || !limpia.includes("=")) continue;
    const i = limpia.indexOf("=");
    const clave = limpia.slice(0, i);
    let valor = limpia.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
    if (!process.env[clave]) process.env[clave] = valor;
  }
}

/** La ficha sin lo que solo sirve en el equipo local: el latido y el título. */
function fichaParaLaNube(markdown) {
  const secciones = markdown.split(/\n(?=## )/);
  return secciones
    .filter((seccion, i) => i > 0 && !/^## .*(Latido|memoria compartida)/i.test(seccion))
    .join("\n")
    .trim();
}

const leer = (relativa) => {
  const ruta = resolve(desde, relativa);
  if (!existsSync(ruta)) {
    console.error(`✗ No existe ${ruta}`);
    process.exit(1);
  }
  return readFileSync(ruta, "utf8").trim();
};

const plan = AGENTES.map((agente) => ({ ...agente, instrucciones: agente.ficha ? fichaParaLaNube(leer(agente.ficha)) : null }));
const notas = NOTAS.map((nota) => ({ ...nota, contenido: leer(nota.archivo) }));

console.log(`Empresa: ${empresa}`);
for (const agente of plan) {
  console.log(`  ${agente.codigo.padEnd(2)} → motor ${agente.motor.padEnd(12)} ficha ${agente.instrucciones ? `${agente.instrucciones.length} caracteres` : "—"}`);
}
for (const nota of notas) console.log(`  nota ${nota.tipo.padEnd(12)} «${nota.titulo}» ${nota.contenido.length} caracteres`);

if (!aplicar) {
  console.log("\nSimulación: no se envió nada. Agrega --aplicar para cargarlo.");
  process.exit(0);
}

cargarEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !clave) {
  console.error("✗ Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(url, clave, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: organizationId, error: errorEmpresa } = await admin.rpc("organization_id_by_slug", { p_slug: empresa });
if (errorEmpresa || typeof organizationId !== "string") {
  console.error(`✗ Empresa «${empresa}» no encontrada`, errorEmpresa?.message ?? "");
  process.exit(1);
}

for (const agente of plan) {
  const cambio = { motor: agente.motor, duracion_max_min: agente.duracion, activo: true };
  if (agente.instrucciones) cambio.instrucciones = agente.instrucciones;
  if (agente.cron) cambio.cron = agente.cron;
  if (agente.horario) cambio.horario = agente.horario;
  const { data, error } = await admin.from("orbita_agentes").update(cambio).eq("organization_id", organizationId).eq("codigo", agente.codigo).select("codigo");
  if (error) {
    console.error(`✗ Agente ${agente.codigo}: ${error.message}`);
    process.exit(1);
  }
  console.log(data?.length ? `✓ ${agente.codigo} en la nube (${agente.motor})` : `· ${agente.codigo} no existe en la red; se omite`);
}

for (const nota of notas) {
  const { count } = await admin
    .from("orbita_notas")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("tipo", nota.tipo)
    .eq("titulo", nota.titulo);
  if (count) {
    console.log(`· nota «${nota.titulo}» ya estaba`);
    continue;
  }
  const { error } = await admin.from("orbita_notas").insert({ organization_id: organizationId, tipo: nota.tipo, titulo: nota.titulo, contenido: nota.contenido, datos: { origen: nota.archivo } });
  if (error) {
    console.error(`✗ Nota «${nota.titulo}»: ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ nota «${nota.titulo}»`);
}
console.log("\nListo.");
