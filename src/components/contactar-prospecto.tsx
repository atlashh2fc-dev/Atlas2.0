"use client";

import { MessageCircle, Phone, Mail } from "lucide-react";

import { registrarToque } from "@/app/actions/prospeccion";
import { SubmitButton } from "@/components/ui";

/**
 * Escribir y anotar en el mismo clic. Abre WhatsApp (o el correo) en otra
 * pestaña y deja registrado el toque, con seguimiento en tres días. Si hubiera
 * que anotarlo aparte, la mitad de las veces no se anotaría: es la razón por la
 * que las herramientas de prospección registran la tarea al ejecutarla.
 */
export function ContactarProspecto({
  leadId,
  canal,
  enlace,
  etiqueta,
}: {
  leadId: string;
  canal: "whatsapp" | "llamada" | "correo";
  enlace: string | null;
  etiqueta: string;
}) {
  const Icono = canal === "whatsapp" ? MessageCircle : canal === "llamada" ? Phone : Mail;
  return (
    <form action={registrarToque}>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="resultado" value={canal} />
      <SubmitButton
        size="sm"
        variant={canal === "whatsapp" ? "primary" : "secondary"}
        pendingLabel="Anotando…"
        onClick={() => {
          if (enlace) window.open(enlace, "_blank", "noopener,noreferrer");
        }}
      >
        <Icono size={13} aria-hidden="true" /> {etiqueta}
      </SubmitButton>
    </form>
  );
}
