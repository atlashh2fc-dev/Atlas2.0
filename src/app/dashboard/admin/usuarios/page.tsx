import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import {
  toggleUserActive,
  createTeam,
  createUserAccount,
  updateTeamSupervisor,
} from "@/app/actions/admin";
import type { AppRole } from "@/lib/types";
import { UserRoleForm } from "@/components/user-role-form";
import { AgentCampaignsDialog } from "@/components/agent-campaigns-dialog";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
} from "@/components/ui";

const ROLES: AppRole[] = ["agente", "supervisor", "admin"];

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  // Los roles se administran en esta pantalla y deben leerse siempre desde
  // Supabase. Una respuesta cacheada hacía que el guardado real volviera a
  // mostrar el rol anterior hasta una recarga posterior.
  noStore();
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  const [{ data: teams }, { data: campaigns }, { data: campaignMemberships }] = await Promise.all([
    supabase.from("teams").select("*").order("name"),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
    supabase.from("campaign_agents").select("profile_id, campaign_id"),
  ]);

  const supervisors = (users ?? []).filter((u) => u.role === "supervisor");
  const { campaign: requestedCampaignId } = await searchParams;
  const selectedCampaign = (campaigns ?? []).find((campaign) => campaign.id === requestedCampaignId) ?? null;
  const supervisorName = (id: string | null) =>
    supervisors.find((s) => s.id === id)?.full_name ?? "Sin supervisor";
  const teamOf = (teamId: string | null) => (teams ?? []).find((t) => t.id === teamId) ?? null;
  const campaignIdsByAgent = new Map<string, string[]>();
  for (const membership of campaignMemberships ?? []) {
    campaignIdsByAgent.set(membership.profile_id, [
      ...(campaignIdsByAgent.get(membership.profile_id) ?? []),
      membership.campaign_id,
    ]);
  }
  const visibleUsers = selectedCampaign
    ? (users ?? []).filter(
        (user) => user.role === "agente" && (campaignIdsByAgent.get(user.id) ?? []).includes(selectedCampaign.id)
      )
    : users ?? [];
  const campaignNameById = new Map((campaigns ?? []).map((campaign) => [campaign.id, campaign.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Gestiona roles, equipos y crea nuevas cuentas directamente desde aquí."
      />

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Crear usuario</h2>
        <form action={createUserAccount} className="flex flex-wrap items-end gap-2">
          <Field label="Nombre" className="w-44">
            <Input type="text" name="full_name" required placeholder="Nombre completo" />
          </Field>
          <Field label="Correo" className="w-52">
            <Input type="email" name="email" required placeholder="correo@ejemplo.com" />
          </Field>
          <Field label="Contraseña" className="w-40">
            <Input type="text" name="password" required minLength={6} placeholder="Mínimo 6 caracteres" />
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
          <Button type="submit">Crear usuario</Button>
        </form>
      </Card>

      <Card className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2">
          <Field label="Campaña a revisar" className="min-w-64">
            <Select name="campaign" defaultValue={selectedCampaign?.id ?? ""}>
              <option value="">Todos los usuarios · solo roles y equipos</option>
              {(campaigns ?? []).map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Revisar campaña</Button>
          {selectedCampaign && (
            <Link href="/dashboard/admin/usuarios" className="pb-2 text-xs font-medium text-primary hover:underline">
              Limpiar filtro
            </Link>
          )}
        </form>
        {selectedCampaign && (
          <Link
            href={`/dashboard/admin/campanas/${selectedCampaign.id}#ejecutivos`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Gestionar ejecutivos de {selectedCampaign.name} →
          </Link>
        )}
      </Card>

      <SectionCard
        title={selectedCampaign ? `Ejecutivos de ${selectedCampaign.name}` : "Roles y equipos"}
        description={
          selectedCampaign
            ? `${visibleUsers.length} ejecutivo(s) asignado(s). Usa “Asignar campañas” para administrar sus skills.`
            : "Administra roles y equipos. Usa “Asignar campañas” sobre cualquier agente para configurar sus skills."
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Usuario</th>
                <th className="min-w-80 px-4 py-2.5 font-semibold">Acceso y equipo</th>
                <th className="px-4 py-2.5 font-semibold">Estado</th>
                <th className="px-4 py-2.5 font-semibold">Campañas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleUsers.map((u) => (
                <tr key={u.id} className="align-top hover:bg-surface-muted/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{u.full_name}</p>
                    <p className="mt-0.5 max-w-64 break-all text-xs text-muted-foreground">{u.email}</p>
                    {u.role === "agente" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Supervisor: {supervisorName(teamOf(u.team_id)?.supervisor_id ?? null)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <UserRoleForm
                      userId={u.id}
                      initialRole={u.role}
                      initialTeamId={u.team_id}
                      teams={teams ?? []}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={u.active ? "success" : "danger"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                    <form action={toggleUserActive} className="mt-2">
                      <input type="hidden" name="user_id" value={u.id} />
                      <input type="hidden" name="active" value={String(u.active)} />
                      <Button type="submit" variant="secondary" size="sm">
                        {u.active ? "Desactivar" : "Activar"}
                      </Button>
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === "agente" ? (
                      <div className="space-y-2">
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {(campaignIdsByAgent.get(u.id) ?? []).map((campaignId) => (
                            <span key={campaignId} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              {campaignNameById.get(campaignId) ?? "Campaña"}
                            </span>
                          ))}
                          {(campaignIdsByAgent.get(u.id) ?? []).length === 0 && (
                            <span className="text-xs text-muted-foreground">Sin campañas</span>
                          )}
                        </div>
                        <AgentCampaignsDialog
                          agent={{ id: u.id, fullName: u.full_name, email: u.email }}
                          campaignIds={campaignIdsByAgent.get(u.id) ?? []}
                          campaigns={campaigns ?? []}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">No aplica</span>
                    )}
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    {selectedCampaign
                      ? "No hay ejecutivos asignados a esta campaña todavía."
                      : "No hay usuarios creados todavía."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selectedCampaign && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Para evitar mezcla de llamadas automáticas, define turnos sin traslape en el detalle de cada campaña.
        </p>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Equipos</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          El supervisor de un equipo define de quién dependen sus agentes (según el equipo asignado a cada
          usuario arriba).
        </p>
        <ul className="mb-4 space-y-2 text-sm">
          {(teams ?? []).map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="font-medium text-foreground">{t.name}</span>
              <form action={updateTeamSupervisor} className="flex items-center gap-2">
                <input type="hidden" name="team_id" value={t.id} />
                <Select name="supervisor_id" fieldSize="sm" defaultValue={t.supervisor_id ?? ""} className="w-auto">
                  <option value="">Sin supervisor</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm">
                  Guardar
                </Button>
              </form>
            </li>
          ))}
          {(teams ?? []).length === 0 && <li className="text-muted-foreground">No hay equipos creados.</li>}
        </ul>
        <form action={createTeam} className="flex max-w-lg flex-wrap items-end gap-2">
          <Field label="Nombre del equipo">
            <Input type="text" name="name" required placeholder="Nombre del equipo" />
          </Field>
          <Field label="Supervisor">
            <Select name="supervisor_id" defaultValue="" className="w-auto">
              <option value="">Sin supervisor</option>
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Crear</Button>
        </form>
      </Card>
    </div>
  );
}
