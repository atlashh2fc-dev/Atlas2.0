import Link from "next/link";
import { ArrowLeft, UserPlus } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ManualLeadRecordForm } from "@/components/manual-lead-record-form";
import { getSupervisedTeamIds } from "@/lib/supervisor-scope";
import { Callout, PageHeader, buttonClasses } from "@/components/ui";

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
    const teamIds = await getSupervisedTeamIds(supabase);
    agentsQuery.in("team_id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"]);
    teamsQuery.in("id", teamIds.length ? teamIds : ["00000000-0000-0000-0000-000000000000"]);
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
      <PageHeader
        title="Ingresar fuera de base"
        icon={UserPlus}
        description="Agrega a la campaña un cliente que no venía en la carga. Si el RUT ya está en esa base, se abre su ficha en vez de duplicarlo."
        actions={
          <Link href="/dashboard/leads" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <ArrowLeft size={14} aria-hidden="true" />
            Volver a registros
          </Link>
        }
      />

      {profile.role === "supervisor" && teamOptions.length === 0 ? (
        <Callout tone="danger">
          Tu usuario supervisor no tiene equipos asignados. Un administrador debe asignarte al menos uno antes de crear registros.
        </Callout>
      ) : (
        <ManualLeadRecordForm
          role={role}
          teams={teamOptions}
          agents={agentOptions}
          campaigns={campaignOptions}
          defaultTeamId={teamOptions[0]?.id ?? null}
        />
      )}
    </div>
  );
}
