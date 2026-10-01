import { FileSpreadsheet, FileText, FileUp } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BulkUploadForm } from "@/components/bulk-upload-form";
import {
  Avatar,
  EmptyState,
  PageHeader,
  SectionCard,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TableEmpty,
  Tr,
} from "@/components/ui";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";

type UploadRow = {
  id: string;
  file_name: string;
  total_rows: number;
  inserted_count: number;
  duplicates_in_file: number;
  duplicates_in_db: number;
  rejected_count: number;
  created_at: string;
  campaigns: { name: string } | { name: string }[] | null;
  profiles: { full_name: string } | { full_name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatDay(value: string): string {
  return new Date(value)
    .toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Santiago" })
    .replace(".", "");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" });
}

/**
 * Resultado de una carga de un vistazo: una barra con lo que entró, lo
 * duplicado y lo rechazado, y las cifras debajo. Reemplaza tres columnas de
 * números sueltos.
 */
function ResultBar({ upload }: { upload: UploadRow }) {
  const duplicated = upload.duplicates_in_file + upload.duplicates_in_db;
  const total = Math.max(1, upload.total_rows);
  const pct = (value: number) => `${Math.min(100, (value / total) * 100)}%`;
  return (
    <div className="min-w-48">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
        <span className="h-full bg-success" style={{ width: pct(upload.inserted_count) }} />
        <span className="h-full bg-muted-foreground/40" style={{ width: pct(duplicated) }} />
        <span className="h-full bg-warning" style={{ width: pct(upload.rejected_count) }} />
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{upload.inserted_count.toLocaleString("es-CL")}</span> creadas
        </span>
        {duplicated > 0 && <span>{duplicated.toLocaleString("es-CL")} duplicadas</span>}
        {upload.rejected_count > 0 && (
          <span className="font-medium text-warning">{upload.rejected_count.toLocaleString("es-CL")} rechazadas</span>
        )}
      </p>
    </div>
  );
}

export default async function BulkUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  const profile = await requireProfile(["supervisor", "admin"]);
  const { campaign_id } = await searchParams;
  const supabase = await createClient();

  const teamsQuery = supabase.from("teams").select("id, name").order("name");
  if (profile.role === "supervisor") {
    const teamIds = await getSupervisedTeamIds(supabase);
    teamsQuery.in("id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const [{ data: teams }, { data: workflows }, { data: campaigns }, { data: uploads }] = await Promise.all([
    teamsQuery,
    supabase.from("workflows").select("id, name").eq("is_active", true).eq("status", "published").order("name"),
    supabase.from("campaigns").select("id, name, workflow_id").eq("is_active", true).order("name"),
    supabase
      .from("lead_uploads")
      .select(
        "id, file_name, total_rows, inserted_count, duplicates_in_file, duplicates_in_db, rejected_count, created_at, campaigns(name), profiles(full_name)"
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const history = (uploads ?? []) as unknown as UploadRow[];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cargas y listas"
        icon={FileUp}
        description="Sube un archivo CSV o Excel para crear registros en lote. Si la carga es para una campaña, el flujo de gestión de esa campaña queda asignado automáticamente."
      />

      <BulkUploadForm
        teams={teams ?? []}
        workflows={workflows ?? []}
        campaigns={campaigns ?? []}
        defaultCampaignId={campaign_id ?? ""}
      />

      <SectionCard
        icon={FileUp}
        tone="blue"
        title="Historial de cargas"
        description="Últimos 25 archivos procesados, con lo que entró y lo que se descartó en cada uno."
      >
        <Table>
          <Thead>
            <Th>Archivo</Th>
            <Th>Campaña</Th>
            <Th align="right">Filas</Th>
            <Th>Resultado</Th>
            <Th>Subió</Th>
            <Th>Fecha</Th>
          </Thead>
          <Tbody>
            {history.length === 0 && (
              <TableEmpty colSpan={6}>
                <EmptyState
                  icon={FileUp}
                  title="Todavía no hay cargas registradas."
                  description="La próxima que hagas quedará acá con su resultado."
                  className="py-6"
                />
              </TableEmpty>
            )}
            {history.map((upload) => {
              const csv = /\.csv$/i.test(upload.file_name);
              const campaign = one(upload.campaigns)?.name ?? null;
              const uploader = one(upload.profiles)?.full_name ?? null;
              return (
                <Tr key={upload.id}>
                  <Td>
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="icon-chip size-9 rounded-lg" data-tone={csv ? "blue" : "green"}>
                        {csv ? <FileText size={17} aria-hidden="true" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block max-w-72 truncate font-medium text-foreground" title={upload.file_name}>
                          {upload.file_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">{csv ? "CSV" : "Excel"}</span>
                      </span>
                    </span>
                  </Td>
                  <Td className={campaign ? "text-foreground" : "text-muted-foreground"}>{campaign ?? "Sin campaña"}</Td>
                  <Td align="right" strong>
                    {upload.total_rows.toLocaleString("es-CL")}
                  </Td>
                  <Td>
                    <ResultBar upload={upload} />
                  </Td>
                  <Td>
                    {uploader ? (
                      <span className="flex items-center gap-2 whitespace-nowrap text-foreground">
                        <Avatar name={uploader} size="xs" />
                        {uploader}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span className="block text-foreground">{formatDay(upload.created_at)}</span>
                    <span className="block text-xs text-muted-foreground">{formatTime(upload.created_at)}</span>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
