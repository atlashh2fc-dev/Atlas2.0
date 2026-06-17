"use client";

import { useRef, useState } from "react";
import { uploadLeadsFile, type BulkUploadResult } from "@/app/actions/leads-bulk";

interface Option {
  id: string;
  name: string;
}

export function BulkUploadForm({
  teams,
  workflows,
}: {
  teams: Option[];
  workflows: Option[];
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await uploadLeadsFile(formData);
      setResult(res);
      if (res.errors.length === 0) {
        formRef.current?.reset();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado al procesar el archivo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} action={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Archivo (.csv, .xlsx)
          </label>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,.xls"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Equipo destino (opcional)
            </label>
            <select
              name="team_id"
              defaultValue=""
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
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
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
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
          <p className="text-sm text-muted-foreground">
            {result.inserted} de {result.totalRows} filas insertadas correctamente.
          </p>
          {result.errors.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-warning">
                {result.errors.length} fila(s) con problemas:
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
