import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { descartarBorrador, marcarBorradorEnviado } from "@/app/actions/vendedor";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  EmptyState,
  PageHeader,
  SectionCard,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const cuando = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const INTENCION: Record<string, { texto: string; tono: "success" | "warning" | "danger" | "neutral" }> = {
  interesado: { texto: "Interesado", tono: "success" },
  pide_precio: { texto: "Pregunta precio", tono: "success" },
  pide_info: { texto: "Pide información", tono: "neutral" },
  rechaza: { texto: "No le interesa", tono: "warning" },
  baja: { texto: "Pide la baja", tono: "danger" },
  fuera_de_alcance: { texto: "Fuera de guion", tono: "warning" },
};

/**
 * Lo que Atlas Vendedor propone responder.
 *
 * Mientras el agente esté en modo borrador, esta pantalla es el paso donde una
 * persona decide. Se lee la respuesta del contacto, se lee lo que el agente
 * escribió, se copia y se envía. Cuando su forma de escribir convenza, se pasa
 * a modo autónomo y esta lista queda como historial.
 */
export default async function RespuestasDelAgentePage() {
  noStore();
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();

  const [{ data: config }, { data: borradores }] = await Promise.all([
    supabase.from("sales_agent_configs").select("enabled, modo, max_respuestas_por_dia").maybeSingle(),
    supabase
      .from("sales_agent_drafts")
      .select("id, para_email, asunto, cuerpo, intencion, razonamiento, escalar, estado, created_at, opportunity_id")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const lista = borradores ?? [];
  const modo = config?.modo ?? "borrador";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Respuestas del agente"
        description="Lo que Atlas Vendedor propone contestar a quienes respondieron una campaña."
        actions={
          <Link className="text-sm text-muted-foreground hover:text-foreground hover:underline" href="/dashboard/ventas">
            Volver al embudo
          </Link>
        }
      />

      {!config?.enabled && (
        <Callout tone="warning">
          El agente vendedor está apagado para esta empresa. Mientras lo esté, nadie contesta las respuestas.
        </Callout>
      )}

      {config?.enabled && modo === "borrador" && (
        <Callout tone="info">
          El agente está en <strong>modo borrador</strong>: escribe y espera. Revisa lo que propone, envíalo tú y
          márcalo como enviado. Cuando su forma de escribir te convenza, se pasa a modo autónomo y contesta solo.
        </Callout>
      )}

      {lista.length === 0 ? (
        <EmptyState
          title="No hay respuestas esperando"
          description="Cuando alguien conteste una campaña, el agente redacta acá su propuesta en menos de quince minutos."
        />
      ) : (
        lista.map((borrador) => {
          const intencion = INTENCION[borrador.intencion ?? ""] ?? { texto: borrador.intencion ?? "—", tono: "neutral" as const };
          return (
            <SectionCard
              key={borrador.id}
              title={borrador.para_email}
              description={`${cuando.format(new Date(borrador.created_at))} · ${borrador.razonamiento ?? ""}`}
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={intencion.tono}>{intencion.texto}</Badge>
                  {borrador.escalar && <Badge tone="warning">Te necesita a ti</Badge>}
                </div>
              }
            >
              <div className="space-y-3 px-5 py-4">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Asunto</p>
                  <p className="text-sm font-medium text-foreground">{borrador.asunto}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Respuesta propuesta</p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{borrador.cuerpo}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <ActionForm action={marcarBorradorEnviado} success="Marcada como enviada">
                    <input type="hidden" name="borrador_id" value={borrador.id} />
                    <ActionSubmit size="sm">Ya la envié</ActionSubmit>
                  </ActionForm>
                  <ActionForm action={descartarBorrador} success="Descartada">
                    <input type="hidden" name="borrador_id" value={borrador.id} />
                    <ActionSubmit variant="ghost" size="sm">Descartar</ActionSubmit>
                  </ActionForm>
                  {borrador.opportunity_id && (
                    <Link
                      className="text-xs font-medium text-primary hover:underline"
                      href={`/dashboard/ventas/${borrador.opportunity_id}`}
                    >
                      Ver el negocio
                    </Link>
                  )}
                </div>
              </div>
            </SectionCard>
          );
        })
      )}
    </div>
  );
}
