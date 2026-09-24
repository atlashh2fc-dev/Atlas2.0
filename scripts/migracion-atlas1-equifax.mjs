// Extrae de Atlas 1 (Registro Intel) los clientes Equifax gestionados, sus agendas y todo
// su historial de llamadas hasta el corte, y los deja en las tablas mig_a1_* de Atlas 2.0.
// La carga final la hace public.migracion_atlas1_equifax_aplicar() (ver la migración
// 20260924130451_migracion_atlas1_equifax.sql).
//
//   node scripts/migracion-atlas1-equifax.mjs --corte 2026-09-24T12:49:28Z
//
// Se puede correr de nuevo con un corte posterior: solo suma lo nuevo.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV =
  process.env.ATLAS_ENV_PATH ||
  [join(scriptDir, "..", ".env.local"), "/Users/hh/Claude/Projects/Atlas 2.0/.env.local"].find(existsSync);
const LEGACY_ENV = process.env.LEGACY_ENV_PATH || "/Users/hh/Projects/active/registro-intel/.env.local";

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

const corte = argument("--corte");
if (!corte || Number.isNaN(Date.parse(corte))) {
  throw new Error("Falta --corte con una fecha ISO, por ejemplo --corte 2026-09-24T12:49:28Z");
}
const corteSql = new Date(corte).toISOString().replace(/'/g, "");

// Universo: campañas Equifax/Dicom; clientes con llamadas, intentos, gestión o agenda.
const universe = `
  create temp table eq as
    select id, name from public.campaigns where name ilike any (array['%equifax%', '%dicom%']);
  -- Una llamada sin cliente de base se hizo desde el módulo de contactos: ese contacto
  -- entra como cliente propio ('contact:<id>') y se funde por RUT con la base si coincide.
  create temp table scope_calls as
    select c.*, coalesce(c.lead_id::text, (
      select l.id::text from public.campaign_base_leads l
      where l.contact_id = c.contact_id and l.campaign_id = c.campaign_id
      order by l.managed_at desc nulls last limit 1
    ), 'contact:' || c.contact_id::text) as resolved_lead_id
    from public.calls c
    where c.campaign_id in (select id from eq)
      and coalesce(c.started_at, c.created_at) < '${corteSql}'::timestamptz;
  create temp table scope_leads as
    select l.* from public.campaign_base_leads l
    where l.campaign_id in (select id from eq)
      and (
        l.id::text in (select resolved_lead_id from scope_calls where resolved_lead_id is not null)
        or coalesce(l.attempts_count, 0) > 0
        or l.managed_at is not null
        or l.next_action_at is not null
      );
  create index on scope_leads (id);
  create temp table scope_contacts as
    select distinct on (c.contact_id) c.contact_id, c.campaign_id, ct.rut, ct.full_name, ct.email,
      ct.address_line1, ct.phone_normalized, ct.phone_mobile, ct.phone_contact, ct.created_at,
      c.reason, c.agent_id, c.started_at, c.ended_at, c.next_action_at,
      count(*) over (partition by c.contact_id) as attempts
    from scope_calls c join public.contacts ct on ct.id = c.contact_id
    where c.resolved_lead_id like 'contact:%'
    order by c.contact_id, c.started_at desc nulls last;
`;

const exports = {
  mig_a1_agents: `
    select a.id::text as legacy_agent_id, p.full_name, lower(u.email) as email, p.role
    from (
      select agent_id as id from scope_calls
      union select callback_owner_user_id from scope_calls
      union select managed_by from scope_leads
      union select assigned_user_id from scope_leads
    ) a
    left join public.profiles p on p.user_id = a.id
    left join auth.users u on u.id = a.id
    where a.id is not null`,
  mig_a1_leads: `
    select l.id::text as legacy_lead_id, e.name as legacy_campaign, l.rut_empresa as rut, l.razon_social,
      l.nombre_cliente, l.mail, l.direccion_empresa as direccion,
      (select p.phone_normalized from public.campaign_base_lead_phones p
        where p.lead_id = l.id order by p.is_primary desc, p.position limit 1) as phone_primary,
      l.tipificacion_actual, l.observacion_actual, l.workflow_status, l.assignment_status,
      l.managed_at, l.managed_by::text as managed_by_legacy, l.assigned_user_id::text as assigned_legacy,
      l.next_action_at, l.attempts_count, l.last_call_started_at, l.created_at,
      l.atlas_first_opened_at as mail_first_opened_at, l.atlas_last_opened_at as mail_last_opened_at,
      l.atlas_first_clicked_at as mail_first_clicked_at, l.atlas_last_clicked_at as mail_last_clicked_at
    from scope_leads l join eq e on e.id = l.campaign_id
    union all
    select 'contact:' || k.contact_id::text, e.name, k.rut, k.full_name, null, k.email, k.address_line1,
      coalesce(nullif(k.phone_normalized, ''), k.phone_mobile, k.phone_contact),
      k.reason, null,
      case when k.next_action_at > now() then 'callback' else 'managed' end,
      'managed', coalesce(k.ended_at, k.started_at), k.agent_id::text, null,
      case when k.next_action_at > now() then k.next_action_at end,
      k.attempts, k.started_at, k.created_at, null, null, null, null
    from scope_contacts k join eq e on e.id = k.campaign_id`,
  mig_a1_phones: `
    select p.id::text as legacy_phone_id, p.lead_id::text as legacy_lead_id, p.position, p.label,
      p.phone_raw, p.phone_normalized, p.is_primary, p.is_callable
    from public.campaign_base_lead_phones p join scope_leads l on l.id = p.lead_id
    union all
    select 'contact:' || k.contact_id::text || ':' || x.kind, 'contact:' || k.contact_id::text, x.pos, x.kind,
      x.phone, x.phone, x.pos = 1, true
    from scope_contacts k
    cross join lateral (values (1, 'movil', k.phone_mobile), (2, 'contacto', k.phone_contact)) as x(pos, kind, phone)
    where nullif(btrim(x.phone), '') is not null`,
  mig_a1_calls: `
    select c.id::text as legacy_call_id, c.resolved_lead_id as legacy_lead_id, e.name as legacy_campaign,
      c.agent_id::text as agent_legacy, c.callback_owner_user_id::text as callback_owner_legacy,
      c.started_at, c.ended_at, c.created_at, c.status, c.outcome, c.reason, c.notes, c.next_action_at,
      c.phone_number, c.telephony_duration_seconds as duration_seconds,
      nullif(c.custom_fields, '{}'::jsonb) as custom_fields,
      (select array_agg(pr->>'label' order by ord) from equifax_contactability_snapshots s,
         jsonb_array_elements(case when jsonb_typeof(s.snapshot_json->'products') = 'array'
           then s.snapshot_json->'products' else '[]'::jsonb end) with ordinality as x(pr, ord)
       where s.call_id = c.id and pr->>'label' is not null) as products,
      (select case
          when jsonb_typeof(s.snapshot_json->'monthlyUf') = 'number' then (s.snapshot_json->>'monthlyUf')::numeric
          when s.snapshot_json->>'monthlyUf' ~ '^[0-9]+([.,][0-9]+)?$' then replace(s.snapshot_json->>'monthlyUf', ',', '.')::numeric
        end
       from equifax_contactability_snapshots s where s.call_id = c.id limit 1) as uf
    from scope_calls c join eq e on e.id = c.campaign_id`,
};

function exportTable(legacyUrl, table, query, outPath, tempDir) {
  const sqlPath = join(tempDir, `${table}.sql`);
  writeFileSync(
    sqlPath,
    `set statement_timeout = 0;\n${universe}\nselect row_to_json(t) from (${query}) t;\n`
  );
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", `psql "$LEGACY_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "${sqlPath}" > "${outPath}"`], {
      env: { ...process.env, LEGACY_URL: legacyUrl },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${table}: ${stderr.split("\n").filter((l) => !/collation|DETAIL|DETALLE|HINT|SUGERENCIA|WARNING/.test(l)).join("\n")}`));
    });
  });
}

