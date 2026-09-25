import * as XLSX from "xlsx";

/**
 * Reporte «Negocios en curso» de Equifax.
 *
 * Operación arma a mano la planilla «NEGOCIOS EN CURSO INFOBUSINESS» copiando
 * desde Atlas; la hoja Data es la que manda a Equifax. Este libro reproduce esa
 * hoja con los mismos encabezados y en el mismo orden (incluidas sus erratas,
 * «FECHA GETION », y los espacios finales), para que las tablas dinámicas y los
 * BUSCARV que ya usan sigan funcionando al pegar las filas.
 *
 * Las filas vienen de la RPC get_equifax_negocios: una por negocio (empresa con
 * cotización o venta tipificada). Q es la cantidad de consultas o registros
 * (de Atlas 1 o de la ficha). Lo que Atlas no registra —$, número de contrato
 * y Back— queda vacío para que operación lo complete.
 */

export type NegocioEquifax = {
  lead_id: string;
  campana: string;
  origen: string | null;
  asesor: string | null;
  rut: string | null;
  empresa: string | null;
  productos: string[] | null;
  uf: number | string | null;
  q_consultas?: number | string | null;
  id_audio: string | null;
  estado: string;
  observacion: string | null;
  nombre_cliente: string | null;
  telefono: string | null;
  email: string | null;
  observaciones_equipo: string | null;
  fecha_seguimiento: string | null;
  fecha_gestion: string | null;
  fecha_ok_contrato: string | null;
  ultima_gestion: string | null;
  fecha_ultima_gestion: string | null;
};

export const ENCABEZADOS_DATA = [
  "AÑO",
  "MES CIERRE",
  "ORIGEN",
  "PLATAFORMA ",
  "ASESOR",
  "RUT",
  "EMPRESA",
  "TIPO CONTRATO",
  "PRODUCTO",
  "Q",
  "$",
  "UF",
  "ID AUDIO ",
  "ESTADO",
  "OBSERVACIONES VOCAL ",
  "NOMBRE CLIENTE",
  "TELEFONO CLIENTE",
  "EMAIL CLIENTE",
  "Obs equipo",
  "fecha seguimiento",
  "NUMERO CONTRATO ",
  "FECHA GETION ",
  "fecha  ok contrato ",
  "Back ",
  "ULTIMA GESTION",
] as const;

export const ESTADOS_EQUIFAX = [
  "APROBADO DEFINITIVO",
  "PDTE FIRMA",
  "PDTE RESPUESTA CLIENTE",
  "RECHAZO DEFINITIVO",
  "REVISION EQUIFAX",
] as const;

const TIPOS_CONTRATO = ["ONE TIME", "PUBLICACION UNICA", "RECURRENTE"] as const;

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

const FORMATO_FECHA = "dd-mm-yyyy";

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Plataforma de cada asesor según la hoja Dotacion de operación: los de la
 * plataforma «NORMAL» son estos; el resto trabaja en «PLACA». Se reconoce por
 * nombre y apellido para que calce tanto «Eduardo Perez» como «EDUARDO RODRIGO
 * PEREZ MOYA».
 */
const ASESORES_NORMAL: Array<[string, string]> = [
  ["andrea", "zuniga"],
  ["catherine", "gaete"],
  ["eduardo", "perez"],
  ["francisca", "chaparro"],
  ["isabel", "zamorano"],
  ["juan", "grajales"],
  ["ximena", "cofre"],
];

export function plataformaDeAsesor(asesor: string | null): string {
  if (!asesor?.trim()) return "";
  const palabras = new Set(normalizar(asesor).split(" "));
  return ASESORES_NORMAL.some(([nombre, apellido]) => palabras.has(nombre) && palabras.has(apellido))
    ? "NORMAL"
    : "PLACA";
}

