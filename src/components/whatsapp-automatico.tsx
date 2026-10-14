import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { cambiarWhatsappAutomatico } from "@/app/actions/prospeccion";
import { ActionForm, ActionSubmit, Badge, buttonClasses, type BadgeTone } from "@/components/ui";
import { BOTON_DE_BAJA, PLANTILLAS_DE_PROSPECCION, REGLAS, textoDePlantilla } from "@/lib/prospeccion-whatsapp";

export type EstadoWhatsappAutomatico = {
  conectado: boolean;
  encendido: boolean;
  /** Por qué Atlas lo apagó solo, si lo hizo. */
  pausa: string | null;
  porDia: number;
  hoy: number;
  /** Meta aprobó el saludo (sin él no sale nada). */
  aprobado: boolean;
  puedeCambiar: boolean;
};

const RUTA_CONECTAR = "/dashboard/admin/integraciones/whatsapp";

/** Los dos mensajes tal como llegan, con un ejemplo: encender es aceptar este texto. */
const EJEMPLOS = [
  { titulo: "Primero", texto: textoDePlantilla("saludo", PLANTILLAS_DE_PROSPECCION.saludo.ejemplo) },
  { titulo: `Si no contesta en ${REGLAS.diasHastaElSeguimiento} días, el último`, texto: textoDePlantilla("ultimo", PLANTILLAS_DE_PROSPECCION.ultimo.ejemplo) },
];

/**
 * El interruptor del WhatsApp automático, arriba de la bandeja: si está
 * prendido, cuánto escribió hoy y, si Atlas lo pausó, por qué. Una sola acción
 * según el estado (conectar, encender o apagar).
 */
export function WhatsappAutomatico({ estado }: { estado: EstadoWhatsappAutomatico }) {
  const { conectado, encendido, pausa, porDia, hoy, aprobado, puedeCambiar } = estado;

  const [etiqueta, tono]: [string, BadgeTone] = !conectado
    ? ["Sin conectar", "neutral"]
    : encendido
      ? aprobado
        ? ["Encendido", "success"]
        : ["Esperando a Meta", "warning"]
      : pausa
        ? ["Pausado por Atlas", "warning"]
        : ["Apagado", "neutral"];

  const detalle = !conectado
    ? "Conecta el WhatsApp de la empresa y Atlas le escribe solo a quien abre o hace clic en tu campaña de correo."
    : encendido
      ? aprobado
        ? `Hoy escribió a ${hoy} de ${porDia}. Las respuestas te llegan al WhatsApp del teléfono y suben a esta lista como «Respondió».`
        : "Meta está revisando los mensajes (suele tardar minutos, a veces un día). Atlas empieza a escribir apenas los apruebe."
      : pausa
        ? `${pausa} Mientras, nadie recibe mensajes automáticos.`
        : `Le escribe a quien abre o hace clic en tu campaña: un saludo que retoma el correo y, si no contesta en ${REGLAS.diasHastaElSeguimiento} días, un último mensaje. Hasta ${porDia} al día, de lunes a viernes de ${REGLAS.horaDesde} a ${REGLAS.horaHasta} h.`;

  return (
    <section aria-label="WhatsApp automático" className="atlas-panel rounded-xl border border-border bg-surface px-5 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground" aria-hidden="true">
          <MessageCircle size={16} />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-foreground">
            WhatsApp automático <Badge tone={tono}>{etiqueta}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">{detalle}</p>
          <details className="group pt-0.5 text-xs">
            <summary className="cursor-pointer select-none font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Ver los mensajes
            </summary>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              {EJEMPLOS.map((ejemplo) => (
                <div key={ejemplo.titulo} className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{ejemplo.titulo}</p>
                  <div className="rounded-xl rounded-tl-md bg-surface-muted/70 px-3.5 py-3">
                    <p className="text-[13px] leading-relaxed text-foreground">{ejemplo.texto}</p>
                  </div>
                  <p className="inline-flex rounded-md border border-border px-2.5 py-1 text-[12px] text-primary">{BOTON_DE_BAJA}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-muted-foreground">
              Quien toca «{BOTON_DE_BAJA}» sale de la lista. Quien responde deja de recibir mensajes automáticos: sigues tú desde el teléfono. Quien no contesta el último sale de Por contactar, salvo que vuelva a abrir un correo.
            </p>
          </details>
        </div>
        <div className="flex shrink-0 items-center">
          {!conectado ? (
            puedeCambiar && (
              <Link href={RUTA_CONECTAR} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                Conectar WhatsApp
              </Link>
            )
          ) : puedeCambiar ? (
            <ActionForm
              action={cambiarWhatsappAutomatico}
              success={encendido ? "WhatsApp automático apagado" : "WhatsApp automático encendido"}
              confirm={
                encendido
                  ? undefined
                  : {
                      title: "¿Encender el WhatsApp automático?",
                      description: `Atlas le escribirá por WhatsApp, a tu nombre, a quien abra o haga clic en tu campaña de correo: hasta ${porDia} personas al día. Cada mensaje tiene costo en Meta. Lo apagas cuando quieras desde aquí.`,
                      confirmLabel: "Encender",
                      tone: "primary",
                    }
              }
            >
              <input type="hidden" name="encender" value={encendido ? "0" : "1"} />
              <ActionSubmit size="sm" variant={encendido ? "ghost" : "secondary"} pendingLabel={encendido ? "Apagando…" : "Encendiendo…"}>
                {encendido ? "Apagar" : "Encender"}
              </ActionSubmit>
            </ActionForm>
          ) : (
            <p className="text-xs text-muted-foreground">Lo enciende administración.</p>
          )}
        </div>
      </div>
    </section>
  );
}
