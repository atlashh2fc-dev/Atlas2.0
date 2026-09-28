"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, CheckCircle2, Mail, MailOpen } from "lucide-react";

import { registrarToque } from "@/app/actions/prospeccion";
import { ContactarProspecto } from "@/components/contactar-prospecto";
import { Badge, SubmitButton } from "@/components/ui";

export type FilaProspecto = {
  leadId: string;
  nombre: string;
  estado: { texto: string; tono: "info" | "warning" | "neutral" | "danger" };
  datos: string;
  senal: string;
  tonoSenal: "success" | "neutral";
  haceCuanto: string;
  campana: string | null;
  ultimoToque: string | null;
  respondio: boolean;
  canal: "whatsapp" | "llamada" | "correo";
  enlace: string | null;
  etiqueta: string;
  telefono: boolean;
  abiertos: number;
  /** Los correos de la secuencia, ya en hora Chile. */
  correos: { asunto: string; enviado: string | null; abierto: string | null; clic: boolean }[];
  /** Si está, no se le escribe: la fila se ve, con el motivo, y sin acciones. */
  noContactar: string | null;
};

const HECHO: Record<string, string> = {
  whatsapp: "WhatsApp anotado · vuelve en 3 días si no responde",
  llamada: "Llamada anotada · vuelve en 3 días",
  correo: "Correo anotado · vuelve en 3 días",
  no_interesa: "Anotado: no le interesa",
  numero_malo: "Anotado: el número no sirve",
  posponer: "Pospuesto una semana",
  interesado: "Pasó al pipeline",
};

/**
 * La cola no se mueve bajo el cursor. Al anotar un toque, el servidor saca a
 * ese prospecto de la bandeja (vuelve el día del seguimiento) y el resto sube:
 * quien va trabajando de arriba hacia abajo pierde el lugar. Por eso la fila
 * gestionada se queda donde estaba, marcada, hasta que se recarga la página;
 * los prospectos nuevos se agregan al final.
 */
export function BandejaProspeccion({ filas }: { filas: FilaProspecto[] }) {
  // Lo último que se supo de cada prospecto, en el orden en que apareció. Se
  // ajusta durante el render cuando llegan filas nuevas (el patrón de React
  // para estado derivado de props), sin efectos ni refs.
  const [vistas, setVistas] = useState<{ de: FilaProspecto[]; filas: FilaProspecto[] }>({ de: filas, filas });
  const [hechos, setHechos] = useState<Record<string, string>>({});
  if (vistas.de !== filas) {
    const porId = new Map(filas.map((fila) => [fila.leadId, fila]));
    const conocidas = vistas.filas.map((fila) => porId.get(fila.leadId) ?? fila);
    const nuevas = filas.filter((fila) => !vistas.filas.some((vista) => vista.leadId === fila.leadId));
    setVistas({ de: filas, filas: [...conocidas, ...nuevas] });
  }
  const presentes = new Set(filas.map((fila) => fila.leadId));

  const anotar = (leadId: string, resultado: string) => setHechos((previo) => ({ ...previo, [leadId]: resultado }));

  return (
    <ul className="divide-y divide-border">
      {vistas.filas.map((p) => {
        const leadId = p.leadId;
        const hecho = hechos[leadId];
        if (!presentes.has(leadId) || (hecho && hecho !== "whatsapp" && hecho !== "llamada" && hecho !== "correo")) {
          return (
            <li key={leadId} className="flex items-center justify-between gap-3 bg-surface-muted/40 px-4 py-3 text-muted-foreground">
              <span className="truncate text-sm">{p.nombre}</span>
              <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-xs">
                <CheckCircle2 size={14} aria-hidden="true" className="text-success" />
                {HECHO[hecho ?? ""] ?? "Gestionado"}
              </span>
            </li>
          );
        }
        if (p.noContactar) {
          return (
            <li key={leadId} className="space-y-1.5 border-l-4 border-l-danger bg-danger-bg px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/leads/${p.leadId}`} className="truncate text-sm font-medium text-foreground hover:underline">
                  {p.nombre}
                </Link>
                <Badge tone="danger">{p.estado.texto}</Badge>
              </div>
              <p className="flex items-start gap-1.5 text-sm font-medium text-danger">
                <Ban size={14} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
                {p.noContactar}
              </p>
              <Correos correos={p.correos} />
            </li>
          );
        }
        return (
          <li key={leadId} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/leads/${p.leadId}`} className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
                  {p.nombre}
                </Link>
                <Badge tone={p.estado.tono}>{p.estado.texto}</Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">{p.datos}</p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <Badge tone={p.tonoSenal}>{p.senal}</Badge>
                {p.correos.length > 0 && <Badge tone="neutral">Abrió {p.abiertos} de {p.correos.length} correos</Badge>}
                <span>{p.haceCuanto}</span>
                {p.campana && <span className="truncate">· {p.campana}</span>}
                {p.ultimoToque && <span>· {p.ultimoToque}</span>}
                {p.respondio && (
                  <Link href="/dashboard/ventas/respuestas" className="text-primary hover:underline">Ver su respuesta</Link>
                )}
              </div>
              <Correos correos={p.correos} />
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
              <span onClickCapture={() => anotar(p.leadId, p.canal)}>
                <ContactarProspecto leadId={p.leadId} canal={p.canal} enlace={p.enlace} etiqueta={p.etiqueta} />
              </span>
              <Resultado leadId={p.leadId} resultado="interesado" texto="Interesado" alAnotar={anotar} />
              <Resultado leadId={p.leadId} resultado="no_interesa" texto="No interesa" alAnotar={anotar} />
              {p.telefono && <Resultado leadId={p.leadId} resultado="numero_malo" texto="Número no sirve" alAnotar={anotar} />}
              <Resultado leadId={p.leadId} resultado="posponer" texto="En una semana" alAnotar={anotar} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Qué se le mandó y qué leyó, para saber de qué hablarle antes de escribirle. */
function Correos({ correos }: { correos: FilaProspecto["correos"] }) {
  if (correos.length === 0) return null;
  return (
    <ul className="space-y-0.5 pt-0.5 text-xs">
      {correos.map((correo, i) => {
        const Icono = correo.abierto ? MailOpen : Mail;
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span className={`inline-flex items-center gap-1.5 ${correo.abierto ? "text-foreground" : "text-muted-foreground"}`}>
              <Icono size={12} aria-hidden="true" className={`flex-shrink-0 self-center ${correo.abierto ? "text-success" : ""}`} />
              {correo.asunto}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {correo.enviado ? `enviado ${correo.enviado}` : "sin fecha de envío"}
              {correo.abierto ? ` · abierto ${correo.abierto}` : " · sin abrir"}
              {correo.clic ? " · hizo clic" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Resultado({ leadId, resultado, texto, alAnotar }: { leadId: string; resultado: string; texto: string; alAnotar: (leadId: string, resultado: string) => void }) {
  return (
    <form action={registrarToque} onSubmit={() => alAnotar(leadId, resultado)}>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="resultado" value={resultado} />
      <SubmitButton size="sm" variant={resultado === "interesado" ? "secondary" : "ghost"} pendingLabel="…">{texto}</SubmitButton>
    </form>
  );
}
