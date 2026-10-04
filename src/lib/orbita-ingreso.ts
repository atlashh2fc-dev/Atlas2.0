import { z } from "zod";

import { instanteDesdeTexto } from "./marketing-ingreso.ts";
import { ESTADOS_AGENTE, TIPOS_CONEXION, TIPOS_EVENTO, TODOS, type EstadoAgente, type TipoEvento } from "./orbita.ts";

/**
 * La puerta de entrada de Órbita: lo que envían los agentes a
 * /api/orbita/eventos.
 *
 * Vive aparte del catálogo para que la red, que es de cliente, no cargue zod.
 * Tolerante con lo que entra (mayúsculas, tildes, "recuperación", códigos en
 * minúscula, fechas sin zona en hora de Chile) y estricto con lo que se
 * guarda: solo valores del catálogo.
 */

export const MAX_POR_ENVIO = 200;

/** Minúsculas y sin tildes: "Recuperación" → "recuperacion". */
function clave(valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const ALIAS_ESTADO: Record<string, EstadoAgente> = { running: "corriendo", sano: "ok", fallo: "error", failed: "error", late: "atrasado" };
const ALIAS_TIPO: Record<string, TipoEvento> = {
  start: "inicio",
  end: "fin",
  done: "fin",
  heartbeat: "pulso",
  latido: "pulso",
  recovery: "recuperacion",
};

const enumTolerante = <T extends string>(lista: readonly T[], alias: Record<string, T> = {}) =>
  z.preprocess((valor) => {
    const normal = clave(valor);
    return typeof normal === "string" ? alias[normal] ?? normal : normal;
  }, z.enum(lista as unknown as [T, ...T[]]));

/** "g" → "G", " 3 " → "3". El mismo formato que exige la base. */
export const codigoSchema = z.preprocess(
  (valor) => (typeof valor === "number" && Number.isInteger(valor) ? String(valor) : typeof valor === "string" ? valor.trim().toUpperCase() : valor),
  z.string().regex(/^[0-9A-Z][0-9A-Z_-]{0,15}$/, "Código inválido: letras o números, hasta 16 (ej. «0», «3», «G»)"),
);

const textoOpcional = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((valor) => {
      const limpio = valor?.trim() ?? "";
      return limpio === "" ? null : limpio;
    });

const conexionSchema = z.object({
  a: z.union([z.literal(TODOS), codigoSchema]),
  tipo: enumTolerante(TIPOS_CONEXION),
  etiqueta: textoOpcional(120),
});

/** Un agente tal como lo declara el sistema: se identifica por su código. */
export const agenteEntranteSchema = z
  .object({
    codigo: codigoSchema,
    nombre: z.string().trim().min(1, "Falta el nombre").max(120),
    /** Nombre de persona con que se presenta en la red ("Tomás"); `nombre` queda como cargo. */
    persona: textoOpcional(40),
    rol: textoOpcional(200),
    descripcion: textoOpcional(4000),
    horario: textoOpcional(120),
    cron: textoOpcional(120),
    color: textoOpcional(7).refine((valor) => valor === null || /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor), {
      message: "Tiene que ser un color #rrggbb",
    }),
    conexiones: z.array(conexionSchema).max(60, "Máximo 60 conexiones").nullish().transform((valor) => valor ?? []),
    /** Opcional: fija el estado a mano (el Guardián marca a uno como atrasado). */
    estado: enumTolerante(ESTADOS_AGENTE, ALIAS_ESTADO).nullish(),
  })
  .superRefine((agente, ctx) => {
    agente.conexiones.forEach((conexion, i) => {
      if (conexion.a === agente.codigo) ctx.addIssue({ code: "custom", path: ["conexiones", i, "a"], message: "Un agente no se conecta consigo mismo" });
    });
  });

export type AgenteEntrante = z.output<typeof agenteEntranteSchema>;

/** Un evento tal como lo envía un agente. */
export const eventoEntranteSchema = z.object({
  agente: codigoSchema,
  tipo: enumTolerante(TIPOS_EVENTO, ALIAS_TIPO),
  estado: enumTolerante(ESTADOS_AGENTE, ALIAS_ESTADO).nullish(),
  resumen: textoOpcional(1000),
  detalle: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((valor) => valor ?? {})
    .refine((valor) => JSON.stringify(valor).length <= 20_000, { message: "Detalle demasiado grande (máx. 20 KB)" }),
  relacionado_con: z.preprocess((valor) => (valor === "" ? null : valor), codigoSchema.nullish()),
  ocurrido_at: z
    .string()
    .nullish()
    .transform((valor, ctx) => {
      if (valor === null || valor === undefined || valor.trim() === "") return null;
      const fecha = instanteDesdeTexto(valor);
      if (!fecha) {
        ctx.addIssue({ code: "custom", message: "Fecha no reconocida; usa ISO 8601 o «AAAA-MM-DD HH:MM» (hora de Chile)" });
        return null;
      }
      return fecha.toISOString();
    }),
});

export type EventoEntrante = z.output<typeof eventoEntranteSchema>;

