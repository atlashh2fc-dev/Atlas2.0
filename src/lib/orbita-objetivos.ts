/**
 * Órbita · objetivos con evidencia.
 *
 * Responde la pregunta de quien dirige: ¿se cumplió lo que pedí? Por día,
 * semana y mes, cada objetivo muestra la meta, lo hecho (contado desde su
 * fuente, no desde lo que el agente dice), lo que falló y la evidencia que
 * respalda la cifra. Y aparte, el circuito de aprendizaje: qué falló, qué se
 * reintentó y qué se decidió cambiar.
 *
 * Reglas para que no haya humo:
 * - Una publicación en un grupo cuenta cuando quedó visible. "En espera de
 *   aprobación" y "eliminada por el grupo" se muestran, pero no suman.
 * - Los turnos del plan (`plan-…`) no son publicaciones: no se cuentan.
 * - Sin datos no es cero: si la fuente no respondió, se dice.
 * - La meta corre desde el día en que se pidió; antes de eso no hay deuda.
 *
 * Puro a propósito: recibe filas ya leídas y devuelve lo que se dibuja.
 */

import type { TipoEvento } from "./orbita.ts";

// ---------------------------------------------------------------------------
// Periodos y días en hora de Chile
// ---------------------------------------------------------------------------

export const PERIODOS = ["hoy", "semana", "mes"] as const;
export type Periodo = (typeof PERIODOS)[number];

export const PERIODO_INFO: Record<Periodo, { label: string; dias: number; frase: string }> = {
  hoy: { label: "Hoy", dias: 1, frase: "hoy" },
  semana: { label: "Semana", dias: 7, frase: "en los últimos 7 días" },
  mes: { label: "Mes", dias: 30, frase: "en los últimos 30 días" },
};

export function periodoValido(valor: unknown): Periodo {
  return typeof valor === "string" && (PERIODOS as readonly string[]).includes(valor) ? (valor as Periodo) : "hoy";
}

const ZONA = "America/Santiago";
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-10-04": el día en Chile de un instante. */
export function diaDeChile(instante: Date | string | number): string {
  const fecha = instante instanceof Date ? instante : new Date(instante);
  return formatoDia.format(fecha);
}

/** Minutos que Chile está detrás de UTC en ese instante (180 o 240). */
function desfaseChile(instante: number): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(instante))
      .map((parte) => [parte.type, parte.value]),
  );
  const comoUtc = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute));
  return Math.round((instante - comoUtc) / 60000);
}

/** El instante en que empieza ese día en Chile (00:00). */
export function inicioDelDiaChile(dia: string): Date {
  const [anio, mes, d] = dia.split("-").map(Number);
  const medianocheUtc = Date.UTC(anio, mes - 1, d);
  return new Date(medianocheUtc + desfaseChile(medianocheUtc + 12 * 3600_000) * 60000);
}

/** Suma días a "AAAA-MM-DD" (calendario, sin zona). */
export function sumarDias(dia: string, cuantos: number): string {
  const [anio, mes, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, d + cuantos)).toISOString().slice(0, 10);
}

/** Los días del periodo, del más antiguo a hoy. */
export function diasDelPeriodo(periodo: Periodo, ahora: Date): string[] {
  const hoy = diaDeChile(ahora);
  const n = PERIODO_INFO[periodo].dias;
  return Array.from({ length: n }, (_, i) => sumarDias(hoy, i - n + 1));
}

/** Lunes a viernes (el correo comercial no sale el fin de semana). */
export function esDiaHabil(dia: string): boolean {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana >= 1 && semana <= 5;
}

