"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import {
  VOCALCOM_CHUNK_SIZE,
  buildVocalcomImportRows,
  chunk,
  type VocalcomBuildResult,
  type VocalcomImportResult,
} from "@/lib/vocalcom-import-shared";

type AggregateResult = Omit<VocalcomImportResult, "batch_id"> & {
  batches: number;
};

const EMPTY_AGGREGATE: AggregateResult = {
  batches: 0,
  source_rows: 0,
  inserted: 0,
  duplicates: 0,
  matched: 0,
  ambiguous: 0,
  unmatched: 0,
  connected: 0,
  not_connected: 0,
  indeterminate: 0,
};

function addResult(current: AggregateResult, next: VocalcomImportResult): AggregateResult {
  return {
    batches: current.batches + 1,
    source_rows: current.source_rows + next.source_rows,
    inserted: current.inserted + next.inserted,
    duplicates: current.duplicates + next.duplicates,
    matched: current.matched + next.matched,
    ambiguous: current.ambiguous + next.ambiguous,
    unmatched: current.unmatched + next.unmatched,
    connected: current.connected + next.connected,
    not_connected: current.not_connected + next.not_connected,
    indeterminate: current.indeterminate + next.indeterminate,
  };
}

export function VocalcomUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [buildResult, setBuildResult] = useState<VocalcomBuildResult | null>(null);
  const [importResult, setImportResult] = useState<AggregateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(null);
    setRows(null);
    setBuildResult(null);
    setImportResult(null);
    setError(null);
    setProgress(0);
    setProgressLabel("");
    if (!selected) return;

    setParsing(true);
    try {
      const buffer = await selected.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const built = buildVocalcomImportRows(parsedRows);
      setFile(selected);
      setRows(built.rows.map((row) => row as unknown as Record<string, unknown>));
      setBuildResult(built.result);
      if (built.result.errors.length > 0 && built.rows.length === 0) {
        setError(built.result.errors[0]?.message ?? "No se pudo preparar el archivo Vocalcom.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo Vocalcom.");
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !rows || rows.length === 0) {
      setError("Selecciona un archivo Vocalcom válido.");
      return;
    }

    setPending(true);
    setError(null);
    setImportResult(null);
    setProgress(0);
    setProgressLabel("Preparando carga...");

    try {
      const supabase = createClient();
      const batches = chunk(rows, VOCALCOM_CHUNK_SIZE);
      let aggregate = { ...EMPTY_AGGREGATE };

      for (let i = 0; i < batches.length; i++) {
        setProgressLabel(
          batches.length > 1
            ? `Procesando lote ${i + 1} de ${batches.length}...`
            : "Procesando archivo Vocalcom..."
        );

        const fileName = batches.length > 1 ? `${file.name} (lote ${i + 1}/${batches.length})` : file.name;
        const { data, error: rpcError } = await supabase.rpc("import_vocalcom_events", {
          p_file_name: fileName,
          p_file_size: file.size,
          p_rows: batches[i],
        });

        if (rpcError) throw new Error(rpcError.message);
        aggregate = addResult(aggregate, data as VocalcomImportResult);
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }

      setImportResult(aggregate);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al cargar Vocalcom.");
    } finally {
      setPending(false);
    }
  }

  const busy = pending || parsing;
  const canSubmit = Boolean(rows && rows.length > 0 && !pending);

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Archivo Vocalcom acumulado (.csv, .xls, .xlsx)
          </label>
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            disabled={busy}
            onChange={handleFileChange}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          />
          {parsing && <p className="mt-1 text-xs text-muted-foreground">Leyendo y clasificando...</p>}
        </div>

        {buildResult && file && (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-xs font-medium text-foreground">
              {file.name}: {buildResult.totalRows.toLocaleString("es-CL")} fila(s),{" "}
              {buildResult.validRows.toLocaleString("es-CL")} lista(s) para procesar.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Recorridos" value={buildResult.validRows} highlight />
              <Stat label="Conecta" value={buildResult.connected} />
              <Stat label="No conecta" value={buildResult.notConnected} />
              <Stat label="Dudoso" value={buildResult.indeterminate} />
              <Stat label="Omitidas" value={buildResult.skippedRows} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Recorrido cuenta todo lo que viene tocado por Vocalcom. Conecta/no conecta se deriva
              desde `Stats_StatusText`, `Stats_StatusCode` y duración.
            </p>
            {buildResult.errors.length > 0 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {buildResult.errors.slice(0, 20).map((item, idx) => (
                  <li key={idx}>
                    {item.row > 0 ? `Fila ${item.row}: ` : ""}
                    {item.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
          disabled={busy || !canSubmit}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Procesando..." : "Cargar Vocalcom"}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {importResult && (
        <div className="rounded-xl border border-border bg-surface p-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Resultado de la carga</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Filas procesadas" value={importResult.source_rows} />
            <Stat label="Nuevas guardadas" value={importResult.inserted} highlight />
            <Stat label="Ya existían" value={importResult.duplicates} />
            <Stat label="Cruzadas CRM" value={importResult.matched} />
            <Stat label="Ambiguas" value={importResult.ambiguous} />
            <Stat label="Sin match" value={importResult.unmatched} />
            <Stat label="Conecta" value={importResult.connected} />
            <Stat label="No conecta" value={importResult.not_connected} />
            <Stat label="Dudoso" value={importResult.indeterminate} />
            <Stat label="Lotes" value={importResult.batches} />
          </div>
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
