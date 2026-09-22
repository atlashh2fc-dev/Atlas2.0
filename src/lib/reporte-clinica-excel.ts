/**
 * Descargas en Excel del tablero de la clínica.
 *
 * Los números se escriben como números (no como texto formateado), con el
 * formato de pesos o de porcentaje puesto en la celda: así la planilla suma,
 * filtra y hace tablas dinámicas sin limpiar nada. Cada hoja lleva autofiltro
 * y anchos de columna según su contenido.
 */

export type ValorExcel = string | number | boolean | null | undefined;
export type FilaExcel = Record<string, ValorExcel>;
export type FormatoColumna = "clp" | "pct" | "int" | "fecha";

export type HojaExcel = { nombre: string; filas: FilaExcel[]; formatos?: Record<string, FormatoColumna> };

const FORMATO_CELDA: Record<FormatoColumna, string> = {
  clp: '"$"#,##0',
  // Los porcentajes llegan como 0–100: se guardan como fracción para que Excel los entienda.
  pct: "0.0%",
  int: "#,##0",
  fecha: "dd-mm-yyyy",
};

/** Excel acepta hasta 31 caracteres y no permite algunos signos en el nombre de la hoja. */
function nombreDeHoja(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Hoja";
  let candidato = base;
  let n = 2;
  while (usados.has(candidato.toLowerCase())) candidato = `${base.slice(0, 28)} ${n++}`;
  usados.add(candidato.toLowerCase());
  return candidato;
}

function archivo(nombre: string): string {
  const limpio = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").toLowerCase();
  return `${limpio || "reporte"}.xlsx`;
}

export async function descargarLibro(nombreArchivo: string, hojas: HojaExcel[]): Promise<void> {
  const XLSX = await import("xlsx");
  const libro = XLSX.utils.book_new();
  const usados = new Set<string>();
  for (const hoja of hojas) {
    const filas = hoja.filas.map((fila) => {
      const copia: FilaExcel = {};
      for (const [columna, valor] of Object.entries(fila)) {
        const formato = hoja.formatos?.[columna];
        if (formato === "pct" && typeof valor === "number") copia[columna] = valor / 100;
        else if (formato === "fecha" && typeof valor === "string" && /^\d{4}-\d{2}-\d{2}/.test(valor)) {
          copia[columna] = new Date(`${valor.slice(0, 10)}T12:00:00Z`) as unknown as ValorExcel;
        } else copia[columna] = valor;
      }
      return copia;
    });
    const hojaXlsx = XLSX.utils.json_to_sheet(filas.length ? filas : [{ Aviso: "Sin datos para este período y estos filtros" }], { cellDates: true });
    const columnas = filas.length ? Object.keys(filas[0]) : ["Aviso"];
    if (filas.length && hojaXlsx["!ref"]) {
      const rango = XLSX.utils.decode_range(hojaXlsx["!ref"]);
      columnas.forEach((columna, c) => {
        const formato = hoja.formatos?.[columna];
        if (!formato) return;
        for (let r = 1; r <= rango.e.r; r++) {
          const celda = hojaXlsx[XLSX.utils.encode_cell({ r, c })];
          if (celda && (celda.t === "n" || celda.t === "d")) celda.z = FORMATO_CELDA[formato];
        }
      });
      hojaXlsx["!autofilter"] = { ref: hojaXlsx["!ref"] };
    }
    hojaXlsx["!cols"] = columnas.map((columna) => {
      const largo = Math.max(columna.length, ...hoja.filas.slice(0, 300).map((f) => String(f[columna] ?? "").length));
      return { wch: Math.min(48, Math.max(10, largo + 2)) };
    });
    XLSX.utils.book_append_sheet(libro, hojaXlsx, nombreDeHoja(hoja.nombre, usados));
  }
  XLSX.writeFile(libro, archivo(nombreArchivo));
}

export function descargarHoja(nombre: string, filas: FilaExcel[], formatos?: Record<string, FormatoColumna>): Promise<void> {
  return descargarLibro(nombre, [{ nombre, filas, formatos }]);
}
