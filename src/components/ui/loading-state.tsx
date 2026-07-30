"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_MESSAGES = [
  "Estamos preparando tu entorno…",
  "Organizando la información para ti…",
  "Ya casi terminamos…",
];

/** Da contexto a esperas cuya duración no podemos predecir. */
export function LoadingState({
  label = "Preparando la información",
  messages = DEFAULT_MESSAGES,
  className,
  compact = false,
}: {
  label?: string;
  messages?: string[];
  className?: string;
  compact?: boolean;
}) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (messages.length < 2) return;
    const timer = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % messages.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [messages]);

  const message = messages[messageIndex] ?? messages[0] ?? "Cargando…";

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={cn("flex items-center gap-3 text-muted-foreground", compact ? "text-xs" : "text-sm", className)}>
      <LoaderCircle className={cn("shrink-0 animate-spin text-primary", compact ? "size-3.5" : "size-5")} aria-hidden="true" />
      <div className="min-w-0">
        <p className={cn("font-medium text-foreground", compact && "text-xs")}>{label}</p>
        <p className={cn("mt-0.5 transition-opacity", compact ? "text-[11px]" : "text-xs")}>{message}</p>
      </div>
    </div>
  );
}
