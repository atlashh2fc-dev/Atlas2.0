/**
 * Cotizador Equifax: tablas de precios y cálculo. Viene del cotizador que el
 * equipo usaba por fuera (CotizadorGo!, build 20260702-2); las tablas son las
 * mismas, copiadas por programa. Precios en UF netas (sin IVA).
 *
 * Tres diferencias con el original, a propósito:
 * - La UF va con decimales; el original la redondeaba a entero.
 * - Partner Check (anual) y RI Bolsa (pago único) ya no se presentan como
 *   cargo mensual ni se multiplican por 12.
 * - Cada línea guarda el tramo elegido, no el precio: si cambia la tabla, una
 *   cotización antigua sigue diciendo qué se cotizó.
 */

export type ProductoClave = "bundle" | "mc" | "ri" | "bolsa" | "malla" | "datafinder" | "pfm" | "pc" | "bdd" | "pub";

/** Cómo se cobra: define la etiqueta del precio y a qué total suma. */
export type Cobro = "mensual" | "unico" | "anual" | "clp";

export type Frecuencia = "s" | "q" | "m";
export type TamanoEmpresa = "micro" | "pequena" | "mediana";

export type DocumentoPublicacion = { monto: number; abonos: number };

export type ConfigLinea =
  | { producto: "bundle"; mc: "4100" | "ilim"; descargas: number; doa?: number; precioManual?: number | null }
  | { producto: "mc"; plan: "4100" | "6900" | "ilim"; doa: number; precioManual?: number | null }
  | { producto: "ri"; tramo: number; doa: number; precioManual?: number | null }
  | { producto: "bolsa"; tramo: number; precioManual?: number | null }
  | { producto: "malla"; tramo: number; doa: number; precioManual?: number | null }
  | { producto: "datafinder"; tramo: number; doa: number; precioManual?: number | null }
  | { producto: "pfm"; frecuencia: Frecuencia; ruts: number; doa: number; precioManual?: number | null }
  | { producto: "pc"; tamano: TamanoEmpresa; precioManual?: number | null }
  | { producto: "bdd"; universo: "personas" | "empresas"; registros: number; ufBackoffice: number | null }
  | { producto: "pub"; pct: number; documentos: DocumentoPublicacion[] };

// ── Tablas (UF netas) ─────────────────────────────────────────────────────

/** Bundle Mora Control + Reporte Interactivo: descargas RI/mes → UF/mes. Sin DOA. */
const BUNDLE: Record<"4100" | "ilim", Record<number, number>> = {
  "4100": { 10: 2.5, 20: 3, 30: 3.5, 40: 4, 50: 4.5, 60: 5, 70: 5.5, 80: 6, 90: 6.5, 100: 7 },
  ilim: { 10: 4, 20: 4.5, 30: 5, 40: 5.5, 50: 6, 60: 6.5, 70: 7, 80: 7.5, 90: 8, 100: 8.5 },
};

const MORA_CONTROL: Record<"4100" | "6900" | "ilim", { etiqueta: string; uf: number }> = {
  "4100": { etiqueta: "MC 4100", uf: 2.65 },
  "6900": { etiqueta: "MC 6900", uf: 3.65 },
  ilim: { etiqueta: "MC Ilimitado", uf: 6.65 },
};

/** Reporte Interactivo: descargas/mes → UF/mes. */
const REPORTE_INTERACTIVO: Record<number, number> = {
  10: 1.1, 20: 1.65, 30: 2.41989, 40: 3.15348, 50: 3.6575, 60: 4.2636, 70: 4.80788, 80: 5.28352, 90: 5.68062,
  100: 6.27, 150: 8.3589, 200: 8.91, 250: 9.4325, 300: 9.8736, 350: 10.1717, 400: 10.3664, 500: 10.56, 1000: 18.612,
};

/** RI Bolsa: descargas totales en 12 meses → UF pago único. Sin DOA. */
const BOLSA_RI: Record<number, number> = {
  10: 3, 20: 5, 30: 6, 40: 7, 50: 8, 60: 9, 70: 10, 80: 11, 90: 12, 100: 14, 150: 18, 200: 19, 250: 20, 300: 21, 500: 25, 1000: 40,
};

/** Malla Societaria: consultas/mes → UF/mes. */
const MALLA: Record<number, number> = {
  10: 0.45, 15: 0.68, 20: 0.9, 25: 1.13, 30: 1.35, 40: 1.8, 50: 2.16, 60: 2.52, 70: 2.88, 80: 3.25, 90: 3.52,
  100: 3.79, 150: 5.19, 200: 6.8, 250: 7.45, 300: 7.95, 500: 9.3, 1000: 16.6,
};

