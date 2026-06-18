/**
 * Lógica pura (sin I/O) de la carga masiva de leads. Se ejecuta en el
 * navegador: el archivo se parsea client-side y los lotes ya validados se
 * insertan directo contra Supabase, sin pasar por ninguna función serverless
 * de Next/Vercel (que tiene un límite duro de ~4.5MB de body).
 */

export interface BulkUploadResult {
  totalRows: number;
  inserted: number;
  /** Filas que se repetían dentro del mismo archivo (mismo rut, o mismo teléfono si no había rut). */
  duplicatesInFile: number;
  /** Filas que ya existían en la base (misma campaña/bolsa) según rut o teléfono. */
  duplicatesInDb: number;
  errors: { row: number; message: string }[];
}

export const REQUIRED_HEADERS = ["full_name"];
export const KNOWN_HEADERS = ["full_name", "rut", "phone", "email", "status"];

// Tamaño de lote enviado por llamada RPC. Mantiene cada request liviana
// (evita timeouts) incluso con archivos de decenas de miles de filas.
export const CHUNK_SIZE = 2000;

export interface CandidateRow {
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

export function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Normaliza un RUT solo para comparar duplicados (no se usa para guardar el valor mostrado). */
export function normalizeRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toUpperCase();
}

/** Normaliza un teléfono solo para comparar duplicados (no se usa para guardar el valor mostrado). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Clave de dedup: prioriza rut (si existe) sobre teléfono, igual que la regla de negocio de leads. */
export function dedupKey(rut: string | null, phone: string | null): string | null {
  if (rut) return `rut:${normalizeRut(rut)}`;
  if (phone) return `phone:${normalizePhone(phone)}`;
  return null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Valida las filas ya parseadas (de XLSX.utils.sheet_to_json) y devuelve los
 * candidatos listos para insertar más un resultado parcial (errores de
 * validación y duplicados detectados dentro del propio archivo).
 */
export function buildCandidates(
  rows: Record<string, unknown>[],
  ctx: {
    teamId: string | null;
    workflowId: string | null;
    campaignId: string | null;
    userId: string;
  }
): { candidates: CandidateRow[]; result: BulkUploadResult } {
  const result: BulkUploadResult = {
    totalRows: rows.length,
    inserted: 0,
    duplicatesInFile: 0,
    duplicatesInDb: 0,
    errors: [],
  };

  if (rows.length === 0) {
    result.errors.push({ row: 0, message: "El archivo no tiene filas de datos." });
    return { candidates: [], result };
  }

  const firstRowHeaders = Object.keys(rows[0]).map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !firstRowHeaders.includes(h));
  if (missing.length > 0) {
    result.errors.push({
      row: 0,
      message: `Faltan columnas obligatorias: ${missing.join(", ")}. Columnas esperadas: ${KNOWN_HEADERS.join(", ")}.`,
    });
    return { candidates: [], result };
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
      team_id: ctx.teamId,
      workflow_id: ctx.workflowId,
      campaign_id: ctx.campaignId,
      created_by: ctx.userId,
    });
  });

  return { candidates, result };
}
