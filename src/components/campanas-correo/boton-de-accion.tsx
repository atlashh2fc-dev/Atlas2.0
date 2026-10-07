"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { cambiarEstadoCampanaCorreo, conectarAtlasLead } from "@/app/actions/campanas-correo";
import { Button, ConfirmDialog, useToast, type ButtonProps, type ConfirmOptions } from "@/components/ui";

type Accion = { tipo: "estado"; campanaId: string; accion: "lanzar" | "pausar" | "reanudar" | "cancelar" } | { tipo: "conectar" };

/**
 * Botón que ejecuta una acción de la campaña y muestra el motivo exacto si
 * Atlas Lead la rechaza. (Un server action que lanza pierde su mensaje en
 * producción; estas acciones devuelven el resultado.)
 */
export function BotonDeAccion({
  accion,
  exito,
  pendiente,
  confirmar,
  children,
  ...boton
}: {
  accion: Accion;
  exito: string;
  pendiente: string;
  confirmar?: ConfirmOptions;
  children: ReactNode;
} & Omit<ButtonProps, "onClick" | "type" | "children">) {
  const router = useRouter();
  const { toast } = useToast();
  const [ejecutando, start] = useTransition();
  const [preguntando, setPreguntando] = useState(false);
  const enVuelo = useRef(false);

  function ejecutar() {
    if (enVuelo.current) return;
    enVuelo.current = true;
    start(async () => {
      try {
        const resultado = accion.tipo === "conectar" ? await conectarAtlasLead() : await cambiarEstadoCampanaCorreo({ campanaId: accion.campanaId, accion: accion.accion });
        if (!resultado.ok) {
          toast({ tone: "danger", message: resultado.error });
          return;
        }
        toast({ tone: "success", message: exito });
        router.refresh();
      } finally {
        enVuelo.current = false;
      }
    });
  }

  return (
    <>
      <Button type="button" {...boton} disabled={ejecutando || boton.disabled} onClick={() => (confirmar ? setPreguntando(true) : ejecutar())}>
        {ejecutando && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {ejecutando ? pendiente : children}
      </Button>
      {confirmar && (
        <ConfirmDialog
          open={preguntando}
          options={confirmar}
          onCancel={() => setPreguntando(false)}
          onConfirm={() => {
            setPreguntando(false);
            ejecutar();
          }}
        />
      )}
    </>
  );
}
