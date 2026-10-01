"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { Check, ChevronLeft, ChevronRight, FileCheck2 } from "lucide-react";
import { Callout, LoadingState, buttonClasses } from "@/components/ui";
import {
  buildCandidates,
  chunk,
  CHUNK_SIZE,
  normalizeHeader,
  normalizeStatus,
  type BulkUploadResult,
} from "@/lib/leads-bulk-shared";

interface Option {
  id: string;
  name: string;
  /** Solo campañas: si trae flujo, ese manda sobre el elegido a mano. */
  workflow_id?: string | null;
}

type SingleFieldKey = "full_name" | "rut" | "status";
type MultiFieldKey = "phone" | "email";

const SINGLE_FIELD_LABELS: Record<SingleFieldKey, string> = {
  full_name: "Nombre completo",
  rut: "RUT",
  status: "Estado",
};

const MULTI_FIELD_LABELS: Record<MultiFieldKey, string> = {
  phone: "Teléfono(s)",
  email: "Correo(s)",
};

interface Mapping {
  full_name: string;
  rut: string;
  status: string;
  phone: string[];
  email: string[];
}

/**
 * La carga va en tres pasos con progreso visible. Antes archivo, columnas,
 * destino y vista previa eran un solo formulario largo y era fácil cargar sin
 * haber revisado el mapeo.
 */
type Step = 1 | 2 | 3;
const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: "Archivo" },
  { id: 2, label: "Columnas" },
  { id: 3, label: "Destino y confirmación" },
];

const EMPTY_MAPPING: Mapping = { full_name: "", rut: "", status: "", phone: [], email: [] };

// Alias en español/variantes comunes para adivinar el mapeo automáticamente.
// El usuario siempre puede corregirlo a mano antes de cargar.
const SINGLE_FIELD_ALIASES: Record<SingleFieldKey, string[]> = {
  full_name: [
    "full_name",
    "nombre",
    "nombre_completo",
    "razon_social",
    "razón_social",
    "nombre_comercial",
    "empresa",
    "cliente",
    "contacto",
  ],
  rut: ["rut", "rut_empresa", "run"],
  status: ["status", "estado", "estado_comercial"],
};

// Raíces de columnas que pueden venir repetidas (Telefono, Telefono 2, Telefono 3...).
// Cualquier columna marcada se revisa fila por fila y se usa la primera que tenga valor.
const MULTI_FIELD_ROOTS: Record<MultiFieldKey, string[]> = {
  phone: ["phone", "telefono", "teléfono", "fono", "celular", "movil", "móvil"],
  email: ["email", "correo", "correo_electronico", "correo_electrónico", "mail", "e-mail", "e_mail"],
};

function matchesRoot(norm: string, root: string): boolean {
  const escaped = root.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(`^${escaped}(_?\\d+)?$`).test(norm);
}

function guessMapping(headers: string[]): Mapping {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const mapping: Mapping = { ...EMPTY_MAPPING, phone: [], email: [] };

  (Object.keys(SINGLE_FIELD_ALIASES) as SingleFieldKey[]).forEach((field) => {
    const aliases = SINGLE_FIELD_ALIASES[field];
    const match = normalized.find((h) => aliases.includes(h.norm));
    if (match) mapping[field] = match.raw;
  });

  (Object.keys(MULTI_FIELD_ROOTS) as MultiFieldKey[]).forEach((field) => {
    const roots = MULTI_FIELD_ROOTS[field];
    mapping[field] = normalized.filter((h) => roots.some((r) => matchesRoot(h.norm, r))).map((h) => h.raw);
  });

  return mapping;
}

