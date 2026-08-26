"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function WhatsAppAutoRefresh({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 250);
    };

    const channel = supabase
      .channel(`whatsapp-inbox:${conversationId ?? "list"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        refresh,
      );

    if (conversationId) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        refresh,
      );
    }

    channel.subscribe();
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, router]);

  return null;
}
