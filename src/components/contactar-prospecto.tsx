"use client";

import { MessageCircle, Phone, Mail } from "lucide-react";

import { buttonClasses } from "@/components/ui";

/**
 * Abre WhatsApp, el teléfono o el correo, y nada más. Abrir no es enviar: la
 * persona puede cerrar WhatsApp sin mandar el mensaje, y si el clic anotara el
 * toque la sacaría de la bandeja por tres días sin que nadie le escribiera
 * (pasó el 29-09). Lo que pasó se anota después, con «¿Cómo te fue?».
 */
export function ContactarProspecto({
  canal,
  enlace,
  etiqueta,
  alAbrir,
}: {
  canal: "whatsapp" | "llamada" | "correo";
  enlace: string | null;
  etiqueta: string;
  alAbrir?: () => void;
}) {
  const Icono = canal === "whatsapp" ? MessageCircle : canal === "llamada" ? Phone : Mail;
  const clases = buttonClasses({ size: "sm", variant: canal === "whatsapp" ? "primary" : "secondary" });
  if (!enlace) return null;
  return (
    <a
      href={enlace}
      target={canal === "llamada" ? undefined : "_blank"}
      rel="noopener noreferrer"
      onClick={alAbrir}
      className={clases}
    >
      <Icono size={13} aria-hidden="true" /> {etiqueta}
    </a>
  );
}
