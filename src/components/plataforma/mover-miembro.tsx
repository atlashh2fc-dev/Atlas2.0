"use client";

import { useState } from "react";

import { moverPersonaDeEmpresa } from "@/app/actions/organizaciones";
import { ActionForm, ActionSubmit, Button, Select } from "@/components/ui";

/**
 * Mover a alguien de empresa es raro: la fila muestra solo «Mover…» y el
 * selector aparece en la fila que lo pide, no repetido en las treinta.
 */
export function MoverMiembro({
  perfilId,
  nombre,
  destinos,
}: {
  perfilId: string;
  nombre: string;
  destinos: { id: string; nombre: string }[];
}) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        Mover…
      </Button>
    );
  }

  return (
    <ActionForm
      action={moverPersonaDeEmpresa}
      success={`${nombre} cambió de empresa`}
      onSuccess={() => setAbierto(false)}
      confirm={{
        title: `¿Mover a ${nombre}?`,
        description:
          "Deja de ver todo lo de esta empresa —registros, campañas, conversaciones— y pasa a ver solo lo de la empresa elegida, desde su próximo clic.",
        confirmLabel: "Mover de empresa",
        tone: "primary",
      }}
    >
      <input type="hidden" name="perfil_id" value={perfilId} />
      <div className="flex items-center justify-end gap-2">
        <Select name="empresa_id" required defaultValue="" fieldSize="sm" className="w-44" aria-label={`Nueva empresa de ${nombre}`} autoFocus>
          <option value="" disabled>
            Elegir empresa
          </option>
          {destinos.map((destino) => (
            <option key={destino.id} value={destino.id}>
              {destino.nombre}
            </option>
          ))}
        </Select>
        <ActionSubmit size="sm" pendingLabel="Moviendo…">
          Mover
        </ActionSubmit>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </ActionForm>
  );
}
