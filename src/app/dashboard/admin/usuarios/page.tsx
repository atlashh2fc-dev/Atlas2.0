import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import type { AppRole } from "@/lib/types";
import { UsersTable, type UserRow } from "@/components/users-table";
import { Callout, Field, FilterBar, Select } from "@/components/ui";

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "agente", label: "Agente" },
  { value: "supervisor", label: "Supervisor" },
  { value: "admin", label: "Administrador" },
];

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; role?: string; active?: string }>;
}) {
  // Los roles se administran acá y deben leerse siempre desde Supabase: una
  // respuesta cacheada mostraba el rol anterior después de guardar.
  noStore();
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { campaign: requestedCampaignId, role: roleFilter, active: activeFilter } = await searchParams;

  const [{ data: users, error: usersError }, { data: teams }, { data: teamSupervisors }, { data: campaigns }, { data: campaignMemberships }] =
    await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("teams").select("*").order("name"),
    supabase.from("team_supervisors").select("team_id, supervisor_id"),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
    supabase.from("campaign_agents").select("profile_id, campaign_id"),
  ]);

  const supervisors = (users ?? []).filter((user) => user.role === "supervisor");
  const selectedCampaign = (campaigns ?? []).find((campaign) => campaign.id === requestedCampaignId) ?? null;

  const teamById = new Map((teams ?? []).map((team) => [team.id, team]));
  const supervisedTeamIdsByUser = new Map<string, string[]>();
  const supervisorIdsByTeam = new Map<string, string[]>();
  for (const membership of teamSupervisors ?? []) {
    supervisedTeamIdsByUser.set(membership.supervisor_id, [
      ...(supervisedTeamIdsByUser.get(membership.supervisor_id) ?? []),
      membership.team_id,
    ]);
    supervisorIdsByTeam.set(membership.team_id, [
      ...(supervisorIdsByTeam.get(membership.team_id) ?? []),
      membership.supervisor_id,
    ]);
  }

  const campaignIdsByAgent = new Map<string, string[]>();
  for (const membership of campaignMemberships ?? []) {
    campaignIdsByAgent.set(membership.profile_id, [
      ...(campaignIdsByAgent.get(membership.profile_id) ?? []),
      membership.campaign_id,
    ]);
  }

  const rows: UserRow[] = (users ?? [])
    .filter((user) => {
      if (selectedCampaign) {
        if (user.role !== "agente") return false;
        if (!(campaignIdsByAgent.get(user.id) ?? []).includes(selectedCampaign.id)) return false;
      }
      if (roleFilter && user.role !== roleFilter) return false;
      if (activeFilter === "si" && !user.active) return false;
      if (activeFilter === "no" && user.active) return false;
      return true;
    })
    .map((user) => {
      const team = user.team_id ? teamById.get(user.team_id) ?? null : null;
      const supervisorNames = (team ? supervisorIdsByTeam.get(team.id) ?? [] : [])
        .map((id) => supervisors.find((candidate) => candidate.id === id)?.full_name)
        .filter((name): name is string => Boolean(name));
      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role as AppRole,
        team_id: user.team_id,
        active: user.active,
        team_name: team?.name ?? null,
        supervisor_names: supervisorNames,
        supervised_team_ids: supervisedTeamIdsByUser.get(user.id) ?? [],
        campaign_ids: campaignIdsByAgent.get(user.id) ?? [],
      };
    });

  return (
    <div className="space-y-5">
      <FilterBar storageKey="usuarios">
        <Field label="Rol" className="w-44">
          <Select name="role" defaultValue={roleFilter ?? ""}>
            <option value="">Todos</option>
            {ROLE_OPTIONS.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Estado" className="w-40">
          <Select name="active" defaultValue={activeFilter ?? ""}>
            <option value="">Todos</option>
            <option value="si">Activos</option>
            <option value="no">Inactivos</option>
          </Select>
        </Field>

        <Field label="Campaña" className="w-56">
          <Select name="campaign" defaultValue={selectedCampaign?.id ?? ""}>
            <option value="">Todas</option>
            {(campaigns ?? []).map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      {selectedCampaign && (
        <p className="text-xs text-muted-foreground">
          Mostrando los ejecutivos de {selectedCampaign.name}.{" "}
          <Link
            href={`/dashboard/admin/campanas/${selectedCampaign.id}/ejecutivos`}
            className="font-medium text-primary hover:underline"
          >
            Gestionar los ejecutivos de la campaña
          </Link>
          . Para evitar mezcla de llamadas automáticas, define turnos sin traslape.
        </p>
      )}

      {usersError ? (
        <Callout tone="danger">No se pudieron cargar los usuarios: {usersError.message}</Callout>
      ) : (
        <UsersTable rows={rows} teams={teams ?? []} campaigns={campaigns ?? []} />
      )}
    </div>
  );
}
