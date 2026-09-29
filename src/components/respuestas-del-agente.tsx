import Link from "next/link";
import { MessageSquareReply } from "lucide-react";

import { descartarBorrador, marcarBorradorEnviado } from "@/app/actions/vendedor";
import { ActionForm, ActionSubmit, Badge, Callout, EmptyState } from "@/components/ui";
import { ZONA_CLINICA } from "@/lib/citas";

const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const INTENCION: Record<string, { texto: string; tono: "success" | "warning" | "danger" | "neutral" }> = {
  interesado: { texto: "Interesado", tono: "success" },
  pide_precio: { texto: "Pregunta precio", tono: "success" },
  pide_info: { texto: "Pide información", tono: "neutral" },
  rechaza: { texto: "No le interesa", tono: "warning" },
  baja: { texto: "Pide la baja", tono: "danger" },
  fuera_de_alcance: { texto: "Fuera de guion", tono: "warning" },
};

export type ConfigAgente = { enabled: boolean; modo: string | null } | null;
export type BorradorAgente = {
  id: string;
  para_email: string;
  asunto: string | null;
  cuerpo: string | null;
  intencion: string | null;
  razonamiento: string | null;
  escalar: boolean | null;
  created_at: string;
  opportunity_id: string | null;
};

/**
 * Lo que Atlas Vendedor propone contestar a quien respondió una campaña.
 *
 * Mientras el agente esté en modo borrador, este es el paso donde una persona
 * decide: lee lo que el agente escribió, lo envía y lo marca. Son personas que
 * contestaron, las más calientes de todas: por eso viven dentro de Por
 * contactar y no en una pantalla aparte.
 */
export function RespuestasDelAgente({ config, borradores }: { config: ConfigAgente; borradores: BorradorAgente[] }) {
  const modo = config?.modo ?? "borrador";
  return (
    <div className="space-y-3">
      {!config?.enabled && (
        <Callout tone="warning">El asistente que redacta respuestas está apagado. Mientras lo esté, las respuestas a tus campañas no reciben propuesta.</Callout>
      )}
      {config?.enabled && modo === "borrador" && (
        <Callout tone="info">El asistente escribe una propuesta y espera. Léela, envíala tú y márcala como enviada.</Callout>
      )}

      {borradores.length === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nada por revisar"
          description="Cuando alguien conteste una campaña, acá aparece la respuesta que el asistente te propone, en menos de quince minutos."
        />
      ) : (
        <ul className="space-y-3">
          {borradores.map((borrador) => {
            const intencion = INTENCION[borrador.intencion ?? ""] ?? { texto: borrador.intencion ?? "—", tono: "neutral" as const };
            return (
              <li key={borrador.id} className="rounded-xl border border-border bg-surface shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{borrador.para_email}</p>
                    <p className="text-xs text-muted-foreground">Contestó el {cuando.format(new Date(borrador.created_at))}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={intencion.tono}>{intencion.texto}</Badge>
                    {borrador.escalar && <Badge tone="warning">Te necesita a ti</Badge>}
                  </div>
                </div>
                <div className="space-y-3 px-4 py-3">
                  {borrador.razonamiento && <p className="text-xs text-muted-foreground">{borrador.razonamiento}</p>}
                  <div className="rounded-lg bg-surface-muted/60 px-3 py-2.5">
                    <p className="text-xs font-medium text-muted-foreground">Respuesta propuesta{borrador.asunto ? ` · ${borrador.asunto}` : ""}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{borrador.cuerpo}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={marcarBorradorEnviado} success="Marcada como enviada">
                      <input type="hidden" name="borrador_id" value={borrador.id} />
                      <ActionSubmit size="sm">Ya la envié</ActionSubmit>
                    </ActionForm>
                    <ActionForm action={descartarBorrador} success="Descartada">
                      <input type="hidden" name="borrador_id" value={borrador.id} />
                      <ActionSubmit variant="ghost" size="sm">Descartar</ActionSubmit>
                    </ActionForm>
                    {borrador.opportunity_id && (
                      <Link className="ml-auto text-xs font-medium text-primary hover:underline" href={`/dashboard/ventas/${borrador.opportunity_id}`}>
                        Ver el negocio
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