/**
 * Data Finder: consultas/mes → UF/mes neta y tarifa por consulta. La UF neta
 * es el F.M.M. bruto de la hoja de Equifax dividido por 1,19: no revertir.
 */
const DATA_FINDER: Record<number, { uf: number; tarifa: number }> = {
  50: { uf: 0.882353, tarifa: 0.021 }, 100: { uf: 1.680672, tarifa: 0.02 }, 150: { uf: 2.319328, tarifa: 0.0184 },
  200: { uf: 2.857143, tarifa: 0.017 }, 250: { uf: 3.319328, tarifa: 0.0158 }, 300: { uf: 3.705882, tarifa: 0.0147 },
  350: { uf: 4.205882, tarifa: 0.0143 }, 400: { uf: 4.672269, tarifa: 0.0139 }, 450: { uf: 5.142857, tarifa: 0.0136 },
  500: { uf: 5.546218, tarifa: 0.0132 }, 750: { uf: 7.878151, tarifa: 0.0125 }, 1000: { uf: 10, tarifa: 0.0119 },
  1500: { uf: 13.487395, tarifa: 0.0107 }, 2000: { uf: 16.134454, tarifa: 0.0096 }, 2500: { uf: 18.277311, tarifa: 0.0087 },
  3000: { uf: 19.915966, tarifa: 0.0079 }, 3500: { uf: 21.176471, tarifa: 0.0072 }, 4000: { uf: 21.848739, tarifa: 0.0065 },
  5000: { uf: 22.268908, tarifa: 0.0053 }, 7500: { uf: 28.991597, tarifa: 0.0046 }, 10000: { uf: 33.613445, tarifa: 0.004 },
  15000: { uf: 46.638655, tarifa: 0.0037 }, 20000: { uf: 58.823529, tarifa: 0.0035 }, 30000: { uf: 83.193277, tarifa: 0.0033 },
  40000: { uf: 104.201681, tarifa: 0.0031 }, 50000: { uf: 121.848739, tarifa: 0.0029 },
};

/** Portfolio Monitor: tarifa UF por RUT; rige el mayor tramo que no supera la cantidad. */
const PORTFOLIO: Record<Frecuencia, Record<number, number>> = {
  s: { 1: 0.0725, 2: 0.0711, 3: 0.0697, 5: 0.0683, 10: 0.067, 20: 0.065, 30: 0.063, 40: 0.062, 50: 0.06, 60: 0.058, 70: 0.056, 80: 0.054, 90: 0.052, 100: 0.05, 200: 0.039, 300: 0.035, 500: 0.029, 1000: 0.024 },
  q: { 1: 0.0563, 2: 0.0554, 3: 0.0546, 5: 0.0538, 10: 0.053, 20: 0.051, 30: 0.05, 40: 0.048, 50: 0.046, 60: 0.045, 70: 0.043, 80: 0.041, 90: 0.039, 100: 0.038, 200: 0.029, 300: 0.025, 500: 0.021, 1000: 0.017 },
  m: { 1: 0.0447, 2: 0.0443, 3: 0.0439, 5: 0.0434, 10: 0.043, 20: 0.042, 30: 0.04, 40: 0.039, 50: 0.038, 60: 0.036, 70: 0.035, 80: 0.033, 90: 0.032, 100: 0.03, 200: 0.023, 300: 0.02, 500: 0.017, 1000: 0.013 },
};

export const FRECUENCIA_ETIQUETA: Record<Frecuencia, string> = { s: "Semanal", q: "Quincenal", m: "Mensual" };

/** Partner Check: UF al año según tamaño. Sin DOA. */
const PARTNER_CHECK: Record<TamanoEmpresa, { etiqueta: string; uf: number }> = {
  micro: { etiqueta: "Micro", uf: 6 },
  pequena: { etiqueta: "Pequeña", uf: 9 },
  mediana: { etiqueta: "Mediana/Grande", uf: 23 },
};

// ── Descuentos DOA ────────────────────────────────────────────────────────

export const DOA_ETIQUETA: Record<number, string> = {
  0: "Sin descuento",
  10: "10%",
  15: "15% Asesor",
  20: "20%",
  25: "25% Supervisor",
  35: "35% Subgerente",
  50: "50% Gerente",
};

const DOA_CORTO = [0, 15, 25];
/** El Bundle ya viene con precio de paquete: solo admite 10 % y 15 % (pedido del 30-09-2026). */
const DOA_BUNDLE = [0, 10, 15];
const DOA_LARGO = [0, 10, 15, 20, 25, 35, 50];

