import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ManualLeadRecordForm } from "@/components/manual-lead-record-form";

type TeamRow = {
  id: string;
  name: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  team_id: string | null;
};

type CampaignRow = {
  id: string;
  name: string;
};

export default async function NewLeadRecordPage() {
  const profile = await requireProfile(["supervisor", "admin"]);
  const role = profile.role === "admin" ? "admin" : "supervisor";
  const supabase = await createClient();

  const agentsQuery = supabase
    .from("profiles")
    .select("id, full_name, team_id")
    .eq("role", "agente")
    .eq("active", true)
    .order("full_name");

  const teamsQuery = supabase.from("teams").select("id, name").order("name");

  if (profile.role === "supervisor") {
    agentsQuery.eq("team_id", profile.team_id);
    teamsQuery.eq("id", profile.team_id);
  }

  const [{ data: teams }, { data: agents }, { data: campaigns }] = await Promise.all([
    teamsQuery,
    agentsQuery,
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
  ]);

  const teamOptions = ((teams ?? []) as TeamRow[]).map((team) => ({ id: team.id, name: team.name }));
  const agentOptions = ((agents ?? []) as ProfileRow[]).map((agent) => ({
    id: agent.id,
    name: agent.full_name,
    team_id: agent.team_id,
  }));
  const campaignOptions = ((campaigns ?? []) as CampaignRow[]).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Nuevo registro</h1>
          <p className="text-sm text-muted-foreground">
            Crea un registro manual fuera de una carga de base y asígnalo a un ejecutivo cuando corresponda.
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          Volver a registros
        </Link>
      </div>

      {profile.role === "supervisor" && !profile.team_id ? (
        <div className="rounded-xl border border-danger/30 bg-danger-bg px-5 py-4 text-sm text-danger">
          Tu usuario supervisor no tiene equipo asignado. Un administrador debe asociarte a un equipo antes de crear registros.
        </div>
      ) : (
        <ManualLeadRecordForm
          role={role}
          teams={teamOptions}
          agents={agentOptions}
          campaigns={campaignOptions}
          defaultTeamId={profile.team_id}
        />
      )}
    </div>
  );
}
