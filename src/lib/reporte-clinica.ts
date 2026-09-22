/**
 * Reportes de la clínica: el motor del tablero.
 *
 * La base entrega los hechos del período y del período anterior en una sola
 * consulta (`reporte_clinica`). Todo lo demás se calcula acá, en el navegador:
 * así un clic en un profesional, una categoría o un día de la semana filtra
 * todo el tablero al instante, como en un tablero de BI, sin volver al
 * servidor. Es puro y sin dependencias para poder probarlo con node:test.
 *
 * Las fechas son `YYYY-MM-DD` en hora de Chile, ya resueltas por la base: acá
 * se comparan como texto, que ordena igual que el calendario.
 */

export type Atencion = {
  id: string;
  fecha: string;
  cuentaId: string;
  profesional: string;
  categoria: string;
  procedimiento: string;
  monto: number;
  costo: number;
  pagado: boolean;
  urgencia: boolean;
  especie: string | null;
  mascota: string | null;
};

export type EstadoCita = "reservada" | "confirmada" | "en_sala" | "atendida" | "no_vino" | "cancelada";

export type Cita = {
  id: string;
  /** `YYYY-MM-DDTHH:mm` en hora de Chile. */
  inicio: string;
  fecha: string;
  hora: number;
  minutos: number;
  cuentaId: string;
  profesional: string;
  estado: EstadoCita;
  motivo: string;
  especie: string | null;
};

export type Plan = {
  id: string;
  creado: string;
  cuentaId: string;
  nombre: string;
  estado: "abierta" | "ganada" | "perdida";
  monto: number;
  cerrado: string | null;
  motivoPerdida: string | null;
  etapa: string | null;
  etapaOrden: number;
  origen: string | null;
};

export type Pago = {
  id: string;
  fecha: string;
  cuentaId: string;
  monto: number;
  medio: string;
  estado: string;
};

export type Saldo = { fecha: string; cuentaId: string; monto: number; profesional: string };

export type Cuenta = {
  id: string;
  nombre: string;
  creada: string;
  origen: string | null;
  comuna: string | null;
  primeraAtencion: string | null;
};

export type Vacuna = { especie: string; proxima: string | null; cuentaId: string };

export type Hechos = {
  atenciones: Atencion[];
  citas: Cita[];
  planes: Plan[];
  pagos: Pago[];
  saldos: Saldo[];
  cuentas: Map<string, Cuenta>;
  vacunas: Vacuna[];
};

type Tupla = unknown[];

const num = (valor: unknown) => (valor === null || valor === undefined ? 0 : Number(valor));
const txt = (valor: unknown) => (valor === null || valor === undefined ? null : String(valor));

/** Convierte la respuesta compacta de la RPC (arreglos por fila) en objetos. */
export function leerHechos(raw: unknown): Hechos {
  const r = (raw ?? {}) as Record<string, Tupla[] | undefined>;
  const filas = (clave: string) => (Array.isArray(r[clave]) ? (r[clave] as Tupla[]) : []);
  return {
    atenciones: filas("atenciones").map((f) => ({
      id: String(f[0]),
      fecha: String(f[1]),
      cuentaId: String(f[2]),
      profesional: String(f[3] ?? "Sin profesional"),
      categoria: String(f[4] ?? "Sin categoría"),
      procedimiento: String(f[5] ?? "—"),
      monto: num(f[6]),
      costo: num(f[7]),
      pagado: f[8] === true,
      urgencia: f[9] === true,
      especie: txt(f[10]),
      mascota: txt(f[11]),
    })),
    citas: filas("citas").map((f) => {
      const inicio = String(f[1]);
      return {
        id: String(f[0]),
        inicio,
        fecha: inicio.slice(0, 10),
        hora: Number(inicio.slice(11, 13)),
        minutos: num(f[2]),
        cuentaId: String(f[3]),
        profesional: String(f[4] ?? "Sin profesional"),
        estado: String(f[5]) as EstadoCita,
        motivo: String(f[6] ?? "—"),
        especie: txt(f[7]),
      };
    }),
    planes: filas("planes").map((f) => ({
      id: String(f[0]),
      creado: String(f[1]),
      cuentaId: String(f[2]),
      nombre: String(f[3] ?? "—"),
      estado: String(f[4]) as Plan["estado"],
      monto: num(f[5]),
      cerrado: txt(f[6]),
      motivoPerdida: txt(f[7]),
      etapa: txt(f[8]),
      etapaOrden: num(f[9]),
      origen: txt(f[10]),
    })),
    pagos: filas("pagos").map((f) => ({
      id: String(f[0]),
      fecha: String(f[1]),
      cuentaId: String(f[2]),
      monto: num(f[3]),
      medio: String(f[4]),
      estado: String(f[5]),
    })),
    saldos: filas("saldos").map((f) => ({ fecha: String(f[0]), cuentaId: String(f[1]), monto: num(f[2]), profesional: String(f[3]) })),
    cuentas: new Map(
      filas("cuentas").map((f) => [
        String(f[0]),
        {
          id: String(f[0]),
          nombre: String(f[1] ?? "—"),
          creada: String(f[2]),
          origen: txt(f[3]),
          comuna: txt(f[4]),
          primeraAtencion: txt(f[5]),
        },
      ]),
    ),
    vacunas: filas("vacunas").map((f) => ({ especie: String(f[0] ?? "Otro"), proxima: txt(f[1]), cuentaId: String(f[2]) })),
  };
}

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------