// ── Catálogo ──────────────────────────────────────────────────────────────

export type DefinicionProducto = {
  clave: ProductoClave;
  etiqueta: string;
  /** Nombre en la lista de productos de la tipificación (EQUIFAX_PRODUCTS). */
  atlas: string;
  badge: string;
  doa: number[];
};

export const PRODUCTOS: DefinicionProducto[] = [
  { clave: "bundle", etiqueta: "Bundle (Mora Control + Reporte Interactivo)", atlas: "Bundle", badge: "BUNDLE", doa: DOA_BUNDLE },
  { clave: "mc", etiqueta: "Mora Control", atlas: "Mora Control", badge: "GESTIÓN DE CARTERA", doa: DOA_CORTO },
  { clave: "ri", etiqueta: "Reporte Interactivo", atlas: "Reporte Interactivo", badge: "EVALUACIÓN CREDITICIA", doa: DOA_LARGO },
  { clave: "bolsa", etiqueta: "Reporte Interactivo Bolsa", atlas: "Bolsa RI", badge: "BOLSA · 12 MESES", doa: [] },
  { clave: "pfm", etiqueta: "Portfolio Monitor", atlas: "Portfolio Monitor", badge: "MONITOREO", doa: DOA_CORTO },
  { clave: "datafinder", etiqueta: "Data Finder", atlas: "DataFinder", badge: "LOCALIZACIÓN · CONTACTABILIDAD", doa: DOA_LARGO },
  { clave: "malla", etiqueta: "Malla Societaria", atlas: "Malla Societaria", badge: "COMPLIANCE · VINCULACIONES", doa: DOA_LARGO },
  { clave: "pc", etiqueta: "Partner Check", atlas: "Partner Check", badge: "PROVEEDORES", doa: [] },
  { clave: "bdd", etiqueta: "Base de Datos", atlas: "BBDD", badge: "SOLICITUD BASE DE DATOS", doa: [] },
  { clave: "pub", etiqueta: "Publicación Única (DICOM)", atlas: "Documento Unico", badge: "PUBLICACIÓN ÚNICA", doa: [] },
];

export function definicion(clave: ProductoClave): DefinicionProducto {
  return PRODUCTOS.find((producto) => producto.clave === clave)!;
}

const tramos = (tabla: Record<number, unknown>) => Object.keys(tabla).map(Number).sort((a, b) => a - b);

export const TRAMOS = {
  bundle: tramos(BUNDLE["4100"]),
  ri: tramos(REPORTE_INTERACTIVO),
  bolsa: tramos(BOLSA_RI),
  malla: tramos(MALLA),
  datafinder: tramos(DATA_FINDER),
};

export const PLANES_MORA_CONTROL = Object.entries(MORA_CONTROL).map(([clave, plan]) => ({ clave: clave as "4100" | "6900" | "ilim", ...plan }));
export const TAMANOS_PARTNER_CHECK = Object.entries(PARTNER_CHECK).map(([clave, tamano]) => ({ clave: clave as TamanoEmpresa, ...tamano }));

/** La configuración con que parte cada producto al agregarlo. */
export function configInicial(clave: ProductoClave): ConfigLinea {
  switch (clave) {
    case "bundle": return { producto: "bundle", mc: "4100", descargas: 10, doa: 0 };
    case "mc": return { producto: "mc", plan: "4100", doa: 0 };
    case "ri": return { producto: "ri", tramo: 10, doa: 0 };
    case "bolsa": return { producto: "bolsa", tramo: 10 };
    case "malla": return { producto: "malla", tramo: 10, doa: 0 };
    case "datafinder": return { producto: "datafinder", tramo: 50, doa: 0 };
    case "pfm": return { producto: "pfm", frecuencia: "m", ruts: 10, doa: 0 };
    case "pc": return { producto: "pc", tamano: "micro" };
    case "bdd": return { producto: "bdd", universo: "empresas", registros: 1000, ufBackoffice: null };
    case "pub": return { producto: "pub", pct: 15, documentos: [{ monto: 0, abonos: 0 }] };
  }
}

/**
 * Lo que llega del navegador, validado contra el catálogo: un tramo que no
 * existe o un producto desconocido no se cotiza. El servidor recalcula los
 * precios con esto; nunca toma los montos que mande la ficha.
 */
