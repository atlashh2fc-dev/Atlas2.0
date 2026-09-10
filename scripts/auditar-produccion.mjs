#!/usr/bin/env node
// Compara lo que corre en produccion contra lo que existe en el repositorio.
//
// Existe porque el 2026-09-10 produccion estuvo tres horas sirviendo commits
// que ningun clon del equipo tenia, y nadie se entero hasta que el codigo
// desaparecio. Este script detecta esa deriva en segundos.
//
// Uso:  npm run auditar:prod
// Token: usa VERCEL_TOKEN si esta definido; si no, el del CLI ya autenticado.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECT_ID = "prj_BbjLHhbfyKZdd5TKqPM1jMT3maQD";
const TEAM_ID = "team_IJlj5eIFM7pBtOCDNOQN0eZs";

function token() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const rutas = [
    join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
    join(homedir(), ".local/share/com.vercel.cli/auth.json"),
  ];
  for (const ruta of rutas) {
    try {
      return JSON.parse(readFileSync(ruta, "utf8")).token;
    } catch {}
  }
  throw new Error("No hay token de Vercel. Define VERCEL_TOKEN o corre: vercel login");
}

// Commits huerfanos cuyo contenido ya se rescato a mano. El SHA original no
// va a existir nunca, asi que sin esta lista la auditoria alertaria para siempre.
function yaRecuperados() {
  try {
    return new Set(
      readFileSync(new URL("./deploys-recuperados.txt", import.meta.url), "utf8")
        .split("\n")
        .map((l) => l.replace(/#.*/, "").trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

const RECUPERADOS = yaRecuperados();

function existeEnElRepo(sha) {
  if (!sha) return false;
  if ([...RECUPERADOS].some((r) => sha.startsWith(r))) return true;
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const url =
  `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}` +
  `&teamId=${TEAM_ID}&target=production&limit=20`;

const respuesta = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
if (!respuesta.ok) {
  console.error(`Vercel respondio ${respuesta.status}`);
  process.exit(2);
}

execFileSync("git", ["fetch", "--quiet", "origin"], { stdio: "ignore" });

const { deployments } = await respuesta.json();
const huerfanos = [];

console.log("");
console.log("  Ultimos despliegues de produccion");
console.log("");

for (const d of deployments) {
  const meta = d.meta ?? {};
  const sha = meta.githubCommitSha ?? "";
  const enRepo = existeEnElRepo(sha);
  const fecha = new Date(d.created).toISOString().slice(0, 16).replace("T", " ");
  const autor = meta.githubCommitAuthorName ?? "desconocido";
  const marca = enRepo ? "ok      " : "HUERFANO";
  console.log(
    `  ${marca}  ${fecha}  ${(d.source ?? "?").padEnd(4)}  ${(sha.slice(0, 9) || "-").padEnd(9)}  ${autor}`,
  );
  if (!enRepo) huerfanos.push({ ...meta, id: d.uid, fecha, sha });
}

console.log("");

if (huerfanos.length === 0) {
  console.log("  Todo lo que corre en produccion existe en el repositorio.");
  console.log("");
  process.exit(0);
}

console.log(`  ${huerfanos.length} despliegue(s) con codigo que el repositorio no tiene:`);
console.log("");
for (const h of huerfanos) {
  console.log(`    ${h.sha.slice(0, 9)}  ${h.githubCommitMessage ?? "(sin mensaje)"}`);
  console.log(`               autor: ${h.githubCommitAuthorName ?? "?"} <${h.githubCommitAuthorEmail ?? "?"}>`);
  console.log(`               deployment: ${h.id}`);
}
console.log("");
console.log("  Ese codigo solo vive en el portatil de quien lo desplego y en el");
console.log("  build de Vercel. Pidele que lo publique antes de tocar main.");
console.log("");
process.exit(1);
