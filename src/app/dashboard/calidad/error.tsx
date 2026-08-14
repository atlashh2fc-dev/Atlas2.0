"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function CalidadError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <EmptyState
        icon={CircleAlert}
        title="No pudimos cargar el menú de Calidad"
        description="Revisa la conexión e inténtalo nuevamente."
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            <RefreshCw size={14} />
            Reintentar
          </Button>
        }
      />
    </div>
  );
}
