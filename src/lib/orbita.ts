import type { BadgeTone } from "@/components/ui";

/**
 * Atlas Órbita · el monitor de los agentes de marketing con IA.
 *
 * Catálogo (estados, tipos de evento, tipos de conexión), la regla que pasa
 * de un evento al estado del agente y las cuentas de la pantalla. Es puro a
 * propósito: lo usan la ruta de ingreso, la página, la red de cliente y las
 * pruebas, sin arrastrar el servidor ni zod. La validación de lo que envían
 * los agentes vive en `orbita-ingreso.ts`.
 */

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export const ESTADOS_AGENTE = ["ok", "corriendo", "error", "atrasado", "inactivo"] as const;
export type EstadoAgente = (typeof ESTADOS_AGENTE)[number];

/**
 * `color` es el del halo del nodo: la red vive sobre un fondo oscuro propio,
 * así que los colores son fijos y no cambian con el tema. El texto siempre
 * acompaña al color (no se depende solo de él).
 */
export const ESTADO_AGENTE_INFO: Record<EstadoAgente, { label: string; tone: BadgeTone; color: string; descripcion: string }> = {
  ok: { label: "Sano", tone: "success", color: "#34d399", descripcion: "Terminó su última ejecución sin problemas" },
  corriendo: { label: "Trabajando", tone: "info", color: "#38bdf8", descripcion: "Está ejecutando su turno ahora" },
  error: { label: "Con error", tone: "danger", color: "#f87171", descripcion: "Su última ejecución falló" },
  atrasado: { label: "Atrasado", tone: "warning", color: "#fbbf24", descripcion: "No corrió a su hora" },
  inactivo: { label: "Inactivo", tone: "neutral", color: "#64748b", descripcion: "Todavía sin actividad" },
};

export const TIPOS_EVENTO = ["inicio", "fin", "error", "decision", "alerta", "recuperacion", "pulso", "tarea"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const TIPO_EVENTO_INFO: Record<TipoEvento, { label: string; tone: BadgeTone }> = {
  inicio: { label: "Inició", tone: "info" },
  fin: { label: "Terminó", tone: "success" },
  error: { label: "Error", tone: "danger" },
  decision: { label: "Decisión", tone: "info" },
  alerta: { label: "Alerta", tone: "warning" },
  recuperacion: { label: "Recuperación", tone: "success" },
  pulso: { label: "Latido", tone: "neutral" },
  tarea: { label: "Tarea", tone: "neutral" },
};

export const TIPOS_CONEXION = ["datos", "ordena", "reporta", "vigila"] as const;
export type TipoConexion = (typeof TIPOS_CONEXION)[number];

/** Cómo se lee la conexión desde quien la tiene ("Ordena a 3 · Producto en acción"). */
export const TIPO_CONEXION_INFO: Record<TipoConexion, { label: string; verbo: string; inverso: string; color: string }> = {
  ordena: { label: "Ordena", verbo: "Ordena a", inverso: "Recibe órdenes de", color: "#a78bfa" },
  datos: { label: "Datos", verbo: "Envía datos a", inverso: "Recibe datos de", color: "#22d3ee" },
  reporta: { label: "Reporta", verbo: "Reporta a", inverso: "Recibe reportes de", color: "#34d399" },
  vigila: { label: "Vigila", verbo: "Vigila a", inverso: "Vigilado por", color: "#94a3b8" },
};

/** Código del CEO de marketing: el centro de la red. */
export const CODIGO_CEO = "0";
/** `"a": "*"` en una conexión = con todos los agentes (el Guardián vigila a todos). */
export const TODOS = "*";

export type ConexionAgente = { a: string; tipo: TipoConexion; etiqueta?: string | null };

export type AgenteOrbita = {
  id: string;
  codigo: string;
  nombre: string;
  rol: string | null;
  descripcion: string | null;
  horario: string | null;
  cron: string | null;
  color: string | null;
  conexiones: ConexionAgente[];
  ultimo_estado: EstadoAgente;
  ultimo_evento_at: string | null;
  ultimo_resumen: string | null;
};

export type EventoOrbita = {
  id: string;
  agente_codigo: string;
  tipo: TipoEvento;
  estado: EstadoAgente | null;
  resumen: string | null;
  detalle: Record<string, unknown>;
  relacionado_con: string | null;
  ocurrido_at: string;
};

export const COLUMNAS_AGENTE =
  "id, codigo, nombre, rol, descripcion, horario, cron, color, conexiones, ultimo_estado, ultimo_evento_at, ultimo_resumen";
export const COLUMNAS_EVENTO = "id, agente_codigo, tipo, estado, resumen, detalle, relacionado_con, ocurrido_at";

export const enLista = <T extends string>(lista: readonly T[], valor: unknown): valor is T =>
  typeof valor === "string" && (lista as readonly string[]).includes(valor);

/** Color de identidad del agente, con un respaldo estable si no trae uno. */
const PALETA_RESPALDO = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fb923c", "#22d3ee", "#facc15", "#818cf8"];
export function colorDelAgente(agente: Pick<AgenteOrbita, "codigo" | "color">): string {
  if (agente.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(agente.color)) return agente.color;
  let suma = 0;
  for (const letra of agente.codigo) suma += letra.charCodeAt(0);
  return PALETA_RESPALDO[suma % PALETA_RESPALDO.length];
}

/** Lo que llega de la base: conexiones mal formadas no rompen la red, se ignoran. */
export function conexionesValidas(valor: unknown): ConexionAgente[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { a, tipo, etiqueta } = item as Record<string, unknown>;
    if (typeof a !== "string" || !a || !enLista(TIPOS_CONEXION, tipo)) return [];
    return [{ a, tipo, etiqueta: typeof etiqueta === "string" ? etiqueta : null }];
  });
}

