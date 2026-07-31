"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  AGENT_FORCE_LOGOUT_EVENT,
  type AgentForceLogoutEventDetail,
} from "@/lib/agent-control";

type CommandRow = {
  id: string;
  target_profile_id: string;
  command: "force_logout";
};

const FALLBACK_POLL_MS = 2_000;
const SIP_SHUTDOWN_TIMEOUT_MS = 3_000;

function withTimeout(promises: Promise<unknown>[], timeoutMs: number) {
  return Promise.race([
    Promise.allSettled(promises),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * Plano de control del agente. Realtime entrega la orden normalmente y el
 * poll cubre una suscripción interrumpida. Antes de salir permite que CTI
 * envíe BYE/unregister y detenga el UserAgent.
 */
export function ForceLogoutGuard({ userId }: { userId: string }) {
  const handlingRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;

    async function execute(row: CommandRow) {
      if (disposed || row.target_profile_id !== userId || handlingRef.current) return;
      handlingRef.current = row.id;

      const detail: AgentForceLogoutEventDetail = {
        commandId: row.id,
        shutdowns: [],
      };
      window.dispatchEvent(
        new CustomEvent<AgentForceLogoutEventDetail>(AGENT_FORCE_LOGOUT_EVENT, { detail })
      );
      await withTimeout(detail.shutdowns, SIP_SHUTDOWN_TIMEOUT_MS);

      // El ACK es deliberadamente un RPC directo: la sesión ya está en la
      // deny-list y las server actions normales deben rechazarla.
      await supabase
        .rpc("acknowledge_agent_control_command", { p_command_id: row.id })
        .then(({ error }) => {
          if (error) console.error("No se pudo confirmar el cierre remoto", error);
        });

      // Global usa el JWT del propio agente y revoca todas sus sesiones y
      // refresh tokens en Supabase. Un login posterior crea otra sesión.
      await supabase.auth.signOut({ scope: "global" }).catch((error) => {
        console.error("No se pudo cerrar Supabase Auth", error);
      });
      window.location.replace("/login?reason=forced_logout");
    }

    async function findPending() {
      const { data, error } = await supabase
        .from("agent_control_commands")
        .select("id, target_profile_id, command")
        .eq("target_profile_id", userId)
        .is("browser_acknowledged_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("No se pudo consultar el plano de control", error);
        return;
      }
      if (data) await execute(data as CommandRow);
    }

    const channel = supabase
      .channel(`agent-control-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_control_commands",
          filter: `target_profile_id=eq.${userId}`,
        },
        (payload) => void execute(payload.new as CommandRow)
      )
      .subscribe();

    void findPending();
    const poll = setInterval(findPending, FALLBACK_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}

