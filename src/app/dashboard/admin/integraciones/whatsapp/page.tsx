import { CheckCircle2, CircleAlert, Copy, Webhook } from "lucide-react";

import { saveWhatsAppChannelConfig } from "@/app/actions/whatsapp";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isWhatsAppProviderConfigured, whatsappProvider } from "@/lib/whatsapp-provider";
import { ActionForm, ActionSubmit, Badge, Card, Field, Input, Select } from "@/components/ui";

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
  last_webhook_at: string | null;
  last_error: string | null;
};

function formatDateTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })
    : "Aún no recibido";
}

export default async function WhatsAppIntegrationPage() {
  await requireProfile(["admin"]);
  const supabase = await createClient();
  const [{ data: channelData }, { data: campaigns }, { data: route }] = await Promise.all([
    supabase.from("whatsapp_channels").select("*").order("created_at").limit(1).maybeSingle(),
    supabase.from("campaigns").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("whatsapp_campaign_routes")
      .select("campaign_id")
      .eq("is_default", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  ]);
  const channel = channelData as Channel | null;
  const hasAppSecret = Boolean(process.env.WHATSAPP_META_APP_SECRET);
  const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN);
  const hasVerifyToken = Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  const hasYCloudApiKey = Boolean(process.env.WHATSAPP_YCLOUD_API_KEY);
  const hasYCloudWebhookSecret = Boolean(process.env.WHATSAPP_YCLOUD_WEBHOOK_SECRET);
  const provider = whatsappProvider();
  const providerConfigured = isWhatsAppProviderConfigured();
  const ready = providerConfigured && channel?.status === "active";
  const webhookUrl = provider === "ycloud" ? YCLOUD_WEBHOOK_URL : META_WEBHOOK_URL;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-3">
        <StatusCard
          label="Número corporativo"
          value={channel?.display_phone_number ?? "+56 9 7415 8774"}
          ok={Boolean(channel)}
          detail={channel ? `Phone ID ${channel.phone_number_id}` : "Activo identificado en Meta"}
        />
        <StatusCard
          label="Webhook de Atlas"
          value={ready ? "Conectado" : "Pendiente"}
          ok={ready}
          detail={`Último evento: ${formatDateTime(channel?.last_webhook_at ?? null)}`}
        />
        <StatusCard
          label="Salida desde el CRM"
          value={providerConfigured ? "Habilitada" : "Pendiente"}
          ok={providerConfigured}
          detail={providerConfigured ? `Proveedor ${provider === "ycloud" ? "YCloud" : "Meta"}` : "Falta completar credenciales"}
        />
      </div>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Canal y campaña de destino</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada conversación nueva crea o reutiliza un lead en esta campaña. Los secretos del proveedor no se guardan en la base.
          </p>
        </div>

        <ActionForm
          action={saveWhatsAppChannelConfig}
          success="Canal de WhatsApp guardado"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <Field label="Cuenta de WhatsApp (WABA ID)">
            <Input name="waba_id" defaultValue={channel?.waba_id ?? "1111675941525164"} required />
          </Field>
          <Field label="Identificador del número">
            <Input name="phone_number_id" defaultValue={channel?.phone_number_id ?? "1245124622024399"} required />
          </Field>
          <Field label="Número visible">
            <Input
              name="display_phone_number"
              defaultValue={channel?.display_phone_number ?? "+56 9 7415 8774"}
              required
            />
          </Field>
          <Field label="Nombre del negocio">
            <Input name="business_name" defaultValue={channel?.business_name ?? "Geimser"} required />
          </Field>
          <Field label="Portfolio comercial de Meta">
            <Input name="meta_business_id" defaultValue={channel?.meta_business_id ?? "1231030185256498"} />
          </Field>
          <Field label="Cuenta publicitaria">
            <Input name="meta_ad_account_id" defaultValue={channel?.meta_ad_account_id ?? "1479484023229361"} />
          </Field>
          <Field label="Campaña de Atlas" className="md:col-span-2 xl:col-span-3">
            <Select name="campaign_id" defaultValue={route?.campaign_id ?? ""} required>
              <option value="">Selecciona una campaña</option>
              {(campaigns ?? []).map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="md:col-span-2 xl:col-span-3">
            <ActionSubmit pendingLabel="Guardando…">Guardar configuración</ActionSubmit>
          </div>
        </ActionForm>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <Webhook size={18} className="mt-0.5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">Webhook del proveedor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              La suscripción debe incluir mensajes entrantes, estados y ecos enviados desde el celular.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">URL de devolución de llamada</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-sm text-foreground">{webhookUrl}</code>
            <Copy size={14} className="text-muted-foreground" aria-hidden />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
        {channel?.last_error && (
          <p className="rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger">
            {channel.last_error}
          </p>
        )}
      </Card>
    </div>
  );
}

function StatusCard({ label, value, detail, ok }: { label: string; value: string; detail: string; ok: boolean }) {
  const Icon = ok ? CheckCircle2 : CircleAlert;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Icon size={18} className={ok ? "text-success" : "text-warning"} />
      </div>
    </Card>
  );
}