export function normalizarConfig(entrada: unknown): ConfigLinea | null {
  if (!entrada || typeof entrada !== "object") return null;
  const raw = entrada as Record<string, unknown>;
  const numero = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? valor : Number(valor));
  const precioManual = raw.precioManual == null || raw.precioManual === "" ? null : numero(raw.precioManual);
  const manual = precioManual != null && Number.isFinite(precioManual) && precioManual >= 0 && precioManual < 10000 ? precioManual : null;
  const doaDe = (clave: ProductoClave) => {
    const doa = numero(raw.doa);
    return definicion(clave).doa.includes(doa) ? doa : 0;
  };
  switch (raw.producto) {
    case "bundle": {
      const descargas = numero(raw.descargas);
      if (raw.mc !== "4100" && raw.mc !== "ilim") return null;
      return TRAMOS.bundle.includes(descargas) ? { producto: "bundle", mc: raw.mc, descargas, doa: doaDe("bundle"), precioManual: manual } : null;
    }
    case "mc":
      return raw.plan === "4100" || raw.plan === "6900" || raw.plan === "ilim" ? { producto: "mc", plan: raw.plan, doa: doaDe("mc"), precioManual: manual } : null;
    case "ri":
    case "malla":
    case "datafinder": {
      const tramo = numero(raw.tramo);
      return TRAMOS[raw.producto].includes(tramo) ? { producto: raw.producto, tramo, doa: doaDe(raw.producto), precioManual: manual } : null;
    }
    case "bolsa": {
      const tramo = numero(raw.tramo);
      return TRAMOS.bolsa.includes(tramo) ? { producto: "bolsa", tramo, precioManual: manual } : null;
    }
    case "pfm": {
      const ruts = Math.round(numero(raw.ruts));
      if (raw.frecuencia !== "s" && raw.frecuencia !== "q" && raw.frecuencia !== "m") return null;
      return ruts >= 1 && ruts <= 5000 ? { producto: "pfm", frecuencia: raw.frecuencia, ruts, doa: doaDe("pfm"), precioManual: manual } : null;
    }
    case "pc":
      return raw.tamano === "micro" || raw.tamano === "pequena" || raw.tamano === "mediana" ? { producto: "pc", tamano: raw.tamano, precioManual: manual } : null;
    case "bdd": {
      const registros = Math.round(numero(raw.registros));
      const uf = raw.ufBackoffice == null || raw.ufBackoffice === "" ? null : numero(raw.ufBackoffice);
      if (raw.universo !== "personas" && raw.universo !== "empresas") return null;
      if (!(registros >= 1 && registros <= 10_000_000)) return null;
      return { producto: "bdd", universo: raw.universo, registros, ufBackoffice: uf != null && Number.isFinite(uf) && uf > 0 && uf < 100000 ? uf : null };
    }
    case "pub": {
      const pct = numero(raw.pct);
      const documentos = Array.isArray(raw.documentos) ? raw.documentos.slice(0, 12) : [];
      const limpios = documentos
        .map((doc) => {
          const fila = (doc ?? {}) as Record<string, unknown>;
          const monto = numero(fila.monto);
          const abonos = numero(fila.abonos ?? 0);
          return Number.isFinite(monto) && monto > 0 && monto < 1e12 ? { monto, abonos: Number.isFinite(abonos) && abonos > 0 ? abonos : 0 } : null;
        })
        .filter((doc): doc is DocumentoPublicacion => doc !== null);
      if (!limpios.length) return null;
      return { producto: "pub", pct: pct > 0 && pct <= 100 ? pct : 15, documentos: limpios };
    }
    default:
      return null;
  }
}

// ── Textos de la propuesta ───────────────────────────────────────────────

