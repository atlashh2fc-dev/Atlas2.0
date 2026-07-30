import { requireProfile } from "@/lib/auth";
import { listAllStatusReasons, createStatusReason, toggleStatusReasonActive } from "@/app/actions/agent-status";
import { CreatePanel } from "@/components/create-panel";
import {
  Badge,
  Button,
  Field,
  InfoTooltip,
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

export default async function EstadosAgentePage() {
  await requireProfile(["admin"]);
  const reasons = await listAllStatusReasons();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estados de agente"
        description="El CTI tiene dos estados operativos: Disponible y AUX. Cada AUX exige un motivo concreto y saca al ejecutivo de las colas mientras esté activo."
        actions={
          <CreatePanel
            label="Nuevo motivo"
            title="Nuevo motivo AUX"
            description="Aparecerá en el CTI del ejecutivo y sacará su extensión de las colas mientras esté activo."
            action={createStatusReason}
            submitLabel="Crear motivo"
          >
            <Field label="Código">
              <Input name="code" required placeholder="almuerzo" data-autofocus />
            </Field>
            <Field label="Etiqueta">
              <Input name="label" required placeholder="Almuerzo" />
            </Field>
            <Field label="Orden en el CTI">
              <Input name="sort_order" type="number" defaultValue={reasons.length} />
            </Field>
          </CreatePanel>
        }
      />

      <SectionCard
        title="Catálogo de estados"
        description="Cada estado define si el ejecutivo recibe llamadas y cómo se cuenta su tiempo en los reportes."
      >
        <Table>
          <Thead>
            <Th>Estado</Th>
            <Th>Código</Th>
            <Th>
              <span className="inline-flex items-center gap-1">
                En la cola
                <InfoTooltip text="Si está en la cola, el discador le puede entregar llamadas. Los motivos AUX lo sacan de la cola." />
              </span>
            </Th>
            <Th>
              <span className="inline-flex items-center gap-1">
                Efecto en reportes
                <InfoTooltip
                  text="El tiempo en AUX resta adherencia y no cuenta como productivo. El tiempo disponible sí cuenta para adherencia. Los estados del sistema se excluyen del cálculo."
                  align="right"
                />
              </span>
            </Th>
            <Th>Disponibilidad</Th>
            <Th />
          </Thead>
          <Tbody>
            {reasons.length === 0 && <TableEmpty colSpan={6}>No hay motivos configurados.</TableEmpty>}
            {reasons.map((reason) => (
              <Tr key={reason.id}>
                <Td strong>
                  {reason.is_pause && !reason.is_system ? `AUX · ${reason.label}` : reason.label}
                  {reason.is_system && (
                    <Badge tone="neutral" className="ml-2">
                      Sistema
                    </Badge>
                  )}
                </Td>
                <Td muted>{reason.code}</Td>
                <Td>
                  {reason.is_system ? (
                    <span className="text-muted-foreground">Automático</span>
                  ) : reason.is_pause ? (
                    <span className="text-warning">Fuera de la cola</span>
                  ) : (
                    <span className="text-success">Recibe llamadas</span>
                  )}
                </Td>
                <Td muted>
                  {reason.excludes_from_adherence
                    ? "Se excluye del cálculo de adherencia"
                    : reason.is_productive
                      ? "Cuenta como tiempo productivo"
                      : reason.is_pause
                        ? "Resta adherencia · no es tiempo productivo"
                        : "Cuenta como tiempo disponible"}
                  {reason.max_seconds != null && (
                    <span className="mt-0.5 block text-xs">
                      Tope sugerido: {Math.round(reason.max_seconds / 60)} min
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={reason.is_active ? "success" : "danger"}>
                    {reason.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </Td>
                <Td align="right">
                  <form action={toggleStatusReasonActive}>
                    <input type="hidden" name="id" value={reason.id} />
                    <input type="hidden" name="active" value={String(reason.is_active)} />
                    <Button type="submit" variant="secondary" size="sm">
                      {reason.is_active ? "Desactivar" : "Activar"}
                    </Button>
                  </form>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>

    </div>
  );
}
