// Completa la persona de contacto de los leads de empresas con Bigdata.
//
// En Equifax el registro es la razón social y el export de Vocalcom trae vacía
// la columna del representante. Bigdata (empresa_telefonos) sabe quién está
// detrás de cada número y de cada RUT. Por lead sin persona se elige, en orden:
//   1. la persona del mismo número que se marca,
//   2. el representante legal del RUT,
//   3. cualquier otra persona del RUT (prioridad de Bigdata),
//   4. el ejecutivo registrado (company_best_executive_contact).
// Se guarda en extra.contacto con public.completar_contacto_leads(), que no
// pisa un contacto existente: se puede volver a correr tras cada carga.
//
//   node scripts/completar-contacto-bigdata.mjs --campana Equifax            (simula)
//   node scripts/completar-contacto-bigdata.mjs --campana Equifax --aplicar  (escribe)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV =
  process.env.ATLAS_ENV_PATH ||
  [join(scriptDir, "..", ".env.local"), "/Users/hh/Claude/Projects/Atlas 2.0/.env.local"].find(existsSync);
const BIGDATA_ENV = process.env.BIGDATA_ENV_PATH || "/Users/hh/Projects/active/Bigdata/mdata/.env.production.local";
const CARGADO = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Santiago" });

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

const normalize = (value) =>
  String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** "76.567.607-K" → "076567607K", el formato de rutid en Bigdata. */
function toRutid(rut) {
  const clean = String(rut ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
  return clean.length >= 2 ? clean.padStart(10, "0") : null;
}

/** Últimos 9 dígitos: Bigdata guarda "226386876", Atlas "+56226386876". */
const phoneKey = (phone) => String(phone ?? "").replace(/\D/g, "").slice(-9) || null;

const COMPANY_NAME = /\b(spa|s\.?p\.?a|ltda|limitada|s\.?a\.?|eirl|e\.i\.r\.l|sociedad|compa[nñ]ia|inversiones)\b/i;
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "van", "von"]);

function titleCase(name) {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => (index > 0 && PARTICLES.has(word) ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function titleCargo(cargo) {
  const clean = String(cargo ?? "").trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1).toLowerCase() : null;
}

/** Misma regla que src/lib/lead-extra.ts: ¿ya hay una persona distinta del registro? */
function hasPerson(lead) {
  const extra = lead.extra ?? {};
  if (extra.contacto && typeof extra.contacto === "object") return true;
  const scopes = [extra, extra.base_discado, extra.atlas1].filter((s) => s && typeof s === "object");
  for (const scope of scopes) {
    for (const key of ["contact_name", "nombre_contacto", "nombre_cliente"]) {
      const value = scope[key];
      if (typeof value === "string" && value.trim() && normalize(value) !== normalize(lead.full_name)) return true;
    }
  }
  return false;
}

function usablePerson(name, recordName) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (clean.length < 5 || !clean.includes(" ")) return null;
  if (COMPANY_NAME.test(clean) || normalize(clean) === normalize(recordName)) return null;
  return clean;
}

async function pagedLeads(atlas, campaignIds) {
  const leads = [];
  let from = 0;
  const size = 1000;
  for (;;) {
    const { data, error } = await atlas
      .from("leads")
      .select("id, rut, phone, full_name, extra")
      .in("campaign_id", campaignIds)
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(`leads: ${error.message}`);
    leads.push(...data);
    if (data.length < size) return leads;
    from += size;
  }
}

async function inChunks(items, size, work) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await work(items.slice(i, i + size))));
  return out;
}

