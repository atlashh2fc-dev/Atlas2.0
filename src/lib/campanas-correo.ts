/**
 * Campañas de correo de la empresa, que envía Atlas Lead.
 *
 * El CRM orquesta: arma la campaña, elige la audiencia en Bigdata, programa y
 * lanza. Atlas Lead es el motor: guarda la campaña, valida el contenido, envía,
 * respeta bajas y cupos. Estos tipos son el contrato del puente
 * (/api/integrations/v2/crm/* en Atlas Lead y bigdata.audiencia.v1 en Bigdata).
 * Puro: lo usan servidor y cliente.
 */

export type EstadoCampana = "borrador" | "programada" | "enviando" | "en_espera" | "pausada" | "terminada" | "cancelada";

export const ESTADO_CAMPANA: Record<EstadoCampana, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger"; ayuda: string }> = {
  borrador: { label: "Borrador", tone: "neutral", ayuda: "Todavía no se lanza." },
  programada: { label: "Programada", tone: "info", ayuda: "Lanzada; empieza en su fecha de inicio." },
  enviando: { label: "Enviando", tone: "success", ayuda: "Dentro de su horario: está saliendo." },
  en_espera: { label: "Fuera de horario", tone: "info", ayuda: "Lanzada; vuelve a enviar en su próxima ventana." },
  pausada: { label: "Pausada", tone: "warning", ayuda: "No envía hasta que la reanudes." },
  terminada: { label: "Terminada", tone: "neutral", ayuda: "Pasó su fecha de término." },
  cancelada: { label: "Cancelada", tone: "neutral", ayuda: "No vuelve a enviar." },
};

export type Remitente = {
  id: string;
  marca: string;
  nombre: string | null;
  email: string | null;
  responder_a: string | null;
  cta_url: string | null;
  cta_texto: string | null;
  proveedor: string | null;
  /** La cabecera de esta marca lleva título y bajada en texto, además de la imagen. */
  cabecera_con_texto: boolean;
};

export type Capacidades = {
  empresa: { slug: string; nombre: string; cupo_diario: number | null };
  remitentes: Remitente[];
  zona_horaria: string;
  limites: { imagenMb: number; pruebaMax: number; pasosMax: number; audienciaLoteMax: number; limiteDiarioMax: number };
  variables: { clave: string; descripcion: string }[];
};

export type Condicion = "todos" | "abrio_anterior" | "no_abrio_anterior" | "hizo_clic_anterior";

export const CONDICIONES: { valor: Condicion; label: string }[] = [
  { valor: "todos", label: "A todos los que recibieron el anterior" },
  { valor: "no_abrio_anterior", label: "Solo a quienes no abrieron el anterior" },
  { valor: "abrio_anterior", label: "Solo a quienes abrieron el anterior" },
  { valor: "hizo_clic_anterior", label: "Solo a quienes hicieron clic en el anterior" },
];

export type Paso = {
  asunto: string;
  cuerpo: string;
  imagen_url: string | null;
  espera_dias_habiles: number;
  condicion: Condicion;
};

export type Cabecera = { imagen_url: string | null; titulo: string | null; bajada: string | null; precio: string | null };

export type Programacion = {
  inicio_fecha: string | null;
  inicio_hora: string | null;
  fin_fecha: string | null;
  fin_hora: string | null;
  dias: number[];
  ventanas: { inicio: string; fin: string }[];
};

export type Metricas = {
  base: number;
  pendientes: number | null;
  contactados: number;
  enviados: number;
  enviados_24h: number;
  abrieron: number;
  clics: number;
  rebotes: number;
  respuestas: number;
  bajas: number;
  ultimo_envio: string | null;
};

export type CampanaResumen = {
  id: string;
  nombre: string;
  estado: EstadoCampana;
  activa: boolean;
  origen: "consola" | "crm";
  remitente: { marca: string; nombre: string | null; email: string | null; responder_a: string | null };
  limite_diario: number | null;
  programacion: Programacion | null;
  version: number;
  creada_at: string;
  actualizada_at: string;
  metricas: Metricas | null;
};

export type Accion = { accion: string; actor: { tipo?: string; nombre?: string } | null; detalle: Record<string, unknown> | null; created_at: string };

export type CampanaDetalle = CampanaResumen & {
  cta_url: string | null;
  cta_texto: string | null;
  contenido: { cabecera: Cabecera; pasos: Paso[]; editable: boolean };
  audiencia: { lote_id: string | null; total: number; nombre: string | null; ola: number | null; origen?: unknown; cargada_at?: string | null };
  remitente_cabecera_con_texto: boolean;
  acciones: Accion[];
};

export type ListaDeCampanas = {
  empresa: { slug: string; nombre: string; cupo_diario: number | null };
  enviados_hoy: number;
  por_dia: { dia: string; enviados: number; abrieron: number; clics: number; respuestas: number; bajas: number; rebotes: number; fallidos: number }[];
  respuestas_7d: { campana_id: string; empresa: string | null; recibida_at: string; intencion: string | null; resumen: string | null }[];
  campanas: CampanaResumen[];
};

/** Lo que el editor envía para crear o guardar. */
export type DatosCampana = {
  nombre: string;
  remitente_id?: string;
  limite_diario: number | null;
  cta_url: string | null;
  cta_texto: string | null;
  cabecera: Cabecera | null;
  pasos: Paso[];
  programacion?: Programacion | null;
};

