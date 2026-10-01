import { UsersRound } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { connection } from "next/server";
import { createTeam, updateTeamSupervisors } from "@/app/actions/admin";
import { CreatePanel } from "@/components/create-panel";
import { Conteo } from "../../_diseno";
import { ActionForm, ActionSubmit, Avatar, EmptyState, Field, Input, SectionCard, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export default async function TeamsAdminPage() {
  await connection();
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
        title={
          <>
            Equipos
            <Conteo>{(teams ?? []).length}</Conteo>
          </>
        }
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
              <div className="mt-2 grid gap-0.5">
                {supervisors.length === 0 && (
                  <p className="text-xs text-muted-foreground">Todavía no hay supervisores. Puedes crear el equipo y asignarlos después.</p>
                )}
                {supervisors.map((supervisor) => (
                  <label key={supervisor.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface-muted/70 has-[:checked]:bg-primary/[0.06]">
                    <input type="checkbox" name="supervisor_ids" value={supervisor.id} className="size-4 accent-primary" />
                    <Avatar name={supervisor.full_name} size="sm" />
                    <span className="min-w-0">
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
            <Th>Supervisores</Th>
          </Thead>
          <Tbody>
            {(teams ?? []).length === 0 && (
              <TableEmpty colSpan={2}>
                <EmptyState
                  icon={UsersRound}
                  title="No hay equipos creados."
                  description="Crea el primero con «Nuevo equipo» y después asigna a sus ejecutivos desde Usuarios."
                  className="py-6"
                />
              </TableEmpty>
            )}
            {(teams ?? []).map((team) => (
              <Tr key={team.id}>
                <Td className="min-w-56 align-top">
                  <span className="flex items-center gap-3">
                    <Avatar name={team.name} size="md" shape="square" />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{team.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {agentsByTeam.get(team.id) ?? 0} {(agentsByTeam.get(team.id) ?? 0) === 1 ? "ejecutivo" : "ejecutivos"}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td>
                  <ActionForm action={updateTeamSupervisors} success="Supervisores actualizados" className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="team_id" value={team.id} />
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                      <legend className="sr-only">Supervisores de {team.name}</legend>
                      {supervisors.map((supervisor) => (
                        <label key={supervisor.id} className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground has-[:checked]:text-foreground">
                          <input
                            type="checkbox"
                            name="supervisor_ids"
                            value={supervisor.id}
                            defaultChecked={supervisorIdsByTeam.get(team.id)?.has(supervisor.id) ?? false}
                            className="size-4 accent-primary"
                          />
                          <Avatar name={supervisor.full_name} size="xs" />
                          {supervisor.full_name}
                        </label>
                      ))}
                    </fieldset>
                    <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
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