/** Beneficios del correo (PITEMS_MAIL del original; Data Finder usa la lista corta). */
const BENEFICIOS: Record<string, string[]> = {
  bundle4100: ["Publicación DICOM hasta $4.100.000 desde una plataforma integral de cobranza", "40 Emails + 10 Cartas + 5 SMS al mes para acelerar el recupero", "Informes comerciales Equifax incluidos para evaluar antes de vender", "~70% de recuperación estimada en el primer mes", "Beneficio tributario por castigo de deuda", "Acciones de cobranza marca DICOM: hasta 6× más probabilidades de recuperar", "Bloqueo comercial del deudor moroso que promueve el pago", "Score de riesgo Equifax para respaldar cada decisión de crédito", "Portal de autogestión de la cobranza disponible 24/7", "Evalúa antes de otorgar crédito y recupera después, en una sola relación"],
  bundleIlim: ["Publicación DICOM ILIMITADA, sin tope de monto, desde una plataforma integral de cobranza", "40 Emails + 10 Cartas + 5 SMS al mes para acelerar el recupero", "Informes comerciales Equifax incluidos para evaluar antes de vender", "Portal de autogestión de la cobranza disponible 24/7", "Beneficio tributario por castigo de deuda", "Publica facturas, cheques y otros documentos impagos, no solo facturas", "Acciones de cobranza marca DICOM: hasta 6× más probabilidades de recuperar", "Bloqueo comercial del deudor moroso que promueve el pago", "Score de riesgo Equifax incluido para respaldar cada decisión", "Administra y agrupa deudores; gestiona abonos y pagos parciales"],
  mc: ["Plataforma integral que centraliza y controla toda la gestión de cobranza", "Publica moras en el Boletín Electrónico DICOM, marca de Equifax reconocida a nivel nacional", "40 Emails + 10 Cartas + 5 SMS al mes para acelerar la recuperación", "Acciones de cobranza marca DICOM: hasta 6× más probabilidades de recuperar", "Revisa, monitorea, envía cartas y publica moras, todo en un solo lugar", "Administra y agrupa deudores por monto de deuda y fecha de publicación", "Carga de documentos masiva o individual desde el portal de autogestión", "Gestión de abonos y pagos parciales de la deuda", "Bloqueo comercial del deudor moroso que promueve el pago", "Incorpora y elimina morosos en línea al regularizar la deuda", "Publica facturas, cheques y otros documentos impagos; contratable por personas y empresas"],
  ri: ["Score de riesgo crediticio Equifax", "Morosidades y protestos actuales", "Comportamiento financiero últimos 24 meses", "Antecedentes patrimoniales y laborales", "Datos de Registro Civil, DICOM, Insp. Laboral", "Análisis de riesgo, crédito y contactabilidad", "Identificación de consultas en línea", "Antecedentes FONASA y tributarios", "Reduce el riesgo de incobrabilidad", "Mejor evaluación de nuevos prospectos"],
  bolsa: ["Bolsa de informes comerciales distribuida a lo largo de 12 meses", "Pago único, sin cargo mensual: los informes se consumen a su ritmo", "Modalidad distinta del Reporte Comercial estándar", "Mismos datos que el Reporte Interactivo: score, morosidades y comportamiento", "Antecedentes patrimoniales, laborales y tributarios", "Activación mediante transferencia", "Proceso de contratación propio con documentación específica", "Ideal para volúmenes de consulta planificados a 12 meses"],
  pfm: ["Herramienta de monitoreo continuo de su cartera de clientes y prospectos", "Análisis, monitoreo y control de personas naturales y jurídicas", "Detecta variaciones comerciales y de morosidad, positivas y negativas", "Alertas oportunas y configurables para anticiparse al riesgo", "Indicadores analíticos orientados a riesgo y marketing", "Seguimiento individual o masivo, con monitoreo dinámico de la cartera", "Actualización semanal, quincenal o mensual", "Potencia a sus buenos clientes y limita los de mayor riesgo", "Anticipa el deterioro financiero y protege su cartera vigente", "Reevaluación al renovar líneas de crédito o facilidades de pago"],
  pc: ["Evaluación de proveedores en 30 minutos", "Ranking verificado de desempeño", "Marketplace de licitaciones y RFPs", "Compliance y KYC integrado", "Tecnología cloud disponible 24/7", "Validación de antecedentes de cada proveedor", "Reduce el riesgo de contraparte", "Centraliza la gestión de proveedores", "Respaldo de la marca Equifax"],
  datafinder: ["Búsqueda de teléfonos, correos y direcciones", "Datos de personas y empresas", "Múltiples fuentes consolidadas", "Información de contacto actualizada", "Enriquecimiento de bases de datos"],
  malla: ["Socios y sociedades vinculadas a un RUT en una sola consulta", "Dos niveles de profundidad: el RUT original más cualquiera de sus socios o sociedades", "Posibilidad de seguir profundizando en cada RUT de la red", "Datos actualizados de personas naturales y de sus cónyuges", "Comportamiento comercial de cada empresa vinculada", "Acceso directo a Directorios de Vehículos, Bienes Raíces e Informes", "Agiliza la evaluación de clientes, proveedores y socios comerciales", "Mitiga fraudes con un análisis de riesgo más profundo", "Insumo clave para compliance y due diligence", "Actualización permanente con fuentes propias de Equifax"],
  bdd: ["Campañas altamente segmentadas que llegan directo al público objetivo", "Menos desperdicio publicitario y mayor tasa de conversión", "Decisiones comerciales basadas en información real", "Mejor retorno de la inversión (ROI) en marketing"],
  pub: ["Publicación inmediata del documento en DICOM, registrada en el informe comercial del deudor", "El deudor recibe la notificación de su publicación en DICOM", "Genera un bloqueo comercial del deudor moroso que incentiva el pago de la deuda", "Las acciones de cobranza que acompañan la publicación aumentan hasta 6 veces las probabilidades de recuperación", "Ideal para documentos puntuales, sin comprometer un plan mensual"],
};

