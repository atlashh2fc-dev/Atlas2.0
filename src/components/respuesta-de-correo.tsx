"use client";

import { useState, useSyncExternalStore } from "react";
import { Reply } from "lucide-react";

import { responderCorreoDeRegistro } from "@/app/actions/correo-registro";
import { ActionForm, ActionSubmit } from "@/components/ui";

const PREFIJO = "atlas:borrador-correo:";

// sessionStorage no avisa cambios en la misma pestaña: se relee en cada render.
const sinSuscripcion = () => () => undefined;

function leerBorrador(clave: string): string {
  try {
    return window.sessionStorage.getItem(clave) ?? "";
  } catch {
    return "";
  }
}

function guardarBorrador(clave: string, texto: string) {
  try {
    if (texto.trim()) window.sessionStorage.setItem(clave, texto);
    else window.sessionStorage.removeItem(clave);
  } catch {
    // Sin almacenamiento (modo privado): el borrador vive solo en pantalla.
  }
}

/**
 * La respuesta al cliente, con borrador. Si entra una llamada y la ficha del
 * discador saca al ejecutivo de la pantalla, lo que estaba escribiendo sigue
 * acá al volver. Al enviarse, el cuadro queda limpio para no reenviar lo mismo.
 */
export function RespuestaDeCorreo({ leadId, correoId, destinatario }: { leadId: string; correoId: string; destinatario: string }) {
  const clave = `${PREFIJO}${leadId}`;
  const [texto, setTexto] = useState("");
  const [recuperado, setRecuperado] = useState(false);
  // El borrador existe solo en el navegador: el servidor lo ve vacío y, al
  // hidratar, se recupera. Ajustar el estado durante el render es el patrón
  // que React documenta para derivarlo de una fuente externa.
  const guardado = useSyncExternalStore(sinSuscripcion, () => leerBorrador(clave), () => "");
  const [visto, setVisto] = useState("");
  if (guardado !== visto) {
    setVisto(guardado);
    if (guardado && !texto) {
      setTexto(guardado);
      setRecuperado(true);
    }
  }

  return (
    <ActionForm
      action={responderCorreoDeRegistro}
      success="Respuesta enviada"
      className="border-t border-border pt-4"
      onSuccess={() => {
        setTexto("");
        setRecuperado(false);
        guardarBorrador(clave, "");
      }}
    >
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="correo_id" value={correoId} />
      <label className="block text-sm font-medium text-foreground" htmlFor={`respuesta-${leadId}`}>
        Responder a {destinatario}
      </label>
      <textarea
        id={`respuesta-${leadId}`}
        name="texto"
        required
        minLength={2}
        maxLength={20000}
        rows={4}
        value={texto}
        onChange={(event) => {
          setTexto(event.target.value);
          setRecuperado(false);
          guardarBorrador(clave, event.target.value);
        }}
        placeholder="Tu firma se agrega sola al final."
        className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {recuperado ? "Recuperamos lo que estabas escribiendo." : texto.trim() ? "Borrador guardado en este navegador." : ""}
        </p>
        <ActionSubmit pendingLabel="Enviando…">
          <Reply size={15} aria-hidden="true" /> Enviar respuesta
        </ActionSubmit>
      </div>
    </ActionForm>
  );
}
