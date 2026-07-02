export const VOCALCOM_CHUNK_SIZE = 2000;

export type VocalcomConnectionStatus = "connected" | "not_connected" | "indeterminate";

export interface VocalcomImportRow {
  row_number: number;
  event_key: string;
  rut: string | null;
  normalized_rut: string | null;
  telefono_original: string | null;
  telefono_vocalcom: string | null;
  phone_normalized: string | null;
  called_at: string | null;
  stats_date: string | null;
  stats_hour: string | null;
  stats_datetime: string | null;
  stats_utc_datetime: string | null;
  agent_external_id: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  wrapup: string | null;
  status_group: string | null;
  status_code: string | null;
  status_detail: string | null;
  status_text: string | null;
  status_text_detail: string | null;
  comments: string | null;
  connected: boolean | null;
  connection_status: VocalcomConnectionStatus;
  connection_rule: string;
  raw: Record<string, unknown>;
}

export interface VocalcomBuildResult {
  totalRows: number;
  validRows: number;
  skippedRows: number;
  connected: number;
  notConnected: number;
  indeterminate: number;
  errors: { row: number; message: string }[];
}

export interface VocalcomImportResult {
  batch_id: string;
  source_rows: number;
  inserted: number;
  duplicates: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  connected: number;
  not_connected: number;
  indeterminate: number;
}

const REQUIRED_HEADERS = [
  "telefono_original",
  "telefono_vocalcom",
  "Stats_DateTime",
  "Stats_StatusText",
  "Stats_StatusCode",
  "Stats_Duration",
];

export function normalizeRut(value: string): string {
  return value.replace(/[^0-9kK]/g, "").toUpperCase();
}

