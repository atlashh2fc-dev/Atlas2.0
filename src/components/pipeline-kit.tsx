import Link from "next/link";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Camera, Mail, MessageCircle, MessagesSquare, Phone, Sparkles, StickyNote, Users, ClipboardCheck } from "lucide-react";

import { Avatar } from "@/components/ui";
import { ZONA_CLINICA, fechaEnChile } from "@/lib/citas";

/**
 * El tablero de conversaciones de Ventas (Negocios y Por contactar), al estilo
 * de las bandejas de Vambe o Kommo: cada tarjeta es una persona o empresa con
 * la última línea de lo que se habló, no una fila de planilla. Las columnas
 * llevan el tinte de su etapa sobre los tokens --tone-*, que ya cambian en
 * oscuro; por eso el color sale de color-mix y no de clases dark:.
 *
 * Sin hooks: lo usan tanto la página del pipeline (servidor) como la bandeja
 * de prospección (cliente).
 */

export type Tono = "blue" | "teal" | "green" | "amber" | "violet" | "rose" | "slate" | "indigo" | "orange" | "cyan" | "pink";
export type Canal = "whatsapp" | "instagram" | "messenger" | "correo" | "llamada" | "reunion" | "nota" | "tarea";

/** Lo último que se dijo con este cliente, ya resumido a una línea. */
export type UltimaLinea = {
  texto: string;
  canal: Canal;
  /** Instante ISO de ese mensaje o gestión. */
  at: string;
  /** "Tú", "Nota", "Llamada"…; sin prefijo cuando habla el cliente. */
  prefijo?: string | null;
  /** La IA fue la última en responder. */
  ia?: boolean;
};

type Icono = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;

const tono = (t: Tono) => `var(--tone-${t})`;

/* ------------------------------------------------------------------ */
/* Datos: la última línea y el tiempo relativo                         */
/* ------------------------------------------------------------------ */

/** Cita del correo anterior ("El lunes, Fulano escribió:" o "> …"): lo que sigue ya se leyó. */
const CORTE_DE_CITA = /\n\s*(>|-{2,}\s*Original|El .{0,120}escribi[óo]:|On .{0,120}wrote:|De: )/i;

/** Una línea legible: sin la cita del hilo, sin saltos ni espacios dobles, y con tope. */
export function recortar(texto: string | null | undefined, max = 220): string {
  if (!texto) return "";
  const sinCita = texto.split(CORTE_DE_CITA)[0] ?? texto;
  const limpio = sinCita.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
}

/** El mensaje de WhatsApp sin texto (foto, audio…) dicho en palabras. */
export function textoDeMensaje(texto: string | null | undefined, tipo: string | null | undefined): string {
  const limpio = recortar(texto);
  if (limpio) return limpio;
  const TIPOS: Record<string, string> = { image: "Envió una foto", audio: "Envió un audio", voice: "Envió un audio", video: "Envió un video", document: "Envió un documento", sticker: "Envió un sticker", location: "Compartió una ubicación", contacts: "Compartió un contacto" };
  return TIPOS[tipo ?? ""] ?? "Mensaje sin texto";
}

/** La más reciente de varias fuentes (actividad, WhatsApp, correo…). */
export function masReciente(...lineas: (UltimaLinea | null | undefined)[]): UltimaLinea | null {
  let mejor: UltimaLinea | null = null;
  for (const linea of lineas) {
    if (!linea || !linea.texto) continue;
    if (!mejor || new Date(linea.at).getTime() > new Date(mejor.at).getTime()) mejor = linea;
  }
  return mejor;
}

const horaChile = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaChile = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });
const completoChile = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Hace cuánto, como en una bandeja de chat y siempre en hora de Chile:
 * «ahora», «12 min», «14:05» (hoy), «Ayer», «3 d» y, pasada una semana, «12 sept».
 */
export function tiempoRelativo(iso: string | null | undefined, ahora: Date): { corto: string; completo: string } | null {
  if (!iso) return null;
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;
  const completo = completoChile.format(instante);
  const minutos = Math.floor((ahora.getTime() - instante.getTime()) / 60000);
  if (minutos < 1) return { corto: "ahora", completo };
  if (minutos < 60) return { corto: `${minutos} min`, completo };
  const hoy = fechaEnChile(ahora);
  const dia = fechaEnChile(instante);
  if (dia === hoy) return { corto: horaChile.format(instante), completo };
  if (dia === fechaEnChile(new Date(ahora.getTime() - 86_400_000))) return { corto: "Ayer", completo };
  const dias = Math.floor(minutos / 1440);
  if (dias < 7) return { corto: `${Math.max(dias, 2)} d`, completo };
  return { corto: diaChile.format(instante).replace(".", ""), completo };
}

/* ------------------------------------------------------------------ */
/* Columna                                                             */
/* ------------------------------------------------------------------ */

/**
 * Un carril del tablero: fondo pastel del tono de la etapa, cabecera con su
 * icono, el nombre, el conteo en una caja suave y, si aplica, el monto.
 */
