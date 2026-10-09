"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";

import { actualizarClienteTerreno } from "@/app/actions/terreno";
import type { DatosCliente } from "@/lib/terreno";
import { BOTON_SECUNDARIO } from "./campos";
import { DatosClienteForm } from "./datos-cliente-form";

/** Completar o corregir los datos sin salir de la ficha. */
export function EditarCliente({ leadId, datos }: { leadId: string; datos: DatosCliente }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className={`${BOTON_SECUNDARIO} mt-3`}>
        <Pencil size={18} aria-hidden="true" />
        Completar o corregir datos
      </button>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <DatosClienteForm
        inicial={datos}
        submitLabel="Guardar datos"
        onSubmit={async (nuevos) => {
          const respuesta = await actualizarClienteTerreno(leadId, nuevos);
          if (respuesta.ok) {
            setAbierto(false);
            router.refresh();
          }
          return respuesta;
        }}
      />
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-muted-foreground"
      >
        Cancelar
      </button>
    </div>
  );
}
