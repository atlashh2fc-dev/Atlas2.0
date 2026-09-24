import { unstable_noStore as noStore } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types";
import { UsersTable, type UserRow } from "@/components/users-table";
import { Callout, NavTabs, PageHeader } from "@/components/ui";

/**
 * Usuarios del equipo: la supervisión administra a sus ejecutivos sin pasar
 * por un admin (skills = campañas, contraseña, activar o desactivar). Solo ve
 * y toca a los ejecutivos de los equipos que supervisa; rol y equipo siguen
 * siendo de administración. Las acciones vuelven a validar el alcance en el
 * servidor (requireAgentManager), esta pantalla solo decide qué se muestra.
 */
export default async function TeamUsersPage() {
  noStore();
  await requireProfile(["supervisor"]);
  const supabase = await createClient();

  const { data: teamIds, error: scopeError } = await supabase.rpc("supervised_team_ids");
  const supervisedTeamIds = ((teamIds ?? []) as string[]).filter(Boolean);

  const header = (
    <>
      <PageHeader
        title="Mi equipo"
        description="Administra a tus ejecutivos: campañas que operan, contraseña y acceso."
        className="border-b-0 pb-0"
      />
      <NavTabs
        tabs={[
          { label: "Operación", href: "/dashboard/team" },
          { label: "Usuarios", href: "/dashboard/team/usuarios" },
        ]}
      />
    </>
  );

  if (scopeError || supervisedTeamIds.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <Callout tone={scopeError ? "danger" : "info"}>
          {scopeError
            ? `No se pudieron leer tus equipos: ${scopeError.message}`
            : "No tienes equipos asignados. Pide a un administrador que te asigne como supervisor de un equipo."}
        </Callout>
      </div>
    );
  }

  // La seguridad por fila de profiles y campaign_agents es de admin: se leen
  // con la llave de servicio, acotadas aquí a los equipos que supervisa.
  const admin = createAdminClient();
  const [
    { data: agents, error: agentsError },
    { data: teams },
    { data: teamSupervisors },
    { data: campaigns },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email, role, team_id, active")
      .eq("role", "agente")
      .in("team_id", supervisedTeamIds)
      .order("full_name"),
    admin.from("teams").select("id, name").in("id", supervisedTeamIds).order("name"),
    admin.from("team_supervisors").select("team_id, supervisor_id").in("team_id", supervisedTeamIds),
    // Campañas elegibles: las activas de su empresa (la sesión del supervisor
    // ya las acota por empresa).
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
  ]);

  const agentIds = (agents ?? []).map((agent) => agent.id);
  const supervisorIds = [...new Set((teamSupervisors ?? []).map((row) => row.supervisor_id))];
  const [{ data: memberships }, { data: supervisors }] = await Promise.all([
    agentIds.length
      ? admin.from("campaign_agents").select("profile_id, campaign_id").in("profile_id", agentIds)
      : Promise.resolve({ data: [] as { profile_id: string; campaign_id: string }[] }),
    supervisorIds.length
      ? admin.from("profiles").select("id, full_name").in("id", supervisorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const visibleCampaignIds = new Set((campaigns ?? []).map((campaign) => campaign.id));
  const campaignIdsByAgent = new Map<string, string[]>();
  for (const membership of memberships ?? []) {
    if (!visibleCampaignIds.has(membership.campaign_id)) continue;
    campaignIdsByAgent.set(membership.profile_id, [
      ...(campaignIdsByAgent.get(membership.profile_id) ?? []),
      membership.campaign_id,
    ]);
  }
  const teamName = new Map((teams ?? []).map((team) => [team.id, team.name]));
  const supervisorName = new Map((supervisors ?? []).map((person) => [person.id, person.full_name]));
  const supervisorNamesByTeam = new Map<string, string[]>();
  for (const row of teamSupervisors ?? []) {
    const name = supervisorName.get(row.supervisor_id);
    if (!name) continue;
    supervisorNamesByTeam.set(row.team_id, [...(supervisorNamesByTeam.get(row.team_id) ?? []), name]);
  }

  const rows: UserRow[] = (agents ?? []).map((agent) => ({
    id: agent.id,
    full_name: agent.full_name,
    email: agent.email,
    role: agent.role as AppRole,
    team_id: agent.team_id,
    active: agent.active,
    team_name: agent.team_id ? teamName.get(agent.team_id) ?? null : null,
    supervisor_names: agent.team_id ? supervisorNamesByTeam.get(agent.team_id) ?? [] : [],
    supervised_team_ids: [],
    campaign_ids: campaignIdsByAgent.get(agent.id) ?? [],
  }));

  return (
    <div className="space-y-5">
      {header}
      {agentsError ? (
        <Callout tone="danger">No se pudieron cargar tus ejecutivos: {agentsError.message}</Callout>
      ) : (
        <UsersTable rows={rows} teams={teams ?? []} campaigns={campaigns ?? []} canEditAccess={false} />
      )}
    </div>
  );
}
