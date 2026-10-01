"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Flame, History, Inbox, Mail, MailOpen, Repeat2 } from "lucide-react";

import { registrarToque } from "@/app/actions/prospeccion";
import { ContactarProspecto } from "@/components/contactar-prospecto";
import { Columna, MarcaIA, Tablero, TarjetaConversacion, type Tono, type UltimaLinea } from "@/components/pipeline-kit";
import { SubmitButton } from "@/components/ui";

export type FilaProspecto = {
  leadId: string;
  nombre: string;
  /** En qué columna va: el estado que devuelve la bandeja. */
  columna: "nuevo" | "volvio" | "seguimiento" | "no_contactar";
  estado: { texto: string; tono: "info" | "warning" | "neutral" | "danger" };
  datos: string;
  senal: string;
  tonoSenal: "success" | "neutral";
  /** Respondió, hizo clic o volvió a abrir. */
  caliente: boolean;
  haceCuanto: string;
  /** Hace cuánto, ya resuelto en hora Chile en el servidor (corto y completo). */
  hace: { corto: string; completo: string } | null;
  /** Lo último que se dijo (WhatsApp, correo, nota o el correo que leyó). */
  linea: UltimaLinea | null;
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
  whatsapp: "Le escribiste por WhatsApp · vuelve en 3 días si no responde",
  llamada: "No contestó · vuelve en 3 días",
  correo: "Le escribiste un correo · vuelve en 3 días si no responde",
  no_interesa: "Anotado: no le interesa",
  numero_malo: "Anotado: el número no sirve",
  posponer: "Pospuesto una semana",
  interesado: "Le interesa · pasó a Negocios",
};

type IconoColumna = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;

/** Las columnas del tablero, en el orden en que se trabajan. */
const COLUMNAS: { clave: FilaProspecto["columna"]; titulo: string; tono: Tono; icono: IconoColumna; vacio: string }[] = [
  { clave: "nuevo", titulo: "Sin contactar", tono: "blue", icono: Inbox, vacio: "Nadie nuevo por ahora" },
  { clave: "volvio", titulo: "Volvieron a abrir", tono: "amber", icono: MailOpen, vacio: "Nadie volvió a abrir" },
  { clave: "seguimiento", titulo: "Toca seguimiento", tono: "violet", icono: Repeat2, vacio: "Ningún seguimiento pendiente" },
  { clave: "no_contactar", titulo: "No contactar", tono: "rose", icono: Ban, vacio: "Nadie marcado" },
];

/**
 * Nada sale de la bandeja sin que alguien diga qué pasó: abrir WhatsApp no
 * cuenta, solo «¿Cómo te fue?».
 *
 * La cola no se mueve bajo el cursor. Al anotar un toque, el servidor saca a
 * ese prospecto de la bandeja (vuelve el día del seguimiento) y el resto sube:
 * quien va trabajando de arriba hacia abajo pierde el lugar. Por eso la fila
 * gestionada se queda donde estaba, marcada, hasta que se recarga la página;
 * los prospectos nuevos se agregan al final.
 *
 * Se ve como tablero de conversaciones (Vambe): una columna por estado y una
 * tarjeta por persona, con la última línea de lo que se habló.
 */
