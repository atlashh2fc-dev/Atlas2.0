"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";

import { importarFichas, type ResultadoImportacion } from "@/app/actions/importacion";
import { buttonClasses } from "@/components/ui";
import { CAMPOS, detectarColumnas, filasParaImportar, plantillaCsv, type CampoImportable } from "@/lib/importacion";

/**
 * Tres pasos: subir la planilla, revisar qué columna es qué (viene adivinado
 * por el título), e importar. El resultado dice cuántas fichas nacieron,
 * cuántas ya existían y qué filas se saltaron y por qué.
 */
export function Importador({ esVet, plural }: { esVet: boolean; plural: string }) {
  const [archivo, setArchivo] = useState<string | null>(null);
  const [titulos, setTitulos] = useState<string[]>([]);
  const [filas, setFilas] = useState<unknown[][]>([]);
  const [columnas, setColumnas] = useState<(CampoImportable | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Extract<ResultadoImportacion, { ok: true }> | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [importando, iniciar] = useTransition();

  const campos = CAMPOS.filter((campo) => esVet || !campo.soloVet);
  const paraImportar = useMemo(() => filasParaImportar(filas, columnas), [filas, columnas]);
  const tieneNombre = columnas.includes("nombre");
  const tieneContacto = columnas.some((campo) => campo === "telefono" || campo === "correo" || campo === "rut");
  const paso = resultado ? 3 : filas.length ? 2 : 1;

  async function leer(entrada: File) {
    setError(null);
    setResultado(null);
    setLeyendo(true);
    try {
      if (entrada.size > 15 * 1024 * 1024) throw new Error("El archivo pesa más de 15 MB.");
      const [buffer, XLSX] = await Promise.all([entrada.arrayBuffer(), import("xlsx")]);
      const libro = XLSX.read(buffer, { type: "array", cellDates: false });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, blankrows: false, defval: "" });
      if (matriz.length < 2) throw new Error("La planilla no tiene filas bajo los títulos.");
      const encabezado = (matriz[0] ?? []).map((celda) => String(celda ?? ""));
      setArchivo(entrada.name);
      setTitulos(encabezado);
      setFilas(matriz.slice(1, 5001));
      setColumnas(detectarColumnas(encabezado, esVet));
      if (matriz.length - 1 > 5000) setError("La planilla tiene más de 5.000 filas: se cargan las primeras 5.000. Sube el resto en otro archivo.");
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pudimos leer el archivo. Prueba guardándolo como .xlsx o .csv.");
    } finally {
      setLeyendo(false);
    }
  }

  function importar() {
    setError(null);
    iniciar(async () => {
      const respuesta = await importarFichas(paraImportar);
      if (respuesta.ok) setResultado(respuesta);
      else setError(respuesta.error);
    });
  }

  function descargarPlantilla() {
    const blob = new Blob([`﻿${plantillaCsv(esVet)}`], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = `plantilla-${plural.toLowerCase()}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2 text-xs" aria-label="Pasos">
        {["Subir planilla", "Revisar columnas", "Listo"].map((nombre, indice) => (
          <li key={nombre} className="flex flex-1 flex-col gap-1">
            <span className={`h-1.5 rounded-full ${indice + 1 <= paso ? "bg-primary" : "bg-border"}`} aria-hidden="true" />
            <span className={indice + 1 === paso ? "font-medium text-foreground" : "text-muted-foreground"} aria-current={indice + 1 === paso ? "step" : undefined}>{nombre}</span>
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}

      {resultado ? (
        <section className="space-y-4 rounded-xl border border-border bg-surface p-6 text-center" aria-live="polite">
          <CheckCircle2 size={36} className="mx-auto text-success" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold">Importación lista</h2>
            <p className="text-sm text-muted-foreground">
              {resultado.creadas} {resultado.creadas === 1 ? "ficha nueva" : "fichas nuevas"} · {resultado.actualizadas} ya {resultado.actualizadas === 1 ? "existía y se completó" : "existían y se completaron"}
              {esVet ? ` · ${resultado.mascotas} mascotas` : ""}
              {resultado.omitidas ? ` · ${resultado.omitidas} filas saltadas` : ""}
            </p>
          </div>
          {resultado.errores.length > 0 && (
            <details className="text-left text-sm">
              <summary className="min-h-9 cursor-pointer font-medium">Ver filas saltadas</summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
                {resultado.errores.map((fila) => <li key={fila.fila}>Fila {fila.fila + 1}: {fila.motivo}</li>)}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/dashboard/pacientes" className={buttonClasses()}>Ver {plural.toLowerCase()}</Link>
            <button type="button" onClick={() => { setResultado(null); setFilas([]); setTitulos([]); setArchivo(null); }} className={buttonClasses({ variant: "ghost" })}>Importar otra planilla</button>
          </div>
        </section>
      ) : filas.length === 0 ? (
        <section className="space-y-4">
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface p-6 text-center hover:border-primary/50 focus-within:ring-2 focus-within:ring-ring">
            {leyendo ? <Loader2 size={28} className="animate-spin text-primary" aria-hidden="true" /> : <Upload size={28} className="text-muted-foreground" aria-hidden="true" />}
            <span className="text-sm font-medium">{leyendo ? "Leyendo la planilla…" : "Elige tu planilla de Excel o CSV"}</span>
            <span className="text-xs text-muted-foreground">Con una fila de títulos (Nombre, Celular, Correo, RUT{esVet ? ", Mascota, Especie" : ""}…). Hasta 5.000 filas.</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(evento) => evento.target.files?.[0] && leer(evento.target.files[0])} />
          </label>
          <button type="button" onClick={descargarPlantilla} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <Download size={14} aria-hidden="true" /> Descargar planilla de ejemplo
          </button>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="flex items-center gap-2 text-sm">
            <FileSpreadsheet size={16} className="text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{archivo}</span>
            <span className="text-muted-foreground">· {paraImportar.length} filas con datos</span>
          </p>
          <p className="text-sm text-muted-foreground">Revisa qué es cada columna. Lo que dejes en «No importar» se ignora.</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted/60">
                <tr>
                  {titulos.map((titulo, indice) => (
                    <th key={indice} className="min-w-36 px-3 py-2 text-left align-top font-normal">
                      <span className="mb-1 block truncate text-xs text-muted-foreground" title={titulo}>{titulo || `Columna ${indice + 1}`}</span>
                      <select
                        value={columnas[indice] ?? ""}
                        onChange={(evento) => setColumnas((actual) => actual.map((campo, posicion) => (posicion === indice ? ((evento.target.value || null) as CampoImportable | null) : campo === evento.target.value ? null : campo)))}
                        className="h-9 w-full rounded-md border border-border-strong/70 bg-surface px-2 text-sm"
                        aria-label={`Qué es la columna ${titulo || indice + 1}`}
                      >
                        <option value="">No importar</option>
                        {campos.map((campo) => <option key={campo.campo} value={campo.campo}>{campo.etiqueta}</option>)}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 5).map((fila, indice) => (
                  <tr key={indice} className="border-t border-border">
                    {titulos.map((_, columna) => (
                      <td key={columna} className={`max-w-48 truncate px-3 py-2 ${columnas[columna] ? "" : "text-muted-foreground/60"}`}>{String(fila[columna] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tieneNombre && <p className="text-sm text-danger">Falta indicar cuál columna es el nombre.</p>}
          {tieneNombre && !tieneContacto && <p className="text-sm text-danger">Indica al menos el celular, el correo o el RUT: así no se duplican fichas.</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => { setFilas([]); setTitulos([]); setArchivo(null); }} className={buttonClasses({ variant: "ghost" })}>Elegir otro archivo</button>
            <button type="button" disabled={!tieneNombre || !tieneContacto || importando || paraImportar.length === 0} onClick={importar} className={buttonClasses()}>
              {importando && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {importando ? "Importando…" : `Importar ${paraImportar.length} ${paraImportar.length === 1 ? "fila" : "filas"}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
