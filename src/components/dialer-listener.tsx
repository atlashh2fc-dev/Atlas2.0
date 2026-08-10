"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface CallEventRow {
  id: string;
  call_id: string;
  lead_id: string;
  agent_id: string;
  event_type: string;
  payload: { phone?: string; source?: string } | null;
  created_at: string;
}

/**
 * Screen-pop nativo de Atlas: escucha en tiempo real los eventos que el
 * endpoint /api/dialer/incoming inserta en `call_events` cuando la
 * extensión detecta una llamada entrante en Vocalcom, y navega
 * automáticamente a la ficha del lead — sin que el agente tenga que
 * copiar/pegar nada ni que la extensión simule clicks dentro de Atlas.
 *
 * RLS ya limita qué filas de call_events puede ver cada usuario (agente:
 * solo leads asignados a él), así que no hace falta filtrar por agent_id
 * en el cliente — si llega el evento, es porque le corresponde.
 */
export function DialerListener({ userId }: { userId: string }) {
  const router = useRouter();
  const lastHandledId = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Un ejecutivo que opera solo el motor de leads no tiene ni necesita SIP.
    // El RPC valida esa condición en servidor y no toca a los agentes del CTI.
    const publishLeadAvailability = () => {
      void supabase.rpc("heartbeat_my_lead_orchestrator").then(({ error }) => {
        if (error) console.error("Motor de leads: heartbeat falló", error);
      });
    };
    publishLeadAvailability();
    const heartbeatId = window.setInterval(publishLeadAvailability, 20_000);

    const channel = supabase
      .channel(`dialer-listener-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_events" },
        (payload) => {
          const row = payload.new as CallEventRow;
          if (!["dialer.incoming_call", "lead_orchestrator.assigned"].includes(row.event_type)) return;
          if (row.agent_id !== userId) return;
          if (lastHandledId.current === row.id) return;
          lastHandledId.current = row.id;

          if (row.event_type === "lead_orchestrator.assigned") {
            void supabase.rpc("open_my_lead_orchestrator_assignment", { p_lead_id: row.lead_id });
          }

          // La ruta lleva una marca explícita para que la ficha priorice la
          // tipificación por sobre el resto del CRM. El agente llega a la
          // información del cliente desde el primer timbre y, al colgar, el
          // CTI vuelve a esta misma ficha si se había navegado a otra parte.
          router.push(
            row.event_type === "lead_orchestrator.assigned"
              ? `/dashboard/leads/${row.lead_id}?orquestado=1`
              : `/dashboard/leads/${row.lead_id}?tipificar=1`
          );
        }
      )
      .subscribe();

    return () => {
      window.clearInterval(heartbeatId);
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
