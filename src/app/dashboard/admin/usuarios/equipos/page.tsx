import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { createTeam, updateTeamSupervisor } from "@/app/actions/admin";
import { CreatePanel } from "@/components/create-panel";
import { Button, Field, Input, SectionCard, Select, Table, Tbody, Td, Th, Thead, TableEmpty, Tr } from "@/components/ui";

export default async function TeamsAdminPage() {
  noStore();
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const [{ data: teams }, { data: profiles }] = await Promise.all([
    supabase.from("teams").select("*").order("name"),
    supabase.from("profiles").select("id, full_name, role, team_id"),
  ]);

  const supervisors = (profiles ?? []).filter((profile) => profile.role === "supervisor");
  const agentsByTeam = new Map<string, number>();
  for (const profile of profiles ?? []) {
    if (profile.role !== "agente" || !profile.team_id) continue;
    agentsByTeam.set(profile.team_id, (agentsByTeam.get(profile.team_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Equipos"
        description="Un supervisor puede quedar a cargo de varios equipos: guárdalo en cada uno que deba supervisar."
        actions={
          <CreatePanel
            label="Nuevo equipo"
            title="Nuevo equipo"
            description="Los ejecutivos se asignan después, desde la pestaña Usuarios."
            action={createTeam}
            submitLabel="Crear equipo"
          >
            <Field label="Nombre del equipo">
              <Input name="name" required placeholder="Ventas Hogar" data-autofocus />
            </Field>
            <Field label="Supervisor">
              <Select name="supervisor_id" defaultValue="">
                <option value="">Sin supervisor</option>
                {supervisors.map((supervisor) => (
                  <option key={supervisor.id} value={supervisor.id}>
                    {supervisor.full_name}
                  </option>
                ))}
              </Select>
            </Field>
          </CreatePanel>
        }
      >
        <Table>
          <Thead>
            <Th>Equipo</Th>
            <Th align="right">Ejecutivos</Th>
            <Th>Supervisor</Th>
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
                  <form action={updateTeamSupervisor} className="flex items-center gap-2">
                    <input type="hidden" name="team_id" value={team.id} />
                    <Select
                      name="supervisor_id"
                      fieldSize="sm"
                      defaultValue={team.supervisor_id ?? ""}
                      className="w-auto"
                    >
                      <option value="">Sin supervisor</option>
                      {supervisors.map((supervisor) => (
                        <option key={supervisor.id} value={supervisor.id}>
                          {supervisor.full_name}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" size="sm">
                      Guardar
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