export function BulkUploadForm({
  teams,
  workflows,
  campaigns,
  defaultCampaignId,
}: {
  teams: Option[];
  workflows: Option[];
  campaigns: Option[];
  defaultCampaignId?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [step, setStep] = useState<Step>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  // Cambia tras una carga completa para vaciar el selector de archivo.
  const [fileInputKey, setFileInputKey] = useState(0);

  const [teamId, setTeamId] = useState("");
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? "");
  const [workflowId, setWorkflowId] = useState("");

  // La campaña con flujo manda sobre el flujo elegido a mano (ver submit):
  // el selector se bloquea y lo dice, en vez de aceptar algo que se ignora.
  const campaignWorkflowId = campaigns.find((c) => c.id === campaignId)?.workflow_id ?? null;
  const campaignWorkflowName = workflows.find((w) => w.id === campaignWorkflowId)?.name ?? null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setError(null);
    setStepError(null);
    setRows(null);
    setHeaders(null);
    setFileName(null);
    if (!file) return;

    setParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsedRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      if (parsedRows.length === 0) {
        setError("El archivo no tiene filas de datos.");
        return;
      }

      const detectedHeaders = Object.keys(parsedRows[0]);
      setRows(parsedRows);
      setHeaders(detectedHeaders);
      setFileName(file.name);
      setMapping(guessMapping(detectedHeaders));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo.");
    } finally {
      setParsing(false);
    }
  }

  function toggleMultiField(field: MultiFieldKey, header: string) {
    setMapping((m) => {
      const current = m[field];
      const next = current.includes(header)
        ? current.filter((h) => h !== header)
        : [...current, header];
      return { ...m, [field]: next };
    });
  }

  function firstNonEmpty(row: Record<string, unknown>, columns: string[]): string {
    for (const col of columns) {
      const value = String(row[col] ?? "").trim();
      if (value) return value;
    }
    return "";
  }

  /**
   * La carga no debe reducir una BBDD al puñado de columnas que Atlas usa
   * para identificar al lead. Conservamos cada campo simple del archivo para
   * que el ejecutivo lo tenga en la ficha cuando entra la llamada.
   */
  function collectCampaignData(row: Record<string, unknown>): Record<string, string | number | boolean> {
    const data: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key.trim() || value === null || value === undefined) continue;
      if (typeof value === "string") {
        const text = value.trim();
        if (text) data[key] = text;
      } else if (typeof value === "number" || typeof value === "boolean") {
        data[key] = value;
      } else if (value instanceof Date) {
        data[key] = value.toISOString();
      } else {
        data[key] = String(value);
      }
    }
    return data;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rows || !headers) {
      setError("Selecciona un archivo CSV o Excel.");
      return;
    }
    if (!mapping.full_name) {
      setError("Indica qué columna corresponde al nombre completo.");
      return;
    }

    setPending(true);
    setProgress(0);
    setProgressLabel("Preparando datos...");
    setError(null);
    setResult(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado. Vuelve a iniciar sesión.");

      let effectiveWorkflowId = workflowId || null;
      // La campaña, si hay, manda sobre el flujo elegido manualmente.
      if (campaignId) {
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("workflow_id")
          .eq("id", campaignId)
          .single();
        if (campaign?.workflow_id) effectiveWorkflowId = campaign.workflow_id;
      }

      // Remapeamos cada fila a las columnas internas (full_name/rut/phone/email/status)
      // según el mapeo que eligió el usuario, sin importar cómo se llamaban
      // realmente las columnas en su archivo original.
      const remappedRows: Record<string, unknown>[] = rows.map((row) => ({
        full_name: mapping.full_name ? row[mapping.full_name] : "",
        rut: mapping.rut ? row[mapping.rut] : "",
        phone: firstNonEmpty(row, mapping.phone),
        email: firstNonEmpty(row, mapping.email),
        status: mapping.status ? row[mapping.status] : "",
        extra: collectCampaignData(row),
      }));

      const { candidates, result: partialResult } = buildCandidates(remappedRows, {
        teamId: teamId || null,
        workflowId: effectiveWorkflowId,
        campaignId: campaignId || null,
        userId: user.id,
      });

      if (candidates.length === 0) {
        setResult(partialResult);
        return;
      }

      const batches = chunk(candidates, CHUNK_SIZE);
      let totalInserted = 0;

      for (let i = 0; i < batches.length; i++) {
        setProgressLabel(
          batches.length > 1
            ? `Insertando lote ${i + 1} de ${batches.length}...`
            : "Insertando leads..."
        );

        const payload = batches[i].map((row) => {
          const { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra } = row;
          return { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by, extra };
        });

        const { data, error: rpcError } = await supabase.rpc("bulk_insert_leads", { payload });

        if (rpcError) {
          console.error(`[carga masiva] lote ${i + 1}`, rpcError);
          partialResult.errors.push({
            row: 0,
            message: `No se pudo guardar el lote ${i + 1} (${batches[i].length} filas). Vuelve a cargar el mismo archivo: lo que ya entró no se duplica. Si se repite, avisa a soporte.`,
          });
        } else {
          const insertedInBatch = (data as { inserted: number } | null)?.inserted ?? 0;
          const refreshedInBatch = (data as { refreshed: number } | null)?.refreshed ?? 0;
          totalInserted += insertedInBatch;
          partialResult.refreshedExisting += refreshedInBatch;
          partialResult.duplicatesInDb += batches[i].length - insertedInBatch - refreshedInBatch;
        }

        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }

      partialResult.inserted = totalInserted;

      // Queda constancia del archivo procesado: qué entró y qué se descartó.
      const { error: historyError } = await supabase.from("lead_uploads").insert({
        file_name: fileName ?? "archivo sin nombre",
        campaign_id: campaignId || null,
        team_id: teamId || null,
        workflow_id: effectiveWorkflowId,
        total_rows: partialResult.totalRows,
        inserted_count: partialResult.inserted,
        duplicates_in_file: partialResult.duplicatesInFile,
        duplicates_in_db: partialResult.duplicatesInDb,
        // Solo filas: los errores con row 0 son fallos de lote, no registros.
        rejected_count: partialResult.errors.filter((issue) => issue.row > 0).length,
        uploaded_by: user.id,
      });

      if (historyError) {
        console.error("[carga masiva] historial de cargas", historyError);
        partialResult.errors.push({
          row: 0,
          message: "Los registros se cargaron, pero este archivo no quedó anotado en el historial de cargas.",
        });
      }

      if (partialResult.normalizedStatus > 0) {
        partialResult.errors.push({
          row: 0,
          message: `${partialResult.normalizedStatus} fila(s) traían un estado que la base no acepta y se cargaron como "nuevo".`,
        });
      }

      setResult(partialResult);
      if (partialResult.errors.length === 0) {
        setRows(null);
        setHeaders(null);
        setFileName(null);
        setMapping(EMPTY_MAPPING);
        setStep(1);
        setFileInputKey((key) => key + 1);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al procesar el archivo.");
    } finally {
      setPending(false);
    }
  }

  /**
   * Descarga las filas que no entraron, con su motivo y sus datos originales.
   * Sin esto, corregir un archivo de 20.000 filas era adivinar.
   */
  function downloadRejected() {
    if (!result || result.errors.length === 0) return;
    const sheetRows = result.errors.map((issue) => {
      const original = issue.row > 1 ? rows?.[issue.row - 2] : undefined;
      return { Fila: issue.row > 0 ? issue.row : "—", Motivo: issue.message, ...(original ?? {}) };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheetRows), "Rechazadas");
    XLSX.writeFile(workbook, `filas-rechazadas-${fileName?.replace(/\.[^.]+$/, "") ?? "carga"}.xlsx`);
  }

  /** Primeras filas tal como quedarán guardadas, según el mapeo elegido. */
  const previewRows = (rows ?? []).slice(0, 5).map((row) => ({
    full_name: mapping.full_name ? String(row[mapping.full_name] ?? "") : "",
    rut: mapping.rut ? String(row[mapping.rut] ?? "") : "",
    phone: firstNonEmpty(row, mapping.phone),
    email: firstNonEmpty(row, mapping.email),
    // Se muestra el estado ya normalizado: es el que quedará guardado.
    status: normalizeStatus(mapping.status ? String(row[mapping.status] ?? "") : "").status,
  }));

  const busy = pending || parsing;
  const campaignName = campaigns.find((c) => c.id === campaignId)?.name ?? null;
  const teamName = teams.find((t) => t.id === teamId)?.name ?? null;
  const workflowName = campaignWorkflowId ? campaignWorkflowName : (workflows.find((w) => w.id === workflowId)?.name ?? null);

  /** Lo que falta para dejar avanzar desde cada paso; null si está completo. */
  function stepProblem(target: Step): string | null {
    if (target === 1 && (!rows || !headers)) return "Elige un archivo CSV o Excel con al menos una fila de datos.";
    if (target === 2) {
      if (!mapping.full_name) return "Indica qué columna corresponde al nombre completo.";
      if (!mapping.rut && mapping.phone.length === 0) {
        return "Marca la columna de RUT o al menos una de teléfono: sin ninguna de las dos no se pueden detectar duplicados y no entra ninguna fila.";
      }
    }
    return null;
  }

  function goTo(target: Step) {
    // Se puede volver siempre; avanzar solo con los pasos anteriores completos.
    for (let previous = 1 as Step; previous < target; previous = (previous + 1) as Step) {
      const problem = stepProblem(previous);
      if (problem) {
        setStep(previous);
        setStepError(problem);
        return;
      }
    }
    setStepError(null);
    setStep(target);
  }

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Enter en los pasos 1 y 2 avanza en vez de cargar.
    if (step < 3) {
      e.preventDefault();
      goTo((step + 1) as Step);
      return;
    }
    void handleSubmit(e);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onFormSubmit} className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm" aria-busy={busy}>
        {/* Progreso: tres pasos unidos por una línea, el actual marcado. */}
        <ol className="flex items-center gap-2" aria-label="Pasos de la carga">
          {STEPS.map((item, index) => {
            const done = item.id < step;
            const current = item.id === step;
            return (
              <li key={item.id} className="flex flex-1 items-center gap-2 last:flex-none">
                <button
                  type="button"
                  onClick={() => goTo(item.id)}
                  disabled={busy}
                  aria-current={current ? "step" : undefined}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-1 text-left text-sm disabled:pointer-events-none"
                >
                  <span
                    className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                      current
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-primary text-primary"
                          : "border-border-strong text-muted-foreground"
                    }`}
                  >
                    {done ? <Check size={14} aria-hidden="true" /> : item.id}
                  </span>
                  <span className={current ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {item.label}
                    <span className="sr-only">{done ? " (completo)" : current ? " (paso actual)" : ""}</span>
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <span className={`h-px flex-1 ${done ? "bg-primary" : "bg-border"}`} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        {/* Paso 1 · Archivo. Los pasos se ocultan sin desmontarse para no perder el archivo elegido. */}
        <section hidden={step !== 1} aria-labelledby="paso-archivo" className="space-y-3">
          <h3 id="paso-archivo" className="text-sm font-semibold text-foreground">
            Elige el archivo
          </h3>
          <div>
            <label htmlFor="carga-archivo" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Archivo (.csv, .xlsx)
            </label>
            <input
              key={fileInputKey}
              id="carga-archivo"
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls"
              disabled={busy}
              onChange={handleFileChange}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            />
            {parsing && <LoadingState label="Estamos leyendo el archivo" compact className="mt-2" />}
          </div>
          {headers && rows && (
            <p className="flex items-center gap-2 text-sm text-foreground">
              <FileCheck2 size={16} className="text-success" aria-hidden="true" />
              {fileName}: {rows.length.toLocaleString("es-CL")} fila(s) y {headers.length} columna(s).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Funciona con cualquier archivo: en el paso siguiente indicas qué columna corresponde a cada dato, sin tener que
            renombrar nada.
          </p>
        </section>

        {/* Paso 2 · Columnas, con la vista previa del mapeo. */}
        <section hidden={step !== 2} aria-labelledby="paso-columnas" className="space-y-4">
          <div>
            <h3 id="paso-columnas" className="text-sm font-semibold text-foreground">
              Indica qué columna de tu archivo corresponde a cada dato
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ya adivinamos lo que pudimos por el nombre de la columna; corrige lo que no calce.
            </p>
          </div>
          {headers && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(SINGLE_FIELD_LABELS) as SingleFieldKey[]).map((field) => (
                  <div key={field}>
                    <label htmlFor={`mapeo-${field}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                      {SINGLE_FIELD_LABELS[field]}
                      {field === "full_name" ? " (obligatorio)" : " (opcional)"}
                    </label>
                    <select
                      id={`mapeo-${field}`}
                      value={mapping[field]}
                      disabled={busy}
                      onChange={(e) => {
                        setStepError(null);
                        setMapping((m) => ({ ...m, [field]: e.target.value }));
                      }}
                      aria-invalid={field === "full_name" && Boolean(stepError) && !mapping.full_name ? true : undefined}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground disabled:opacity-60"
                    >
                      <option value="">(ninguna columna)</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(MULTI_FIELD_LABELS) as MultiFieldKey[]).map((field) => (
                  <fieldset key={field}>
                    <legend className="mb-1 block text-xs font-medium text-muted-foreground">
                      {MULTI_FIELD_LABELS[field]} (opcional, marca todas las que apliquen)
                    </legend>
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-surface p-2">
                      {headers.map((h) => (
                        <label key={h} className="flex items-center gap-2 px-1 py-0.5 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={mapping[field].includes(h)}
                            disabled={busy}
                            onChange={() => {
                              setStepError(null);
                              toggleMultiField(field, h);
                            }}
                          />
                          {h}
                        </label>
                      ))}
                    </div>
                    {mapping[field].length > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Se usará la primera con dato, en este orden: {mapping[field].join(" → ")}.
                      </p>
                    )}
                  </fieldset>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Cada fila necesita al menos RUT o teléfono para poder detectar duplicados. Todas las demás columnas se
                conservan como datos de campaña y se muestran en la ficha del ejecutivo.
              </p>
            </>
          )}

          {previewRows.length > 0 && (
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-xs font-medium text-foreground">
                Vista previa · {(rows ?? []).length.toLocaleString("es-CL")} filas en el archivo
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Así quedarán guardadas las primeras {previewRows.length} filas con el mapeo actual.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="border-b border-border text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Nombre</th>
                      <th className="py-1.5 pr-3 font-medium">RUT</th>
                      <th className="py-1.5 pr-3 font-medium">Teléfono</th>
                      <th className="py-1.5 pr-3 font-medium">Correo</th>
                      <th className="py-1.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewRows.map((row, index) => (
                      <tr key={index}>
                        <td className="py-1.5 pr-3 text-foreground">{row.full_name || "—"}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{row.rut || "—"}</td>
                        <td className={`py-1.5 pr-3 ${row.phone ? "text-muted-foreground" : "text-danger"}`}>
                          {row.phone || "sin teléfono"}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{row.email || "—"}</td>
                        <td className="py-1.5 text-muted-foreground">{row.status || "nuevo"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Paso 3 · Destino y confirmación. */}
        <section hidden={step !== 3} aria-labelledby="paso-destino" className="space-y-4">
          <h3 id="paso-destino" className="text-sm font-semibold text-foreground">
            ¿Dónde quedan los registros?
          </h3>
          <div>
            <label htmlFor="carga-campana" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Campaña (opcional)
            </label>
            <select
              id="carga-campana"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            >
              <option value="">Sin campaña</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Si eliges una campaña, estos registros quedan en su base y, si la campaña tiene flujo, heredan ese flujo.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="carga-equipo" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Equipo destino (opcional)
              </label>
              <select
                id="carga-equipo"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              >
                <option value="">Sin equipo</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="carga-flujo" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Flujo de gestión (opcional)
              </label>
              <select
                id="carga-flujo"
                value={campaignWorkflowId ? "__campaign__" : workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                disabled={busy || Boolean(campaignWorkflowId)}
                aria-describedby={campaignWorkflowId ? "flujo-de-la-campana" : undefined}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
              >
                {campaignWorkflowId && (
                  <option value="__campaign__">
                    {campaignWorkflowName ? `Flujo de la campaña · ${campaignWorkflowName}` : "Flujo de la campaña"}
                  </option>
                )}
                <option value="">Sin flujo</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              {campaignWorkflowId && (
                <p id="flujo-de-la-campana" className="mt-1 text-xs text-muted-foreground">
                  Se usa el flujo de la campaña elegida. Para cambiarlo, edítalo en el Resumen de la campaña.
                </p>
              )}
            </div>
          </div>

          {/* Resumen de lo que se va a cargar: nada que recordar de los pasos anteriores. */}
          {rows && (
            <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-background p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Archivo</dt>
                <dd className="truncate text-foreground">
                  {fileName} · {rows.length.toLocaleString("es-CL")} filas
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Columnas</dt>
                <dd className="text-foreground">
                  Nombre: {mapping.full_name || "—"} · RUT: {mapping.rut || "—"} · Teléfono:{" "}
                  {mapping.phone.length ? mapping.phone.join(", ") : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Destino</dt>
                <dd className="text-foreground">
                  {campaignName ?? "Sin campaña"} · {teamName ?? "Sin equipo"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Flujo</dt>
                <dd className="text-foreground">{workflowName ?? "Sin flujo"}</dd>
              </div>
            </dl>
          )}

          <p className="text-xs text-muted-foreground">
            La carga es segura para archivos grandes (decenas de miles de filas) y evita duplicados automáticamente: si dos
            filas comparten el mismo RUT (o el mismo teléfono cuando no hay RUT) dentro de la misma campaña o bolsa sin
            campaña, solo se crea un lead. Esto aplica tanto a duplicados dentro del propio archivo como contra leads ya
            cargados antes.
          </p>

          {pending && (
            <div>
              <LoadingState label={progressLabel || "Estamos preparando la carga"} compact />
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-label="Avance de la carga"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Avance real: {progress > 0 ? `${progress}%` : "iniciando"}</p>
            </div>
          )}
        </section>

        {stepError && (
          <p role="alert" className="text-sm text-danger">
            {stepError}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => goTo((step - 1) as Step)}
              disabled={busy}
              className={buttonClasses({ variant: "secondary" })}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Atrás
            </button>
          ) : (
            <span />
          )}
          {step < 3 ? (
            <button type="submit" disabled={busy} className={buttonClasses()}>
              Siguiente
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" disabled={busy || !rows || !mapping.full_name} className={buttonClasses()}>
              {pending ? "Carga en curso…" : `Cargar ${(rows ?? []).length.toLocaleString("es-CL")} filas`}
            </button>
          )}
        </div>
      </form>

      {error && (
        <Callout tone="danger">{error}</Callout>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileCheck2 size={16} className="text-muted-foreground" aria-hidden="true" />
            Resultado de la carga
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Filas en el archivo" value={result.totalRows} />
            <Stat label="Insertadas" value={result.inserted} highlight />
            <Stat label="Datos actualizados" value={result.refreshedExisting} highlight />
            <Stat label="Duplicadas (archivo)" value={result.duplicatesInFile} />
            <Stat label="Duplicadas (ya existían)" value={result.duplicatesInDb} />
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-warning">
                  {result.errors.length.toLocaleString("es-CL")} fila(s) no entraron
                </p>
                <button
                  type="button"
                  onClick={downloadRejected}
                  className={buttonClasses({ variant: "secondary", size: "sm" })}
                >
                  Descargar rechazadas
                </button>
              </div>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {result.errors.map((e, idx) => (
                  <li key={idx}>
                    {e.row > 0 ? `Fila ${e.row}: ` : ""}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Cifra en baldosa: lo que entró se destaca con borde y número de éxito. */
function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-border border-l-2 bg-background px-3 py-2.5 ${
        highlight ? "border-l-success" : "border-l-border-strong"
      }`}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums tracking-tight ${highlight ? "text-success" : "text-foreground"}`}>
        {value.toLocaleString("es-CL")}
      </p>
    </div>
  );
}