/** El cuerpo del POST: `{ agentes?: [...], eventos?: [...] }`, con al menos uno de los dos. */
export const envioDeOrbitaSchema = z
  .object({
    agentes: z.array(z.unknown()).max(MAX_POR_ENVIO, `Máximo ${MAX_POR_ENVIO} agentes por envío`).optional(),
    eventos: z.array(z.unknown()).max(MAX_POR_ENVIO, `Máximo ${MAX_POR_ENVIO} eventos por envío`).optional(),
  })
  .refine((envio) => (envio.agentes?.length ?? 0) + (envio.eventos?.length ?? 0) > 0, { message: "No vienen agentes ni eventos" });

export type ErrorDeOrbita = { lista: "agentes" | "eventos"; indice: number; codigo: string | null; errores: string[] };

export type FilaAgente = {
  organization_id: string;
  codigo: string;
  nombre: string;
  persona: string | null;
  rol: string | null;
  descripcion: string | null;
  horario: string | null;
  cron: string | null;
  color: string | null;
  conexiones: { a: string; tipo: string; etiqueta: string | null }[];
};

export type FilaEvento = {
  organization_id: string;
  agente_codigo: string;
  tipo: TipoEvento;
  estado: EstadoAgente | null;
  resumen: string | null;
  detalle: Record<string, unknown>;
  relacionado_con: string | null;
  ocurrido_at: string;
};

export type EnvioValidado = {
  agentes: FilaAgente[];
  /** Estado fijado a mano por código (solo los agentes que lo traen). */
  estados: Map<string, EstadoAgente>;
  eventos: FilaEvento[];
  errores: ErrorDeOrbita[];
};

const mensajes = (issues: readonly { path: readonly PropertyKey[]; message: string }[], raiz: string) =>
  issues.map((issue) => `${issue.path.map(String).join(".") || raiz}: ${issue.message}`);

const codigoCrudo = (item: unknown, campo: string): string | null => {
  const valor = item && typeof item === "object" ? (item as Record<string, unknown>)[campo] : undefined;
  return typeof valor === "string" && valor.trim() ? valor.trim().toUpperCase() : typeof valor === "number" ? String(valor) : null;
};

/**
 * Valida cada agente y cada evento por separado (uno malo no esconde a los
 * otros malos) y deja las filas listas para guardar. `ahora` es la hora de
 * los eventos que no traen `ocurrido_at`.
 *
 * `existentes` son los códigos que la empresa ya tiene: un evento de un agente
 * que no existe (ni en la base ni en este mismo envío) se rechaza, porque la
 * red no tendría dónde dibujarlo.
 */
export function validarEnvioOrbita(
  envio: { agentes?: unknown[]; eventos?: unknown[] },
  organizationId: string,
  existentes: Iterable<string>,
  ahora: Date = new Date(),
): EnvioValidado {
  const agentes: FilaAgente[] = [];
  const estados = new Map<string, EstadoAgente>();
  const eventos: FilaEvento[] = [];
  const errores: ErrorDeOrbita[] = [];
  const conocidos = new Set(existentes);
  const vistos = new Set<string>();

  (envio.agentes ?? []).forEach((item, indice) => {
    const resultado = agenteEntranteSchema.safeParse(item);
    if (!resultado.success) {
      errores.push({ lista: "agentes", indice, codigo: codigoCrudo(item, "codigo"), errores: mensajes(resultado.error.issues, "agente") });
      return;
    }
    const agente = resultado.data;
    // Dos veces el mismo código en un lote haría fallar el upsert entero.
    if (vistos.has(agente.codigo)) {
      errores.push({ lista: "agentes", indice, codigo: agente.codigo, errores: ["codigo: repetido en este envío"] });
      return;
    }
    vistos.add(agente.codigo);
    conocidos.add(agente.codigo);
    agentes.push({
      organization_id: organizationId,
      codigo: agente.codigo,
      nombre: agente.nombre,
      persona: agente.persona,
      rol: agente.rol,
      descripcion: agente.descripcion,
      horario: agente.horario,
      cron: agente.cron,
      color: agente.color,
      conexiones: agente.conexiones.map((conexion) => ({ a: conexion.a, tipo: conexion.tipo, etiqueta: conexion.etiqueta })),
    });
    if (agente.estado) estados.set(agente.codigo, agente.estado);
  });

  (envio.eventos ?? []).forEach((item, indice) => {
    const resultado = eventoEntranteSchema.safeParse(item);
    if (!resultado.success) {
      errores.push({ lista: "eventos", indice, codigo: codigoCrudo(item, "agente"), errores: mensajes(resultado.error.issues, "evento") });
      return;
    }
    const evento = resultado.data;
    const faltan: string[] = [];
    if (!conocidos.has(evento.agente)) faltan.push(`agente: «${evento.agente}» no existe; declara el agente primero`);
    if (evento.relacionado_con && !conocidos.has(evento.relacionado_con)) {
      faltan.push(`relacionado_con: «${evento.relacionado_con}» no existe`);
    }
    if (faltan.length > 0) {
      errores.push({ lista: "eventos", indice, codigo: evento.agente, errores: faltan });
      return;
    }
    eventos.push({
      organization_id: organizationId,
      agente_codigo: evento.agente,
      tipo: evento.tipo,
      estado: evento.estado ?? null,
      resumen: evento.resumen,
      detalle: evento.detalle,
      relacionado_con: evento.relacionado_con ?? null,
      ocurrido_at: evento.ocurrido_at ?? ahora.toISOString(),
    });
  });

  return { agentes, estados, eventos, errores };
}