async function main() {
  const campaignName = argument("--campana") ?? "Equifax";
  const apply = process.argv.includes("--aplicar");
  if (!ATLAS_ENV || !existsSync(BIGDATA_ENV)) throw new Error("Faltan los .env de Atlas o de Bigdata.");
  const atlasEnv = loadEnv(ATLAS_ENV);
  const bigEnv = loadEnv(BIGDATA_ENV);
  const atlas = createClient(atlasEnv.SUPABASE_URL ?? atlasEnv.NEXT_PUBLIC_SUPABASE_URL, atlasEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const bigdata = createClient(bigEnv.SUPABASE_URL ?? bigEnv.NEXT_PUBLIC_SUPABASE_URL, bigEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: campaigns, error: campaignError } = await atlas.from("campaigns").select("id, name").eq("name", campaignName);
  if (campaignError) throw new Error(campaignError.message);
  if (!campaigns?.length) throw new Error(`No existe la campaña ${campaignName}.`);

  const leads = await pagedLeads(atlas, campaigns.map((c) => c.id));
  const pending = leads.filter((lead) => !hasPerson(lead) && toRutid(lead.rut));
  console.log(`${campaignName}: ${leads.length} leads, ${pending.length} sin persona de contacto.`);

  const rutids = [...new Set(pending.map((lead) => toRutid(lead.rut)))];
  const phonesByRut = new Map();
  const phoneRows = await inChunks(rutids, 200, async (chunk) => {
    const { data, error } = await bigdata
      .from("empresa_telefonos")
      .select("rutid, telefono, nombre_origen, cargo_origen, prioridad")
      .in("rutid", chunk)
      .not("nombre_origen", "is", null);
    if (error) throw new Error(`empresa_telefonos: ${error.message}`);
    return data;
  });
  for (const row of phoneRows) {
    if (!phonesByRut.has(row.rutid)) phonesByRut.set(row.rutid, []);
    phonesByRut.get(row.rutid).push(row);
  }

  const sinTelefonos = rutids.filter((rutid) => !phonesByRut.has(rutid));
  const executives = new Map();
  const executiveRows = await inChunks(sinTelefonos, 200, async (chunk) => {
    const { data, error } = await bigdata
      .from("company_best_executive_contact")
      .select("rutid, nombre_ejecutivo, cargo, mejor_telefono")
      .in("rutid", chunk);
    if (error) throw new Error(`company_best_executive_contact: ${error.message}`);
    return data;
  });
  for (const row of executiveRows) executives.set(row.rutid, row);

  const counts = { mismo_numero: 0, representante_legal: 0, otra_persona_rut: 0, ejecutivo: 0, sin_dato: 0 };
  const filas = [];
  for (const lead of pending) {
    const rutid = toRutid(lead.rut);
    const dialed = phoneKey(lead.phone);
    const candidates = (phonesByRut.get(rutid) ?? [])
      .map((row) => ({ ...row, nombre: usablePerson(row.nombre_origen, lead.full_name) }))
      .filter((row) => row.nombre);
    const byPriority = (a, b) => (a.prioridad ?? 99) - (b.prioridad ?? 99);
    const sameNumber = candidates.filter((row) => dialed && phoneKey(row.telefono) === dialed).sort(byPriority)[0];
    const legal = candidates.filter((row) => /represent/i.test(row.cargo_origen ?? "")).sort(byPriority)[0];
    const anyone = [...candidates].sort(byPriority)[0];
    const chosen = sameNumber ?? legal ?? anyone;

    let contacto = null;
    if (chosen) {
      const via = sameNumber ? "mismo_numero" : legal ? "representante_legal" : "otra_persona_rut";
      counts[via] += 1;
      contacto = {
        nombre: titleCase(chosen.nombre),
        cargo: titleCargo(chosen.cargo_origen),
        telefono: chosen.telefono ? `+56${phoneKey(chosen.telefono)}` : null,
        del_numero_marcado: Boolean(sameNumber),
        fuente: "bigdata",
        cargado: CARGADO,
      };
    } else {
      const executive = executives.get(rutid);
      const nombre = executive && usablePerson(executive.nombre_ejecutivo, lead.full_name);
      if (nombre) {
        counts.ejecutivo += 1;
        contacto = {
          nombre: titleCase(nombre),
          cargo: titleCargo(executive.cargo),
          telefono: executive.mejor_telefono ? `+56${phoneKey(executive.mejor_telefono)}` : null,
          del_numero_marcado: phoneKey(executive.mejor_telefono) === dialed,
          fuente: "bigdata_ejecutivos",
          cargado: CARGADO,
        };
      } else {
        counts.sin_dato += 1;
      }
    }
    if (contacto) filas.push({ id: lead.id, contacto });
  }

  console.log("Resultado:", counts);
  console.log("Ejemplos:", filas.slice(0, 3).map((f) => f.contacto));
  if (!apply) {
    console.log(`Simulación: se completarían ${filas.length} leads. Agrega --aplicar para escribir.`);
    return;
  }

  let written = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const { data, error } = await atlas.rpc("completar_contacto_leads", { p_filas: filas.slice(i, i + 500) });
    if (error) throw new Error(`completar_contacto_leads: ${error.message}`);
    written += data ?? 0;
  }
  console.log(`Listo: ${written} leads con persona de contacto.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