// ---------------------------------------------------------------------------
// Del evento al estado del agente
// ---------------------------------------------------------------------------

export type EventoParaEstado = {
  agente: string;
  tipo: TipoEvento;
  estado?: EstadoAgente | null;
  resumen?: string | null;
  relacionado_con?: string | null;
  /** ISO 8601. */
  ocurrido_at: string;
};

export type EfectoDeEvento = { codigo: string; estado: EstadoAgente | null; esDelAgente: boolean };

/**
 * Qué agente cambia de estado con un evento, y a cuál.
 *
 * - inicio → el agente queda "corriendo".
 * - fin → el estado que diga el evento, o "ok".
 * - error → "error".
 * - recuperacion → "corriendo". Si trae `relacionado_con`, el recuperado es
 *   ese otro agente (el Guardián envía `{agente: "G", relacionado_con: "5"}`);
 *   si no, es el propio agente que volvió.
 * - alerta con estado y `relacionado_con` → el estado es del otro agente (el
 *   Guardián marca al 3 como "atrasado"); sin `relacionado_con`, es propio.
 * - decision, pulso, tarea → solo cambian el estado si el evento trae uno.
 *
 * El agente que envía el evento siempre registra su última actividad, aunque
 * su estado no cambie (`estado: null`).
 */
export function efectosDelEvento(evento: Pick<EventoParaEstado, "agente" | "tipo" | "estado" | "relacionado_con">): EfectoDeEvento[] {
  const propio = (estado: EstadoAgente | null): EfectoDeEvento => ({ codigo: evento.agente, estado, esDelAgente: true });
  const otro = evento.relacionado_con && evento.relacionado_con !== evento.agente ? evento.relacionado_con : null;
  const estado = evento.estado ?? null;

  switch (evento.tipo) {
    case "inicio":
      return [propio("corriendo")];
    case "fin":
      return [propio(estado ?? "ok")];
    case "error":
      return [propio("error")];
    case "recuperacion":
      return otro ? [propio(null), { codigo: otro, estado: "corriendo", esDelAgente: false }] : [propio("corriendo")];
    case "alerta":
      if (otro && estado) return [propio(null), { codigo: otro, estado, esDelAgente: false }];
      return [propio(estado)];
    default:
      return [propio(estado)];
  }
}

export type AgenteParaEstado = { codigo: string; ultimo_evento_at: string | null };

export type CambioDeAgente = {
  ultimo_estado?: EstadoAgente;
  ultimo_evento_at?: string;
  ultimo_resumen?: string | null;
};

/**
 * Los cambios a guardar en cada agente después de un lote de eventos.
 *
 * Se aplican en orden de `ocurrido_at`. Un evento más viejo que la última
 * actividad que ya tenía el agente (un reenvío, un relleno de ayer) se guarda
 * en la bitácora pero no le cambia el estado: lo que pasó antes no puede tapar
 * lo que pasó después.
 */
export function cambiosTrasEventos(agentes: readonly AgenteParaEstado[], eventos: readonly EventoParaEstado[]): Map<string, CambioDeAgente> {
  const ultimo = new Map<string, number>(
    agentes.map((agente) => [agente.codigo, agente.ultimo_evento_at ? Date.parse(agente.ultimo_evento_at) : Number.NEGATIVE_INFINITY]),
  );
  const cambios = new Map<string, CambioDeAgente>();
  const ordenados = [...eventos].sort((a, b) => Date.parse(a.ocurrido_at) - Date.parse(b.ocurrido_at));

  for (const evento of ordenados) {
    const instante = Date.parse(evento.ocurrido_at);
    if (Number.isNaN(instante)) continue;
    for (const efecto of efectosDelEvento(evento)) {
      const previo = ultimo.get(efecto.codigo);
      if (previo === undefined || instante < previo) continue;
      const cambio = cambios.get(efecto.codigo) ?? {};
      if (efecto.estado) cambio.ultimo_estado = efecto.estado;
      if (efecto.esDelAgente) {
        cambio.ultimo_evento_at = new Date(instante).toISOString();
        ultimo.set(efecto.codigo, instante);
        if (evento.resumen) cambio.ultimo_resumen = evento.resumen;
      }
      if (Object.keys(cambio).length > 0) cambios.set(efecto.codigo, cambio);
    }
  }
  return cambios;
}

