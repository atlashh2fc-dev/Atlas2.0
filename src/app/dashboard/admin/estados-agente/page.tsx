import { requireProfile } from "@/lib/auth";
import {
  listAllStatusReasons,
  createStatusReason,
  toggleStatusReasonActive,
  updateStatusReasonCap,
} from "@/app/actions/agent-status";
import { TOPE_MAXIMO_MINUTOS, TOPE_MINIMO_MINUTOS } from "@/lib/tope-de-pausa";
import { CreatePanel } from "@/components/create-panel";
import {
  ActionForm,
  ActionSubmit,
  Badge,
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
            successLabel="Motivo creado"
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
            <Field label="Tope en minutos (opcional)">
              <Input
                name="max_minutes"
                type="number"
                inputMode="numeric"
                min={TOPE_MINIMO_MINUTOS}
                max={TOPE_MAXIMO_MINUTOS}
                step={1}
                placeholder="10"
              />
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
            <Th>
              <span className="inline-flex items-center gap-1">
                Tope
                <InfoTooltip
                  text="Minutos que puede durar la pausa. No la corta: al pasarse, el teléfono le avisa a la ejecutiva y el monitor en vivo la marca como excedida. Vacío = sin tope."
                  align="right"
                />
              </span>
            </Th>
            <Th>Disponibilidad</Th>
            <Th />
          </Thead>
          <Tbody>
            {reasons.length === 0 && <TableEmpty colSpan={7}>No hay motivos configurados.</TableEmpty>}
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
                </Td>
                <Td>
                  {reason.is_pause ? (
                    <ActionForm action={updateStatusReasonCap} success="Tope guardado" className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={reason.id} />
                      {/* cn() no fusiona clases: el ancho va en el contenedor, no contra el w-full del Input. */}
                      <div className="w-20">
                        <Input
                          name="max_minutes"
                          type="number"
                          inputMode="numeric"
                          min={TOPE_MINIMO_MINUTOS}
                          max={TOPE_MAXIMO_MINUTOS}
                          step={1}
                          fieldSize="sm"
                          placeholder="Sin tope"
                          defaultValue={reason.max_seconds != null ? Math.round(reason.max_seconds / 60) : ""}
                          aria-label={`Tope en minutos de ${reason.label}`}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">min</span>
                      <ActionSubmit variant="secondary" size="sm" pendingLabel="…">
                        Guardar
                      </ActionSubmit>
                    </ActionForm>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={reason.is_active ? "success" : "danger"}>
                    {reason.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </Td>
                <Td align="right">
                  <ActionForm
                    action={toggleStatusReasonActive}
                    success={reason.is_active ? "Motivo desactivado" : "Motivo activado"}
                  >
                    <input type="hidden" name="id" value={reason.id} />
                    <input type="hidden" name="active" value={String(reason.is_active)} />
                    <ActionSubmit variant="secondary" size="sm" pendingLabel="…">
                      {reason.is_active ? "Desactivar" : "Activar"}
                    </ActionSubmit>
                  </ActionForm>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>

    </div>
  );
}