/** "lun 04-10". */
export function etiquetaDia(dia: string): string {
  const fecha = new Date(`${dia}T12:00:00Z`);
  const semana = new Intl.DateTimeFormat("es-CL", { weekday: "short", timeZone: "UTC" }).format(fecha).replace(".", "");
  return `${semana} ${dia.slice(8, 10)}-${dia.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------
// Lo que pidió quien dirige (metas)
// ---------------------------------------------------------------------------

/**
 * Las metas de Altius. `desde` es el día en que se pidieron: antes no hay
 * deuda. Cambiarlas acá cambia el tablero y el cálculo de cumplimiento.
 */
export const METAS = {
  /** Publicaciones visibles en grupos de Facebook distintos, por día (Hugo, 04-10). */
  grupos: { diaria: 20, desde: "2026-10-03" },
  /** Piezas por agente que publica (1 a 5), cada una en un grupo distinto. */
  porAgente: { diaria: 5, desde: "2026-10-04", agentes: ["1", "2", "3", "4", "5"] },
  /** Empresas de la base que seguimos en Facebook o Instagram, por día (Agente 4). */
  seguidos: { diaria: 15, desde: "2026-10-03" },
  /** Grupos activos donde la Página puede publicar (25 = 5 agentes × 5). */
  gruposActivos: { total: 25 },
  /** Correo comercial: el cupo diario de envío, de lunes a viernes. */
  correo: { diariaPorDefecto: 90 },
} as const;

// ---------------------------------------------------------------------------
// Entradas (filas ya leídas)
// ---------------------------------------------------------------------------

export type PiezaLeida = {
  channel: string;
  status: string;
  agent: string | null;
  title: string;
  target: string | null;
  body: string | null;
  external_id: string | null;
  external_url: string | null;
  scheduled_at: string | null;
  published_at: string | null;
};

export type MetricaLeida = {
  dia: string;
  metrica: string;
  agente_codigo: string | null;
  valor: number;
  evidencia: unknown;
  updated_at?: string | null;
};

export type EventoLeido = {
  agente_codigo: string;
  tipo: TipoEvento | string;
  estado: string | null;
  resumen: string | null;
  relacionado_con: string | null;
  ocurrido_at: string;
};

export type CorreoDia = {
  dia: string;
  enviados: number;
  fallidos: number;
  abrieron: number;
  clics: number;
  rebotes: number;
  respuestas: number;
  bajas: number;
};

export type CorreoLeido = {
  cupo: number | null;
  porDia: CorreoDia[];
  respuestas: { empresa: string | null; recibida_at: string | null; intencion: string | null }[];
} | null;

export type AgenteLeido = { codigo: string; nombre: string; persona: string | null; ultimo_resumen: string | null };

// ---------------------------------------------------------------------------
// Salidas
// ---------------------------------------------------------------------------

export type Tono = "good" | "warn" | "danger" | "default";
export type EstadoObjetivo = "cumplido" | "en_curso" | "bajo_meta" | "no_aplica" | "sin_datos";

export const ESTADO_OBJETIVO_INFO: Record<EstadoObjetivo, { label: string; tono: Tono }> = {
  cumplido: { label: "Cumplido", tono: "good" },
  en_curso: { label: "En curso", tono: "warn" },
  bajo_meta: { label: "Bajo la meta", tono: "danger" },
  no_aplica: { label: "No aplica hoy", tono: "default" },
  sin_datos: { label: "Sin datos", tono: "default" },
};

export type Evidencia = {
  /** Día en Chile o instante ISO. */
  cuando: string | null;
  texto: string;
  detalle?: string | null;
  url?: string | null;
  estado: string;
  tono: Tono;
};

export type DiaDeObjetivo = { dia: string; hecho: number; meta: number };

export type Objetivo = {
  id: "grupos" | "correo" | "seguidos" | "grupos_activos";
  titulo: string;
  /** Quién lo hace ("Agentes 1 a 5"). */
  responsable: string;
  /** Cómo se cuenta, en una frase. */
  comoSeMide: string;
  fuente: string;
  hecho: number | null;
  meta: number | null;
  unidad: string;
  estado: EstadoObjetivo;
  /** Por qué no hay datos o una advertencia sobre la cifra. */
  nota?: string | null;
  desglose: { label: string; valor: number; tono?: Tono }[];
  /** Qué muestran las barras por día. */
  serie: string;
  porDia: DiaDeObjetivo[];
  evidencia: Evidencia[];
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const enRango = (dia: string, dias: readonly string[]) => dias.length > 0 && dia >= dias[0] && dia <= dias[dias.length - 1];

function metaDelDia(dia: string, diaria: number, desde: string, soloHabiles = false): number {
  if (dia < desde) return 0;
  if (soloHabiles && !esDiaHabil(dia)) return 0;
  return diaria;
}

function estadoDe(hecho: number | null, meta: number | null, periodo: Periodo): EstadoObjetivo {
  if (hecho === null) return "sin_datos";
  if (meta === null || meta === 0) return hecho > 0 ? "cumplido" : "sin_datos";
  if (hecho >= meta) return "cumplido";
  return periodo === "hoy" ? "en_curso" : "bajo_meta";
}

/** "Agente 3 · Producto en acción" → "3". */
export function codigoDesdeAgente(agente: string | null | undefined): string | null {
  const encontrado = agente?.match(/agente\s+([0-9a-z]+)/i);
  return encontrado ? encontrado[1].toUpperCase() : null;
}

function evidenciaValida(valor: unknown): { texto: string; url: string | null; estado: string | null }[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((pieza) => {
    if (!pieza || typeof pieza !== "object") return [];
    const { texto, url, estado } = pieza as Record<string, unknown>;
    if (typeof texto !== "string" || !texto.trim()) return [];
    return [{ texto: texto.trim(), url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null, estado: typeof estado === "string" ? estado : null }];
  });
}

const suma = (valores: number[]) => valores.reduce((total, valor) => total + valor, 0);

// ---------------------------------------------------------------------------
// Publicaciones en grupos
// ---------------------------------------------------------------------------

/** Las piezas que son publicaciones reales en un grupo (no los turnos del plan). */
export function esPublicacionDeGrupo(pieza: Pick<PiezaLeida, "channel" | "external_id">): boolean {
  return pieza.channel === "facebook_grupo" && !(pieza.external_id ?? "").startsWith("plan-");
}

type ClaseDePublicacion = "visible" | "espera" | "fallida" | "futura";

/** Visible, en espera de aprobación, fallida (eliminada, omitida, bloqueada) o aún por publicar. */
export function claseDePublicacion(pieza: Pick<PiezaLeida, "status" | "scheduled_at">, ahora: Date): ClaseDePublicacion {
  if (pieza.status === "publicado") return "visible";
  if (pieza.status === "fallido") return "fallida";
  const cuando = pieza.scheduled_at ? Date.parse(pieza.scheduled_at) : NaN;
  if (pieza.status === "programado" && !Number.isNaN(cuando) && cuando <= ahora.getTime()) return "espera";
  return "futura";
}

function objetivoGrupos(piezas: readonly PiezaLeida[], dias: readonly string[], periodo: Periodo, ahora: Date, metaDiaria: number): Objetivo {
  const publicaciones = piezas
    .filter(esPublicacionDeGrupo)
    .map((pieza) => ({ pieza, dia: pieza.scheduled_at ? diaDeChile(pieza.scheduled_at) : null, clase: claseDePublicacion(pieza, ahora) }))
    .filter((p): p is typeof p & { dia: string } => p.dia !== null && enRango(p.dia, dias) && p.clase !== "futura");

  const porDia = dias.map((dia) => ({
    dia,
    hecho: publicaciones.filter((p) => p.dia === dia && p.clase === "visible").length,
    meta: metaDelDia(dia, metaDiaria, METAS.grupos.desde),
  }));
  const visibles = publicaciones.filter((p) => p.clase === "visible").length;
  const espera = publicaciones.filter((p) => p.clase === "espera").length;
  const fallidas = publicaciones.filter((p) => p.clase === "fallida").length;
  const meta = suma(porDia.map((d) => d.meta));

  const evidencia: Evidencia[] = publicaciones
    .sort((a, b) => Date.parse(b.pieza.scheduled_at ?? "") - Date.parse(a.pieza.scheduled_at ?? ""))
    .map(({ pieza, clase }) => ({
      cuando: pieza.scheduled_at,
      texto: pieza.target ?? "Grupo sin nombre",
      detalle: [pieza.agent, pieza.title, clase === "fallida" ? pieza.body : null].filter(Boolean).join(" · ") || null,
      url: pieza.external_url,
      estado: clase === "visible" ? "Visible" : clase === "espera" ? "En espera de aprobación" : "Falló o fue eliminada",
      tono: clase === "visible" ? "good" : clase === "espera" ? "warn" : "danger",
    }));

  return {
    id: "grupos",
    titulo: "Publicaciones visibles en grupos",
    responsable: "Agentes 1 a 5",
    comoSeMide: "Solo cuenta la publicación que quedó visible en el grupo. Las que esperan aprobación o el grupo eliminó se muestran aparte.",
    fuente: "Registro de publicaciones de los agentes, verificado por el Monitor (agente 6)",
    hecho: visibles,
    meta,
    unidad: "publicaciones",
    serie: "Visibles por día",
    estado: estadoDe(visibles, meta, periodo),
    nota: publicaciones.length === 0 ? "Ninguna publicación registrada en el periodo." : null,
    desglose: [
      { label: "Intentadas", valor: publicaciones.length },
      { label: "En espera de aprobación", valor: espera, tono: espera > 0 ? "warn" : undefined },
      { label: "Fallidas o eliminadas", valor: fallidas, tono: fallidas > 0 ? "danger" : undefined },
    ],
    porDia,
    evidencia,
  };
}

// ---------------------------------------------------------------------------
// Correo
// ---------------------------------------------------------------------------

function objetivoCorreo(correo: CorreoLeido, correoError: string | null, dias: readonly string[], periodo: Periodo): Objetivo {
  const base = {
    id: "correo" as const,
    titulo: "Correos enviados",
    responsable: "Atlas Lead (cerebro de marketing)",
    comoSeMide: "Correos entregados al servidor de envío, de lunes a viernes, contra el cupo diario. Abajo, lo que volvió.",
    fuente: "Atlas Lead, envío por Resend",
    unidad: "correos",
    serie: "Enviados por día",
  };
  if (!correo) {
    return {
      ...base,
      hecho: null,
      meta: null,
      estado: "sin_datos",
      nota: `Sin datos de correo: ${correoError ?? "Atlas Lead no respondió"}.`,
      desglose: [],
      porDia: dias.map((dia) => ({ dia, hecho: 0, meta: 0 })),
      evidencia: [],
    };
  }
  const cupo = correo.cupo ?? METAS.correo.diariaPorDefecto;
  const delPeriodo = correo.porDia.filter((d) => enRango(d.dia, dias));
  // Atlas Lead todavía sin la serie por día (versión anterior): se dice, no se inventa.
  if (correo.porDia.length === 0) {
    return { ...base, hecho: null, meta: null, estado: "sin_datos", nota: "Atlas Lead todavía no entrega el envío por día.", desglose: [], porDia: [], evidencia: [] };
  }
  const porFecha = new Map(delPeriodo.map((d) => [d.dia, d]));
  const porDia = dias.map((dia) => ({ dia, hecho: porFecha.get(dia)?.enviados ?? 0, meta: metaDelDia(dia, cupo, "0000-00-00", true) }));
  const total = (clave: keyof Omit<CorreoDia, "dia">) => suma(delPeriodo.map((d) => d[clave] ?? 0));
  const enviados = total("enviados");
  const meta = suma(porDia.map((d) => d.meta));

  const evidencia: Evidencia[] = [
    ...correo.respuestas
      .filter((r) => r.recibida_at && enRango(diaDeChile(r.recibida_at), dias))
      .map((r) => ({
        cuando: r.recibida_at,
        texto: r.empresa ?? "Empresa sin nombre",
        detalle: r.intencion ? `Intención: ${r.intencion}` : null,
        estado: "Respondió",
        tono: "good" as Tono,
      })),
    ...[...delPeriodo]
      .reverse()
      .filter((d) => d.enviados + d.fallidos + d.abrieron + d.clics + d.respuestas > 0)
      .map((d) => ({
        cuando: d.dia,
        texto: `${d.enviados.toLocaleString("es-CL")} enviados${esDiaHabil(d.dia) ? ` de ${cupo}` : " (fin de semana)"}`,
        detalle: `${d.abrieron} aperturas · ${d.clics} clics · ${d.respuestas} respuestas · ${d.bajas} bajas · ${d.rebotes} rebotes${d.fallidos ? ` · ${d.fallidos} fallidos` : ""}`,
        estado: !esDiaHabil(d.dia) ? "Fin de semana" : d.enviados >= cupo ? "Cupo cumplido" : "Bajo el cupo",
        tono: (!esDiaHabil(d.dia) ? "default" : d.enviados >= cupo ? "good" : "warn") as Tono,
      })),
  ];

  return {
    ...base,
    hecho: enviados,
    meta,
    estado: meta === 0 && periodo === "hoy" && enviados === 0 ? "no_aplica" : estadoDe(enviados, meta, periodo),
    nota: meta === 0 && periodo === "hoy" ? "Hoy no es día hábil: el correo comercial no sale." : null,
    desglose: [
      { label: "Aperturas", valor: total("abrieron") },
      { label: "Clics", valor: total("clics") },
      { label: "Respuestas", valor: total("respuestas"), tono: total("respuestas") > 0 ? "good" : undefined },
      { label: "Bajas", valor: total("bajas") },
      { label: "Rebotes y fallidos", valor: total("rebotes") + total("fallidos"), tono: total("rebotes") + total("fallidos") > 0 ? "warn" : undefined },
    ],
    porDia,
    evidencia,
  };
}

// ---------------------------------------------------------------------------
// Métricas que envían los agentes (seguidos, grupos)
// ---------------------------------------------------------------------------

function valorDe(metricas: readonly MetricaLeida[], metrica: string, dia: string): number | null {
  const fila = metricas.find((m) => m.metrica === metrica && m.dia === dia);
  return fila ? Number(fila.valor) || 0 : null;
}

function objetivoSeguidos(metricas: readonly MetricaLeida[], dias: readonly string[], periodo: Periodo): Objetivo {
  const propias = metricas.filter((m) => enRango(m.dia, dias));
  const hayDatos = propias.some((m) => m.metrica === "empresas_seguidas" || m.metrica === "seguir_revisadas");
  const porDia = dias.map((dia) => ({ dia, hecho: valorDe(propias, "empresas_seguidas", dia) ?? 0, meta: metaDelDia(dia, METAS.seguidos.diaria, METAS.seguidos.desde) }));
  const seguidas = suma(porDia.map((d) => d.hecho));
  const meta = suma(porDia.map((d) => d.meta));
  const total = (metrica: string) => suma(dias.map((dia) => valorDe(propias, metrica, dia) ?? 0));
  const revisadas = total("seguir_revisadas");

  const evidencia: Evidencia[] = propias
    .filter((m) => m.metrica === "empresas_seguidas" || m.metrica === "seguir_sin_coincidencia")
    .sort((a, b) => b.dia.localeCompare(a.dia))
    .flatMap((m) =>
      evidenciaValida(m.evidencia).map((pieza) => ({
        cuando: m.dia,
        texto: pieza.texto,
        detalle: pieza.estado,
        url: pieza.url,
        estado: m.metrica === "empresas_seguidas" ? "Seguida" : "Sin coincidencia clara",
        tono: (m.metrica === "empresas_seguidas" ? "good" : "default") as Tono,
      })),
    );

  return {
    id: "seguidos",
    titulo: "Empresas nuevas que seguimos",
    responsable: "Agente 4 · Comunidad",
    comoSeMide: "Negocios de la base de correo que la Página empezó a seguir en Facebook o Instagram, confirmados con «Siguiendo».",
    fuente: "Lista de seguimiento del Agente 4",
    hecho: hayDatos ? seguidas : null,
    meta,
    unidad: "empresas",
    serie: "Seguidas por día",
    estado: hayDatos ? estadoDe(seguidas, meta, periodo) : "sin_datos",
    nota: hayDatos
      ? revisadas > 0 && seguidas / revisadas < 0.2
        ? `Solo ${seguidas} de ${revisadas} revisadas tuvo coincidencia clara: la lista necesita nombre de fantasía o enlace de FB/IG.`
        : null
      : "El Agente 4 todavía no envía su conteo diario a Atlas.",
    desglose: [
      { label: "Revisadas", valor: revisadas },
      { label: "En Facebook", valor: total("seguidos_fb") },
      { label: "En Instagram", valor: total("seguidos_ig") },
      { label: "Sin coincidencia", valor: total("seguir_sin_coincidencia") },
    ],
    porDia,
    evidencia,
  };
}

function objetivoGruposActivos(metricas: readonly MetricaLeida[], dias: readonly string[]): Objetivo {
  const propias = metricas.filter((m) => enRango(m.dia, dias));
  // Los activos son una foto: vale la del día más reciente que llegó.
  const foto = [...metricas].filter((m) => m.metrica === "grupos_activos").sort((a, b) => b.dia.localeCompare(a.dia))[0] ?? null;
  const porDia = dias.map((dia) => ({ dia, hecho: valorDe(propias, "grupos_solicitados", dia) ?? 0, meta: 0 }));
  const solicitados = suma(porDia.map((d) => d.hecho));
  const activos = foto ? Number(foto.valor) || 0 : null;
  const meta = METAS.gruposActivos.total;

  const evidencia: Evidencia[] = propias
    .filter((m) => m.metrica === "grupos_solicitados")
    .sort((a, b) => b.dia.localeCompare(a.dia))
    .flatMap((m) =>
      evidenciaValida(m.evidencia).map((pieza) => {
        const estado = (pieza.estado ?? "solicitado").toLowerCase();
        return {
          cuando: m.dia,
          texto: pieza.texto,
          url: pieza.url,
          estado: estado === "activo" ? "Activo" : estado === "descartado" ? "Descartado" : "Solicitud pendiente",
          tono: (estado === "activo" ? "good" : estado === "descartado" ? "danger" : "warn") as Tono,
        };
      }),
    );
  const activados = evidencia.filter((e) => e.estado === "Activo").length;
  const descartados = evidencia.filter((e) => e.estado === "Descartado").length;

  return {
    id: "grupos_activos",
    titulo: "Grupos activos para publicar",
    responsable: "Agente 10 · Explorador de grupos",
    comoSeMide: "Grupos donde la Página ya puede publicar, contra los 25 que necesitan los 5 agentes. Abajo, las solicitudes del periodo.",
    fuente: "Lista de grupos del Explorador",
    hecho: activos,
    meta,
    unidad: "grupos",
    serie: "Solicitudes por día",
    estado: activos === null ? "sin_datos" : activos >= meta ? "cumplido" : "bajo_meta",
    nota: activos === null ? "El Explorador todavía no envía su conteo a Atlas." : activos < meta ? `Faltan ${meta - activos} para la meta.` : null,
    desglose: [
      { label: "Solicitados en el periodo", valor: solicitados },
      { label: "Ya activos", valor: activados, tono: activados > 0 ? "good" : undefined },
      { label: "Descartados", valor: descartados, tono: descartados > 0 ? "danger" : undefined },
    ],
    porDia,
    evidencia,
  };
}

// ---------------------------------------------------------------------------
// Cumplimiento por agente
// ---------------------------------------------------------------------------

export type CumplimientoAgente = {
  codigo: string;
  nombre: string;
  persona: string | null;
  /** Lo que se le pidió, en una frase. */
  objetivo: string;
  hecho: number | null;
  meta: number | null;
  /** 0–100, o null si su objetivo no se cuenta en piezas. */
  puntos: number | null;
  /** Un segundo encargo que no se mezcla con el primero ("Empresas seguidas: 1 de 15"). */
  extra: string | null;
  turnosOk: number;
  turnosConError: number;
  ultimoResumen: string | null;
};

const OBJETIVO_TEXTO: Record<string, string> = {
  "0": "Decidir y repartir el trabajo del día",
  "6": "Verificar que las publicaciones sigan visibles",
  "7": "Medir y escribir el diario de resultados",
  "8": "Vigilar competidores y traer ideas",
  "9": "Producir los Reels de la semana",
  "10": "Mantener 25 grupos activos",
  G: "Revisar a todos y relanzar a los caídos",
};

function cumplimientoPorAgente(
  agentes: readonly AgenteLeido[],
  piezas: readonly PiezaLeida[],
  metricas: readonly MetricaLeida[],
  eventos: readonly EventoLeido[],
  dias: readonly string[],
  ahora: Date,
): CumplimientoAgente[] {
  const visiblesPorAgente = new Map<string, number>();
  for (const pieza of piezas) {
    if (!esPublicacionDeGrupo(pieza) || !pieza.scheduled_at || !enRango(diaDeChile(pieza.scheduled_at), dias)) continue;
    if (claseDePublicacion(pieza, ahora) !== "visible") continue;
    const codigo = codigoDesdeAgente(pieza.agent);
    if (codigo) visiblesPorAgente.set(codigo, (visiblesPorAgente.get(codigo) ?? 0) + 1);
  }
  const seguidas = suma(dias.map((dia) => valorDe(metricas, "empresas_seguidas", dia) ?? 0));
  const metaSeguidas = suma(dias.map((dia) => metaDelDia(dia, METAS.seguidos.diaria, METAS.seguidos.desde)));
  const activos = [...metricas].filter((m) => m.metrica === "grupos_activos").sort((a, b) => b.dia.localeCompare(a.dia))[0];

  const orden = (codigo: string) => (/^\d+$/.test(codigo) ? Number(codigo) : Number.MAX_SAFE_INTEGER);
  const enOrden = [...agentes].sort((a, b) => orden(a.codigo) - orden(b.codigo) || a.codigo.localeCompare(b.codigo));
  return enOrden.map((agente) => {
    const propios = eventos.filter((e) => e.agente_codigo === agente.codigo && enRango(diaDeChile(e.ocurrido_at), dias));
    const turnosConError = propios.filter((e) => e.tipo === "error" || (e.tipo === "fin" && e.estado === "error")).length;
    const turnosOk = propios.filter((e) => e.tipo === "fin" && e.estado !== "error").length;

    let objetivo = OBJETIVO_TEXTO[agente.codigo] ?? "Completar su turno";
    let hecho: number | null = null;
    let meta: number | null = null;
    let extra: string | null = null;
    if ((METAS.porAgente.agentes as readonly string[]).includes(agente.codigo)) {
      objetivo = `${METAS.porAgente.diaria} publicaciones visibles al día, cada una en un grupo distinto`;
      hecho = visiblesPorAgente.get(agente.codigo) ?? 0;
      meta = suma(dias.map((dia) => metaDelDia(dia, METAS.porAgente.diaria, METAS.porAgente.desde)));
      if (agente.codigo === "4") {
        objetivo += ` y seguir ${METAS.seguidos.diaria} empresas`;
        extra = `Empresas seguidas: ${seguidas.toLocaleString("es-CL")} de ${metaSeguidas.toLocaleString("es-CL")}`;
      }
    } else if (agente.codigo === "10" && activos) {
      hecho = Number(activos.valor) || 0;
      meta = METAS.gruposActivos.total;
    }
    const puntos = hecho !== null && meta ? Math.min(100, Math.round((hecho / meta) * 100)) : null;
    return {
      codigo: agente.codigo,
      nombre: agente.nombre,
      persona: agente.persona,
      objetivo,
      hecho,
      meta,
      puntos,
      extra,
      turnosOk,
      turnosConError,
      ultimoResumen: agente.ultimo_resumen,
    };
  });
}

// ---------------------------------------------------------------------------
// Aprendizaje y reintento
// ---------------------------------------------------------------------------

export type TipoDeHecho = "falla" | "alerta" | "reintento" | "aprendizaje";

export type CircuitoDeAprendizaje = {
  /** Lo que salió mal y quedó registrado. */
  fallas: { total: number; desglose: { label: string; valor: number }[] };
  /** Lo que se volvió a intentar o se mandó a corregir. */
  reintentos: { total: number; desglose: { label: string; valor: number }[] };
  /** Lo que se decidió cambiar a partir de lo medido. */
  aprendizajes: { total: number; desglose: { label: string; valor: number }[] };
  /** Los hechos, del más reciente al más antiguo. */
  linea: { cuando: string; agente: string; tipo: TipoDeHecho; texto: string }[];
};

function circuito(
  eventos: readonly EventoLeido[],
  piezas: readonly PiezaLeida[],
  correo: CorreoLeido,
  dias: readonly string[],
  ahora: Date,
  nombres: ReadonlyMap<string, string>,
): CircuitoDeAprendizaje {
  const delPeriodo = eventos.filter((e) => enRango(diaDeChile(e.ocurrido_at), dias));
  const errores = delPeriodo.filter((e) => e.tipo === "error" || (e.tipo === "fin" && e.estado === "error"));
  const alertas = delPeriodo.filter((e) => e.tipo === "alerta");
  const recuperaciones = delPeriodo.filter((e) => e.tipo === "recuperacion");
  const tareas = delPeriodo.filter((e) => e.tipo === "tarea");
  const decisiones = delPeriodo.filter((e) => e.tipo === "decision");
  const publicacionesFallidas = piezas.filter(
    (p) => esPublicacionDeGrupo(p) && p.scheduled_at && enRango(diaDeChile(p.scheduled_at), dias) && claseDePublicacion(p, ahora) === "fallida",
  ).length;
  const correosFallidos = correo ? suma(correo.porDia.filter((d) => enRango(d.dia, dias)).map((d) => d.fallidos + d.rebotes)) : 0;

  const nombre = (codigo: string) => nombres.get(codigo) ?? `Agente ${codigo}`;
  const tipoDe = (evento: EventoLeido): TipoDeHecho =>
    evento.tipo === "decision"
      ? "aprendizaje"
      : evento.tipo === "recuperacion" || evento.tipo === "tarea"
        ? "reintento"
        : evento.tipo === "alerta"
          ? "alerta"
          : "falla";
  const linea = [...errores, ...alertas, ...recuperaciones, ...tareas, ...decisiones]
    .sort((a, b) => Date.parse(b.ocurrido_at) - Date.parse(a.ocurrido_at))
    .slice(0, 40)
    .map((evento) => ({
      cuando: evento.ocurrido_at,
      agente:
        evento.tipo === "recuperacion" && evento.relacionado_con
          ? `${nombre(evento.agente_codigo)} → ${nombre(evento.relacionado_con)}`
          : evento.relacionado_con && evento.tipo === "tarea"
            ? `${nombre(evento.agente_codigo)} → ${nombre(evento.relacionado_con)}`
            : nombre(evento.agente_codigo),
      tipo: tipoDe(evento),
      texto: evento.resumen?.trim() || (evento.tipo === "recuperacion" ? "Relanzado automáticamente" : "Sin detalle"),
    }));

  return {
    fallas: {
      total: errores.length + alertas.length + publicacionesFallidas + correosFallidos,
      desglose: [
        { label: "Turnos con error", valor: errores.length },
        { label: "Alertas", valor: alertas.length },
        { label: "Publicaciones fallidas", valor: publicacionesFallidas },
        { label: "Correos rebotados o fallidos", valor: correosFallidos },
      ],
    },
    reintentos: {
      total: recuperaciones.length + tareas.length,
      desglose: [
        { label: "Agentes relanzados solos", valor: recuperaciones.length },
        { label: "Tareas de corrección", valor: tareas.length },
      ],
    },
    aprendizajes: {
      total: decisiones.length,
      desglose: [{ label: "Decisiones a partir de lo medido", valor: decisiones.length }],
    },
    linea,
  };
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------

export type TableroDeObjetivos = {
  periodo: Periodo;
  dias: string[];
  objetivos: Objetivo[];
  agentes: CumplimientoAgente[];
  circuito: CircuitoDeAprendizaje;
  /** Cuántos objetivos con datos se cumplen. */
  cumplidos: number;
  conDatos: number;
};

export function tableroDeObjetivos(entrada: {
  periodo: Periodo;
  ahora: Date;
  agentes: readonly AgenteLeido[];
  piezas: readonly PiezaLeida[];
  metricas: readonly MetricaLeida[];
  eventos: readonly EventoLeido[];
  correo: CorreoLeido;
  correoError: string | null;
  metaGrupos?: number;
}): TableroDeObjetivos {
  const { periodo, ahora } = entrada;
  const dias = diasDelPeriodo(periodo, ahora);
  const objetivos = [
    objetivoGrupos(entrada.piezas, dias, periodo, ahora, entrada.metaGrupos ?? METAS.grupos.diaria),
    objetivoCorreo(entrada.correo, entrada.correoError, dias, periodo),
    objetivoSeguidos(entrada.metricas, dias, periodo),
    objetivoGruposActivos(entrada.metricas, dias),
  ];
  const nombres = new Map(entrada.agentes.map((a) => [a.codigo, a.persona?.trim() || a.nombre]));
  const conDatos = objetivos.filter((o) => o.estado !== "sin_datos" && o.estado !== "no_aplica");
  return {
    periodo,
    dias,
    objetivos,
    agentes: cumplimientoPorAgente(entrada.agentes, entrada.piezas, entrada.metricas, entrada.eventos, dias, ahora),
    circuito: circuito(entrada.eventos, entrada.piezas, entrada.correo, dias, ahora, nombres),
    cumplidos: conDatos.filter((o) => o.estado === "cumplido").length,
    conDatos: conDatos.length,
  };
}
