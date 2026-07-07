import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { activateHistoricalAgent } from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
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

  const { data: callCounts } = await supabase
    .from("calls")
    .select("historical_agent_id")
    .not("historical_agent_id", "is", null);

  const countsByAgent = new Map<string, number>();
  for (const row of callCounts ?? []) {
    const id = row.historical_agent_id as string;
    countsByAgent.set(id, (countsByAgent.get(id) ?? 0) + 1);
  }

  const linkedProfileIds = (agents ?? [])
    .map((a) => a.linked_profile_id)
    .filter((id): id is string => !!id);

  const { data: linkedProfiles } = linkedProfileIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", linkedProfileIds)
    : { data: [] };

  const profileOf = (id: string | null) => (linkedProfiles ?? []).find((p) => p.id === id) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ejecutivos históricos"
        description="Personas que aparecen en la gestión heredada de un CRM legado. Mientras no se activen, su historial queda registrado pero sin login propio. Activar un ejecutivo crea una cuenta real y le reasigna todo su historial de llamadas, sin perder la trazabilidad al origen legado."
      />

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
                        <form
                          action={activateHistoricalAgent}
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
                          <Button type="submit">Crear cuenta y activar</Button>
                        </form>
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
