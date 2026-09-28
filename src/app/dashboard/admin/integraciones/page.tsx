import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CircleHelp,
  Copy,
  Database,
  FileSpreadsheet,
  FileUp,
  Link2,
  PhoneCall,
  PhoneOff,
  Rows3,
} from "lucide-react";
import { VocalcomUploadForm } from "@/components/vocalcom-upload-form";
import {
  Callout,
  EmptyState,
  MetricCard,
  SectionCard,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";

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
      <p className="text-sm text-muted-foreground">
        Sube el archivo acumulado diario de Vocalcom. Atlas guarda solo eventos nuevos, marca todo lo
        tocado como recorrido y clasifica conecta/no conecta como dato técnico.
      </p>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Importaciones" value={formatNumber(totals.total_imports)} icon={FileUp} iconTone="slate" />
        <MetricCard label="Eventos guardados" value={formatNumber(totals.stored_events)} icon={Database} iconTone="blue" />
        <MetricCard label="Ya venían en cargas previas" value={formatNumber(totals.duplicate_events)} icon={Copy} iconTone="slate" />
        <MetricCard label="Cruzados con CRM" value={formatNumber(totals.matched_events)} icon={Link2} iconTone="blue" />
        <MetricCard label="Conecta" value={formatNumber(totals.connected_events)} icon={PhoneCall} iconTone="green" />
        <MetricCard label="No conecta" value={formatNumber(totals.not_connected_events)} icon={PhoneOff} iconTone="rose" />
        <MetricCard label="Dudosos" value={formatNumber(totals.indeterminate_events)} icon={CircleHelp} iconTone="amber" />
        <MetricCard label="Filas leídas" value={formatNumber(totals.source_rows)} icon={Rows3} iconTone="slate" />
      </section>

      <VocalcomUploadForm />

      {error && (
        <Callout tone="warning">
          La pantalla está disponible, pero falta aplicar la migración Vocalcom en la base de
          datos: {error.message}
        </Callout>
      )}

      <SectionCard icon={FileSpreadsheet} tone="primary" title="Últimas cargas">
        {recent.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="Aún no hay archivos Vocalcom cargados." />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-full text-left">
              <Thead>
                <Th>Fecha</Th>
                <Th>Archivo</Th>
                <Th align="right">Nuevas</Th>
                <Th align="right">Existían</Th>
                <Th align="right">CRM</Th>
                <Th align="right">Conecta</Th>
                <Th align="right">No conecta</Th>
                <Th align="right">Dudoso</Th>
                <Th>Usuario</Th>
              </Thead>
              <Tbody>
                {recent.map((item) => (
                  <Tr key={item.id}>
                    <Td muted className="whitespace-nowrap">
                      {formatDateTime(item.created_at)}
                    </Td>
                    <Td className="max-w-72 truncate text-foreground">{item.file_name}</Td>
                    <Td align="right" strong>{formatNumber(item.inserted_count)}</Td>
                    <Td align="right" muted>{formatNumber(item.duplicate_count)}</Td>
                    <Td align="right" muted>{formatNumber(item.matched_count)}</Td>
                    <Td align="right" muted>{formatNumber(item.connected_count)}</Td>
                    <Td align="right" muted>{formatNumber(item.not_connected_count)}</Td>
                    <Td align="right" muted>{formatNumber(item.indeterminate_count)}</Td>
                    <Td muted className="whitespace-nowrap">
                      {item.uploaded_by_name ?? "—"}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