async function loadTable(atlas, table, path, key) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let batch = [];
  let total = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const { error } = await atlas.from(table).upsert(batch, { onConflict: key });
    if (error) throw new Error(`${table}: ${error.message}`);
    total += batch.length;
    batch = [];
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= 500) await flush();
  }
  await flush();
  return total;
}

async function run() {
  const legacyEnv = loadEnv(LEGACY_ENV);
  const atlasEnv = loadEnv(ATLAS_ENV);
  const legacyUrl = (legacyEnv.POSTGRES_URL_NON_POOLING || legacyEnv.POSTGRES_URL || "").replace(/\?.*$/, "");
  if (!legacyUrl) throw new Error("No encontré la conexión Postgres de Atlas 1.");

  const atlasUrl = atlasEnv.NEXT_PUBLIC_SUPABASE_URL || atlasEnv.SUPABASE_URL;
  if (!atlasUrl.includes("lxdclavsycdidmzlbaid")) throw new Error(`Destino inesperado: ${atlasUrl}`);
  const atlas = createClient(atlasUrl, atlasEnv.SUPABASE_SERVICE_ROLE_KEY || atlasEnv.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tempDir = mkdtempSync(join(process.env.MIG_TMPDIR || tmpdir(), "atlas1-equifax-"));
  const keys = {
    mig_a1_agents: "legacy_agent_id",
    mig_a1_leads: "legacy_lead_id",
    mig_a1_phones: "legacy_phone_id",
    mig_a1_calls: "legacy_call_id",
  };
  const summary = { corte: corteSql };
  try {
    for (const [table, query] of Object.entries(exports)) {
      const outPath = join(tempDir, `${table}.jsonl`);
      const started = Date.now();
      await exportTable(legacyUrl, table, query, outPath, tempDir);
      summary[table] = await loadTable(atlas, table, outPath, keys[table]);
      console.error(`${table}: ${summary[table]} filas en ${Math.round((Date.now() - started) / 1000)} s`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
