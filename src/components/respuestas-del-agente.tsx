import Link from "next/link";
import { ChevronRight, MessageSquareReply } from "lucide-react";

import { descartarBorrador, marcarBorradorEnviado } from "@/app/actions/vendedor";
import { ActionForm, ActionSubmit, Avatar, Badge, EmptyState } from "@/components/ui";
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
  // El aviso del modo va como una línea sobre la lista, no como una caja más.
  const aviso = !config?.enabled
    ? { tono: "bg-warning", texto: "El asistente que redacta respuestas está apagado. Mientras lo esté, las respuestas a tus campañas no reciben propuesta." }
    : modo === "borrador"
      ? { tono: "bg-primary", texto: "El asistente escribe una propuesta y espera. Léela, envíala tú y márcala como enviada." }
      : null;
  return (
    <div>
      {aviso && (
        <p className="flex items-start gap-2 border-b border-border/70 px-5 py-2.5 text-xs text-foreground">
          <span aria-hidden="true" className={`mt-1 size-1.5 shrink-0 rounded-full ${aviso.tono}`} />
          {aviso.texto}
        </p>
      )}

      {borradores.length === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nada por revisar"
          description="Cuando alguien conteste una campaña, acá aparece la respuesta que el asistente te propone, en menos de quince minutos."
        />
      ) : (
        <ul className="divide-y divide-border/70">
          {borradores.map((borrador) => {
            const intencion = INTENCION[borrador.intencion ?? ""] ?? { texto: borrador.intencion ?? "—", tono: "neutral" as const };
            return (
              <li key={borrador.id} className="flex gap-3 px-5 py-4">
                <Avatar name={borrador.para_email} size="md" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-foreground">{borrador.para_email}</p>
                      <p className="text-xs text-muted-foreground">Contestó el {cuando.format(new Date(borrador.created_at))}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={intencion.tono}>{intencion.texto}</Badge>
                      {borrador.escalar && <Badge tone="warning">Te necesita a ti</Badge>}
                    </div>
                  </div>
                  {borrador.razonamiento && <p className="text-xs text-muted-foreground">{borrador.razonamiento}</p>}
                  {/* La propuesta se lee como un mensaje: es lo que va a recibir el cliente. */}
                  <div className="rounded-xl rounded-tl-md bg-surface-muted/70 px-3.5 py-3">
                    <p className="text-xs font-medium text-muted-foreground">Respuesta propuesta{borrador.asunto ? ` · ${borrador.asunto}` : ""}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{borrador.cuerpo}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={marcarBorradorEnviado} success="Marcada como enviada">
                      <input type="hidden" name="borrador_id" value={borrador.id} />
                      <ActionSubmit size="sm" variant="secondary">Ya la envié</ActionSubmit>
                    </ActionForm>
                    <ActionForm action={descartarBorrador} success="Descartada">
                      <input type="hidden" name="borrador_id" value={borrador.id} />
                      <ActionSubmit variant="ghost" size="sm">Descartar</ActionSubmit>
                    </ActionForm>
                    {borrador.opportunity_id && (
                      <Link className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline" href={`/dashboard/ventas/${borrador.opportunity_id}`}>
                        Ver el negocio <ChevronRight size={13} aria-hidden="true" />
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