export function Columna({
  tono: t,
  icono: IconoColumna,
  titulo,
  conteo,
  monto,
  detalle,
  vacio,
  children,
}: {
  tono: Tono;
  icono: Icono;
  titulo: string;
  conteo: number;
  /** El total de la columna, ya formateado. */
  monto?: ReactNode;
  detalle?: ReactNode;
  /** Qué decir cuando no hay tarjetas. */
  vacio: string;
  children?: ReactNode;
}) {
  const estilo = { "--tono": tono(t), background: "color-mix(in srgb, var(--tono) 7%, var(--surface-muted))" } as CSSProperties;
  const vacia = conteo === 0 && !children;
  return (
    <section aria-label={`${titulo}: ${conteo}`} style={estilo} className="flex w-[18.5rem] flex-shrink-0 flex-col rounded-2xl">
      <header className="flex items-start gap-2.5 px-3 pb-2.5 pt-3">
        <span
          aria-hidden="true"
          className="mt-px inline-flex size-7 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ background: "color-mix(in srgb, var(--tono) 16%, transparent)", color: "var(--tono)" }}
        >
          <IconoColumna size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[13px] font-semibold leading-5 text-foreground">{titulo}</h2>
            <span
              className={`flex-shrink-0 rounded-md px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums ${conteo > 0 ? "text-foreground" : "text-muted-foreground"}`}
              style={{ background: "color-mix(in srgb, var(--tono) 13%, var(--surface))" }}
            >
              {conteo.toLocaleString("es-CL")}
            </span>
          </div>
          {(monto || detalle) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {monto && <span className="font-semibold tabular-nums text-foreground">{monto}</span>}
              {monto && detalle ? " · " : ""}
              {detalle}
            </p>
          )}
        </div>
      </header>
      <div className="max-h-[68vh] min-h-24 space-y-2 overflow-y-auto overscroll-contain px-2 pb-2">
        {vacia ? (
          <p
            className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
            style={{ borderColor: "color-mix(in srgb, var(--tono) 28%, transparent)" }}
          >
            {vacio}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** El riel horizontal que sostiene las columnas. */
export function Tablero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`-mx-1 overflow-x-auto px-1 pb-2 ${className}`}>
      <div className="flex w-max items-start gap-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta                                                             */
/* ------------------------------------------------------------------ */

const CANAL: Record<Canal, { icono: Icono; tono: Tono; nombre: string }> = {
  whatsapp: { icono: MessageCircle, tono: "green", nombre: "WhatsApp" },
  instagram: { icono: Camera, tono: "pink", nombre: "Instagram" },
  messenger: { icono: MessagesSquare, tono: "blue", nombre: "Messenger" },
  correo: { icono: Mail, tono: "indigo", nombre: "Correo" },
  llamada: { icono: Phone, tono: "teal", nombre: "Llamada" },
  reunion: { icono: Users, tono: "violet", nombre: "Reunión" },
  nota: { icono: StickyNote, tono: "amber", nombre: "Nota" },
  tarea: { icono: ClipboardCheck, tono: "slate", nombre: "Tarea" },
};

/** El avatar con el canal de la conversación en una esquina, como en una bandeja de chat. */
export function AvatarConCanal({ nombre, canal, forma = "square" }: { nombre: string; canal?: Canal | null; forma?: "square" | "circle" }) {
  const info = canal ? CANAL[canal] : null;
  return (
    <span className="relative flex-shrink-0">
      <Avatar name={nombre} shape={forma} size="md" />
      {info && (
        <span
          title={info.nombre}
          className="absolute -bottom-1 -right-1 inline-flex size-[18px] items-center justify-center rounded-md ring-2 ring-surface-solid"
          style={{ background: `color-mix(in srgb, ${tono(info.tono)} 18%, var(--surface-solid))`, color: tono(info.tono) }}
        >
          <info.icono size={10} aria-hidden="true" />
          <span className="sr-only">{info.nombre}</span>
        </span>
      )}
    </span>
  );
}

/** «IA» en violeta suave: la IA fue la última en responder. */
export function MarcaIA() {
  return (
    <span
      title="La IA respondió el último mensaje"
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold leading-[18px]"
      style={{ background: "color-mix(in srgb, var(--tone-violet) 12%, transparent)", color: "var(--tone-violet)" }}
    >
      <Sparkles size={11} aria-hidden="true" />
      IA
    </span>
  );
}

/**
 * La tarjeta de una conversación. Toda la tarjeta lleva a la ficha (el enlace
 * del nombre se estira sobre ella); lo que va dentro y se puede tocar
 * (formularios, botones) debe ir con `relative z-10` para quedar encima.
 */
export function TarjetaConversacion({
  href,
  nombre,
  subtitulo,
  canal,
  hace,
  linea,
  atenuada = false,
  children,
}: {
  href: string;
  nombre: string;
  subtitulo?: ReactNode;
  canal?: Canal | null;
  /** Ya resuelto en el servidor, para que cliente y servidor rendericen lo mismo. */
  hace?: { corto: string; completo: string } | null;
  linea?: UltimaLinea | null;
  atenuada?: boolean;
  children?: ReactNode;
}) {
  return (
    <article
      className={`group relative rounded-xl bg-surface-solid p-3 shadow-sm ring-1 ring-border/70 transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${atenuada ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <AvatarConCanal nombre={nombre} canal={canal} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link
              href={href}
              className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-foreground after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              title={nombre}
            >
              {nombre}
            </Link>
            {hace && (
              <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground" title={hace.completo}>
                {hace.corto}
              </span>
            )}
          </div>
          {subtitulo && <div className="truncate text-xs leading-4 text-muted-foreground">{subtitulo}</div>}
        </div>
      </div>
      {linea && <LineaConversacion linea={linea} />}
      {children}
    </article>
  );
}

/** La última línea, en gris y a lo más en dos renglones. */
export function LineaConversacion({ linea }: { linea: UltimaLinea }) {
  return (
    <p className="mt-2 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground" title={linea.texto}>
      {linea.prefijo && <span className="font-medium text-foreground/75">{linea.prefijo}: </span>}
      {linea.texto}
    </p>
  );
}
