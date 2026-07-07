import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createCampaign, toggleCampaignActive } from "@/app/actions/campaigns";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  Input,
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

export default async function CampaignsPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*, workflows(name)")
    .order("created_at", { ascending: true });

  const { data: leadCounts } = await supabase
    .from("leads")
    .select("campaign_id")
    .not("campaign_id", "is", null);

  const countByCampaign = new Map<string, number>();
  (leadCounts ?? []).forEach((row) => {
    const id = row.campaign_id as string;
    countByCampaign.set(id, (countByCampaign.get(id) ?? 0) + 1);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campañas"
        description="Cada campaña es su propio ecosistema: ejecutivos asignados, base de datos de leads y un flujo productivo propio."
      />

      <SectionCard>
        <Table>
          <Thead>
            <Th>Nombre</Th>
            <Th>Flujo productivo</Th>
            <Th>Leads</Th>
            <Th>Estado</Th>
            <Th />
          </Thead>
          <Tbody>
            {(campaigns ?? []).length === 0 && (
              <TableEmpty colSpan={5}>Todavía no hay campañas creadas.</TableEmpty>
            )}
            {(campaigns ?? []).map((c) => (
              <Tr key={c.id}>
                <Td strong>
                  <Link href={`/dashboard/admin/campanas/${c.id}`} className="hover:text-primary">
                    {c.name}
                  </Link>
                  {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
                </Td>
                <Td muted>{(c.workflows as { name: string } | null)?.name ?? "Sin flujo asignado"}</Td>
                <Td muted>{countByCampaign.get(c.id) ?? 0}</Td>
                <Td>
                  <Badge tone={c.is_active ? "success" : "danger"}>
                    {c.is_active ? "Activa" : "Inactiva"}
                  </Badge>
                </Td>
                <Td align="right">
                  <form action={toggleCampaignActive}>
                    <input type="hidden" name="campaign_id" value={c.id} />
                    <input type="hidden" name="active" value={String(c.is_active)} />
                    <Button type="submit" variant="secondary" size="sm">
                      {c.is_active ? "Desactivar" : "Activar"}
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear campaña</h2>
        <form action={createCampaign} className="flex max-w-xl flex-col gap-3 sm:flex-row">
          <Input type="text" name="name" required placeholder="Nombre de la campaña" className="flex-1" />
          <Input type="text" name="description" placeholder="Descripción (opcional)" className="flex-1" />
          <Button type="submit">Crear y configurar</Button>
        </form>
      </Card>
    </div>
  );
}
