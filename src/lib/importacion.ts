/**
 * Importar fichas desde una planilla: reconocer las columnas por su título
 * («Nombre», «Teléfono», «Celular», «E-mail», «Mascota»…) y dejar cada fila
 * con las llaves que entiende la base. Puro: lo usan el navegador (vista
 * previa) y las pruebas.
 */

export type CampoImportable = "nombre" | "rut" | "telefono" | "correo" | "comuna" | "mascota" | "especie" | "raza" | "sexo" | "nacimiento" | "nota";

export const CAMPOS: { campo: CampoImportable; etiqueta: string; soloVet?: boolean }[] = [
  { campo: "nombre", etiqueta: "Nombre" },
  { campo: "telefono", etiqueta: "Celular" },
  { campo: "correo", etiqueta: "Correo" },
  { campo: "rut", etiqueta: "RUT" },
  { campo: "comuna", etiqueta: "Comuna" },
  { campo: "mascota", etiqueta: "Mascota", soloVet: true },
  { campo: "especie", etiqueta: "Especie", soloVet: true },
  { campo: "raza", etiqueta: "Raza", soloVet: true },
  { campo: "sexo", etiqueta: "Sexo", soloVet: true },
  { campo: "nacimiento", etiqueta: "Nacimiento", soloVet: true },
  { campo: "nota", etiqueta: "Nota" },
];

const SINONIMOS: Record<CampoImportable, string[]> = {
  nombre: ["nombre", "nombre completo", "paciente", "cliente", "tutor", "propietario", "dueno", "nombres", "nombre y apellido", "razon social"],
  telefono: ["telefono", "celular", "movil", "fono", "whatsapp", "tel", "numero", "telefono movil", "cel"],
  correo: ["correo", "email", "e mail", "mail", "correo electronico"],
  rut: ["rut", "run", "rut paciente", "documento", "dni", "cedula"],
  comuna: ["comuna", "ciudad", "localidad"],
  mascota: ["mascota", "nombre mascota", "paciente mascota", "animal", "nombre del paciente"],
  especie: ["especie", "tipo", "tipo de animal"],
  raza: ["raza"],
  sexo: ["sexo", "genero"],
  nacimiento: ["nacimiento", "fecha nacimiento", "fecha de nacimiento", "f nacimiento"],
  nota: ["nota", "notas", "observacion", "observaciones", "comentario", "comentarios"],
};

export function normalizarTitulo(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Para cada columna de la planilla, el campo que parece ser (o null). Gana
 * la coincidencia exacta; después, la que contiene el sinónimo. Un campo se
 * asigna a una sola columna. En Vet, «paciente» es la mascota y no la persona.
 */
export function detectarColumnas(titulos: string[], esVet: boolean): (CampoImportable | null)[] {
  const asignados = new Set<CampoImportable>();
  const normalizados = titulos.map(normalizarTitulo);
  const resultado: (CampoImportable | null)[] = titulos.map(() => null);
  const candidatos = (Object.keys(SINONIMOS) as CampoImportable[]).filter((campo) => esVet || !CAMPOS.find((item) => item.campo === campo)?.soloVet);
  const sinonimosDe = (campo: CampoImportable) =>
    esVet && campo === "nombre" ? SINONIMOS.nombre.filter((sinonimo) => sinonimo !== "paciente") : esVet && campo === "mascota" ? [...SINONIMOS.mascota, "paciente"] : SINONIMOS[campo];

  for (const pasada of ["exacta", "contiene"] as const) {
    normalizados.forEach((titulo, indice) => {
      if (resultado[indice] || !titulo) return;
      const campo = candidatos.find(
        (opcion) => !asignados.has(opcion) && sinonimosDe(opcion).some((sinonimo) => (pasada === "exacta" ? titulo === sinonimo : titulo.includes(sinonimo))),
      );
      if (campo) {
        resultado[indice] = campo;
        asignados.add(campo);
      }
    });
  }
  return resultado;
}

/** Excel guarda las fechas como número de días desde 1899-12-30. */
function fechaDeCelda(valor: unknown): string {
  if (typeof valor === "number" && valor > 1000 && valor < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + valor * 86400000).toISOString().slice(0, 10);
  }
  const texto = String(valor ?? "").trim();
  const dmy = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : "";
}

/** Las filas de la planilla, con las llaves de la base. Descarta filas vacías. */
export function filasParaImportar(filas: unknown[][], columnas: (CampoImportable | null)[]): Record<string, string>[] {
  const salida: Record<string, string>[] = [];
  for (const fila of filas) {
    const registro: Record<string, string> = {};
    columnas.forEach((campo, indice) => {
      if (!campo) return;
      const valor = fila[indice];
      const texto = campo === "nacimiento" ? fechaDeCelda(valor) : String(valor ?? "").trim();
      if (texto) registro[campo] = texto.slice(0, 300);
    });
    if (Object.keys(registro).length > 0) salida.push(registro);
  }
  return salida;
}

/** Planilla de ejemplo para descargar (CSV con punto y coma, como la abre Excel en Chile). */
export function plantillaCsv(esVet: boolean): string {
  const titulos = esVet ? ["Nombre", "Celular", "Correo", "RUT", "Comuna", "Mascota", "Especie", "Raza", "Nacimiento"] : ["Nombre", "Celular", "Correo", "RUT", "Comuna", "Nota"];
  const ejemplo = esVet
    ? ["Camila Rojas", "9 8765 4321", "camila@correo.cl", "12.345.678-9", "Ñuñoa", "Luna", "Gato", "Siamés", "2021-03-15"]
    : ["Camila Rojas", "9 8765 4321", "camila@correo.cl", "12.345.678-9", "Ñuñoa", "Paciente desde 2019"];
  return `${titulos.join(";")}\n${ejemplo.join(";")}\n`;
}
