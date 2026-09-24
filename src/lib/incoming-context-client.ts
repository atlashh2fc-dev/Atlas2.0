import { createClient } from "@/lib/supabase/client";
import type { IncomingDialContext } from "@/app/actions/agent-sip";

/**
 * Contexto de la llamada que acaba de entrar, consultado directo desde el
 * navegador a la base (misma consulta que getMyIncomingDialContext, con la
 * seguridad por fila del ejecutivo). La acción de servidor tardaba ~1 s por
 * vuelta (Chile → servidor de la app → base); directo son ~0,2 s.
 *
 * Devuelve:
 *   - el contexto, si ya está;
 *   - null, si todavía no hay intento a nombre del ejecutivo (seguir esperando);
 *   - undefined, si hay intento pero la política no dejó leer el lead o hubo
 *     error: el llamador pregunta por la vía del servidor.
 */
export async function fetchIncomingDialContextDirect(
  userId: string
): Promise<IncomingDialContext | null | undefined> {
  const supabase = createClient();
  const recentCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: attempt, error } = await supabase
    .from("dial_attempts")
    .select("id, lead_id, campaign_id, phone")
    .eq("agent_id", userId)
    .or(
      "status.in.(ringing,answered,bridged),and(attempt_kind.eq.personal_callback,status.in.(queued,originating))"
    )
    .gte("updated_at", recentCutoff)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return undefined;
  if (!attempt) return null;

  const [{ data: lead }, { data: campaign }] = await Promise.all([
    supabase.from("leads").select("id, full_name, phone, rut, email, extra").eq("id", attempt.lead_id).maybeSingle(),
    supabase.from("campaigns").select("name").eq("id", attempt.campaign_id).maybeSingle(),
  ]);
  if (!lead) return undefined;

  return {
    dial_attempt_id: attempt.id,
    lead_id: lead.id,
    campaign_id: attempt.campaign_id,
    campaign_name: campaign?.name ?? "",
    phone: lead.phone ?? attempt.phone,
    full_name: lead.full_name,
    rut: lead.rut,
    email: lead.email,
    extra:
      lead.extra && typeof lead.extra === "object" && !Array.isArray(lead.extra)
        ? (lead.extra as Record<string, unknown>)
        : {},
  };
}
