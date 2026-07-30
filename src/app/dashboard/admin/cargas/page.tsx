import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BulkUploadForm } from "@/components/bulk-upload-form";
import {
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" });
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
    teamsQuery.eq("supervisor_id", profile.id);
  }

  const [{ data: teams }, { data: workflows }, { data: campaigns }, { data: uploads }] = await Promise.all([
    teamsQuery,
    supabase.from("workflows").select("id, name").eq("is_active", true).eq("status", "published").order("name"),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
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
        description="Sube un archivo CSV o Excel para crear registros en lote. Si la carga es para una campaña, el flujo de gestión de esa campaña queda asignado automáticamente."
      />

      <BulkUploadForm
        teams={teams ?? []}
        workflows={workflows ?? []}
        campaigns={campaigns ?? []}
        defaultCampaignId={campaign_id ?? ""}
      />

      <SectionCard
        title="Historial de cargas"
        description="Últimos 25 archivos procesados, con lo que entró y lo que se descartó en cada uno."
      >
        <Table>
          <Thead>
            <Th>Archivo</Th>
            <Th>Campaña</Th>
            <Th align="right">Filas</Th>
            <Th align="right">Creadas</Th>
            <Th align="right">Duplicadas</Th>
            <Th align="right">Rechazadas</Th>
            <Th>Subió</Th>
            <Th>Fecha</Th>
          </Thead>
          <Tbody>
            {history.length === 0 && (
              <TableEmpty colSpan={8}>
                Todavía no hay cargas registradas. La próxima que hagas quedará acá con su resultado.
              </TableEmpty>
            )}
            {history.map((upload) => (
              <Tr key={upload.id}>
                <Td strong className="max-w-72 truncate">
                  {upload.file_name}
                </Td>
                <Td muted>{one(upload.campaigns)?.name ?? "Sin campaña"}</Td>
                <Td align="right" muted>
                  {upload.total_rows.toLocaleString("es-CL")}
                </Td>
                <Td align="right" strong>
                  {upload.inserted_count.toLocaleString("es-CL")}
                </Td>
                <Td align="right" muted>
                  {(upload.duplicates_in_file + upload.duplicates_in_db).toLocaleString("es-CL")}
                </Td>
                <Td align="right" className={upload.rejected_count > 0 ? "text-warning" : "text-muted-foreground"}>
                  {upload.rejected_count.toLocaleString("es-CL")}
                </Td>
                <Td muted>{one(upload.profiles)?.full_name ?? "—"}</Td>
                <Td muted>{formatDateTime(upload.created_at)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
