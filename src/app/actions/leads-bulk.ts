"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";

export interface BulkUploadResult {
  totalRows: number;
  inserted: number;
  errors: { row: number; message: string }[];
}

const REQUIRED_HEADERS = ["full_name"];
const KNOWN_HEADERS = ["full_name", "rut", "phone", "email", "status"];

function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

export async function uploadLeadsFile(formData: FormData): Promise<BulkUploadResult> {
  const file = formData.get("file") as File | null;
  const teamId = (formData.get("team_id") as string) || null;
  const workflowId = (formData.get("workflow_id") as string) || null;

  if (!file || file.size === 0) {
    throw new Error("Selecciona un archivo CSV o Excel.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");

  const result: BulkUploadResult = { totalRows: rows.length, inserted: 0, errors: [] };

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

  const toInsert: Record<string, unknown>[] = [];

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

    toInsert.push({
      full_name: fullName,
      rut,
      phone,
      email,
      status,
      team_id: teamId,
      workflow_id: workflowId,
      created_by: user.id,
    });
  });

  if (toInsert.length > 0) {
    const { error, count } = await supabase
      .from("leads")
      .insert(toInsert, { count: "exact" });

    if (error) {
      result.errors.push({ row: 0, message: `Error al insertar: ${error.message}` });
    } else {
      result.inserted = count ?? toInsert.length;
    }
  }

  revalidatePath("/dashboard/leads");
  return result;
}
