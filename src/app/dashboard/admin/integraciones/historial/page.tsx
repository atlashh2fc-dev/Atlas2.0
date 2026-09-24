import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { activateHistoricalAgent } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Field,
  Input,
  SectionCard,
  Select,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  TableEmpty,
  Tr,
} from "@/components/ui";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

export default async function HistoricalAgentsAdminPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: agents } = await supabase
    .from("historical_agents")
    .select("id, full_name, legacy_system, legacy_executive_id, linked_profile_id, created_at")
    .order("full_name");

  const { data: teams } = await supabase.from("teams").select("*").order("name");

  // Se cuenta en la base: traer las filas topa en 1.000 y deja a casi todos en 0.
  const { data: callCounts } = await supabase.rpc("historical_agent_call_counts");

  const countsByAgent = new Map<string, number>(
    (callCounts ?? []).map((row: { historical_agent_id: string; calls: number }) => [
      row.historical_agent_id,
      Number(row.calls),
    ])
  );

  const linkedProfileIds = (agents ?? [])
    .map((a) => a.linked_profile_id)
    .filter((id): id is string => !!id);

  const { data: linkedProfiles } = linkedProfileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", linkedProfileIds)
    : { data: [] };

  const profileOf = (id: string | null) => (linkedProfiles ?? []).find((p) => p.id === id) ?? null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Personas que aparecen en la gestión heredada de un CRM legado. Mientras no se activen, su
        historial queda registrado pero sin login propio. Activar un ejecutivo crea una cuenta real y le
        reasigna todo su historial de llamadas, sin perder la trazabilidad al origen legado.
      </p>

      <SectionCard>
        <Table>
          <Thead>
            <Th>Ejecutivo (legado)</Th>
            <Th>Sistema origen</Th>
            <Th>Llamadas históricas</Th>
            <Th>Estado</Th>
            <Th>Activar</Th>
          </Thead>
          <Tbody>
            {(agents ?? []).map((a) => {
              const linked = profileOf(a.linked_profile_id);
              const calls = countsByAgent.get(a.id) ?? 0;
              return (
                <Tr key={a.id}>
                  <Td strong>{a.full_name}</Td>
                  <Td muted>{a.legacy_system}</Td>
                  <Td muted>{calls}</Td>
                  <Td>
                    {linked ? (
                      <Badge tone="success">Activo como {linked.full_name}</Badge>
                    ) : (
                      <Badge tone="neutral">Sin activar</Badge>
                    )}
                  </Td>
                  <Td>
                    {linked ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-primary">
                          Activar ejecutivo
                        </summary>
                        <ActionForm
                          action={activateHistoricalAgent}
                          success="Cuenta creada y ejecutivo activado"
                          className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-3"
                        >
                          <input type="hidden" name="historical_agent_id" value={a.id} />
                          <Field label="Correo" className="w-52">
                            <Input type="email" name="email" required placeholder="correo@ejemplo.com" />
                          </Field>
                          <Field label="Contraseña" className="w-40">
                            <Input
                              type="text"
                              name="password"
                              required
                              minLength={6}
                              placeholder="Mínimo 6 caracteres"
                            />
                          </Field>
                          <Field label="Rol">
                            <Select name="role" defaultValue="agente" className="w-auto">
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Equipo">
                            <Select name="team_id" defaultValue="" className="w-auto">
                              <option value="">Sin equipo</option>
                              {(teams ?? []).map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <ActionSubmit pendingLabel="Creando…">Crear cuenta y activar</ActionSubmit>
                        </ActionForm>
                      </details>
                    )}
                  </Td>
                </Tr>
              );
            })}
            {(agents ?? []).length === 0 && (
              <TableEmpty colSpan={5}>No hay ejecutivos históricos registrados.</TableEmpty>
            )}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
