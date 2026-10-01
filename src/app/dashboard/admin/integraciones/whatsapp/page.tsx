import { ChevronRight, Send, Smartphone, Webhook } from "lucide-react";

import { saveWhatsAppChannelConfig } from "@/app/actions/whatsapp";
import { ConectarWhatsAppMeta } from "@/components/conectar-whatsapp-meta";
import { registroDeMeta } from "@/lib/meta-registro";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isWhatsAppProviderConfigured, whatsappProvider } from "@/lib/whatsapp-provider";
import { ActionForm, ActionSubmit, Badge, Callout, Field, Input, SectionCard, Select } from "@/components/ui";
import { FranjaDeEstado, Grupo, PieDeFormulario, fechaLegible } from "../../_diseno";
import { BotonCopiar } from "./boton-copiar";

const META_WEBHOOK_URL = "https://atlascrm.geimser.cl/api/integrations/meta/whatsapp/webhook";
const YCLOUD_WEBHOOK_URL = "https://atlascrm.geimser.cl/api/integrations/ycloud/whatsapp/webhook";

type Channel = {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string;
  business_name: string;
  meta_business_id: string | null;
  meta_ad_account_id: string | null;
  status: "pending" | "active" | "paused" | "error";
  provider: string | null;
  coexistencia: boolean | null;
  token_vence_at: string | null;
  last_webhook_at: string | null;
  last_error: string | null;
};

function formatDateTime(value: string | null) {
  return value
    ? fechaLegible(value)
    : "Aún no recibido";
}

