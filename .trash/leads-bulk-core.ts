import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export interface BulkUploadResult {
  totalRows: number;
  inserted: number;
  /** Filas que se repetían dentro del mismo archivo (mismo rut, o mismo teléfono si no había rut). */
  duplicatesInFile: number;
  /** Filas que ya existían en la base (misma campaña/bolsa) según rut o teléfono. */
  duplicatesInDb: number;
  errors: { row: number; message: string }[];
}

const REQUIRED_HEADERS = ["full_name"];
const KNOWN_HEADERS = ["full_name", "rut", "phone", "email", "status"];

// Tamaño de lote enviado por llamada al RPC. Mantiene cada request liviano
// (evita timeouts y límites de tamaño de payload) incluso con archivos de
// decenas de miles de filas.
const CHUNK_SIZE = 2000;

interface CandidateRow {
  rowNum: number;
  full_name: string;
  rut: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  team_id: string | null;
  workflow_id: string | null;
  campaign_id: string | null;
  created_by: string;
}

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Normaliza un RUT solo para comparar duplicados (no se usa para guardar el valor mostrado). */
function normalizeRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toUpperCase();
}

/** Normaliza un teléfono solo para comparar duplicados (no se usa para guardar el valor mostrado). */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Clave de dedup: prioriza rut (si existe) sobre teléfono, igual que la regla de negocio de leads. */
function dedupKey(rut: string | null, phone: string | null): string | null {
  if (rut) return `rut:${normalizeRut(rut)}`;
  if (phone) return `phone:${normalizePhone(phone)}`;
  return null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Lógica principal de carga masiva: parsea el archivo, deduplica dentro del
 * propio archivo y delega a la BBDD (vía RPC) la inserción con dedup real
 * contra leads existentes. No depende de Server Actions ni de Route
 * Handlers específicamente, para poder reutilizarse desde ambos.
 */
export async function parseAndInsertLeads(params: {
  file: File;
  teamId: string | null;
  campaignId: string | null;
  workflowId: string | null;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
}): Promise<BulkUploadResult> {
  const { file, teamId, campaignId, userId, supabase } = params;
  let workflowId = params.workflowId;

  if (!file || file.size === 0) {
    throw new Error("Selecciona un archivo CSV o Excel.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  // Si la BBDD se carga dentro de una campaña, el flujo productivo de esa
  // campaña manda sobre cualquier flujo elegido manualmente: la campaña es
  // la fuente de verdad de qué guion siguen sus leads.
  if (campaignId) {
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("workflow_id")
      .eq("id", campaignId)
      .single();
    if (campaign?.workflow_id) workflowId = campaign.workflow_id;
  }

  const result: BulkUploadResult = {
    totalRows: rows.length,
    inserted: 0,
    duplicatesInFile: 0,
    duplicatesInDb: 0,
    errors: [],
  };

  if (rows.length === 0) {
    result.errors.push({ row: 0, message: "El archivo no tiene filas de datos." });
    return result;
  }

  // Validate headers against the first row's keys.
  const firstRowHeaders = Object.keys(rows[0]).map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !firstRowHeaders.includes(h));
  if (missing.length > 0) {
    result.errors.push({
      row: 0,
      message: `Faltan columnas obligatorias: ${missing.join(", ")}. Columnas esperadas: ${KNOWN_HEADERS.join(", ")}.`,
    });
    return result;
  }

  const candidates: CandidateRow[] = [];
  const seenKeys = new Map<string, number>(); // key -> primera fila donde apareció

  rows.forEach((rawRow, idx) => {
    const rowNum = idx + 2; // header is row 1
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawRow)) {
      row[normalizeHeader(key)] = value;
    }

    const fullName = String(row.full_name ?? "").trim();
    if (!fullName) {
      result.errors.push({ row: rowNum, message: "Falta el nombre completo (full_name)." });
      return;
    }

    const rut = String(row.rut ?? "").trim() || null;
    const phone = String(row.phone ?? "").trim() || null;
    const email = String(row.email ?? "").trim() || null;
    const status = String(row.status ?? "").trim() || "nuevo";

    if (!rut && !phone) {
      result.errors.push({
        row: rowNum,
        message: "Cada lead necesita al menos RUT o teléfono para evitar duplicados.",
      });
      return;
    }

    const key = dedupKey(rut, phone);
    if (key) {
      const firstRow = seenKeys.get(key);
      if (firstRow) {
        result.duplicatesInFile += 1;
        result.errors.push({
          row: rowNum,
          message: `Duplicado dentro del mismo archivo (mismo ${rut ? "RUT" : "teléfono"} que la fila ${firstRow}). Omitido.`,
        });
        return;
      }
      seenKeys.set(key, rowNum);
    }

    candidates.push({
      rowNum,
      full_name: fullName,
      rut,
      phone,
      email,
      status,
      team_id: teamId,
      workflow_id: workflowId,
      campaign_id: campaignId,
      created_by: userId,
    });
  });

  let totalInserted = 0;
  for (const batch of chunk(candidates, CHUNK_SIZE)) {
    const payload = batch.map((row) => {
      const { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by } = row;
      return { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by };
    });
    const { data, error } = await supabase.rpc("bulk_insert_leads", { payload });

    if (error) {
      result.errors.push({
        row: 0,
        message: `Error al insertar un lote de ${batch.length} filas: ${error.message}`,
      });
      continue;
    }

    const insertedInBatch = (data as { inserted: number } | null)?.inserted ?? 0;
    totalInserted += insertedInBatch;
    result.duplicatesInDb += batch.length - insertedInBatch;
  }

  result.inserted = totalInserted;
  return result;
}
