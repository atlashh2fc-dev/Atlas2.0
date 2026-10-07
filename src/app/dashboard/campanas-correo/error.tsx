"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function CampanasCorreoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <EmptyState
        icon={CircleAlert}
        title="No pudimos cargar las campañas de correo"
        description="Puede ser la conexión con Atlas Lead o un corte momentáneo. Las campañas siguen enviando según su horario; vuelve a intentarlo."
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
