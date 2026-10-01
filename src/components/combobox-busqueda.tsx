"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { coincide } from "@/lib/busqueda-tolerante";
import { cn } from "@/lib/utils";

/**
 * Selector con búsqueda para listas largas (personas, mascotas).
 *
 * Reemplaza al <select> nativo cuando las opciones son cientos: el select
 * obligaba a recorrerlas con la rueda y además cortaba sin aviso en las que
 * alcanzaba a cargar la página. Acá se escribe parte del nombre o del RUT
 * (con o sin puntos y guion, con o sin tildes) y, si la empresa tiene más
 * registros que los cargados, se pregunta al servidor.
 *
 * Patrón WAI-ARIA «combobox con listbox»: ↑ ↓ recorren, Enter elige, Esc
 * cierra la lista (y un segundo Esc deja que se cierre el panel). Lo que se
 * envía con el formulario es el `value` de la opción, en un input oculto con
 * el `name` de siempre.
 */

export type OpcionCombobox = {
  value: string;
  label: string;
  /** Segunda línea: RUT, tutor, especie… También se busca en ella. */
  detalle?: string;
};

const MAX_VISIBLES = 50;

export function ComboboxBusqueda<T extends OpcionCombobox>({
  name,
  label,
  opciones,
  seleccion,
  onSeleccion,
  placeholder = "Escribe para buscar",
  requerido = false,
  mensajeRequerido = "Elige una opción de la lista.",
  opcionVacia,
  total,
  buscarEnServidor,
  autoFocus = false,
  ayuda,
}: {
  /** Nombre del campo que recibe la acción (input oculto). */
  name: string;
  label: string;
  opciones: T[];
  seleccion: T | null;
  onSeleccion: (opcion: T | null) => void;
  placeholder?: string;
  requerido?: boolean;
  mensajeRequerido?: string;
  /** Primera opción que deja el campo vacío («Sin mascota»). */
  opcionVacia?: string;
  /** Cuántas hay en la base; si supera las cargadas, se avisa y se busca en el servidor. */
  total?: number;
  buscarEnServidor?: (consulta: string) => Promise<T[]>;
  autoFocus?: boolean;
  ayuda?: string;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-lista`;
  const estadoId = `${id}-estado`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  const [abierta, setAbierta] = useState(false);
  const [editando, setEditando] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [escribio, setEscribio] = useState(false);
  const [activa, setActiva] = useState(0);
  const [remotas, setRemotas] = useState<T[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [falloServidor, setFalloServidor] = useState(false);

  const hayMas = typeof total === "number" && total > opciones.length;
  const filtro = escribio ? consulta.trim() : "";
  const consultaServidor = hayMas && buscarEnServidor && filtro.length >= 2 ? filtro : "";

  // Búsqueda en el servidor, con espera corta para no consultar por cada tecla.
  useEffect(() => {
    if (!consultaServidor || !buscarEnServidor) return;
    let vigente = true;
    const espera = window.setTimeout(() => {
      setBuscando(true);
      setFalloServidor(false);
      buscarEnServidor(consultaServidor)
        .then((resultado) => {
          if (vigente) setRemotas(resultado);
        })
        .catch(() => {
          if (vigente) setFalloServidor(true);
        })
        .finally(() => {
          if (vigente) setBuscando(false);
        });
    }, 250);
    return () => {
      vigente = false;
      window.clearTimeout(espera);
    };
  }, [consultaServidor, buscarEnServidor]);

  const coincidencias = useMemo(() => {
    const vistas = new Set<string>();
    const todas: T[] = [];
    for (const opcion of consultaServidor ? [...opciones, ...remotas] : opciones) {
      if (vistas.has(opcion.value) || !coincide(opcion, filtro)) continue;
      vistas.add(opcion.value);
      todas.push(opcion);
    }
    return todas;
  }, [opciones, remotas, filtro, consultaServidor]);

  const visibles = coincidencias.slice(0, MAX_VISIBLES);
  // La opción vacía va primero y solo mientras no se esté filtrando.
  const items: Array<T | null> = opcionVacia && !filtro ? [null, ...visibles] : visibles;
  const activaSegura = Math.min(activa, Math.max(items.length - 1, 0));

  // Sin elección válida el formulario no se envía: el input oculto no participa
  // de la validación nativa, así que la lleva el campo visible.
  useEffect(() => {
    inputRef.current?.setCustomValidity(requerido && !seleccion ? mensajeRequerido : "");
  }, [requerido, seleccion, mensajeRequerido]);

  useEffect(() => {
    if (!abierta) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${activaSegura}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activaSegura, abierta]);

  function abrir() {
    if (abierta) return;
    const indiceElegido = seleccion ? items.findIndex((item) => item?.value === seleccion.value) : -1;
    setActiva(indiceElegido >= 0 ? indiceElegido : 0);
    setAbierta(true);
  }

  function elegir(opcion: T | null) {
    onSeleccion(opcion);
    setAbierta(false);
    setEditando(false);
    setEscribio(false);
    setConsulta("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!abierta) return abrir();
        setActiva((indice) => Math.min(indice + 1, items.length - 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!abierta) return abrir();
        setActiva((indice) => Math.max(indice - 1, 0));
        return;
      case "Home":
        if (abierta) {
          event.preventDefault();
          setActiva(0);
        }
        return;
      case "End":
        if (abierta) {
          event.preventDefault();
          setActiva(items.length - 1);
        }
        return;
      case "Enter":
        // Con la lista abierta, Enter elige y no envía el formulario.
        if (abierta && items.length > 0) {
          event.preventDefault();
          elegir(items[activaSegura] ?? null);
        }
        return;
      case "Escape":
        if (abierta) {
          // Cierra solo la lista; el panel que la contiene sigue abierto.
          event.preventDefault();
          event.stopPropagation();
          setAbierta(false);
          return;
        }
        if (escribio) {
          event.preventDefault();
          event.stopPropagation();
          setEscribio(false);
          setConsulta(seleccion?.label ?? "");
        }
        return;
      case "Tab":
        setAbierta(false);
        return;
    }
  }

  const valorVisible = editando ? consulta : (seleccion?.label ?? "");

  let estado = "";
  if (buscando) estado = `Buscando entre ${total?.toLocaleString("es-CL")}…`;
  else if (falloServidor) estado = "No se pudo buscar entre todas. Revisa tu conexión e inténtalo otra vez.";
  else if (filtro && coincidencias.length === 0)
    estado = hayMas && filtro.length < 2 ? "Escribe al menos 2 letras para buscar entre todas." : `Nada coincide con «${filtro}». Revisa el nombre o el RUT.`;
  else if (coincidencias.length > MAX_VISIBLES)
    estado = `Se muestran ${MAX_VISIBLES} de ${coincidencias.length.toLocaleString("es-CL")} coincidencias. Escribe más para acotar.`;
  else if (hayMas && !consultaServidor)
    estado = `Hay ${total?.toLocaleString("es-CL")} y se cargaron ${opciones.length.toLocaleString("es-CL")}. Escribe al menos 2 letras para buscar entre todas.`;
  else if (filtro) estado = `${coincidencias.length} ${coincidencias.length === 1 ? "coincidencia" : "coincidencias"}.`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={abierta}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={abierta && items.length > 0 ? `${id}-op-${activaSegura}` : undefined}
          aria-describedby={estadoId}
          aria-required={requerido || undefined}
          autoComplete="off"
          spellCheck={false}
          data-autofocus={autoFocus || undefined}
          placeholder={seleccion ? seleccion.label : placeholder}
          value={valorVisible}
          onFocus={(event) => {
            setEditando(true);
            setConsulta(seleccion?.label ?? "");
            setEscribio(false);
            // Escribir reemplaza la elección actual sin tener que borrarla a mano.
            requestAnimationFrame(() => event.target.select());
          }}
          onClick={abrir}
          onChange={(event) => {
            setConsulta(event.target.value);
            setEscribio(true);
            setActiva(0);
            setAbierta(true);
          }}
          onBlur={() => {
            // Borrar el texto y salir deja el campo vacío si se permite.
            if (escribio && !consulta.trim() && (opcionVacia || !requerido)) onSeleccion(null);
            setAbierta(false);
            setEditando(false);
            setEscribio(false);
          }}
          onKeyDown={onKeyDown}
          className="h-9 w-full rounded-lg border border-border-strong/70 bg-surface pl-9 pr-9 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">
          {buscando ? <Loader2 size={15} className="animate-spin" /> : <ChevronsUpDown size={15} />}
        </span>
        <input type="hidden" name={name} value={seleccion?.value ?? ""} />

        <ul
          ref={listaRef}
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!abierta}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((opcion, indice) => {
            const elegida = opcion ? seleccion?.value === opcion.value : !seleccion;
            return (
              <li
                key={opcion?.value ?? "__vacia"}
                id={`${id}-op-${indice}`}
                data-indice={indice}
                role="option"
                aria-selected={elegida}
                // mousedown y no click: así el input no pierde el foco antes de elegir.
                onMouseDown={(event) => {
                  event.preventDefault();
                  elegir(opcion);
                }}
                onMouseMove={() => setActiva(indice)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                  indice === activaSegura ? "bg-surface-muted" : "",
                  opcion ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opcion ? opcion.label : opcionVacia}</span>
                  {opcion?.detalle && <span className="block truncate text-xs text-muted-foreground">{opcion.detalle}</span>}
                </span>
                {elegida && <Check size={14} className="flex-shrink-0 text-primary" aria-hidden="true" />}
              </li>
            );
          })}
          {items.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">{buscando ? "Buscando…" : "Sin resultados"}</li>}
        </ul>
      </div>
      {/* Siempre montado: una región viva que aparece y desaparece no se anuncia. */}
      <p id={estadoId} role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {abierta && estado ? estado : (ayuda ?? (hayMas ? estado : ""))}
      </p>
    </div>
  );
}
