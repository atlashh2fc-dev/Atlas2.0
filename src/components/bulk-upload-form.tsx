"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import { buildCandidates, chunk, CHUNK_SIZE, type BulkUploadResult } from "@/lib/leads-bulk-shared";

interface Option {
  id: string;
  name: string;
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
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    if (!file) {
      setError("Selecciona un archivo CSV o Excel.");
      return;
    }

    const teamId = (form.elements.namedItem("team_id") as HTMLSelectElement | null)?.value || null;
    const campaignId = (form.elements.namedItem("campaign_id") as HTMLSelectElement | null)?.value || null;
    let workflowId = (form.elements.namedItem("workflow_id") as HTMLSelectElement | null)?.value || null;

    setPending(true);
    setProgress(0);
    setProgressLabel("Leyendo el archivo...");
    setError(null);
    setResult(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado. Vuelve a iniciar sesión.");

      // La campaña, si hay, manda sobre el flujo elegido manualmente.
      if (campaignId) {
        const { data: campaign } = await supabase
          .from("campaigns")
          .select("workflow_id")
          .eq("id", campaignId)
          .single();
        if (campaign?.workflow_id) workflowId = campaign.workflow_id;
      }

      // El archivo se parsea en el navegador: nunca se sube como blob a
      // ninguna función serverless, así que no hay límite de tamaño de body
      // (Vercel limita esas funciones a ~4.5MB) que pueda chocar acá.
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const { candidates, result: partialResult } = buildCandidates(rows, {
        teamId,
        workflowId,
        campaignId,
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
        form.reset();
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al procesar el archivo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Archivo (.csv, .xlsx)
          </label>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            disabled={pending}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Campaña (opcional)
          </label>
          <select
            name="campaign_id"
            defaultValue={defaultCampaignId ?? ""}
            disabled={pending}
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
              name="team_id"
              defaultValue=""
              disabled={pending}
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
              name="workflow_id"
              defaultValue=""
              disabled={pending}
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
          Columnas esperadas: <code>full_name</code> (obligatorio), <code>rut</code>,{" "}
          <code>phone</code>, <code>email</code>, <code>status</code>. Cada fila necesita RUT o
          teléfono.
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
          disabled={pending}
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
