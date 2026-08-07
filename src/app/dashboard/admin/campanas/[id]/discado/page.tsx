import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { upsertDialerCampaignConfig } from "@/app/actions/dialer-config";
import type { DialerCampaignConfig } from "@/lib/types";
import { DialModeSelect } from "@/components/dial-mode-select";
import { ActionForm, ActionSubmit, Callout, Field, InfoTooltip, Input, SectionCard, Select } from "@/components/ui";

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
        <ActionForm
          action={upsertDialerCampaignConfig}
          success="Configuración de discado guardada"
          className="grid gap-4 p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="campaign_id" value={id} />

          <Field
            label={
              <LabelWithHelp
                label="Dirección de la campaña"
                help="Decide qué familia de indicadores se reporta. En saliente se miden contactabilidad, penetración de base e intentos por contacto; en entrante, nivel de servicio y espera en cola. En mixta se reportan ambas por separado, nunca promediadas."
              />
            }
          >
            <Select name="campaign_type" defaultValue={config?.campaign_type ?? "outbound"}>
              <option value="outbound">Saliente · el discador origina las llamadas</option>
              <option value="inbound">Entrante · el cliente llama y espera en cola</option>
              <option value="blending">Mixta · ambas direcciones</option>
            </Select>
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Modo de discado"
                help="Selecciona un modo para ver debajo una explicación de cómo se originan y se entregan las llamadas."
              />
            }
          >
            <DialModeSelect defaultValue={mode} />
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

          <div className="sm:col-span-2 border-t border-border pt-4">
            <p className="text-sm font-medium text-foreground">Compromisos agendados</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cuando un ejecutivo agenda una llamada, ese compromiso es suyo. A la hora acordada el discador marca al
              cliente y la llamada le entra a él, nunca al resto del equipo.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              name="personal_callback_enabled"
              value="true"
              defaultChecked={config?.personal_callback_enabled ?? true}
              className="accent-primary"
            />
            Entregar los compromisos automáticamente a su ejecutivo
            <InfoTooltip text="Si lo desactivas, las agendas quedan solo en Mi agenda y el ejecutivo llama a mano." />
          </label>

          <Field
            label={
              <LabelWithHelp
                label="Ventana de entrega (minutos)"
                help="Cuánto se sigue intentando entregar el compromiso mientras el ejecutivo no esté disponible. Pasado ese tiempo se da por vencido."
              />
            }
          >
            <Input
              type="number"
              name="personal_callback_window_minutes"
              min="1"
              max="480"
              defaultValue={config?.personal_callback_window_minutes ?? 30}
            />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Reintento (segundos)"
                help="Cada cuánto se vuelve a intentar mientras el ejecutivo esté en llamada o en pausa."
              />
            }
          >
            <Input
              type="number"
              name="personal_callback_retry_seconds"
              min="30"
              max="3600"
              defaultValue={config?.personal_callback_retry_seconds ?? 120}
            />
          </Field>

          <Field
            label={
              <LabelWithHelp
                label="Si vence la ventana"
                help="Qué pasa con el compromiso que no se pudo entregar: queda vencido en la agenda de su ejecutivo para que el supervisor decida, o se suelta al pool para que lo atienda el primero disponible."
              />
            }
            className="sm:col-span-2"
          >
            <Select
              name="personal_callback_on_expiry"
              defaultValue={config?.personal_callback_on_expiry ?? "keep_in_agenda"}
            >
              <option value="keep_in_agenda">Queda en la agenda de su ejecutivo</option>
              <option value="release_to_pool">Se suelta al pool de la campaña</option>
            </Select>
          </Field>

          <div className="sm:col-span-2 flex items-center gap-3">
            <ActionSubmit pendingLabel="Guardando…">Guardar configuración</ActionSubmit>
          </div>
        </ActionForm>
      </SectionCard>
    </div>
  );
}