export default async function WhatsAppIntegrationPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  // Solo el canal de la empresa que se está mirando: el dueño de la plataforma
  // ve todas por RLS, y antes esta página mostraba el de Geimser en cualquiera.
  const { data: organizationId } = await supabase.rpc("current_org_id");
  const [{ data: channelData }, { data: campaigns }] = await Promise.all([
    supabase.from("whatsapp_channels").select("*").eq("organization_id", organizationId as string).eq("canal", "whatsapp").order("created_at").limit(1).maybeSingle(),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
  ]);
  const channel = channelData as Channel | null;
  const { data: route } = channel
    ? await supabase.from("whatsapp_campaign_routes").select("campaign_id").eq("channel_id", channel.id).eq("is_default", true).eq("is_active", true).limit(1).maybeSingle()
    : { data: null };
  const hasAppSecret = Boolean(process.env.WHATSAPP_META_APP_SECRET);
  const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN);
  const hasVerifyToken = Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  const hasYCloudApiKey = Boolean(process.env.WHATSAPP_YCLOUD_API_KEY);
  const hasYCloudWebhookSecret = Boolean(process.env.WHATSAPP_YCLOUD_WEBHOOK_SECRET);
  const provider = channel ? whatsappProvider(channel.provider) : "meta";
  const registro = registroDeMeta();
  // Con el token a punto de vencer, el canal se corta sin aviso: se vuelve a
  // conectar antes, con el mismo botón.
  const diasParaVencer = channel?.token_vence_at
    ? Math.floor((new Date(channel.token_vence_at).getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const porVencer = diasParaVencer !== null && diasParaVencer <= 10;
  const providerConfigured = isWhatsAppProviderConfigured(provider);
  const ready = providerConfigured && channel?.status === "active";
  const webhookUrl = provider === "ycloud" ? YCLOUD_WEBHOOK_URL : META_WEBHOOK_URL;

  return (
    <div className="space-y-5">
      <FranjaDeEstado
        celdas={[
          {
            label: "Número corporativo",
            icon: Smartphone,
            value: channel?.display_phone_number ?? "Sin conectar",
            tone: channel ? "success" : "warning",
            detail: channel ? (channel.coexistencia ? "También sigue en la app del teléfono" : `Phone ID ${channel.phone_number_id}`) : "Conéctalo con el botón de abajo",
          },
          {
            label: "Webhook de Atlas",
            icon: Webhook,
            value: channel?.last_error ? "Con error" : ready ? "Conectado" : "Pendiente",
            tone: channel?.last_error ? "danger" : ready ? "success" : "warning",
            detail: `Último evento: ${formatDateTime(channel?.last_webhook_at ?? null)}`,
          },
          {
            label: "Salida desde el CRM",
            icon: Send,
            value: providerConfigured ? "Habilitada" : "Pendiente",
            tone: providerConfigured ? "success" : "warning",
            detail: providerConfigured ? `Proveedor ${provider === "ycloud" ? "YCloud" : "Meta"}` : "Falta completar credenciales",
          },
        ]}
      />

      {/* Lo que reportó el proveedor va pegado al estado, no al final de la página. */}
      {channel?.last_error && (
        <Callout tone="danger">
          <p className="font-medium">
            {provider === "ycloud" ? "YCloud" : "Meta"} informó un error en la última conexión.
          </p>
          <p className="mt-0.5">Vuelve a conectar el número; si sigue, avisa a soporte.</p>
          <p className="mt-2 break-words text-xs opacity-80">Detalle del proveedor: {channel.last_error}</p>
        </Callout>
      )}

      {porVencer && (
        <Callout tone="warning">
          {diasParaVencer !== null && diasParaVencer < 0
            ? "El acceso de Meta a este número venció: los mensajes dejaron de entrar. Vuelve a conectarlo abajo."
            : `El acceso de Meta a este número vence en ${diasParaVencer} ${diasParaVencer === 1 ? "día" : "días"}. Vuelve a conectarlo abajo para que no se corte.`}
        </Callout>
      )}

      {(!ready || porVencer) && (
        <SectionCard
          title="Conectar tu WhatsApp Business"
          description="Inicias sesión con tu Facebook, eliges el WhatsApp Business de la empresa y escaneas un código con el teléfono. El número sigue en la app y Atlas ve lo que envías y recibes."
        >
          <div className="border-t border-border px-5 py-4">
            {registro.listo && registro.configId ? (
              <ConectarWhatsAppMeta appId={registro.appId} configId={registro.configId} version={registro.version} />
            ) : (
              <p className="text-sm text-muted-foreground">
                La conexión con Meta todavía no está habilitada para tu cuenta. Avisa a soporte de Atlas para que
                terminen de activarla; mientras tanto puedes usar la configuración manual de abajo.
              </p>
            )}
          </div>
        </SectionCard>
      )}

      <details className="group atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm" open={Boolean(channel) || undefined}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-surface-muted/50">
          <ChevronRight size={16} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold tracking-tight text-foreground">
              {channel ? "Canal y campaña de destino" : "Configuración manual (avanzado)"}
            </span>
            <span className="block text-[13px] text-muted-foreground">
              Los mensajes que te lleguen crean o reutilizan un lead en la campaña elegida. Las claves del proveedor no se guardan en la base.
            </span>
          </span>
        </summary>
        <ActionForm
          action={saveWhatsAppChannelConfig}
          success="Canal de WhatsApp guardado"
          className="divide-y divide-border border-t border-border"
        >
          <Grupo titulo="Proveedor" descripcion="Por dónde entra y sale WhatsApp: directo con Meta o a través de YCloud." columnas={1}>
            <Field label="Cómo se conecta" className="max-w-sm">
              <Select name="provider" defaultValue={provider}>
                <option value="meta">Meta</option>
                <option value="ycloud">YCloud</option>
              </Select>
            </Field>
          </Grupo>
          <Grupo titulo="Número" descripcion="Los identificadores que entrega Meta para la cuenta y el número de WhatsApp Business.">
            <Field label="Cuenta de WhatsApp (WABA ID)">
              <Input name="waba_id" defaultValue={channel?.waba_id ?? ""} inputMode="numeric" placeholder="1111675941525164" required />
            </Field>
            <Field label="Identificador del número (Phone Number ID)">
              <Input name="phone_number_id" defaultValue={channel?.phone_number_id ?? ""} inputMode="numeric" placeholder="1245124622024399" required />
            </Field>
            <Field label="Número visible">
              <Input name="display_phone_number" defaultValue={channel?.display_phone_number ?? ""} placeholder="+56 9 1234 5678" required />
            </Field>
            <Field label="Nombre del negocio">
              <Input name="business_name" defaultValue={channel?.business_name ?? ""} placeholder="Altius Ignite" required />
            </Field>
          </Grupo>
          <Grupo titulo="Meta Business (opcional)" descripcion="Solo si quieres ligar el canal al portfolio comercial y a la cuenta publicitaria.">
            <Field label="Portfolio comercial de Meta">
              <Input name="meta_business_id" defaultValue={channel?.meta_business_id ?? ""} inputMode="numeric" />
            </Field>
            <Field label="Cuenta publicitaria">
              <Input name="meta_ad_account_id" defaultValue={channel?.meta_ad_account_id ?? ""} inputMode="numeric" />
            </Field>
          </Grupo>
          <Grupo titulo="Campaña de destino" descripcion="Donde entran los contactos nuevos que escriben al número." columnas={1}>
            <Field label="Campaña para los mensajes que te lleguen (opcional)" className="max-w-md">
              <Select name="campaign_id" defaultValue={route?.campaign_id ?? ""}>
                <option value="">Ninguna por ahora</option>
                {(campaigns ?? []).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </Select>
            </Field>
          </Grupo>
          <PieDeFormulario>
            <ActionSubmit pendingLabel="Guardando…">Guardar configuración</ActionSubmit>
          </PieDeFormulario>
        </ActionForm>
      </details>

      <SectionCard
        title="Webhook del proveedor"
        description="La suscripción debe incluir mensajes entrantes, estados y ecos enviados desde el celular."
      >
        <div className="divide-y divide-border/70 border-t border-border">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <p className="w-48 shrink-0 text-[13px] text-muted-foreground">URL de devolución de llamada</p>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">{webhookUrl}</code>
            <BotonCopiar texto={webhookUrl} etiqueta="URL del webhook" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <p className="w-48 shrink-0 text-[13px] text-muted-foreground">Credenciales del servidor</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {provider === "ycloud" ? (
            <>
              <Badge tone={hasYCloudWebhookSecret ? "success" : "warning"}>Firma de YCloud</Badge>
              <Badge tone={hasYCloudApiKey ? "success" : "warning"}>API de YCloud</Badge>
            </>
          ) : (
            <>
              <Badge tone={hasVerifyToken ? "success" : "warning"}>Token de verificación</Badge>
              <Badge tone={hasAppSecret ? "success" : "warning"}>Firma de Meta</Badge>
              <Badge tone={hasAccessToken ? "success" : "warning"}>Acceso Cloud API</Badge>
            </>
          )}
          </div>
        </div>
        </div>
      </SectionCard>
    </div>
  );
}
