"use client";

import { useRef, useState } from "react";
import type { BulkUploadResult } from "@/app/actions/leads-bulk";

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
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;

    const file = (formRef.current.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0];
    if (!file) {
      setError("Selecciona un archivo CSV o Excel.");
      return;
    }

    setPending(true);
    setProgress(0);
    setError(null);
    setResult(null);

    const formData = new FormData(formRef.current);
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (evt) => {
      if (evt.lengthComputable) {
        // % real de bytes ya enviados. El último tramo (procesar el archivo
        // + insertar en la BBDD) puede tardar un poco más tras llegar al
        // 100% de subida; por eso el texto avisa que sigue procesando.
        setProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      setPending(false);
      let body: (BulkUploadResult & { error?: string }) | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // se maneja abajo como respuesta inesperada
      }

      if (xhr.status >= 200 && xhr.status < 300 && body && !body.error) {
        setResult(body);
        if (body.errors.length === 0) formRef.current?.reset();
      } else {
        setError(body?.error || `Error inesperado del servidor (HTTP ${xhr.status}).`);
      }
    });

    xhr.addEventListener("error", () => {
      setPending(false);
      setError("Error de red al subir el archivo. Verifica tu conexión e intenta de nuevo.");
    });

    xhr.addEventListener("abort", () => {
      setPending(false);
      setError("Carga cancelada.");
    });

    xhr.open("POST", "/api/leads/bulk-upload");
    xhr.send(formData);
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
              {progress < 100
                ? `Subiendo archivo... ${progress}%`
                : "Archivo subido, procesando e insertando leads..."}
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
