"use client";

import { useState, type ReactNode } from "react";
import { ActionForm, type ConfirmOptions } from "@/components/ui";

/**
 * ActionForm de configuración que trae, entre muchos campos, la casilla que
 * enciende o apaga una operación (discador, agente IA, motor de leads).
 *
 * Guardar un cambio de ratio no debería pedir nada; guardar con la casilla
 * cambiada sí, porque eso empieza a marcar clientes o deja de hacerlo. El
 * diálogo aparece solo cuando la casilla quedó distinta de lo guardado.
 */
export function FormularioConEncendido({
  action,
  success,
  className,
  toggleName,
  savedOn,
  turnOn,
  turnOff,
  children,
}: {
  action: (formData: FormData) => Promise<void> | void;
  success: string;
  className?: string;
  /** `name` de la casilla que enciende la operación. */
  toggleName: string;
  /** Estado guardado hoy. */
  savedOn: boolean;
  turnOn: ConfirmOptions;
  turnOff: ConfirmOptions;
  children: ReactNode;
}) {
  const [checked, setChecked] = useState(savedOn);
  // Tras guardar, la página se refresca y `savedOn` pasa a ser lo que quedó
  // marcado: el siguiente guardado ya no pregunta.
  const changed = checked !== savedOn;

  return (
    <div
      className="contents"
      onChange={(event) => {
        const target = event.target as HTMLInputElement;
        if (target.name === toggleName && target.type === "checkbox") setChecked(target.checked);
      }}
    >
      <ActionForm
        action={action}
        success={success}
        className={className}
        confirm={changed ? (checked ? turnOn : turnOff) : undefined}
      >
        {children}
      </ActionForm>
    </div>
  );
}
