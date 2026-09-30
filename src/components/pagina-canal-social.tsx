import { CheckCircle2, CircleAlert, Link2, MessagesSquare, Pause, Play, Target, UserRound, type LucideIcon } from "lucide-react";

import { guardarCampanaDelCanalSocial, pausarCanalSocial } from "@/app/actions/mensajeria-social";
import { ConectarCanalSocial } from "@/components/conectar-canal-social";
import { ActionForm, ActionSubmit, Field, SectionCard, Select } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { NOMBRE_DEL_CANAL, type CanalSocial } from "@/lib/mensajeria-social";
import { mensajeriaDeMeta } from "@/lib/meta-mensajeria";
import { haceCuanto } from "@/lib/prospeccion";
import { createClient } from "@/lib/supabase/server";

type Canal = {
  id: string;
  cuenta: string | null;
  business_name: string | null;
  status: "pending" | "active" | "paused" | "error";
  last_webhook_at: string | null;
  last_error: string | null;
};

/**
 * Pantalla de Instagram o Messenger: estado, conectar con Facebook y a qué
 * campaña entran los mensajes. Es la misma para los dos canales porque se
 * conectan igual (una página de Facebook y, en Instagram, su cuenta vinculada).
 */
export async function PaginaDeCanalSocial({ canal }: { canal: CanalSocial }) {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: organizationId } = await supabase.rpc("current_org_id");
  const [{ data: canalData }, { data: campanas }] = await Promise.all([
    supabase
      .from("whatsapp_channels")
      .select("id, cuenta, business_name, status, last_webhook_at, last_error")
      .eq("organization_id", organizationId as string)
      .eq("canal", canal)
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
  ]);
  const actual = canalData as Canal | null;
  const { data: ruta } = actual
    ? await supabase
        .from("whatsapp_campaign_routes")
        .select("campaign_id, campaigns(name)")
        .eq("channel_id", actual.id)
        .eq("is_default", true)
        .eq("is_active", true)
        .maybeSingle()
    : { data: null };
  const campanaDeRuta = ruta?.campaigns as { name: string } | { name: string }[] | null | undefined;
  const nombreCampana = Array.isArray(campanaDeRuta) ? campanaDeRuta[0]?.name : campanaDeRuta?.name;

  const meta = mensajeriaDeMeta();
  const nombre = NOMBRE_DEL_CANAL[canal];
  const pausado = actual?.status === "paused";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-3">
        <Estado
          icon={UserRound}
          label={canal === "instagram" ? "Cuenta de Instagram" : "Página de Facebook"}
          value={actual?.cuenta ?? actual?.business_name ?? "Sin conectar"}
          ok={Boolean(actual) && !pausado}
          detail={!actual ? "Conéctala con el botón de abajo" : pausado ? "En pausa: los mensajes no entran a Atlas" : "Conectada desde Atlas"}
        />
        <Estado
          icon={MessagesSquare}
          label="Mensajes"
          value={actual?.last_webhook_at ? "Llegando" : "Aún no llega ninguno"}
          ok={Boolean(actual?.last_webhook_at) && !actual?.last_error}
          detail={
            actual?.last_error
              ? actual.last_error
              : actual?.last_webhook_at
                ? `Último ${haceCuanto(actual.last_webhook_at)}`
                : `Escríbele a la ${canal === "instagram" ? "cuenta" : "página"} para probar`
          }
        />
        <Estado
          icon={Target}
          label="Campaña de destino"
          value={nombreCampana ?? "Sin elegir"}
          ok={Boolean(nombreCampana)}
          detail={nombreCampana ? "Los contactos nuevos entran aquí" : "Sin campaña, los mensajes no se guardan"}
        />
      </div>

      {actual && (
        <SectionCard
          icon={Target}
          tone="primary"
          title="Campaña de destino"
          description={`Cada persona nueva que escribe por ${nombre} crea un registro en esta campaña y cae en su cola de mensajería, junto a WhatsApp.`}
        >
          <ActionForm action={guardarCampanaDelCanalSocial} success="Campaña guardada" className="flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="channel_id" value={actual.id} />
            <Field label="Campaña" className="min-w-64 flex-1">
              <Select name="campaign_id" defaultValue={ruta?.campaign_id ?? ""} required>
                <option value="" disabled>
                  Elige una campaña
                </option>
                {(campanas ?? []).map((campana) => (
                  <option key={campana.id} value={campana.id}>
                    {campana.name}
                  </option>
                ))}
              </Select>
            </Field>
            <ActionSubmit pendingLabel="Guardando…">Guardar campaña</ActionSubmit>
          </ActionForm>
        </SectionCard>
      )}

      <SectionCard
        icon={Link2}
        tone="slate"
        title={actual ? "Conexión con Meta" : `Conectar ${nombre}`}
        description={
          canal === "instagram"
            ? "Entras con tu Facebook, autorizas la página vinculada a la cuenta profesional de Instagram y Atlas empieza a recibir sus mensajes directos."
            : "Entras con tu Facebook, autorizas la página de la empresa y Atlas empieza a recibir sus mensajes."
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          {meta.listo && meta.configId ? (
            <ConectarCanalSocial canal={canal} appId={meta.appId} configId={meta.configId} version={meta.version} reconectar={Boolean(actual)} />
          ) : (
            <p className="text-sm text-muted-foreground">
              La conexión con Facebook todavía no está habilitada en este servidor: falta la configuración de inicio de sesión de la
              app de Altius (<code>ATLAS_META_MENSAJERIA_CONFIG_ID</code>).
            </p>
          )}
          {actual && (
            <ActionForm action={pausarCanalSocial} success={pausado ? "Canal reanudado" : "Canal en pausa"}>
              <input type="hidden" name="channel_id" value={actual.id} />
              <input type="hidden" name="pausar" value={pausado ? "false" : "true"} />
              <ActionSubmit variant="ghost" size="sm" pendingLabel="…">
                {pausado ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                {pausado ? "Reanudar" : "Pausar"}
              </ActionSubmit>
            </ActionForm>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function Estado({ icon: Icon, label, value, detail, ok }: { icon: LucideIcon; label: string; value: string; detail: string; ok: boolean }) {
  const StateIcon = ok ? CheckCircle2 : CircleAlert;
  return (
    <div className={`rounded-xl border border-border border-l-2 bg-surface p-4 shadow-sm ${ok ? "border-l-success" : "border-l-warning"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="icon-chip size-8 rounded-lg" data-tone="blue" aria-hidden="true">
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-lg font-semibold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>
        <StateIcon size={18} className={ok ? "text-success" : "text-warning"} aria-hidden="true" />
      </div>
    </div>
  );
}