export const DESCRIPCION_BASE_DE_DATOS = [
  "Una Base de Datos Equifax le entrega información comercial validada y actualizada —de personas y empresas— construida exactamente según los atributos, el segmento, la industria, la ubicación y el volumen que usted defina.",
  "En lugar de prospectar a ciegas, su equipo comercial trabaja con un universo de contactos calificados y verificados: se reduce el tiempo de gestión, mejora la tasa de contacto y aumenta la conversión de cada campaña.",
];

export const DESCRIPCION_PUBLICACION = [
  "La Publicación Única permite publicar en DICOM un documento impago puntual —por ejemplo, una factura— sin necesidad de contratar un plan mensual de Mora Control.",
  "La publicación queda registrada de inmediato en el informe comercial del deudor, que recibe la notificación correspondiente. Esto produce un bloqueo comercial que incentiva el pago de la deuda.",
];

export const REQUISITOS_PUBLICACION = [
  "Documento con antigüedad máxima de 7 años desde el vencimiento (empresas) o 5 años (personas naturales)",
  "Facturas aceptadas por el SII",
  "No debe existir demanda judicial sobre el documento",
  "Personas naturales: autorización según Ley 19.628",
];

export const DOCUMENTOS_PUBLICACION = [
  "Cédula de identidad de los representantes legales (ambos lados).",
  "Escritura de la empresa con firma de los representantes legales, o escritura donde consten los poderes de firma.",
  "Facturas o documentos a publicar.",
  "Si es factura: print de pantalla de la DTE de la factura donde se indica que está aceptada por el SII (SII › Factura Electrónica › Registro de aceptación o reclamo DTE).",
  "Comprobante de transferencia por el pago de la publicación en DICOM.",
];

export const DOCUMENTOS_CONTRATACION = [
  "Ficha de contratación",
  "Cédula representante legal",
  "Escritura con poderes de firma",
  "Certificado de estatuto actualizado (no mayor a 30 días)",
  "Carpeta tributaria",
];

export const DATOS_TRANSFERENCIA = [
  ["Nombre", "Servicios Equifax Chile Limitada"],
  ["RUT", "85.896.100-9"],
  ["Banco", "Banco de Chile"],
  ["Cuenta corriente", "166143017"],
] as const;

// ── Cálculo ───────────────────────────────────────────────────────────────

export type DetallePublicacion = {
  pct: number;
  documentos: Array<DocumentoPublicacion & { publicar: number; neto: number; iva: number; total: number }>;
  publicar: number;
  neto: number;
  iva: number;
  total: number;
};

export type LineaCotizada = {
  config: ConfigLinea;
  producto: ProductoClave;
  badge: string;
  /** Nombre del producto como lo lee el cliente. */
  nombre: string;
  /** Qué se cotizó: "30 descargas de Reporte Interactivo/mes", "Semanal · 50 RUTs"… */
  detalle: string;
  atlas: string;
  cobro: Cobro;
  /** UF netas antes del descuento; null en Publicación Única y en BDD sin valor. */
  ufLista: number | null;
  ufVenta: number | null;
  /** Descuento efectivo entre lista y venta, en puntos (0 si no hay). */
  descuento: number;
  /** Descuento mayor que el máximo DOA del producto: necesita autorización. */
  descuentoFueraDeDoa: boolean;
  /** Consultas, descargas, registros o RUTs: la Q de la tipificación. */
  q: number | null;
  beneficios: string[];
  nota: string | null;
  publicacion: DetallePublicacion | null;
};

const redondear4 = (valor: number) => Math.round(valor * 10000) / 10000;
/** El precio que se ofrece va a 2 decimales: así la UF que ve el cliente y los pesos cuadran. */
const redondear2 = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

function tarifaPortfolio(frecuencia: Frecuencia, ruts: number): number {
  const tabla = PORTFOLIO[frecuencia];
  const tramo = tramos(tabla).filter((minimo) => minimo <= ruts).pop() ?? 1;
  return tabla[tramo];
}

function conDescuento(ufLista: number, doa: number, precioManual: number | null | undefined) {
  const ufVenta = redondear2(precioManual != null && Number.isFinite(precioManual) && precioManual >= 0 ? precioManual : ufLista * (1 - doa / 100));
  return { ufLista: redondear4(ufLista), ufVenta };
}