export function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("56") && digits.length > 9) digits = digits.slice(2);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function text(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "").trim();
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function integerOrNull(value: string): number | null {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = Number.parseInt(clean, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUtcDateTime(value: string): string | null {
  const clean = value.replace(/\D/g, "");
  if (clean.length < 12) return null;
  const year = clean.slice(0, 4);
  const month = clean.slice(4, 6);
  const day = clean.slice(6, 8);
  const hour = clean.slice(8, 10);
  const minute = clean.slice(10, 12);
  const second = clean.slice(12, 14) || "00";
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLocalDateTime(value: string): string | null {
  const clean = value.replace(/\D/g, "");
  if (clean.length < 12) return null;
  const year = clean.slice(0, 4);
  const month = clean.slice(4, 6);
  const day = clean.slice(6, 8);
  const hour = clean.slice(8, 10);
  const minute = clean.slice(10, 12);
  const second = clean.slice(12, 14) || "00";
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-04:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function classifyConnection(input: {
  statusText: string;
  statusCode: string;
  durationSeconds: number | null;
}): { connected: boolean | null; connection_status: VocalcomConnectionStatus; connection_rule: string } {
  const statusText = input.statusText.trim().toLowerCase();
  const statusCode = input.statusCode.trim();
  const duration = input.durationSeconds ?? 0;

  if (statusCode === "101" || statusText.includes("handled by agent")) {
    return { connected: true, connection_status: "connected", connection_rule: "status_atendido_por_agente" };
  }

  if ((statusText.includes("outbund") || statusText.includes("outbound")) && duration >= 10) {
    return { connected: true, connection_status: "connected", connection_rule: "outbound_con_duracion_minima_10s" };
  }

  if (statusText.includes("tipificacion automatica")) {
    return { connected: false, connection_status: "not_connected", connection_rule: "tipificacion_automatica" };
  }

  if (duration === 0) {
    return { connected: false, connection_status: "not_connected", connection_rule: "duracion_cero" };
  }

  return { connected: null, connection_status: "indeterminate", connection_rule: "sin_regla_concluyente" };
}

function eventKey(parts: {
  normalizedRut: string;
  phone: string;
  statsDateTime: string;
  agentId: string;
  agentName: string;
  duration: number | null;
  wrapup: string;
  statusCode: string;
  statusText: string;
}): string {
  return [
    parts.normalizedRut,
    parts.phone,
    parts.statsDateTime,
    parts.agentId,
    parts.agentName,
    parts.duration ?? "",
    parts.wrapup,
    parts.statusCode,
    parts.statusText,
  ].join("|");
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildVocalcomImportRows(rows: Record<string, unknown>[]): {
  rows: VocalcomImportRow[];
  result: VocalcomBuildResult;
} {
  const result: VocalcomBuildResult = {
    totalRows: rows.length,
    validRows: 0,
    skippedRows: 0,
    connected: 0,
    notConnected: 0,
    indeterminate: 0,
    errors: [],
  };

  if (rows.length === 0) {
    result.errors.push({ row: 0, message: "El archivo no tiene filas." });
    return { rows: [], result };
  }

  const headers = new Set(Object.keys(rows[0] ?? {}));
  const missing = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missing.length > 0) {
    result.errors.push({ row: 0, message: `Faltan columnas Vocalcom: ${missing.join(", ")}.` });
    return { rows: [], result };
  }

  const importRows: VocalcomImportRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rut = text(row, "rutid");
    const normalizedRut = normalizeRut(rut);
    const telefonoOriginal = text(row, "telefono_original");
    const telefonoVocalcom = text(row, "telefono_vocalcom");
    const phoneNormalized = normalizePhone(telefonoVocalcom || telefonoOriginal);
    const statsDateTime = text(row, "Stats_DateTime");
    const statsUtcDateTime = text(row, "Stats_UtcDateTime");
    const calledAt = parseUtcDateTime(statsUtcDateTime) ?? parseLocalDateTime(statsDateTime);
    const durationSeconds = integerOrNull(text(row, "Stats_Duration"));
    const statusText = text(row, "Stats_StatusText");
    const statusCode = text(row, "Stats_StatusCode");
    const wrapup = text(row, "Stats_Wrapup");

    if (!phoneNormalized && !normalizedRut) {
      result.skippedRows += 1;
      result.errors.push({ row: rowNumber, message: "Fila sin RUT ni teléfono para cruzar." });
      return;
    }

    const connection = classifyConnection({ statusText, statusCode, durationSeconds });
    if (connection.connection_status === "connected") result.connected += 1;
    if (connection.connection_status === "not_connected") result.notConnected += 1;
    if (connection.connection_status === "indeterminate") result.indeterminate += 1;

    importRows.push({
      row_number: rowNumber,
      event_key: eventKey({
        normalizedRut,
        phone: phoneNormalized,
        statsDateTime,
        agentId: text(row, "Stats_AgentId"),
        agentName: text(row, "Stats_AgentName"),
        duration: durationSeconds,
        wrapup,
        statusCode,
        statusText,
      }),
      rut: nullable(rut),
      normalized_rut: nullable(normalizedRut),
      telefono_original: nullable(telefonoOriginal),
      telefono_vocalcom: nullable(telefonoVocalcom),
      phone_normalized: nullable(phoneNormalized),
      called_at: calledAt,
      stats_date: nullable(text(row, "Stats_Date")),
      stats_hour: nullable(text(row, "Stats_Hour")),
      stats_datetime: nullable(statsDateTime),
      stats_utc_datetime: parseUtcDateTime(statsUtcDateTime),
      agent_external_id: nullable(text(row, "Stats_AgentId")),
      agent_name: nullable(text(row, "Stats_AgentName")),
      duration_seconds: durationSeconds,
      wrapup: nullable(wrapup),
      status_group: nullable(text(row, "Stats_StatusGroup")),
      status_code: nullable(statusCode),
      status_detail: nullable(text(row, "Stats_StatusDetail")),
      status_text: nullable(statusText),
      status_text_detail: nullable(text(row, "Stats_StatusTextDetail")),
      comments: nullable(text(row, "Comments")),
      connected: connection.connected,
      connection_status: connection.connection_status,
      connection_rule: connection.connection_rule,
      raw: row,
    });
  });

  result.validRows = importRows.length;
  return { rows: importRows, result };
}
