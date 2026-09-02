import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Callout, NavTabs, PageHeader } from "@/components/ui";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { ATTENTION_TABS, getEnabledChannels } from "@/lib/campaign-channels";

/**
 * Puesto de atención, con una pestaña por canal habilitado.
 *
 * Antes esta ruta era el inbox de WhatsApp y nada más: el ejecutivo de una
 * campaña de voz entraba a una bandeja vacía sin ninguna pista de por qué. Las
 * pestañas salen de `campaign_channels`, así que lo que se puede atender lo
 * decide la configuración de la campaña y no el código de la pantalla.
 */
export default async function AttentionLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const permissions = getWorkspacePermissions(profile.role);
  // Administración vigila metadatos; nunca abre la conversación de un cliente.
  if (!permissions.canReadConversationContent) redirect("/dashboard/operacion");

  const supabase = await createClient();
  const enabled = await getEnabledChannels(supabase, profile);
  const tabs = ATTENTION_TABS.filter((tab) => {
    if (!enabled.includes(tab.channel)) return false;
    // La bandeja de correo es compartida y su RLS
    // (`can_operate_inbound_campaign`) hoy solo admite supervisión y
    // administración. Mostrarle la pestaña al ejecutivo sería prometerle una
    // bandeja que la base le va a devolver vacía.
    if (tab.channel === "mail") return !permissions.canAttendCustomers;
    return true;
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={permissions.canAttendCustomers ? "Mi atención" : "Historial de atención"}
        description={
          permissions.canAttendCustomers
            ? "Los canales que ves son los habilitados en tus campañas."
            : "Consulta autorizada del historial de tus equipos, por los canales que operan."
        }
        className="border-b-0 pb-0"
      />

      {tabs.length === 0 ? (
        <Callout tone="warning">
          {permissions.canAttendCustomers
            ? "No tienes campañas asignadas con canales de atención habilitados. Pídele a tu supervisor que te asigne una campaña."
            : "Ninguna de tus campañas tiene canales de atención habilitados todavía."}
        </Callout>
      ) : (
        <NavTabs tabs={tabs.map((tab) => ({ label: tab.label, href: tab.href }))} />
      )}

      {children}
    </div>
  );
}