function descuentoEfectivo(ufLista: number | null, ufVenta: number | null): number {
  if (!ufLista || ufVenta == null || ufVenta >= ufLista) return 0;
  return Math.round((1 - ufVenta / ufLista) * 100);
}

const miles = (valor: number) => valor.toLocaleString("es-CL");

export function calcularPublicacion(pct: number, documentos: DocumentoPublicacion[]): DetallePublicacion {
  const filas = documentos.map((documento) => {
    const monto = Math.max(0, Math.round(documento.monto || 0));
    const abonos = Math.min(monto, Math.max(0, Math.round(documento.abonos || 0)));
    const publicar = monto - abonos;
    const neto = Math.round((publicar * pct) / 100);
    const iva = Math.round(neto * 0.19);
    return { monto, abonos, publicar, neto, iva, total: neto + iva };
  });
  const suma = (campo: "publicar" | "neto" | "iva" | "total") => filas.reduce((total, fila) => total + fila[campo], 0);
  return { pct, documentos: filas, publicar: suma("publicar"), neto: suma("neto"), iva: suma("iva"), total: suma("total") };
}

export function cotizarLinea(config: ConfigLinea): LineaCotizada {
  const def = definicion(config.producto);
  const maxDoa = def.doa.length ? Math.max(...def.doa) : 0;
  const cerrar = (
    parcial: Pick<LineaCotizada, "nombre" | "detalle" | "cobro" | "ufLista" | "ufVenta" | "q" | "beneficios"> & {
      nota?: string | null;
      publicacion?: DetallePublicacion | null;
    },
  ): LineaCotizada => {
    const descuento = descuentoEfectivo(parcial.ufLista, parcial.ufVenta);
    return {
      config,
      producto: config.producto,
      badge: def.badge,
      atlas: def.atlas,
      ...parcial,
      nota: parcial.nota ?? null,
      publicacion: parcial.publicacion ?? null,
      descuento,
      descuentoFueraDeDoa: descuento > maxDoa,
    };
  };

  switch (config.producto) {
    case "bundle": {
      const precios = conDescuento(BUNDLE[config.mc][config.descargas] ?? BUNDLE[config.mc][10], config.doa ?? 0, config.precioManual);
      return cerrar({
        nombre: config.mc === "ilim" ? "Mora Control Ilimitado + Informes Comerciales" : "Mora Control 4100 + Informes Comerciales",
        detalle: `${config.descargas} descargas de Reporte Interactivo/mes`,
        cobro: "mensual",
        ...precios,
        q: config.descargas,
        beneficios: [`Plan de ${config.descargas} descargas de Reporte Interactivo (informe comercial) al mes`, ...BENEFICIOS[config.mc === "ilim" ? "bundleIlim" : "bundle4100"]],
      });
    }
    case "mc": {
      const plan = MORA_CONTROL[config.plan];
      return cerrar({
        nombre: "Mora Control",
        detalle: plan.etiqueta.replace(/^MC\s+/, "Plan "),
        cobro: "mensual",
        ...conDescuento(plan.uf, config.doa, config.precioManual),
        q: null,
        beneficios: BENEFICIOS.mc,
      });
    }
    case "ri":
      return cerrar({
        nombre: "Reporte Comercial (Reporte Interactivo)",
        detalle: `${config.tramo} descargas de Reporte Interactivo/mes`,
        cobro: "mensual",
        ...conDescuento(REPORTE_INTERACTIVO[config.tramo] ?? 0, config.doa, config.precioManual),
        q: config.tramo,
        beneficios: [`Plan de ${config.tramo} descargas de Reporte Interactivo al mes`, ...BENEFICIOS.ri],
      });
    case "bolsa":
      return cerrar({
        nombre: "Informes Comerciales Bolsa (Reporte Interactivo Bolsa)",
        detalle: `${config.tramo} descargas de Reporte Interactivo en 12 meses`,
        cobro: "unico",
        ...conDescuento(BOLSA_RI[config.tramo] ?? 0, 0, config.precioManual),
        q: config.tramo,
        beneficios: [`Bolsa de ${config.tramo} informes comerciales para 12 meses`, ...BENEFICIOS.bolsa],
      });
    case "malla":
      return cerrar({
        nombre: "Malla Societaria",
        detalle: `${config.tramo} consultas/mes`,
        cobro: "mensual",
        ...conDescuento(MALLA[config.tramo] ?? 0, config.doa, config.precioManual),
        q: config.tramo,
        beneficios: [`Plan de ${config.tramo} consultas al mes`, ...BENEFICIOS.malla],
      });
    case "datafinder": {
      const fila = DATA_FINDER[config.tramo] ?? DATA_FINDER[50];
      const tarifa = fila.tarifa * (1 - config.doa / 100);
      return cerrar({
        nombre: "Data Finder",
        detalle: `${config.tramo} consultas/mes`,
        cobro: "mensual",
        ...conDescuento(fila.uf, config.doa, config.precioManual),
        q: config.tramo,
        beneficios: BENEFICIOS.datafinder,
        nota: `Consulta adicional: ${(tarifa * 1.2).toLocaleString("es-CL", { maximumFractionDigits: 4 })} UF + IVA`,
      });
    }
    case "pfm": {
      const ruts = Math.max(1, Math.min(5000, Math.round(config.ruts || 1)));
      const frecuencia = FRECUENCIA_ETIQUETA[config.frecuencia];
      return cerrar({
        nombre: "Portfolio Monitor",
        detalle: `${frecuencia} · ${miles(ruts)} RUTs`,
        cobro: "mensual",
        ...conDescuento(tarifaPortfolio(config.frecuencia, ruts) * ruts, config.doa, config.precioManual),
        q: ruts,
        beneficios: BENEFICIOS.pfm.map((beneficio) =>
          beneficio === "Actualización semanal, quincenal o mensual" ? `Actualización ${frecuencia.toLowerCase()} de toda la cartera` : beneficio,
        ),
      });
    }
    case "pc": {
      const tamano = PARTNER_CHECK[config.tamano];
      return cerrar({
        nombre: "Partner Check",
        detalle: `Empresa ${tamano.etiqueta.toLowerCase()}`,
        cobro: "anual",
        ...conDescuento(tamano.uf, 0, config.precioManual),
        q: null,
        beneficios: BENEFICIOS.pc,
      });
    }
    case "bdd": {
      const registros = Math.max(1, Math.round(config.registros || 0));
      const valor = config.ufBackoffice != null && config.ufBackoffice > 0 ? redondear2(config.ufBackoffice) : null;
      return cerrar({
        nombre: "Base de Datos Comercial",
        detalle: `${miles(registros)} registros de ${config.universo}`,
        cobro: "unico",
        ufLista: valor,
        ufVenta: valor,
        q: registros,
        beneficios: BENEFICIOS.bdd,
        nota: valor ? null : "Valor por confirmar con BackOffice (referencia: desde 1.000 RUT por 10 UF + IVA).",
      });
    }
    case "pub": {
      const pct = config.pct > 0 && config.pct <= 100 ? config.pct : 15;
      const publicacion = calcularPublicacion(pct, config.documentos.slice(0, 12));
      return cerrar({
        nombre: "Publicación Única",
        detalle: `${publicacion.documentos.length} ${publicacion.documentos.length === 1 ? "documento" : "documentos"} a publicar en DICOM`,
        cobro: "clp",
        ufLista: null,
        ufVenta: null,
        q: publicacion.documentos.length,
        beneficios: BENEFICIOS.pub,
        publicacion,
      });
    }
  }
}

