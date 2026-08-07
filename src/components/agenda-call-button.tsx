"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { requestAgentDial } from "@/lib/agent-control";

/**
 * Marca un compromiso de la agenda propia.
 *
 * Antes esto era un enlace a la ficha, que no tiene forma de llamar: si el
 * discador no alcanzó a entregar el callback dentro de su ventana, el
 * compromiso quedaba visible pero incallable, porque el marcado manual del CTI
 * está bloqueado en campañas automáticas. El botón le pide al teléfono —lo
 * único que habla SIP— que origine; el servidor abre la gestión.
 */
export function AgendaCallButton({
  leadId,
  fullName,
  variant = "primary",
  label = "Llamar ahora",
}: {
  leadId: string;
  fullName: string;
  variant?: "primary" | "secondary";
  label?: string;
}) {
  const [dialing, setDialing] = useState(false);

  return (
    <button
      type="button"
      disabled={dialing}
      onClick={(event) => {
        // En la agenda la fila completa navega a la ficha; el botón solo marca.
        event.preventDefault();
        event.stopPropagation();
        setDialing(true);
        requestAgentDial({ leadId, fullName });
        // Desde aquí manda el CTI, incluido el screen-pop. El bloqueo es solo
        // para que un doble clic no dispare dos gestiones.
        window.setTimeout(() => setDialing(false), 4000);
      }}
      className={buttonClasses({ size: "sm", variant })}
    >
      <Phone size={14} />
      {dialing ? "Marcando…" : label}
    </button>
  );
}
