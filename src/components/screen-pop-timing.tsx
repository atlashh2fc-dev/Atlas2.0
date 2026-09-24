"use client";

import { useEffect } from "react";
import { recordScreenPopTiming } from "@/app/actions/agent-sip";

export const SCREEN_POP_STORAGE_KEY = "atlas-screen-pop";

export type ScreenPopMark = {
  leadId: string;
  dialAttemptId: string | null;
  inviteAt: number | null;
  contextAt: number;
  polls: number | null;
  source: string;
};

/** Lo llama el teléfono cuando ya sabe qué cliente es. */
export function markScreenPop(mark: ScreenPopMark) {
  try {
    window.sessionStorage.setItem(SCREEN_POP_STORAGE_KEY, JSON.stringify(mark));
  } catch {
    // Sin sessionStorage no se mide; la llamada sigue igual.
  }
}

/**
 * Se monta con la tipificación de la ficha: cierra la medición del
 * screen-pop (cuánto tardó la ficha en dibujarse desde que se supo el
 * cliente) y la envía. Una vez por llamada.
 */
export function ScreenPopTiming({ leadId }: { leadId: string }) {
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(SCREEN_POP_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let mark: ScreenPopMark;
    try {
      mark = JSON.parse(raw) as ScreenPopMark;
    } catch {
      return;
    }
    if (mark.leadId !== leadId || Date.now() - mark.contextAt > 60_000) return;
    try {
      window.sessionStorage.removeItem(SCREEN_POP_STORAGE_KEY);
    } catch {
      // ignorar
    }
    const renderedAt = Date.now();
    void recordScreenPopTiming({
      leadId,
      dialAttemptId: mark.dialAttemptId,
      inviteToContextMs: mark.inviteAt ? mark.contextAt - mark.inviteAt : null,
      contextToRenderMs: renderedAt - mark.contextAt,
      polls: mark.polls,
      source: mark.source,
    }).catch(() => undefined);
  }, [leadId]);
  return null;
}