// ---------------------------------------------------------------------------
// La red: posiciones y aristas
// ---------------------------------------------------------------------------

export const LIENZO = { ancho: 1000, alto: 660 } as const;
export const CENTRO_DE_LA_RED = { x: LIENZO.ancho / 2, y: 318 };
const CENTRO = CENTRO_DE_LA_RED;
export const ANILLO_INTERNO = { rx: 200, ry: 148 };
export const ANILLO_EXTERNO = { rx: 410, ry: 238 };

export type NodoDeLaRed = { codigo: string; x: number; y: number; r: number; anillo: 0 | 1 | 2 };

/** Los que publican: el anillo interno, alrededor del CEO. */
const PUBLICAN = new Set(["1", "2", "3", "4", "5"]);
/** Orden del anillo externo: arriba a la derecha y en sentido horario, siguiendo el ciclo del día. */
const ORDEN_EXTERNO = ["8", "7", "6", "9", "G"];

function enAnillo(codigos: string[], radio: { rx: number; ry: number }, desfase: number): Map<string, { x: number; y: number }> {
  const puntos = new Map<string, { x: number; y: number }>();
  codigos.forEach((codigo, i) => {
    const angulo = desfase + (2 * Math.PI * i) / Math.max(codigos.length, 1);
    puntos.set(codigo, { x: CENTRO.x + radio.rx * Math.cos(angulo), y: CENTRO.y + radio.ry * Math.sin(angulo) });
  });
  return puntos;
}

const porCodigo = (a: string, b: string) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.localeCompare(b);
};

/**
 * El CEO al centro, los que publican (1-5) en el anillo interno y el resto
 * (monitor, líder, inteligencia, productor, guardián…) en el externo, que es
 * la órbita. Sirve para cualquier empresa: sin CEO, el centro queda vacío;
 * códigos nuevos se suman al anillo externo.
 */
export function posicionesDeLaRed(codigos: readonly string[]): Map<string, NodoDeLaRed> {
  const nodos = new Map<string, NodoDeLaRed>();
  const unicos = [...new Set(codigos)];
  if (unicos.includes(CODIGO_CEO)) nodos.set(CODIGO_CEO, { codigo: CODIGO_CEO, ...CENTRO, r: 44, anillo: 0 });

  const internos = unicos.filter((codigo) => PUBLICAN.has(codigo)).sort(porCodigo);
  for (const [codigo, punto] of enAnillo(internos, ANILLO_INTERNO, -Math.PI / 2)) {
    nodos.set(codigo, { codigo, ...punto, r: 31, anillo: 1 });
  }

  const externos = unicos
    .filter((codigo) => codigo !== CODIGO_CEO && !PUBLICAN.has(codigo))
    .sort((a, b) => {
      const ia = ORDEN_EXTERNO.indexOf(a);
      const ib = ORDEN_EXTERNO.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return porCodigo(a, b);
    });
  // Entre los del anillo interno, para que ninguna línea pase por encima de un nodo.
  for (const [codigo, punto] of enAnillo(externos, ANILLO_EXTERNO, -Math.PI / 2 + Math.PI / Math.max(externos.length, 1))) {
    nodos.set(codigo, { codigo, ...punto, r: 29, anillo: 2 });
  }
  return nodos;
}

export type AristaDeLaRed = { id: string; de: string; a: string; tipo: TipoConexion; etiqueta: string | null };

/**
 * Las conexiones declaradas, como aristas con dirección. `"a": "*"` se abre a
 * todos los demás agentes; las que apuntan a un código que no existe se
 * descartan. Una misma pareja y tipo se dibuja una sola vez.
 */
export function aristasDeLaRed(agentes: readonly Pick<AgenteOrbita, "codigo" | "conexiones">[]): AristaDeLaRed[] {
  const codigos = new Set(agentes.map((agente) => agente.codigo));
  const vistas = new Set<string>();
  const aristas: AristaDeLaRed[] = [];
  for (const agente of agentes) {
    for (const conexion of conexionesValidas(agente.conexiones)) {
      const destinos = conexion.a === TODOS ? [...codigos].filter((codigo) => codigo !== agente.codigo) : [conexion.a];
      for (const destino of destinos) {
        if (!codigos.has(destino) || destino === agente.codigo) continue;
        const id = `${agente.codigo}>${destino}:${conexion.tipo}`;
        if (vistas.has(id)) continue;
        vistas.add(id);
        aristas.push({ id, de: agente.codigo, a: destino, tipo: conexion.tipo, etiqueta: conexion.etiqueta ?? null });
      }
    }
  }
  return aristas;
}

