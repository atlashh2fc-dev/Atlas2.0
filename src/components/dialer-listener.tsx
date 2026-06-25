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

    const channel = supabase
      .channel(`dialer-listener-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_events" },
        (payload) => {
          const row = payload.new as CallEventRow;
          if (row.event_type !== "dialer.incoming_call") return;
          if (row.agent_id !== userId) return;
          if (lastHandledId.current === row.id) return;
          lastHandledId.current = row.id;

          router.push(`/dashboard/leads/${row.lead_id}`);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
