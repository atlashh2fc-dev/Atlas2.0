import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { puedeLeerConversaciones, requireModule } from "@/lib/modules.server";
import { Callout, NavTabs, PageHeader } from "@/components/ui";
import { getWorkspacePermissions } from "@/lib/workspace-permissions";
import { ATTENTION_TABS } from "@/lib/campaign-channels";
import { puestoDeAtencion } from "@/lib/presencia.server";

/**
 * Puesto de atención, con una pestaña por canal habilitado.
 *
 * Antes esta ruta era el inbox de WhatsApp y nada más: el ejecutivo de una
 * campaña de voz entraba a una bandeja vacía sin ninguna pista de por qué. Las
 * pestañas salen de `campaign_channels`, así que lo que se puede atender lo
 * decide la configuración de la campaña y no el código de la pantalla. Para el
 * ejecutivo también cuentan sus colas: si su cola atiende el buzón, ve Correo.
 * Cada pestaña lleva lo que tiene pendiente, como en cualquier puesto
 * omnicanal: se ve dónde hay trabajo sin tener que entrar a mirar.
 */
export default async function AttentionLayout({ children }: { children: React.ReactNode }) {
  await requireModule("contact_center", "whatsapp", "correo");
  const profile = await requireProfile();
  const permissions = getWorkspacePermissions(profile.role);
  // Administración vigila metadatos; nunca abre la conversación de un cliente.
  // La excepción es el dueño de la plataforma, que lee sin poder responder.
  if (!(await puedeLeerConversaciones(profile.role))) redirect("/dashboard/operacion");
  const soloLectura = !permissions.canAttendCustomers && !permissions.canReadConversationContent;

  const { canales, pendientes } = await puestoDeAtencion();
  const tabs = ATTENTION_TABS.filter((tab) => canales.includes(tab.channel));

  return (
    <div className="space-y-5">
      <PageHeader
        title={permissions.canAttendCustomers ? "Mi atención" : soloLectura ? "Conversaciones" : "Historial de atención"}
        description={
          permissions.canAttendCustomers
            ? "Los canales que ves son los de tus campañas y tus colas. Correo y WhatsApp se prenden o apagan en tu estado, arriba."
            : soloLectura
              ? "Lectura de las conversaciones de la empresa que estás mirando. Responde el ejecutivo asignado."
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
        <NavTabs tabs={tabs.map((tab) => ({ label: tab.label, href: tab.href, badge: pendientes[tab.channel] }))} />
      )}

      {children}
    </div>
  );
}
