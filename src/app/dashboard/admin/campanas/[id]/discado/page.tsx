import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { upsertDialerCampaignConfig } from "@/app/actions/dialer-config";
import { DIAL_MODES, type DialerCampaignConfig } from "@/lib/types";
import { Button, Callout, Field, InfoTooltip, Input, SectionCard, Select } from "@/components/ui";

/** Etiqueta con la explicación al lado: esta es la pantalla más técnica del producto. */
function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTooltip text={help} />
    </span>
  );
}

export default async function CampaignDialerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: dialerConfig }, { data: campaign }] = await Promise.all([
    supabase.from("dialer_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("campaigns").select("workflow_id").eq("id", id).single(),
  ]);

  const config = dialerConfig as DialerCampaignConfig | null;
  const usesSiptel = config?.trunk_context === "siptel";
  const mode = config?.dial_mode ?? "manual";

  return (
    <div className="space-y-5">
      {config && !usesSiptel && (
        <Callout tone="warning">
          <strong className="font-medium">Ruta saliente por revisar.</strong> Esta campaña no está
          saliendo por Siptel, que hoy es la única ruta habilitada. Guarda la configuración para
          corregirlo antes de iniciar el discado.
        </Callout>
      )}

      {!campaign?.workflow_id && (
        <Callout tone="warning">
          <strong className="font-medium">Sin flujo de gestión.</strong> Los ejecutivos no tendrán
          guion al atender. Asigna un flujo en la pestaña Resumen.
        </Callout>
      )}

      <SectionCard
        title="Configuración de discado"
        description="Define cómo el motor maneja esta campaña. Los ejecutivos asignados en la pestaña Ejecutivos son los que se sincronizan como miembros de la cola."
      >
        <form action={upsertDialerCampaignConfig} className="grid gap-4 p-4 sm:grid-cols-2">
          <input type="hidden" name="campaign_id" value={id} />

          <Field
            label={
              <LabelWithHelp
                label="Modo de discado"
                help="Manual: el ejecutivo marca. Progresivo: una llamada por ejecutivo libre. Predictivo: el motor adelanta llamadas según la tasa de contacto."
              />
            }
          >
            <Select name="dial_mode" defaultValue={mode}>
              {DIAL_MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Ratio de discado"
                help="Cuántas llamadas se lanzan por cada ejecutivo disponible. Más alto contacta más rápido, pero sube el abandono."
              />
            }
          >
            <Input type="number" name="max_dial_ratio" step="0.1" min="0.1" defaultValue={config?.max_dial_ratio ?? 1.0} />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Tiempo entre llamadas (segundos)"
                help="Interrupción efectiva entre una llamada y la siguiente, sin tipificar. El mínimo legal es 10 segundos."
              />
            }
          >
            <Input type="number" name="wrapup_seconds" min="10" max="600" defaultValue={config?.wrapup_seconds ?? 10} />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Identificador de llamada"
                help="Número que ve el cliente, en formato internacional E.164. Debe estar habilitado en la ruta saliente."
              />
            }
          >
            <Input type="text" name="caller_id" placeholder="+16507062614" defaultValue={config?.caller_id ?? ""} />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Nombre de la cola"
                help="Identificador técnico de la cola en la central telefónica. Sin espacios ni tildes."
              />
            }
          >
            <Input
              type="text"
              name="queue_name"
              required
              placeholder="campania_ventas"
              defaultValue={config?.queue_name ?? ""}
            />
          </Field>

          <Field
            label={<LabelWithHelp label="Ruta saliente" help="Proveedor por el que salen las llamadas de esta campaña." />}
          >
            <Select name="trunk_context" defaultValue="siptel">
              <option value="siptel">Siptel · única ruta habilitada</option>
            </Select>
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Tope de reintentos automáticos"
                help="Espera creciente entre reintentos: 15 minutos tras el primer no-contesta, 1 hora tras el segundo, 4 horas desde el tercero. Al llegar al tope el registro sigue disponible para gestión manual."
              />
            }
          >
            <Input
              type="number"
              name="max_redial_attempts"
              min="0"
              max="20"
              defaultValue={config?.max_redial_attempts ?? 4}
            />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Espera máxima sin ejecutivo (segundos)"
                help="Si el cliente contesta y no hay ejecutivo libre, cuánto espera antes de que se corte. Esa llamada cuenta como abandono."
              />
            }
          >
            <Input
              type="number"
              name="abandon_timeout_seconds"
              min="10"
              max="600"
              defaultValue={config?.abandon_timeout_seconds ?? 90}
            />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Abandono objetivo (%)"
                help="Solo en modo predictivo: el motor ajusta el ratio para mantener el abandono cerca de este valor, sin pasar el ratio máximo."
              />
            }
          >
            <Input
              type="number"
              name="target_abandonment_rate"
              step="0.5"
              min="0"
              max="100"
              defaultValue={config?.target_abandonment_rate ?? 6.0}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" name="amd_enabled" value="true" defaultChecked={config?.amd_enabled ?? false} className="accent-primary" />
            Detectar contestador automático
            <InfoTooltip text="Descarta las llamadas que caen en un buzón de voz, para no entregarle una grabación a un ejecutivo." />
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input type="checkbox" name="is_active" value="true" defaultChecked={config?.is_active ?? false} className="accent-primary" />
            Campaña activa para el motor de discado
          </label>

          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit">Guardar configuración</Button>
            <p className="text-xs text-muted-foreground">
              {DIAL_MODES.find((item) => item.value === mode)?.description}
            </p>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