/** Curva suave de un nodo a otro, que nace y muere en el borde de cada círculo. */
export function trazoEntre(de: NodoDeLaRed, a: NodoDeLaRed, curvatura = 0.14): { d: string; largo: number } {
  const dx = a.x - de.x;
  const dy = a.y - de.y;
  const largo = Math.hypot(dx, dy) || 1;
  const ux = dx / largo;
  const uy = dy / largo;
  // La flecha necesita aire: se corta un poco antes del borde del destino.
  const inicio = { x: de.x + ux * (de.r + 4), y: de.y + uy * (de.r + 4) };
  const fin = { x: a.x - ux * (a.r + 9), y: a.y - uy * (a.r + 9) };
  const medio = { x: (inicio.x + fin.x) / 2 - uy * largo * curvatura, y: (inicio.y + fin.y) / 2 + ux * largo * curvatura };
  const r = (n: number) => Math.round(n * 10) / 10;
  return { d: `M${r(inicio.x)},${r(inicio.y)} Q${r(medio.x)},${r(medio.y)} ${r(fin.x)},${r(fin.y)}`, largo };
}

/** Eventos con destino ocurridos en la ventana: los pulsos que viajan por la red. */
export const VENTANA_PULSOS_MS = 10 * 60 * 1000;

export function pulsosRecientes<T extends Pick<EventoOrbita, "relacionado_con" | "agente_codigo" | "ocurrido_at">>(
  eventos: readonly T[],
  ahora: number,
  ventana = VENTANA_PULSOS_MS,
): T[] {
  return eventos.filter((evento) => {
    if (!evento.relacionado_con || evento.relacionado_con === evento.agente_codigo) return false;
    const instante = Date.parse(evento.ocurrido_at);
    return Number.isFinite(instante) && ahora - instante <= ventana && instante - ahora <= 60_000;
  });
}

// ---------------------------------------------------------------------------
// Cifras
// ---------------------------------------------------------------------------

export type ConteosOrbita = {
  fin24: number;
  error24: number;
  fin7: number;
  /** Fines que el agente marcó con estado "error". */
  finConError7: number;
  error7: number;
  recuperaciones7: number;
  decisionesCeo7: number;
};

export type ResumenOrbita = {
  total: number;
  sanos: number;
  porEstado: Record<EstadoAgente, number>;
  ejecuciones24: number;
  fallidas24: number;
  /** 0–100, o null si en 7 días no terminó ninguna ejecución. */
  tasaExito7: number | null;
  ejecuciones7: number;
  recuperaciones7: number;
  decisionesCeo7: number;
};

/**
 * Una ejecución termina con un evento `fin` (bien, o con el estado que diga)
 * o con un `error`. Un agente sano está "ok" o "corriendo".
 */
export function resumenDeOrbita(agentes: readonly Pick<AgenteOrbita, "ultimo_estado">[], conteos: ConteosOrbita): ResumenOrbita {
  const porEstado = Object.fromEntries(ESTADOS_AGENTE.map((estado) => [estado, 0])) as Record<EstadoAgente, number>;
  for (const agente of agentes) porEstado[enLista(ESTADOS_AGENTE, agente.ultimo_estado) ? agente.ultimo_estado : "inactivo"] += 1;
  const ejecuciones7 = conteos.fin7 + conteos.error7;
  const exitosas7 = Math.max(0, conteos.fin7 - conteos.finConError7);
  return {
    total: agentes.length,
    sanos: porEstado.ok + porEstado.corriendo,
    porEstado,
    ejecuciones24: conteos.fin24 + conteos.error24,
    fallidas24: conteos.error24,
    tasaExito7: ejecuciones7 > 0 ? Math.round((exitosas7 / ejecuciones7) * 1000) / 10 : null,
    ejecuciones7,
    recuperaciones7: conteos.recuperaciones7,
    decisionesCeo7: conteos.decisionesCeo7,
  };
}

// ---------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------

/** "hace un momento", "hace 3 min", "hace 2 h", "hace 4 d". */
export function haceCuanto(iso: string | null | undefined, ahora: number): string {
  if (!iso) return "sin actividad";
  const instante = Date.parse(iso);
  if (Number.isNaN(instante)) return "sin actividad";
  const segundos = Math.round((ahora - instante) / 1000);
  if (segundos < -60) return "programado";
  if (segundos < 45) return "hace un momento";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} d`;
}

/** "03-10 21:15" en hora de Chile, para el título de cada hora relativa. */
export function horaExacta(iso: string): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return iso;
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instante);
}