export type Totales = {
  mensual: number;
  unico: number;
  anual: number;
  clp: number;
  /** Lo que va a «UF mensual» de la tipificación: lo mensual, o lo único/anual si no hay mensual. */
  ufTipificacion: number | null;
};

export function totales(lineas: LineaCotizada[]): Totales {
  const suma = (cobro: Cobro) => redondear4(lineas.filter((linea) => linea.cobro === cobro).reduce((total, linea) => total + (linea.ufVenta ?? 0), 0));
  const mensual = suma("mensual");
  const unico = suma("unico");
  const anual = suma("anual");
  const clp = lineas.reduce((total, linea) => total + (linea.publicacion?.total ?? 0), 0);
  const ufTipificacion = mensual > 0 ? mensual : unico + anual > 0 ? redondear4(unico + anual) : null;
  return { mensual, unico, anual, clp, ufTipificacion };
}

// ── Formatos ──────────────────────────────────────────────────────────────

export function formatoUf(valor: number): string {
  return valor.toLocaleString("es-CL", { minimumFractionDigits: valor % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
}

export function formatoPesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CL")}`;
}

export function etiquetaCobro(linea: Pick<LineaCotizada, "cobro" | "producto">): string {
  if (linea.producto === "bolsa") return "Pago único · 12 meses";
  return ETIQUETA_COBRO[linea.cobro];
}

export const ETIQUETA_COBRO: Record<Cobro, string> = {
  mensual: "Cargo fijo mensual",
  unico: "Pago único",
  anual: "Pago anual",
  clp: "Total a pagar",
};