export function BandejaProspeccion({ filas }: { filas: FilaProspecto[] }) {
  // Lo último que se supo de cada prospecto, en el orden en que apareció. Se
  // ajusta durante el render cuando llegan filas nuevas (el patrón de React
  // para estado derivado de props), sin efectos ni refs.
  const [vistas, setVistas] = useState<{ de: FilaProspecto[]; filas: FilaProspecto[] }>({ de: filas, filas });
  const [hechos, setHechos] = useState<Record<string, string>>({});
  // A quién se le abrió WhatsApp, el teléfono o el correo. No se anota nada:
  // solo se le recuerda a la persona que diga cómo le fue.
  const [abrio, setAbrio] = useState<Record<string, boolean>>({});
  // Los resultados van plegados en la tarjeta hasta que se piden (o se abre WhatsApp).
  const [desplegado, setDesplegado] = useState<Record<string, boolean>>({});
  if (vistas.de !== filas) {
    const porId = new Map(filas.map((fila) => [fila.leadId, fila]));
    const conocidas = vistas.filas.map((fila) => porId.get(fila.leadId) ?? fila);
    const nuevas = filas.filter((fila) => !vistas.filas.some((vista) => vista.leadId === fila.leadId));
    setVistas({ de: filas, filas: [...conocidas, ...nuevas] });
  }
  const presentes = new Set(filas.map((fila) => fila.leadId));

  const anotar = (leadId: string, resultado: string) => setHechos((previo) => ({ ...previo, [leadId]: resultado }));

  const tarjeta = (p: FilaProspecto) => {
    const leadId = p.leadId;
    const hecho = hechos[leadId];
    if (!presentes.has(leadId) || hecho) {
      return (
        <TarjetaConversacion key={leadId} href={`/dashboard/leads/${leadId}`} nombre={p.nombre} atenuada>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 size={14} aria-hidden="true" className="mt-px flex-shrink-0 text-success" />
            {HECHO[hecho ?? ""] ?? "Gestionado"}
          </p>
        </TarjetaConversacion>
      );
    }
    if (p.noContactar) {
      return (
        <TarjetaConversacion key={leadId} href={`/dashboard/leads/${leadId}`} nombre={p.nombre} subtitulo={p.datos} hace={p.hace} linea={p.linea} atenuada>
          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger">
            <Ban size={13} aria-hidden="true" className="mt-px flex-shrink-0" />
            {p.noContactar}
          </p>
          <Correos correos={p.correos} abiertos={p.abiertos} campana={p.campana} />
        </TarjetaConversacion>
      );
    }
    const abierto = Boolean(abrio[leadId] || desplegado[leadId]);
    return (
      <TarjetaConversacion key={leadId} href={`/dashboard/leads/${leadId}`} nombre={p.nombre} subtitulo={p.datos} canal={p.linea?.canal ?? p.canal} hace={p.hace} linea={p.linea}>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className={`inline-flex min-w-0 items-center gap-1 ${p.caliente ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {p.caliente ? (
              <Flame size={12} aria-hidden="true" className="flex-shrink-0" style={{ color: "var(--tone-orange)" }} />
            ) : (
              <MailOpen size={12} aria-hidden="true" className="flex-shrink-0" />
            )}
            <span className="truncate">{p.senal}</span>
          </span>
          {p.linea?.ia && <MarcaIA />}
          {p.respondio && (
            <Link href="/dashboard/ventas/prospeccion?vista=respuestas" className="relative z-10 font-medium text-primary hover:underline">
              Ver su respuesta
            </Link>
          )}
        </div>
        {p.ultimoToque && (
          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <History size={11} aria-hidden="true" className="flex-shrink-0" />
            <span className="truncate">{p.ultimoToque}</span>
          </p>
        )}
        <Correos correos={p.correos} abiertos={p.abiertos} campana={p.campana} />

        <div className="relative z-10 mt-2.5 flex items-center gap-1.5 border-t border-border/60 pt-2.5">
          <ContactarProspecto canal={p.canal} enlace={p.enlace} etiqueta={p.etiqueta} alAbrir={() => setAbrio((previo) => ({ ...previo, [leadId]: true }))} />
          <button
            type="button"
            aria-expanded={abierto}
            aria-controls={`resultado-${leadId}`}
            onClick={() => setDesplegado((previo) => ({ ...previo, [leadId]: !abierto }))}
            className={`ml-auto inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${abrio[leadId] ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
          >
            ¿Cómo te fue?
            <ChevronDown size={13} aria-hidden="true" className={`transition-transform ${abierto ? "rotate-180" : ""}`} />
          </button>
        </div>
        {abierto && (
          // Tras abrir WhatsApp, el recuadro toma el color de lo pendiente.
          <div
            id={`resultado-${leadId}`}
            role="group"
            aria-label="Cómo te fue"
            className={`relative z-10 mt-2 rounded-lg p-1.5 ${abrio[leadId] ? "bg-primary/[0.07]" : "bg-surface-muted/70"}`}
          >
            {abrio[leadId] && <p className="px-1 pb-1 text-[11px] font-medium text-primary">¿Lo enviaste? Anota cómo te fue:</p>}
            <div className="grid grid-cols-2 gap-1">
              <Resultado
                leadId={p.leadId}
                resultado={p.canal}
                texto={p.canal === "llamada" ? "No contestó" : "Le escribí"}
                titulo={p.canal === "llamada" ? "Vuelve a esta lista en 3 días" : "Vuelve a esta lista en 3 días si no responde"}
                alAnotar={anotar}
              />
              <Resultado leadId={p.leadId} resultado="interesado" texto="Le interesa" titulo="Pasa a Negocios" alAnotar={anotar} />
              <Resultado leadId={p.leadId} resultado="no_interesa" texto="No le interesa" alAnotar={anotar} />
              <Resultado leadId={p.leadId} resultado="posponer" texto="En una semana" titulo="Vuelve a esta lista en 7 días" alAnotar={anotar} />
              {p.telefono && <Resultado leadId={p.leadId} resultado="numero_malo" texto="Número malo" alAnotar={anotar} />}
            </div>
          </div>
        )}
      </TarjetaConversacion>
    );
  };

  return (
    <Tablero>
      {COLUMNAS.map((columna) => {
        const propias = vistas.filas.filter((fila) => fila.columna === columna.clave);
        // «No contactar» solo aparece si hay alguien marcado: no es trabajo.
        if (columna.clave === "no_contactar" && propias.length === 0) return null;
        const pendientes = propias.filter((fila) => presentes.has(fila.leadId) && !hechos[fila.leadId]);
        const calientes = pendientes.filter((fila) => fila.caliente).length;
        return (
          <Columna
            key={columna.clave}
            tono={columna.tono}
            icono={columna.icono}
            titulo={columna.titulo}
            conteo={columna.clave === "no_contactar" ? propias.length : pendientes.length}
            detalle={columna.clave === "no_contactar" ? "Se ven, pero no se les escribe" : calientes > 0 ? `${calientes} muy ${calientes === 1 ? "interesado" : "interesados"}` : undefined}
            vacio={columna.vacio}
          >
            {propias.length > 0 ? propias.map(tarjeta) : null}
          </Columna>
        );
      })}
    </Tablero>
  );
}

/**
 * Qué se le mandó y qué leyó, para saber de qué hablarle antes de escribirle.
 * Plegado: es contexto para quien lo necesita, no algo que leer en cada tarjeta.
 */
function Correos({ correos, abiertos, campana }: { correos: FilaProspecto["correos"]; abiertos: number; campana: string | null }) {
  if (correos.length === 0) return null;
  return (
    <details className="group relative z-10 mt-1.5 text-xs">
      <summary className="inline-flex min-h-6 max-w-full cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
        <ChevronRight size={12} aria-hidden="true" className="flex-shrink-0 transition-transform group-open:rotate-90" />
        <span className="truncate">
          Abrió {abiertos} de {correos.length} {correos.length === 1 ? "correo" : "correos"}{campana ? ` · ${campana}` : ""}
        </span>
      </summary>
      <ul className="mt-1 space-y-1.5 rounded-lg bg-surface-muted/60 p-2">
        {correos.map((correo, i) => {
          const Icono = correo.abierto ? MailOpen : Mail;
          return (
            <li key={i} className="space-y-0.5">
              <span className={`flex items-start gap-1.5 ${correo.abierto ? "text-foreground" : "text-muted-foreground"}`}>
                <Icono size={12} aria-hidden="true" className={`mt-0.5 flex-shrink-0 ${correo.abierto ? "text-success" : ""}`} />
                {correo.asunto}
              </span>
              <span className="block pl-[18px] text-[11px] tabular-nums text-muted-foreground">
                {correo.enviado ? `enviado ${correo.enviado}` : "sin fecha de envío"}
                {correo.abierto ? ` · abierto ${correo.abierto}` : " · sin abrir"}
                {correo.clic ? " · hizo clic" : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Resultado({ leadId, resultado, texto, titulo, alAnotar }: { leadId: string; resultado: string; texto: string; titulo?: string; alAnotar: (leadId: string, resultado: string) => void }) {
  return (
    <form action={registrarToque} onSubmit={() => alAnotar(leadId, resultado)} title={titulo}>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="resultado" value={resultado} />
      <SubmitButton size="sm" variant={resultado === "interesado" ? "secondary" : "ghost"} pendingLabel="…" className="w-full">{texto}</SubmitButton>
    </form>
  );
}
