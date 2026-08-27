"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { buttonClasses } from "@/components/ui";

/** No realtime subscription: admin never receives conversation row payloads. */
export function OperationsRefresh({ observedAt }: { observedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [auto, setAuto] = useState(false);
  const [checkedAt, setCheckedAt] = useState(() => Date.parse(observedAt));
  const stale = checkedAt - Date.parse(observedAt) > 60_000;
  const refresh = () => startTransition(() => router.refresh());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCheckedAt(Date.now());
      // Do not replace a focused form or reorder a table while interacting.
      if (
        auto &&
        document.visibilityState === "visible" &&
        !document.activeElement?.closest("form, table")
      ) {
        startTransition(() => router.refresh());
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [auto, observedAt, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span aria-live="polite">
        {stale ? "Datos de hace más de 1 minuto" : "Instantánea consultada"} ·{" "}
        {new Date(observedAt).toLocaleTimeString("es-CL", {
          timeZone: "America/Santiago",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={auto}
          onChange={(event) => setAuto(event.target.checked)}
        />{" "}
        Actualizar cada 30 s
      </label>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className={buttonClasses({ variant: "secondary", size: "sm" })}
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        {pending ? "Actualizando…" : "Actualizar"}
      </button>
    </div>
  );
}
