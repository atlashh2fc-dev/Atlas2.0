import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VocalcomUploadForm } from "@/components/vocalcom-upload-form";

type VocalcomSummary = {
  totals?: {
    total_imports?: number;
    source_rows?: number;
    stored_events?: number;
    duplicate_events?: number;
    matched_events?: number;
    connected_events?: number;
    not_connected_events?: number;
    indeterminate_events?: number;
  };
  recent?: {
    id: string;
    file_name: string;
    source_row_count: number;
    inserted_count: number;
    duplicate_count: number;
    matched_count: number;
    ambiguous_count: number;
    unmatched_count: number;
    connected_count: number;
    not_connected_count: number;
    indeterminate_count: number;
    created_at: string;
    uploaded_by_name: string | null;
  }[];
};

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("es-CL");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function VocalcomAdminPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_vocalcom_import_admin_summary");

  const summary = (error ? {} : data ?? {}) as VocalcomSummary;
  const totals = summary.totals ?? {};
  const recent = summary.recent ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cargar Vocalcom</h1>
        <p className="text-sm text-muted-foreground">
          Sube el archivo acumulado diario. Atlas guarda solo eventos nuevos, marca todo lo tocado
          como recorrido y clasifica conecta/no conecta como dato técnico.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Metric label="Importaciones" value={formatNumber(totals.total_imports)} />
        <Metric label="Eventos guardados" value={formatNumber(totals.stored_events)} />
        <Metric label="Ya venían en cargas previas" value={formatNumber(totals.duplicate_events)} />
        <Metric label="Cruzados con CRM" value={formatNumber(totals.matched_events)} />
        <Metric label="Conecta" value={formatNumber(totals.connected_events)} />
        <Metric label="No conecta" value={formatNumber(totals.not_connected_events)} />
        <Metric label="Dudosos" value={formatNumber(totals.indeterminate_events)} />
        <Metric label="Filas leídas" value={formatNumber(totals.source_rows)} />
      </section>

      <VocalcomUploadForm />

      {error && (
        <div className="rounded-xl border border-warning/40 bg-warning-bg p-4 text-sm text-warning">
          La pantalla está disponible, pero falta aplicar la migración Vocalcom en la base de
          datos: {error.message}
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Últimas cargas</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay archivos Vocalcom cargados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Archivo</th>
                  <th className="px-3 py-2 font-medium">Nuevas</th>
                  <th className="px-3 py-2 font-medium">Existían</th>
                  <th className="px-3 py-2 font-medium">CRM</th>
                  <th className="px-3 py-2 font-medium">Conecta</th>
                  <th className="px-3 py-2 font-medium">No conecta</th>
                  <th className="px-3 py-2 font-medium">Dudoso</th>
                  <th className="px-3 py-2 font-medium">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="max-w-72 truncate px-3 py-2 text-foreground">{item.file_name}</td>
                    <td className="px-3 py-2 text-foreground">{formatNumber(item.inserted_count)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(item.duplicate_count)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(item.matched_count)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(item.connected_count)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(item.not_connected_count)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(item.indeterminate_count)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {item.uploaded_by_name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
