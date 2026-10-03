"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function OrbitaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <EmptyState
        icon={CircleAlert}
        title="No pudimos cargar Órbita"
        description="Puede ser la conexión o un corte momentáneo. Los agentes siguen trabajando y sus eventos quedan guardados; vuelve a intentarlo."
        action={
          <Button type="button" variant="secondary" onClick={reset}>
            <RefreshCw size={14} aria-hidden="true" />
            Reintentar
          </Button>
        }
      />
    </div>
  );
}
