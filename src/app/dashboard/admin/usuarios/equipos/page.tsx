import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { createTeam, updateTeamSupervisors } from "@/app/actions/admin";
import { CreatePanel } from "@/components/create-panel";
import { ActionForm, ActionSubmit, Field, Input, SectionCard, Select, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export default async function TeamsAdminPage() {
  noStore();
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const [{ data: teams }, { data: profiles }, { data: supervisorMemberships }] = await Promise.all([
    supabase.from("teams").select("*").order("name"),
    supabase.from("profiles").select("id, full_name, email, role, team_id"),
    supabase.from("team_supervisors").select("team_id, supervisor_id"),
  ]);

  const supervisors = (profiles ?? []).filter((profile) => profile.role === "supervisor");
  const agentsByTeam = new Map<string, number>();
  for (const profile of profiles ?? []) {
    if (profile.role !== "agente" || !profile.team_id) continue;
    agentsByTeam.set(profile.team_id, (agentsByTeam.get(profile.team_id) ?? 0) + 1);
  }
  const supervisorIdsByTeam = new Map<string, Set<string>>();
  for (const membership of supervisorMemberships ?? []) {
    const current = supervisorIdsByTeam.get(membership.team_id) ?? new Set<string>();
    current.add(membership.supervisor_id);
    supervisorIdsByTeam.set(membership.team_id, current);
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Equipos"
        description="Un equipo puede tener varios supervisores y cada supervisor puede participar en varios equipos."
        actions={
          <CreatePanel
            label="Nuevo equipo"
            title="Nuevo equipo"
            description="Los ejecutivos se asignan después, desde la pestaña Usuarios."
            action={createTeam}
            submitLabel="Crear equipo"
            successLabel="Equipo creado"
          >
            <Field label="Nombre del equipo">
              <Input name="name" required placeholder="Ventas Hogar" data-autofocus />
            </Field>
            <fieldset>
              <legend className="text-xs font-medium text-foreground">Supervisores</legend>
              <div className="mt-2 grid gap-2">
                {supervisors.map((supervisor) => (
                  <label key={supervisor.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <input type="checkbox" name="supervisor_ids" value={supervisor.id} className="mt-1" />
                    <span>
                      <span className="block font-medium">{supervisor.full_name}</span>
                      <span className="block text-xs text-muted-foreground">{supervisor.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </CreatePanel>
        }
      >
        <Table>
          <Thead>
            <Th>Equipo</Th>
            <Th align="right">Ejecutivos</Th>
            <Th>Supervisores</Th>
          </Thead>
          <Tbody>
            {(teams ?? []).length === 0 && <TableEmpty colSpan={3}>No hay equipos creados.</TableEmpty>}
            {(teams ?? []).map((team) => (
              <Tr key={team.id}>
                <Td strong>{team.name}</Td>
                <Td align="right" muted>
                  {agentsByTeam.get(team.id) ?? 0}
                </Td>
                <Td>
                  <ActionForm action={updateTeamSupervisors} success="Supervisores actualizados" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="team_id" value={team.id} />
                    <fieldset className="flex flex-wrap gap-2">
                      <legend className="sr-only">Supervisores de {team.name}</legend>
                      {supervisors.map((supervisor) => (
                        <label key={supervisor.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs">
                          <input
                            type="checkbox"
                            name="supervisor_ids"
                            value={supervisor.id}
                            defaultChecked={supervisorIdsByTeam.get(team.id)?.has(supervisor.id) ?? false}
                          />
                          {supervisor.full_name}
                        </label>
                      ))}
                    </fieldset>
                    <ActionSubmit size="sm" pendingLabel="Guardando…">
                      Guardar
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
