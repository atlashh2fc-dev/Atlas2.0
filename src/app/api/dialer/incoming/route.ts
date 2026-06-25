import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateOpenCall } from "@/app/actions/calls";

/**
 * Endpoint nativo para integraciones de discador (ej. extensión de Chrome
 * que detecta el número entrante en Vocalcom vía CDP/WebSocket sniffing).
 *
 * Reemplaza el flujo anterior de "extraer texto de la pantalla de Atlas y
 * parsearlo": la extensión solo envía el número detectado, Atlas hace el
 * match contra `leads`, registra el evento en `call_events` (igual que el
 * resto del ciclo de vida de la llamada) y devuelve los datos estructurados
 * del lead para que la extensión/agente no dependa de scraping del DOM.
 *
 * POST { phone: string }
 * → 200 { matched: true, leadId, callId, lead }
 * → 200 { matched: false }
 * → 401 si no hay sesión válida (cookies de Atlas)
 */

function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("56") && digits.length >= 10 && digits.length <= 12) {
    return "+" + digits;
  }
  if (digits.length === 9) return "+56" + digits;
  // Número largo sin 56 explícito (ej. ya viene con 0 inicial u otro prefijo)
  if (digits.length > 9) return "+56" + digits.slice(-9);
  return null;
}

export async function POST(request: Request) {
  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido, se espera JSON" }, { status: 400 });
  }

  const rawPhone = body.phone;
  if (!rawPhone) {
    return NextResponse.json({ error: "Falta 'phone'" }, { status: 400 });
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: "Número no reconocible" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Match exacto contra el formato real almacenado (+56XXXXXXXXX).
  // RLS limita lo que cada rol puede ver (agente: solo sus leads asignados;
  // supervisor: su equipo; admin: todo) — igual que en el resto de la app.
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, rut, full_name, phone, email, status, assigned_to")
    .eq("phone", phone)
    .limit(5);

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ matched: false, phone });
  }

  // Si hay varios leads con el mismo teléfono, prioriza el asignado al
  // agente que está recibiendo la llamada.
  const lead = leads.find((l) => l.assigned_to === user.id) ?? leads[0];

  let callId: string | null = null;
  try {
    const call = await getOrCreateOpenCall(lead.id);
    callId = call.id;

    const { error: eventError } = await supabase.from("call_events").insert({
      call_id: call.id,
      lead_id: lead.id,
      agent_id: user.id,
      event_type: "dialer.incoming_call",
      payload: { phone, source: "vocalcom_extension" },
    });
    if (eventError) throw new Error(eventError.message);
  } catch (err) {
    // No bloqueamos la respuesta del match por un fallo al registrar el
    // evento: el agente igual necesita los datos del lead en pantalla.
    return NextResponse.json({
      matched: true,
      leadId: lead.id,
      callId,
      lead,
      warning: err instanceof Error ? err.message : "No se pudo registrar el evento de llamada",
    });
  }

  return NextResponse.json({ matched: true, leadId: lead.id, callId, lead });
}
