"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { buildCandidates, chunk, CHUNK_SIZE, normalizeHeader, type BulkUploadResult } from "@/lib/leads-bulk-shared";

interface Option {
  id: string;
  name: string;
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

  const [teamId, setTeamId] = useState("");
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? "");
  const [workflowId, setWorkflowId] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setError(null);
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
          const { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by } = row;
          return { full_name, rut, phone, email, status, team_id, workflow_id, campaign_id, created_by };
        });

        const { data, error: rpcError } = await supabase.rpc("bulk_insert_leads", { payload });

        if (rpcError) {
          partialResult.errors.push({
            row: 0,
            message: `Error al insertar el lote ${i + 1} (${batches[i].length} filas): ${rpcError.message}`,
          });
        } else {
          const insertedInBatch = (data as { inserted: number } | null)?.inserted ?? 0;
          totalInserted += insertedInBatch;
          partialResult.duplicatesInDb += batches[i].length - insertedInBatch;
        }

        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }

      partialResult.inserted = totalInserted;
      setResult(partialResult);
      if (partialResult.errors.length === 0) {
        setRows(null);
        setHeaders(null);
        setFileName(null);
        setMapping(EMPTY_MAPPING);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al procesar el archivo.");
    } finally {
      setPending(false);
    }
  }

  const busy = pending || parsing;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Archivo (.csv, .xlsx)
          </label>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            disabled={busy}
            onChange={handleFileChange}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
          {parsing && <p className="mt-1 text-xs text-muted-foreground">Leyendo encabezados...</p>}
        </div>

        {headers && rows && (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="mb-3 text-xs font-medium text-foreground">
              {fileName}: {rows.length.toLocaleString("es-CL")} fila(s), {headers.length} columna(s)
              detectada(s). Indica qué columna de tu archivo corresponde a cada dato:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(SINGLE_FIELD_LABELS) as SingleFieldKey[]).map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {SINGLE_FIELD_LABELS[field]}
                    {field === "full_name" ? " (obligatorio)" : " (opcional)"}
                  </label>
                  <select
                    value={mapping[field]}
                    disabled={busy}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
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

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(Object.keys(MULTI_FIELD_LABELS) as MultiFieldKey[]).map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {MULTI_FIELD_LABELS[field]} (opcional, marca todas las que apliquen)
                  </label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-surface p-2">
                    {headers.map((h) => (
                      <label key={h} className="flex items-center gap-2 px-1 py-0.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={mapping[field].includes(h)}
                          disabled={busy}
                          onChange={() => toggleMultiField(field, h)}
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
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Cada fila necesita al menos RUT o teléfono para poder detectar duplicados.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Campaña (opcional)
          </label>
          <select
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
            Si eliges una campaña, estos leads quedan en su BBDD y heredan su flujo productivo
            (anula el flujo elegido abajo).
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Equipo destino (opcional)
            </label>
            <select
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
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Flujo de gestión (opcional)
            </label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
            >
              <option value="">Sin flujo</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Funciona con cualquier archivo: elige el Excel/CSV y arriba indicas qué columna de tu
          archivo corresponde a cada dato, sin tener que renombrar nada.
        </p>
        <p className="text-xs text-muted-foreground">
          La carga es segura para archivos grandes (decenas de miles de filas) y evita duplicados
          automáticamente: si dos filas comparten el mismo RUT (o el mismo teléfono cuando no hay
          RUT) dentro de la misma campaña o bolsa sin campaña, solo se crea un lead. Esto aplica
          tanto a duplicados dentro del propio archivo como contra leads ya cargados antes.
        </p>

        {pending && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {progressLabel} {progress > 0 ? `(${progress}%)` : ""}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !rows || !mapping.full_name}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Procesando..." : "Cargar leads"}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Resultado de la carga</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Filas en el archivo" value={result.totalRows} />
            <Stat label="Insertadas" value={result.inserted} highlight />
            <Stat label="Duplicadas (archivo)" value={result.duplicatesInFile} />
            <Stat label="Duplicadas (ya existían)" value={result.duplicatesInDb} />
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-warning">
                {result.errors.length} fila(s) con detalle:
              </p>
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

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-foreground">{value.toLocaleString("es-CL")}</p>
    </div>
  );
}
