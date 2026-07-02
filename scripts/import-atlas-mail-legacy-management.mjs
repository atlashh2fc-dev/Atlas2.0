import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const ATLAS_ENV = process.env.ATLAS_ENV_PATH || join(scriptDir, "..", ".env.local");
const LEGACY_ENV = process.env.LEGACY_ENV_PATH || "/Users/hh/Projects/active/registro-intel/.env.local";
const SENTINEL_EMAIL = "migracion-historica@system.local";
const LEGACY_SOURCE = "equifax_crm_legado";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function postgresUrl(env) {
  const value = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
  return value ? value.replace(/\?.*$/, "") : "";
}

function serviceClient(env) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function csv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRut(value) {
  return String(value || "").toUpperCase().replace(/[^0-9K]/g, "");
}

async function fetchAll(client, table, select, buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(select).range(from, from + pageSize - 1);
    if (buildQuery) query = buildQuery(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchByIds(client, table, select, ids, column = "id", pageSize = 100) {
  const rows = [];
  for (let index = 0; index < ids.length; index += pageSize) {
    const { data, error } = await client.from(table).select(select).in(column, ids.slice(index, index + pageSize));
    if (error) throw new Error(`${table} chunk ${index}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function buildAtlasMailKeys(atlas, filePath) {
  const mailCampaigns = await fetchAll(
    atlas,
    "mail_campaigns",
    "id,name,campaign_id,umbrella_key",
    (query) => query.eq("umbrella_key", "equifax")
  );
  const mailCampaignById = new Map(mailCampaigns.map((campaign) => [campaign.id, campaign]));
  const batches = await fetchAll(
    atlas,
    "mail_result_batches",
    "id,mail_campaign_id,campaign_id",
    (query) => query.in("mail_campaign_id", mailCampaigns.map((campaign) => campaign.id))
  );
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const contacts = (
    await fetchAll(atlas, "mail_result_contacts", "lead_id,email,email_normalized,batch_id", (query) =>
      query.not("lead_id", "is", null)
    )
  ).filter((row) => batchById.has(row.batch_id));
  const leadIds = [...new Set(contacts.map((row) => row.lead_id).filter(Boolean))];
  const leads = await fetchByIds(atlas, "leads", "id,email,rut,full_name,campaign_id", leadIds);
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const rows = [];
  const seen = new Set();

  for (const contact of contacts) {
    const batch = batchById.get(contact.batch_id);
    const mailCampaign = mailCampaignById.get(batch?.mail_campaign_id);
    const lead = leadById.get(contact.lead_id);
    if (!mailCampaign || !lead) continue;

    const email = normalizeEmail(contact.email_normalized || contact.email || lead.email);
    const rut = normalizeRut(lead.rut);
    const key = [lead.id, mailCampaign.id, email, rut].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([lead.id, mailCampaign.id, mailCampaign.name, email, rut, lead.full_name]);
  }

  writeFileSync(filePath, rows.map((row) => row.map(csv).join(",")).join("\n"));
  return {
    rowCount: rows.length,
    leadCount: new Set(rows.map((row) => row[0])).size,
    campaignCount: new Set(rows.map((row) => row[1])).size,
  };
}

function exportLegacyCalls(legacyUrl, keysPath, outputPath, tempDir) {
  const sql = `
create temp table atlas_mail_keys (
  atlas_lead_id uuid,
  mail_campaign_id uuid,
  mail_campaign_name text,
  email text,
  rut text,
  full_name text
);
\\copy atlas_mail_keys from '${keysPath}' with (format csv)
with legacy_equifax_campaigns as (
    select id, name from public.campaigns where name ilike '%equifax%'
  ), legacy_leads as (
    select l.*, c.name as legacy_campaign_name
    from public.campaign_base_leads l
    join legacy_equifax_campaigns c on c.id = l.campaign_id
  ), legacy_email as (
    select l.id as legacy_lead_id, lower(trim(email_part)) as email
    from legacy_leads l
    cross join lateral regexp_split_to_table(coalesce(l.mail,''), '[|,;[:space:]]+') as email_part
    where nullif(trim(email_part),'') is not null
  ), matched as (
    select distinct k.atlas_lead_id, k.mail_campaign_id, k.mail_campaign_name, l.id as legacy_lead_id,
      l.campaign_id as legacy_campaign_id, l.legacy_campaign_name, 'email' as match_by
    from atlas_mail_keys k
    join legacy_email le on le.email = lower(k.email)
    join legacy_leads l on l.id = le.legacy_lead_id
    where nullif(k.email,'') is not null
    union
    select distinct k.atlas_lead_id, k.mail_campaign_id, k.mail_campaign_name, l.id,
      l.campaign_id, l.legacy_campaign_name, 'rut'
    from atlas_mail_keys k
    join legacy_leads l on regexp_replace(upper(coalesce(l.rut_empresa,'')), '[^0-9K]', '', 'g') = k.rut
    where nullif(k.rut,'') is not null
  ), call_matches as (
    select distinct on (m.atlas_lead_id, c.id)
      m.atlas_lead_id, m.mail_campaign_id, m.mail_campaign_name, m.legacy_lead_id,
      m.legacy_campaign_id, m.legacy_campaign_name, m.match_by, c.id as legacy_call_id,
      c.agent_id as legacy_agent_id, p.full_name as legacy_agent_name, c.started_at, c.ended_at,
      c.status, c.outcome, c.reason, c.notes, c.next_action_at, c.phone_number, c.created_at
    from matched m
    join public.calls c on c.lead_id = m.legacy_lead_id and c.ended_at is not null
    left join public.profiles p on p.user_id = c.agent_id
    order by m.atlas_lead_id, c.id, case m.match_by when 'email' then 0 else 1 end
  )
select coalesce(json_agg(call_matches), '[]'::json) from call_matches;
`;

  const sqlPath = join(tempDir, "legacy_export.sql");
  writeFileSync(sqlPath, sql);
  try {
    const stdout = execFileSync("psql", [legacyUrl, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", sqlPath], {
      stdio: "pipe",
      maxBuffer: 50 * 1024 * 1024,
    });
    writeFileSync(outputPath, stdout);
  } catch (error) {
    const stderr = error.stderr?.toString() || error.message;
    throw new Error(`Legacy export failed: ${stderr}`);
  }
}

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function legacyCallKey(row) {
  return `${LEGACY_SOURCE}:${row.legacy_call_id}:${row.atlas_lead_id}`;
}

function chunk(rows, size = 500) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function ensureHistoricalAgents(atlas, legacyRows) {
  const { data: existing, error } = await atlas
    .from("historical_agents")
    .select("id,full_name,legacy_executive_id,linked_profile_id")
    .eq("legacy_system", LEGACY_SOURCE);
  if (error) throw error;

  const byLegacyId = new Map((existing ?? []).map((agent) => [agent.legacy_executive_id, agent]));
  const missing = new Map();

  for (const row of legacyRows) {
    if (!row.legacy_agent_id || byLegacyId.has(row.legacy_agent_id)) continue;
    missing.set(row.legacy_agent_id, {
      legacy_system: LEGACY_SOURCE,
      legacy_executive_id: row.legacy_agent_id,
      full_name: row.legacy_agent_name || "Ejecutivo legado",
    });
  }

  if (missing.size > 0) {
    const { error: insertError } = await atlas.from("historical_agents").insert([...missing.values()]);
    if (insertError) throw insertError;
    const { data: refreshed, error: refreshError } = await atlas
      .from("historical_agents")
      .select("id,full_name,legacy_executive_id,linked_profile_id")
      .eq("legacy_system", LEGACY_SOURCE);
    if (refreshError) throw refreshError;
    return new Map((refreshed ?? []).map((agent) => [agent.legacy_executive_id, agent]));
  }

  return byLegacyId;
}

async function existingCallKeys(atlas, keys) {
  const existing = new Set();
  for (const keyChunk of chunk(keys, 100)) {
    const { data, error } = await atlas.from("calls").select("legacy_call_id").in("legacy_call_id", keyChunk);
    if (error) throw error;
    for (const row of data ?? []) existing.add(row.legacy_call_id);
  }
  return existing;
}

async function existingInteractionKeys(atlas, leadIds) {
  const existing = new Set();
  for (const idChunk of chunk(leadIds, 100)) {
    const { data, error } = await atlas
      .from("interactions")
      .select("metadata")
      .eq("legacy_source", LEGACY_SOURCE)
      .in("lead_id", idChunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const key = row.metadata?.legacy_call_key;
      if (key) existing.add(key);
    }
  }
  return existing;
}

async function run() {
  const dryRun = process.argv.includes("--dry-run");
  const atlasEnv = loadEnv(ATLAS_ENV);
  const legacyEnv = loadEnv(LEGACY_ENV);
  const legacyUrl = postgresUrl(legacyEnv);
  if (!legacyUrl) throw new Error("No legacy Postgres URL found.");

  const atlas = serviceClient(atlasEnv);
  const tempDir = mkdtempSync(join(tmpdir(), "atlas-mail-legacy-"));
  const keysPath = join(tempDir, "mail_keys.csv");
  const callsPath = join(tempDir, "legacy_calls.jsonl");

  try {
    const keyStats = await buildAtlasMailKeys(atlas, keysPath);
    exportLegacyCalls(legacyUrl, keysPath, callsPath, tempDir);
    const legacyRows = readJsonLines(callsPath);
    const keys = legacyRows.map(legacyCallKey);
    const existingCalls = await existingCallKeys(atlas, keys);
    const candidateRows = legacyRows.filter((row) => !existingCalls.has(legacyCallKey(row)));
    const historicalAgents = await ensureHistoricalAgents(atlas, legacyRows);
    const { data: sentinelRows, error: sentinelError } = await atlas
      .from("profiles")
      .select("id")
      .eq("email", SENTINEL_EMAIL)
      .limit(1);
    if (sentinelError) throw sentinelError;
    const sentinelId = sentinelRows?.[0]?.id;
    if (!sentinelId) throw new Error(`Missing sentinel profile ${SENTINEL_EMAIL}`);

    const { data: profiles, error: profilesError } = await atlas.from("profiles").select("id,team_id");
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    const rowsWithAgents = candidateRows.map((row) => {
      const historicalAgent = historicalAgents.get(row.legacy_agent_id);
      const agentId = historicalAgent?.linked_profile_id || sentinelId;
      return { ...row, historicalAgent, agentId };
    });

    const byCampaign = new Map();
    for (const row of legacyRows) {
      const current = byCampaign.get(row.mail_campaign_name) ?? { exported: 0, pending: 0 };
      current.exported += 1;
      if (!existingCalls.has(legacyCallKey(row))) current.pending += 1;
      byCampaign.set(row.mail_campaign_name, current);
    }

    const summary = {
      dryRun,
      keyStats,
      exportedLegacyCalls: legacyRows.length,
      alreadyImportedCalls: existingCalls.size,
      pendingCalls: candidateRows.length,
      byCampaign: [...byCampaign.entries()].map(([name, value]) => ({ name, ...value })),
      linkedProfileCalls: rowsWithAgents.filter((row) => row.historicalAgent?.linked_profile_id).length,
      historicalOnlyCalls: rowsWithAgents.filter((row) => !row.historicalAgent?.linked_profile_id).length,
    };

    if (dryRun) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const callRows = rowsWithAgents.map((row) => ({
      lead_id: row.atlas_lead_id,
      agent_id: row.agentId,
      historical_agent_id: row.historicalAgent?.id ?? null,
      legacy_call_id: legacyCallKey(row),
      status: row.status,
      outcome: row.outcome,
      reason: row.reason,
      notes: row.notes,
      next_action_at: row.next_action_at,
      started_at: row.started_at || row.created_at || row.ended_at,
      ended_at: row.ended_at || row.started_at || row.created_at,
      created_at: row.created_at || row.started_at || row.ended_at,
      updated_at: row.ended_at || row.started_at || row.created_at,
    }));

    for (const callChunk of chunk(callRows, 300)) {
      const { error } = await atlas.from("calls").insert(callChunk);
      if (error) throw error;
    }

    const allCallKeys = rowsWithAgents.map(legacyCallKey);
    const importedCalls = new Map();
    for (const keyChunk of chunk(allCallKeys, 100)) {
      const { data, error } = await atlas.from("calls").select("id,legacy_call_id").in("legacy_call_id", keyChunk);
      if (error) throw error;
      for (const call of data ?? []) importedCalls.set(call.legacy_call_id, call.id);
    }

    const leadIds = [...new Set(rowsWithAgents.map((row) => row.atlas_lead_id))];
    const existingInteractions = await existingInteractionKeys(atlas, leadIds);
    const interactionRows = rowsWithAgents
      .filter((row) => !existingInteractions.has(legacyCallKey(row)))
      .map((row) => ({
        lead_id: row.atlas_lead_id,
        agent_id: row.agentId,
        historical_agent_id: row.historicalAgent?.id ?? null,
        result: row.reason || row.outcome || row.status || "Gestión legacy",
        notes: row.notes,
        legacy_source: LEGACY_SOURCE,
        created_at: row.ended_at || row.started_at || row.created_at,
        metadata: {
          source: "atlas_mail_legacy_management_import",
          legacy_call_key: legacyCallKey(row),
          legacy_call_id: row.legacy_call_id,
          legacy_lead_id: row.legacy_lead_id,
          legacy_campaign_id: row.legacy_campaign_id,
          legacy_campaign_name: row.legacy_campaign_name,
          mail_campaign_id: row.mail_campaign_id,
          mail_campaign_name: row.mail_campaign_name,
          match_by: row.match_by,
          status: row.status,
          outcome: row.outcome,
          next_action_at: row.next_action_at,
          call_id: importedCalls.get(legacyCallKey(row)) ?? null,
        },
      }));

    for (const interactionChunk of chunk(interactionRows, 300)) {
      const { error } = await atlas.from("interactions").insert(interactionChunk);
      if (error) throw error;
    }

    const eventRows = rowsWithAgents.map((row) => ({
      call_id: importedCalls.get(legacyCallKey(row)),
      lead_id: row.atlas_lead_id,
      agent_id: row.agentId,
      event_type: "call.closed",
      created_at: row.ended_at || row.started_at || row.created_at,
      payload: {
        source: "atlas_mail_legacy_management_import",
        legacy_call_key: legacyCallKey(row),
        status: row.status,
        outcome: row.outcome,
        reason: row.reason,
        next_action_at: row.next_action_at,
      },
    })).filter((row) => row.call_id);

    for (const eventChunk of chunk(eventRows, 300)) {
      const { error } = await atlas.from("call_events").insert(eventChunk);
      if (error) throw error;
    }

    const latestByLead = new Map();
    for (const row of rowsWithAgents) {
      const current = latestByLead.get(row.atlas_lead_id);
      const rowDate = new Date(row.ended_at || row.started_at || row.created_at || 0).getTime();
      const currentDate = current ? new Date(current.ended_at || current.started_at || current.created_at || 0).getTime() : -1;
      if (!current || rowDate >= currentDate) latestByLead.set(row.atlas_lead_id, row);
    }

    let updatedLeads = 0;
    for (const row of latestByLead.values()) {
      const profile = profileById.get(row.agentId);
      const payload = {
        tipificacion_actual: row.reason || row.outcome || row.status || "Gestión legacy",
        observacion_actual: row.notes,
        next_action_at: row.next_action_at,
        workflow_status: row.next_action_at ? "callback" : "managed",
        assignment_status: "managed",
        managed_at: row.ended_at || row.started_at || row.created_at,
        managed_by: row.agentId,
        updated_at: new Date().toISOString(),
      };

      if (row.agentId !== sentinelId) {
        payload.assigned_to = row.agentId;
        if (profile?.team_id) payload.team_id = profile.team_id;
      }

      const { error } = await atlas.from("leads").update(payload).eq("id", row.atlas_lead_id);
      if (error) throw error;
      updatedLeads += 1;
    }

    console.log(JSON.stringify({
      ...summary,
      insertedCalls: callRows.length,
      insertedInteractions: interactionRows.length,
      insertedCallEvents: eventRows.length,
      updatedLeads,
    }, null, 2));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