/**
 * Tipo de contrato según el producto (hoja Hoja5 de operación): bolsas y bases
 * de datos se venden una vez, el documento único es publicación única y lo
 * demás (Bundle, Mora Control, RI, Portfolio, DataFinder, Malla…) es
 * recurrente. Si el negocio mezcla productos, manda el recurrente.
 */
export function tipoContrato(productos: string[] | null): string {
  const tipos = (productos ?? [])
    .map((producto) => normalizar(producto))
    .filter(Boolean)
    .map((producto) => {
      if (producto.includes("documento unico") || producto.includes("publicacion")) return "PUBLICACION UNICA";
      if (producto.includes("bolsa") || producto.includes("bbdd") || producto.includes("one time")) return "ONE TIME";
      return "RECURRENTE";
    });
  if (tipos.includes("RECURRENTE")) return "RECURRENTE";
  if (tipos.includes("ONE TIME")) return "ONE TIME";
  return tipos[0] ?? "";
}

/** RUT como lo lleva la planilla: solo dígitos y K, sin puntos ni guion. */
export function rutPlanilla(rut: string | null): string {
  return (rut ?? "").toUpperCase().replace(/[^0-9K]/g, "");
}

function partesFecha(valor: string | null): [number, number, number] | null {
  const match = valor?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Día de Chile de un instante (la agenda llega como timestamptz). */
export function diaEnChile(instante: string | null): string | null {
  if (!instante) return null;
  const fecha = new Date(instante);
  if (!Number.isFinite(fecha.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

/** Número de serie de Excel de un día, sin pasar por la zona horaria del servidor. */
function serieExcel(dia: string | null): number | null {
  const partes = partesFecha(dia);
  if (!partes) return null;
  return Date.UTC(partes[0], partes[1] - 1, partes[2]) / 86_400_000 + 25_569;
}

function fechaTexto(dia: string | null): string {
  const partes = partesFecha(dia);
  if (!partes) return "";
  return `${String(partes[2]).padStart(2, "0")}-${String(partes[1]).padStart(2, "0")}-${partes[0]}`;
}

function numero(valor: number | string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

type Celda = string | number | null | { fecha: string | null };

export function filaData(negocio: NegocioEquifax): Celda[] {
  const gestion = partesFecha(negocio.fecha_gestion);
  const ultima = negocio.ultima_gestion?.trim()
    ? [fechaTexto(negocio.fecha_ultima_gestion), negocio.ultima_gestion.trim()].filter(Boolean).join(" · ")
    : "";
  return [
    gestion ? gestion[0] : null,
    gestion ? MESES[gestion[1] - 1] : "",
    negocio.origen ?? "",
    plataformaDeAsesor(negocio.asesor),
    negocio.asesor ?? "",
    rutPlanilla(negocio.rut),
    negocio.empresa ?? "",
    tipoContrato(negocio.productos),
    (negocio.productos ?? []).join(" + "),
    numero(negocio.q_consultas ?? null),
    null,
    numero(negocio.uf),
    negocio.id_audio ?? "",
    negocio.estado,
    negocio.observacion ?? "",
    negocio.nombre_cliente ?? "",
    negocio.telefono ?? "",
    negocio.email ?? "",
    negocio.observaciones_equipo ?? "",
    { fecha: diaEnChile(negocio.fecha_seguimiento) },
    null,
    { fecha: negocio.fecha_gestion },
    { fecha: negocio.fecha_ok_contrato },
    null,
    ultima,
  ];
}

function celdaXlsx(valor: Celda): XLSX.CellObject | null {
  if (valor === null || valor === "") return null;
  if (typeof valor === "object") {
    const serie = serieExcel(valor.fecha);
    return serie === null ? null : { t: "n", v: serie, z: FORMATO_FECHA };
  }
  if (typeof valor === "number") return { t: "n", v: valor };
  return { t: "s", v: valor };
}

function hojaDesdeFilas(encabezados: readonly string[], filas: Celda[][], anchos: number[]): XLSX.WorkSheet {
  const hoja: XLSX.WorkSheet = {};
  encabezados.forEach((texto, c) => {
    hoja[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: texto };
  });
  filas.forEach((fila, i) => {
    fila.forEach((valor, c) => {
      const celda = celdaXlsx(valor);
      if (celda) hoja[XLSX.utils.encode_cell({ r: i + 1, c })] = celda;
    });
  });
  const rango = { s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1), c: encabezados.length - 1 } };
  hoja["!ref"] = XLSX.utils.encode_range(rango);
  hoja["!autofilter"] = { ref: XLSX.utils.encode_range({ s: rango.s, e: { r: filas.length, c: rango.e.c } }) };
  hoja["!cols"] = anchos.map((wch) => ({ wch }));
  return hoja;
}

const ANCHOS_DATA = [6, 12, 30, 11, 28, 12, 40, 16, 26, 6, 10, 7, 38, 24, 50, 30, 15, 30, 60, 12, 16, 12, 12, 8, 36];

/**
 * Hoja TD: la tabla dinámica que operación tiene junto a Data, suma de UF por
 * tipo de contrato y estado. Debajo, la misma cuenta en cantidad de negocios.
 */
function hojaTd(negocios: NegocioEquifax[]): XLSX.WorkSheet {
  const estados = ESTADOS_EQUIFAX.filter((estado) => negocios.some((n) => n.estado === estado));
  const tipos = [...TIPOS_CONTRATO, ""].filter((tipo) =>
    negocios.some((n) => tipoContrato(n.productos) === tipo),
  );
  const filas: Celda[][] = [];
  const bloque = (titulo: string, valor: (n: NegocioEquifax) => number) => {
    filas.push([titulo, "Estado"]);
    filas.push(["Tipo contrato", ...estados, "Total general"]);
    const totalPorEstado = estados.map(() => 0);
    let totalGeneral = 0;
    for (const tipo of tipos) {
      const delTipo = negocios.filter((n) => tipoContrato(n.productos) === tipo);
      const porEstado = estados.map((estado, i) => {
        const suma = redondear(delTipo.filter((n) => n.estado === estado).reduce((s, n) => s + valor(n), 0));
        totalPorEstado[i] += suma;
        return suma;
      });
      const total = redondear(porEstado.reduce((s, v) => s + v, 0));
      totalGeneral += total;
      filas.push([tipo || "(sin producto)", ...porEstado.map((v) => v || null), total]);
    }
    filas.push(["Total general", ...totalPorEstado.map((v) => redondear(v)), redondear(totalGeneral)]);
    filas.push([]);
  };
  bloque("Suma de UF", (n) => numero(n.uf) ?? 0);
  bloque("Cantidad de negocios", () => 1);

  const hoja: XLSX.WorkSheet = {};
  filas.forEach((fila, r) => {
    fila.forEach((valor, c) => {
      const celda = celdaXlsx(valor);
      if (celda) hoja[XLSX.utils.encode_cell({ r, c })] = celda;
    });
  });
  hoja["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: estados.length + 1 } });
  hoja["!cols"] = [{ wch: 22 }, ...estados.map(() => ({ wch: 22 })), { wch: 14 }];
  return hoja;
}

function redondear(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

export function nombreArchivoNegocios(hoy: string): string {
  const partes = partesFecha(hoy);
  const periodo = partes ? `${MESES[partes[1] - 1]} ${partes[0]}` : "";
  return `NEGOCIOS EN CURSO INFOBUSINESS ${periodo}.xlsx`.replace(/\s+\./, ".");
}

export function libroNegociosEquifax(negocios: NegocioEquifax[]): Uint8Array {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hojaDesdeFilas(ENCABEZADOS_DATA, negocios.map(filaData), ANCHOS_DATA), "Data");
  XLSX.utils.book_append_sheet(libro, hojaTd(negocios), "TD");
  return XLSX.write(libro, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array;
}