const DIA_MS = 24 * 60 * 60 * 1000;

function aUtc(fecha: string): number {
  return Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)) - 1, Number(fecha.slice(8, 10)));
}

function deUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  return deUtc(aUtc(fecha) + dias * DIA_MS);
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS);
}

/** 0 = lunes … 6 = domingo: la semana de la clínica empieza el lunes. */
export function diaSemana(fecha: string): number {
  return (new Date(aUtc(fecha)).getUTCDay() + 6) % 7;
}

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;

export type Grano = "dia" | "semana" | "mes";

export function granoSugerido(dias: number): Grano {
  if (dias <= 45) return "dia";
  if (dias <= 190) return "semana";
  return "mes";
}

/** Inicio del tramo al que pertenece la fecha. */
export function tramo(fecha: string, grano: Grano): string {
  if (grano === "dia") return fecha;
  if (grano === "mes") return `${fecha.slice(0, 7)}-01`;
  return sumarDias(fecha, -diaSemana(fecha));
}

/** Todos los tramos entre dos fechas, sin huecos: un día sin atenciones es un cero, no un salto. */
export function tramos(desde: string, hasta: string, grano: Grano): string[] {
  const salida: string[] = [];
  let actual = tramo(desde, grano);
  while (actual <= hasta) {
    salida.push(actual);
    if (grano === "dia") actual = sumarDias(actual, 1);
    else if (grano === "semana") actual = sumarDias(actual, 7);
    else {
      const anio = Number(actual.slice(0, 4));
      const mes = Number(actual.slice(5, 7));
      actual = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
    }
  }
  return salida;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

export function etiquetaTramo(inicio: string, grano: Grano): string {
  const dia = Number(inicio.slice(8, 10));
  const mes = MESES[Number(inicio.slice(5, 7)) - 1];
  if (grano === "mes") return `${mes} ${inicio.slice(2, 4)}`;
  if (grano === "semana") return `sem ${dia} ${mes}`;
  return `${dia} ${mes}`;
}

export function etiquetaFecha(fecha: string): string {
  return `${Number(fecha.slice(8, 10))} ${MESES[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Períodos y filtros
// ---------------------------------------------------------------------------

export type Periodo = { desde: string; hasta: string };

/** El período anterior tiene el mismo largo y termina el día antes. */
export function periodoAnterior({ desde, hasta }: Periodo): Periodo {
  const largo = diasEntre(desde, hasta) + 1;
  return { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1) };
}

/** El mismo tramo del calendario, un año antes. El 29 de febrero cae en el 28. */
export function mismoPeriodoAnioAnterior({ desde, hasta }: Periodo): Periodo {
  const atras = (fecha: string) => {
    const anio = Number(fecha.slice(0, 4)) - 1;
    const resto = fecha.slice(4);
    return resto === "-02-29" ? `${anio}-02-28` : `${anio}${resto}`;
  };
  return { desde: atras(desde), hasta: atras(hasta) };
}

export type Comparacion = "anterior" | "anio";

export function periodoDeComparacion(p: Periodo, comparacion: Comparacion): Periodo {
  return comparacion === "anio" ? mismoPeriodoAnioAnterior(p) : periodoAnterior(p);
}

/** Desde dónde hay que traer hechos para poder comparar de las dos maneras. */
export function inicioDeLosHechos(p: Periodo): string {
  const a = periodoAnterior(p).desde;
  const b = mismoPeriodoAnioAnterior(p).desde;
  return a < b ? a : b;
}

export const DIMENSIONES = ["profesional", "categoria", "procedimiento", "origen", "comuna", "especie", "dia"] as const;
export type Dimension = (typeof DIMENSIONES)[number];
export type Filtros = Partial<Record<Dimension, string>>;

export const ETIQUETA_DIMENSION: Record<Dimension, string> = {
  profesional: "Profesional",
  categoria: "Categoría",
  procedimiento: "Procedimiento",
  origen: "Canal de origen",
  comuna: "Comuna",
  especie: "Especie",
  dia: "Día de la semana",
};

export const SIN_DATO = "Sin dato";

const ORIGENES: Record<string, string> = {
  instagram: "Instagram",
  google: "Google",
  whatsapp: "WhatsApp",
  referido: "Referido",
  convenio: "Convenio",
  web: "Sitio web",
  campana_correo: "Campaña de correo",
  prospeccion: "Prospección",
};

export function etiquetaOrigen(origen: string | null | undefined): string {
  if (!origen) return SIN_DATO;
  return ORIGENES[origen] ?? origen.charAt(0).toUpperCase() + origen.slice(1).replace(/_/g, " ");
}

type ConCuenta = { cuentaId: string };

function pasaCuenta(hechos: Hechos, fila: ConCuenta, filtros: Filtros, origenPropio?: string | null): boolean {
  if (filtros.origen === undefined && filtros.comuna === undefined) return true;
  const cuenta = hechos.cuentas.get(fila.cuentaId);
  if (filtros.origen !== undefined) {
    const origen = etiquetaOrigen(origenPropio !== undefined ? origenPropio ?? cuenta?.origen : cuenta?.origen);
    if (origen !== filtros.origen) return false;
  }
  if (filtros.comuna !== undefined && (cuenta?.comuna ?? SIN_DATO) !== filtros.comuna) return false;
  return true;
}

/** Qué dimensiones filtran cada conjunto. Lo que no aplica se ignora, no vacía el panel. */
export const APLICA: Record<"atenciones" | "citas" | "planes" | "pagos" | "saldos" | "cuentas", Dimension[]> = {
  atenciones: ["profesional", "categoria", "procedimiento", "origen", "comuna", "especie", "dia"],
  citas: ["profesional", "origen", "comuna", "especie", "dia"],
  planes: ["origen", "comuna", "dia"],
  pagos: ["origen", "comuna", "dia"],
  saldos: ["profesional", "origen", "comuna"],
  cuentas: ["origen", "comuna"],
};

const enPeriodo = (fecha: string | null, p: Periodo) => fecha !== null && fecha >= p.desde && fecha <= p.hasta;
const pasaDia = (fecha: string, filtros: Filtros) => filtros.dia === undefined || DIAS_SEMANA[diaSemana(fecha)] === filtros.dia;

export function filtrarAtenciones(h: Hechos, p: Periodo, f: Filtros): Atencion[] {
  return h.atenciones.filter(
    (a) =>
      enPeriodo(a.fecha, p) &&
      (f.profesional === undefined || a.profesional === f.profesional) &&
      (f.categoria === undefined || a.categoria === f.categoria) &&
      (f.procedimiento === undefined || a.procedimiento === f.procedimiento) &&
      (f.especie === undefined || (a.especie ?? SIN_DATO) === f.especie) &&
      pasaDia(a.fecha, f) &&
      pasaCuenta(h, a, f),
  );
}

export function filtrarCitas(h: Hechos, p: Periodo, f: Filtros): Cita[] {
  return h.citas.filter(
    (c) =>
      enPeriodo(c.fecha, p) &&
      (f.profesional === undefined || c.profesional === f.profesional) &&
      (f.especie === undefined || (c.especie ?? SIN_DATO) === f.especie) &&
      pasaDia(c.fecha, f) &&
      pasaCuenta(h, c, f),
  );
}

export function filtrarPlanes(h: Hechos, p: Periodo, f: Filtros): Plan[] {
  return h.planes.filter((plan) => enPeriodo(plan.creado, p) && pasaDia(plan.creado, f) && pasaCuenta(h, plan, f, plan.origen));
}

export function filtrarPagos(h: Hechos, p: Periodo, f: Filtros): Pago[] {
  return h.pagos.filter((pago) => enPeriodo(pago.fecha, p) && pasaDia(pago.fecha, f) && pasaCuenta(h, pago, f));
}

export function filtrarSaldos(h: Hechos, f: Filtros): Saldo[] {
  return h.saldos.filter((s) => (f.profesional === undefined || s.profesional === f.profesional) && pasaCuenta(h, s, f));
}

/** Cuentas cuya primera atención de la historia cae en el período: pacientes nuevos de verdad. */
export function primerasVisitas(h: Hechos, p: Periodo, f: Filtros): Cuenta[] {
  const atendidas = new Set(filtrarAtenciones(h, p, f).map((a) => a.cuentaId));
  return [...h.cuentas.values()].filter((c) => enPeriodo(c.primeraAtencion, p) && atendidas.has(c.id));
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

export type Kpis = {
  produccion: number;
  atenciones: number;
  visitas: number;
  pacientes: number;
  ticket: number | null;
  costo: number;
  margen: number;
  margenPct: number | null;
  cobradoPct: number | null;
  pendienteDelPeriodo: number;
  nuevos: number;
  citas: number;
  citasPasadas: number;
  atendidas: number;
  noVino: number;
  canceladas: number;
  asistenciaPct: number | null;
  planesCreados: number;
  planesGanados: number;
  planesPerdidos: number;
  planesAbiertos: number;
  valorPresupuestado: number;
  valorAceptado: number;
  conversionPct: number | null;
  urgencias: number;
};

const pct = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : null);

/**
 * `hoy` separa las citas que ya pasaron de las que vienen: la asistencia solo
 * se mide sobre las que ya tuvieron su hora.
 */
export function calcularKpis(h: Hechos, p: Periodo, f: Filtros, hoy: string): Kpis {
  const atenciones = filtrarAtenciones(h, p, f);
  const citas = filtrarCitas(h, p, f);
  const planes = filtrarPlanes(h, p, f);
  const produccion = suma(atenciones, (a) => a.monto);
  const costo = suma(atenciones, (a) => a.costo);
  const pagado = suma(atenciones.filter((a) => a.pagado), (a) => a.monto);
  const visitas = new Set(atenciones.map((a) => `${a.cuentaId}|${a.fecha}`)).size;
  const pasadas = citas.filter((c) => c.fecha < hoy || c.estado === "atendida" || c.estado === "no_vino");
  const atendidas = pasadas.filter((c) => c.estado === "atendida").length;
  const noVino = pasadas.filter((c) => c.estado === "no_vino").length;
  const ganados = planes.filter((x) => x.estado === "ganada");
  const perdidos = planes.filter((x) => x.estado === "perdida").length;
  return {
    produccion,
    atenciones: atenciones.length,
    visitas,
    pacientes: new Set(atenciones.map((a) => a.cuentaId)).size,
    ticket: visitas > 0 ? produccion / visitas : null,
    costo,
    margen: produccion - costo,
    margenPct: pct(produccion - costo, produccion),
    cobradoPct: pct(pagado, produccion),
    pendienteDelPeriodo: produccion - pagado,
    nuevos: primerasVisitas(h, p, f).length,
    citas: citas.length,
    citasPasadas: pasadas.length,
    atendidas,
    noVino,
    canceladas: citas.filter((c) => c.estado === "cancelada").length,
    asistenciaPct: pct(atendidas, atendidas + noVino),
    planesCreados: planes.length,
    planesGanados: ganados.length,
    planesPerdidos: perdidos,
    planesAbiertos: planes.filter((x) => x.estado === "abierta").length,
    valorPresupuestado: suma(planes, (x) => x.monto),
    valorAceptado: suma(ganados, (x) => x.monto),
    conversionPct: pct(ganados.length, planes.length),
    urgencias: atenciones.filter((a) => a.urgencia).length,
  };
}

/** Variación porcentual; nula cuando no hay base contra qué comparar. */
export function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null) return null;
  if (anterior === 0) return actual === 0 ? 0 : null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

export function suma<T>(filas: T[], valor: (fila: T) => number): number {
  let total = 0;
  for (const fila of filas) total += valor(fila);
  return total;
}

// ---------------------------------------------------------------------------
// Agregaciones
// ---------------------------------------------------------------------------

export type Grupo = {
  clave: string;
  cantidad: number;
  valor: number;
  costo: number;
  /** Valor del mismo grupo en el período anterior, para la variación. */
  anterior: number;
};

/** Agrupa y ordena de mayor a menor valor. Los grupos que solo existían antes también aparecen. */
export function agrupar<T>(
  actual: T[],
  anterior: T[],
  clave: (fila: T) => string,
  valor: (fila: T) => number,
  costo: (fila: T) => number = () => 0,
): Grupo[] {
  const grupos = new Map<string, Grupo>();
  const tomar = (k: string) => {
    let g = grupos.get(k);
    if (!g) {
      g = { clave: k, cantidad: 0, valor: 0, costo: 0, anterior: 0 };
      grupos.set(k, g);
    }
    return g;
  };
  for (const fila of actual) {
    const g = tomar(clave(fila));
    g.cantidad += 1;
    g.valor += valor(fila);
    g.costo += costo(fila);
  }
  for (const fila of anterior) tomar(clave(fila)).anterior += valor(fila);
  return [...grupos.values()].sort((a, b) => b.valor - a.valor || b.cantidad - a.cantidad || a.clave.localeCompare(b.clave));
}

/** Serie temporal completa (con ceros) y la del período anterior alineada tramo a tramo. */
export function serie<T>(
  actual: T[],
  anterior: T[],
  fecha: (fila: T) => string,
  valor: (fila: T) => number,
  p: Periodo,
  grano: Grano,
  previo: Periodo = periodoAnterior(p),
): { tramo: string; valor: number; anterior: number | null }[] {
  const ejeActual = tramos(p.desde, p.hasta, grano);
  const ejePrevio = tramos(previo.desde, previo.hasta, grano);
  const acumular = (filas: T[]) => {
    const m = new Map<string, number>();
    for (const fila of filas) {
      const t = tramo(fecha(fila), grano);
      m.set(t, (m.get(t) ?? 0) + valor(fila));
    }
    return m;
  };
  const a = acumular(actual);
  const b = acumular(anterior);
  // Se alinea desde el final: el último tramo de hoy contra el último de antes.
  const desfase = ejePrevio.length - ejeActual.length;
  return ejeActual.map((t, i) => {
    const par = ejePrevio[i + desfase];
    return { tramo: t, valor: a.get(t) ?? 0, anterior: par === undefined ? null : b.get(par) ?? 0 };
  });
}

/** Matriz día de la semana × hora de las citas, para el mapa de calor de la agenda. */
export function calorAgenda(citas: Cita[]): { horas: number[]; celdas: number[][]; maximo: number } {
  const conHora = citas.filter((c) => c.estado !== "cancelada");
  const horasUsadas = conHora.map((c) => c.hora);
  const desde = horasUsadas.length ? Math.min(8, ...horasUsadas) : 8;
  const hasta = horasUsadas.length ? Math.max(19, ...horasUsadas) : 19;
  const horas = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i);
  const celdas = DIAS_SEMANA.map(() => horas.map(() => 0));
  for (const c of conHora) celdas[diaSemana(c.fecha)][c.hora - desde] += 1;
  return { horas, celdas, maximo: Math.max(0, ...celdas.flat()) };
}

export const TRAMOS_ANTIGUEDAD = [
  { etiqueta: "0–30 días", hasta: 30 },
  { etiqueta: "31–60 días", hasta: 60 },
  { etiqueta: "61–90 días", hasta: 90 },
  { etiqueta: "Más de 90 días", hasta: Infinity },
] as const;

export function antiguedadSaldos(saldos: Saldo[], hoy: string): { etiqueta: string; monto: number; fichas: number }[] {
  return TRAMOS_ANTIGUEDAD.map((t, i) => {
    const desde = i === 0 ? -Infinity : TRAMOS_ANTIGUEDAD[i - 1].hasta;
    const filas = saldos.filter((s) => {
      const dias = diasEntre(s.fecha, hoy);
      return dias > desde && dias <= t.hasta;
    });
    return { etiqueta: t.etiqueta, monto: suma(filas, (s) => s.monto), fichas: new Set(filas.map((s) => s.cuentaId)).size };
  });
}

/** Cuántas visitas hizo cada persona en el período: 1, 2 o 3 y más. */
export function recurrencia(atenciones: Atencion[]): { etiqueta: string; personas: number }[] {
  const visitas = new Map<string, Set<string>>();
  for (const a of atenciones) {
    const dias = visitas.get(a.cuentaId) ?? new Set<string>();
    dias.add(a.fecha);
    visitas.set(a.cuentaId, dias);
  }
  const conteo = [0, 0, 0];
  for (const dias of visitas.values()) conteo[Math.min(dias.size, 3) - 1] += 1;
  return [
    { etiqueta: "1 visita", personas: conteo[0] },
    { etiqueta: "2 visitas", personas: conteo[1] },
    { etiqueta: "3 o más", personas: conteo[2] },
  ];
}

export type EstadoVacunaReporte = "vencida" | "por_vencer" | "al_dia" | "sin_dato";

export function estadoVacunas(vacunas: Vacuna[], hoy: string): Record<EstadoVacunaReporte, number> {
  const salida: Record<EstadoVacunaReporte, number> = { vencida: 0, por_vencer: 0, al_dia: 0, sin_dato: 0 };
  const limite = sumarDias(hoy, 30);
  for (const v of vacunas) {
    if (!v.proxima) salida.sin_dato += 1;
    else if (v.proxima < hoy) salida.vencida += 1;
    else if (v.proxima <= limite) salida.por_vencer += 1;
    else salida.al_dia += 1;
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Lectura deductiva: de lo general a lo particular, en palabras.
// ---------------------------------------------------------------------------

export type Hallazgo = { tono: "positivo" | "negativo" | "neutro"; texto: string; filtro?: { dimension: Dimension; valor: string } };

const clp = (valor: number) => `$${Math.round(valor).toLocaleString("es-CL")}`;
const pts = (valor: number) => `${valor >= 0 ? "+" : ""}${valor.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;

/**
 * Tres o cuatro frases que explican el número grande: cuánto cambió, quién lo
 * movió y dónde mirar. Cada una puede filtrar el tablero al hacer clic.
 */
export function hallazgos(h: Hechos, p: Periodo, f: Filtros, hoy: string, previo: Periodo = periodoAnterior(p)): Hallazgo[] {
  const contra = previo.desde === periodoAnterior(p).desde ? "período anterior" : "mismo período del año pasado";
  const actual = calcularKpis(h, p, f, hoy);
  const antes = calcularKpis(h, previo, f, hoy);
  const salida: Hallazgo[] = [];

  const delta = variacion(actual.produccion, antes.produccion);
  if (actual.produccion === 0 && antes.produccion === 0) {
    return [{ tono: "neutro", texto: "No hay atenciones registradas en este período ni en el anterior." }];
  }
  salida.push({
    tono: delta === null ? "neutro" : delta >= 0 ? "positivo" : "negativo",
    texto:
      delta === null
        ? `La producción fue ${clp(actual.produccion)} en ${actual.atenciones} atenciones; el ${contra} no tiene registros para comparar.`
        : `La producción ${delta >= 0 ? "subió" : "bajó"} ${pts(delta)} frente al ${contra}: ${clp(actual.produccion)} contra ${clp(antes.produccion)}.`,
  });

  const atencionesActual = filtrarAtenciones(h, p, f);
  const atencionesAntes = filtrarAtenciones(h, previo, f);
  if (f.categoria === undefined) {
    const categorias = agrupar(atencionesActual, atencionesAntes, (a) => a.categoria, (a) => a.monto);
    const motor = [...categorias].sort((a, b) => Math.abs(b.valor - b.anterior) - Math.abs(a.valor - a.anterior))[0];
    if (motor && motor.valor !== motor.anterior) {
      const cambio = motor.valor - motor.anterior;
      salida.push({
        tono: cambio >= 0 ? "positivo" : "negativo",
        texto: `${motor.clave} es lo que más movió el resultado: ${cambio >= 0 ? "aportó" : "restó"} ${clp(Math.abs(cambio))} respecto del ${contra}.`,
        filtro: { dimension: "categoria", valor: motor.clave },
      });
    }
  }
  if (f.profesional === undefined && actual.produccion > 0) {
    const profesionales = agrupar(atencionesActual, [], (a) => a.profesional, (a) => a.monto);
    const primero = profesionales[0];
    if (primero && profesionales.length > 1) {
      salida.push({
        tono: "neutro",
        texto: `${primero.clave} concentra el ${Math.round((primero.valor / actual.produccion) * 100)}% de la producción, con ${primero.cantidad} atenciones.`,
        filtro: { dimension: "profesional", valor: primero.clave },
      });
    }
  }
  if (actual.asistenciaPct !== null && actual.noVino > 0) {
    salida.push({
      tono: actual.asistenciaPct >= 90 ? "positivo" : "negativo",
      texto: `${actual.noVino} ${actual.noVino === 1 ? "cita quedó" : "citas quedaron"} sin asistencia: la asistencia es de ${Math.round(actual.asistenciaPct)}%.`,
    });
  } else if (actual.pendienteDelPeriodo > 0) {
    salida.push({ tono: "negativo", texto: `De lo producido en el período quedan ${clp(actual.pendienteDelPeriodo)} por cobrar.` });
  }
  return salida;
}
