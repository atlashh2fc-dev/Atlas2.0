"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { ConfirmDialog } from "@/components/ui";

/**
 * Cerrar sesión corta el teléfono. Si hay una llamada al aire (el CTI marca
 * `data-cti-in-call` en la raíz), se pide confirmar antes: un clic de más al
 * lado del cambio de tema no puede colgarle a un cliente.
 */
export function BotonCerrarSesion() {
  const formRef = useRef<HTMLFormElement>(null);
  const [preguntando, setPreguntando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  // Ya confirmado: el reenvío no vuelve a preguntar (el estado aún no se repinta).
  const confirmado = useRef(false);

  return (
    <>
      <form
        ref={formRef}
        action={signOut}
        onSubmit={(event) => {
          if (saliendo || confirmado.current) {
            setSaliendo(true);
            return;
          }
          if (document.documentElement.dataset.ctiInCall) {
            event.preventDefault();
            setPreguntando(true);
            return;
          }
          setSaliendo(true);
        }}
      >
        <button
          type="submit"
          disabled={saliendo}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <LogOut size={18} />
        </button>
      </form>
      <ConfirmDialog
        open={preguntando}
        options={{
          title: "¿Cerrar sesión con una llamada en curso?",
          description: "La llamada se corta y quedas desconectado del discador. Si falta tipificar, la gestión queda pendiente.",
          confirmLabel: "Cortar y cerrar sesión",
        }}
        onCancel={() => setPreguntando(false)}
        onConfirm={() => {
          setPreguntando(false);
          confirmado.current = true;
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