export const DIAS = [
  { valor: 1, corto: "L", label: "Lunes" },
  { valor: 2, corto: "M", label: "Martes" },
  { valor: 3, corto: "X", label: "Miércoles" },
  { valor: 4, corto: "J", label: "Jueves" },
  { valor: 5, corto: "V", label: "Viernes" },
  { valor: 6, corto: "S", label: "Sábado" },
  { valor: 0, corto: "D", label: "Domingo" },
] as const;

export const PROGRAMACION_POR_DEFECTO: Programacion = {
  inicio_fecha: null,
  inicio_hora: null,
  fin_fecha: null,
  fin_hora: null,
  dias: [1, 2, 3, 4, 5],
  ventanas: [{ inicio: "09:00", fin: "13:00" }, { inicio: "15:00", fin: "18:00" }],
};

export const PASO_NUEVO: Paso = { asunto: "", cuerpo: "", imagen_url: null, espera_dias_habiles: 3, condicion: "todos" };

// ---------------------------------------------------------------------------
// Audiencia (Bigdata, contrato bigdata.audiencia.v1)

export type FiltrosAudiencia = {
  regiones?: string[];
  comunas?: string[];
  rubros?: string[];
  tamanos?: string[];
  cargos?: string[];
  trabajadores_min?: number | null;
  trabajadores_max?: number | null;
  solo_activas?: boolean;
  excluir_clientes_equifax?: boolean;
  contacto?: "ejecutivos" | "empresa" | "ambos";
  nombre_contiene?: string | null;
};

export type OpcionConConteo = { valor: string; contactos: number; region?: string };

export type OpcionesAudiencia = {
  regiones: OpcionConConteo[];
  rubros: OpcionConConteo[];
  tamanos: OpcionConConteo[];
  cargos: OpcionConConteo[];
  comunas: OpcionConConteo[];
  actualizada_at: string | null;
};

export type ConteoAudiencia = { contactos: number; empresas: number; ejecutivos: number; correos_generales: number; actualizada_at: string | null };

export const TAMANO_LABEL: Record<string, string> = {
  micro: "Micro",
  pequena: "Pequeña",
  mediana: "Mediana",
  grande: "Grande",
  sin_info: "Sin información de ventas",
};

export const CARGO_LABEL: Record<string, string> = {
  gerente_general: "Gerente general",
  gerencia: "Cualquier gerencia",
  representante_legal: "Representante legal",
  dueno_directorio: "Dueños y directorio",
  comercial: "Comercial y ventas",
  finanzas: "Finanzas y administración",
  operaciones: "Operaciones",
  personas: "Personas (RR. HH.)",
  tecnologia: "Tecnología",
  marketing: "Marketing",
};

export const CONTACTO_LABEL: Record<NonNullable<FiltrosAudiencia["contacto"]>, string> = {
  ejecutivos: "Solo ejecutivos con nombre y cargo",
  empresa: "Solo el correo general de la empresa",
  ambos: "Ejecutivos y, si la empresa no tiene, su correo general",
};

/** Etiqueta en palabras de una acción del registro. */
export function etiquetaDeAccion(accion: string): string {
  const etiquetas: Record<string, string> = {
    crear: "Creó la campaña",
    editar: "Editó los correos",
    ajustar: "Ajustó nombre, límite o programación",
    prueba: "Envió una prueba",
    audiencia: "Cargó la audiencia",
    lanzar: "Lanzó la campaña",
    pausar: "Pausó la campaña",
    reanudar: "Reanudó la campaña",
    cancelar: "Canceló la campaña",
    ajuste_agente: "Órbita ajustó la campaña",
  };
  return etiquetas[accion] ?? accion;
}

/** Lo que falta para poder lanzar, en orden. Vacío = lista para lanzar. */
export function pendientesParaLanzar(campana: Pick<CampanaDetalle, "contenido" | "audiencia" | "programacion">): string[] {
  const faltan: string[] = [];
  if (!campana.contenido.pasos.length) faltan.push("Escribir al menos un correo");
  if (!campana.audiencia.total) faltan.push("Cargar la audiencia");
  if (!campana.programacion) faltan.push("Definir cuándo envía");
  return faltan;
}

export function formatearNumero(valor: number | null | undefined): string {
  return (valor ?? 0).toLocaleString("es-CL");
}

export function porcentaje(parte: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((parte / total) * 1000) / 10} %`.replace(".", ",");
}

function fechaLarga(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function listaHumana(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/** Resumen en una frase de cuándo envía la campaña. */
export function describirProgramacion(programacion: Programacion, limiteDiario: number | null): string {
  const dias = programacion.dias.length === 7
    ? "todos los días"
    : JSON.stringify([...programacion.dias].sort()) === JSON.stringify([1, 2, 3, 4, 5])
      ? "de lunes a viernes"
      : `los ${listaHumana(DIAS.filter((dia) => programacion.dias.includes(dia.valor)).map((dia) => dia.label.toLowerCase()))}`;
  const ventanas = listaHumana(programacion.ventanas.map((ventana) => `de ${ventana.inicio} a ${ventana.fin}`));
  const inicio = programacion.inicio_fecha ? `, desde el ${fechaLarga(programacion.inicio_fecha)}${programacion.inicio_hora ? ` a las ${programacion.inicio_hora}` : ""}` : ", apenas la lances";
  const fin = programacion.fin_fecha ? ` y hasta el ${fechaLarga(programacion.fin_fecha)}` : "";
  const tope = limiteDiario ? `. Hasta ${formatearNumero(limiteDiario)} correos nuevos por día, repartidos en esas horas` : "";
  return `Envía ${dias}, ${ventanas} (hora de Chile)${inicio}${fin}${tope}.`;
}

