"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

import { beginOfflineManagement, getMyOpenManagement } from "@/app/actions/calls";
import { buttonClasses } from "@/components/ui";
import { isPendingManagementError } from "@/lib/call-management-navigation";

/**
 * Cierra la conversación de correo con la tipificación de siempre: abre una
 * gestión sin llamada por correo y el formulario aparece en la misma bandeja,
 * sobre el hilo. Al guardarla, los correos pendientes de ese cliente quedan
 * atendidos y se vuelve a la bandeja.
 */
export function TipificarCorreo({ leadId, pendiente: porAtender }: { leadId: string; pendiente: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function tipificar() {
    setError(null);
    startTransition(async () => {
      const resultado = await beginOfflineManagement(leadId, "correo");
      if (!resultado.ok) {
        // Ya hay una gestión abierta: se lleva a ella en vez de repetir el rechazo.
        const abierta = isPendingManagementError(resultado.error) ? await getMyOpenManagement().catch(() => null) : null;
        if (!abierta) {
          setError(resultado.error);
          return;
        }
        // Si es de este mismo cliente, la bandeja estaba desactualizada: se
        // repinta con el formulario. Si es de otro, se va a cerrarla primero.
        if (abierta.leadId === leadId) router.refresh();
        else router.push(`/dashboard/leads/${abierta.leadId}?tipificar=1`);
        return;
      }
      // El formulario aparece en la misma bandeja, sobre el hilo.
      router.refresh();
      for (const espera of [300, 900, 1800]) {
        window.setTimeout(() => {
          document.getElementById("gestion-en-curso")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, espera);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <button type="button" onClick={tipificar} disabled={pendiente} className={buttonClasses({ variant: "secondary", className: "w-full justify-center" })}>
        <ClipboardCheck size={15} aria-hidden="true" />
        {pendiente ? "Abriendo la tipificación…" : porAtender ? "Tipificar y cerrar" : "Tipificar la conversación"}
      </button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * La bandeja se pone al día sola cada minuto, salvo mientras se escribe: un
 * refresco nunca pisa una respuesta a medio redactar.
 */
export function RefrescoDeBandeja({ cadaMs = 60_000 }: { cadaMs?: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const id = window.setInterval(() => {
      const activo = document.activeElement;
      const escribiendo =
        activo instanceof HTMLTextAreaElement || activo instanceof HTMLInputElement
          ? activo.value.trim().length > 0
          : false;
      if (document.visibilityState === "visible" && !escribiendo) {
        startTransition(() => router.refresh());
      }
    }, cadaMs);
    return () => window.clearInterval(id);
  }, [cadaMs, router]);

  return null;
}

/**
 * Cuánto lleva esperando el cliente, con el color del nivel de servicio: gris
 * mientras hay tiempo, ámbar pasada la mitad, rojo vencido. Corre solo, sin
 * recargar la página.
 */
export function EsperaDelCliente({ desde, slaSegundos }: { desde: string; slaSegundos: number }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const segundos = Math.max(0, (ahora - new Date(desde).getTime()) / 1000);
  const tono = segundos > slaSegundos ? "text-danger font-semibold" : segundos > slaSegundos / 2 ? "text-warning font-medium" : "text-muted-foreground";
  return (
    <span className={`text-xs tabular-nums ${tono}`} title={`Nivel de servicio: responder antes de ${duracion(slaSegundos)}`}>
      {segundos > slaSegundos ? "Vencido · " : "Espera "}
      {duracion(segundos)}
    </span>
  );
}

function duracion(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h ${minutos % 60 ? `${minutos % 60} min` : ""}`.trim();
  const dias = Math.floor(horas / 24);
  return `${dias} d ${horas % 24 ? `${horas % 24} h` : ""}`.trim();
}
