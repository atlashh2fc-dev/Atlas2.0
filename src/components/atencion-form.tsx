"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Minus, Package, Plus, Search, Stethoscope, Trash2, X } from "lucide-react";

import { registrarAtenciones } from "@/app/actions/atenciones";
import { useInsumos } from "@/components/insumos-context";
import { ActionForm, ActionSubmit, Field, Input, Select } from "@/components/ui";
import {
  pesos,
  porCategoria,
  totalesMateriales,
  type AplicaA,
  type MaterialElegido,
  type Procedimiento,
} from "@/lib/arancel";
import { INFO_ESTADO, SUPERFICIES, piezaPorNumero, type EstadoPieza } from "@/lib/odontograma";

const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

type Linea = {
  clave: number;
  procedimiento: Procedimiento;
  precio: string;
  pieza: string;
  superficies: string[];
  materiales: MaterialElegido[];
  abierta: boolean;
};

// Claves de las líneas de la visita: solo tienen que ser únicas en la sesión.
let ultimaClave = 0;

const necesitaPieza = (procedimiento: Procedimiento) => procedimiento.aplica_a === "pieza" || procedimiento.aplica_a === "superficie";
const aNumero = (texto: string) => Number(texto.replace(/[^\d]/g, "")) || 0;
const formatoPrecio = (valor: number | null) => (valor ? Math.round(Number(valor)).toLocaleString("es-CL") : "");

/**
 * Registrar una atención.
 *
 * En la ficha se ve compacto: el contexto (pieza, zona, mascota), los
 * procedimientos más probables para un toque y el botón para abrir la visita.
 * La visita se abre en un espacio amplio, como en los softwares clínicos: a la
 * izquierda el arancel con buscador y categorías, a la derecha lo que se hizo
 * en esta visita (varios procedimientos, cada uno con su pieza, superficies,
 * precio y materiales), y abajo un solo total con el costo y el margen.
 */
export function AtencionForm({
  cuentaId,
  arancel,
  aplica,
  pieza,
  superficies,
  mascotaId,
  region,
  profesionales,
  onGuardada,
  titulo,
}: {
  cuentaId: string;
  arancel: Procedimiento[];
  /** Los procedimientos sugeridos para este contexto: los de la pieza, los de la mascota... */
  aplica: AplicaA[];
  pieza?: number;
  /** Superficies elegidas en la cruz (para los procedimientos por superficie). */
  superficies?: string[];
  mascotaId?: string;
  region?: string | null;
  profesionales: string[];
  onGuardada?: () => void;
  titulo?: string;
}) {
  const activos = useMemo(() => arancel.filter((procedimiento) => procedimiento.active), [arancel]);
  const sugeridos = useMemo(() => activos.filter((procedimiento) => aplica.includes(procedimiento.aplica_a)), [activos, aplica]);
  const [abierta, setAbierta] = useState(false);
  const [inicial, setInicial] = useState<Procedimiento | null>(null);

  if (activos.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay procedimientos en el arancel. Agrégalos en Procedimientos y precios.</p>;
  }

  const contexto = [
    pieza !== undefined ? `Pieza ${pieza}` : null,
    (superficies ?? []).length > 0 ? (superficies ?? []).join(" ") : null,
    region ?? null,
  ].filter(Boolean);

  const abrir = (procedimiento: Procedimiento | null) => {
    setInicial(procedimiento);
    setAbierta(true);
  };

  return (
    <div className="space-y-3">
      {titulo && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>}
      {sugeridos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sugeridos.slice(0, 6).map((procedimiento) => (
            <button
              key={procedimiento.id}
              type="button"
              onClick={() => abrir(procedimiento)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/5"
            >
              {procedimiento.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => abrir(null)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
      >
        <Stethoscope size={15} aria-hidden="true" /> Registrar atención
        {contexto.length > 0 && <span className="font-normal opacity-80">· {contexto.join(" · ")}</span>}
      </button>
      <p className="text-center text-[11px] text-muted-foreground">Varios procedimientos, materiales y cobro en una sola visita.</p>

      {abierta && (
        <Visita
          cuentaId={cuentaId}
          procedimientos={activos}
          sugeridos={sugeridos}
          inicial={inicial}
          pieza={pieza}
          superficies={superficies ?? []}
          mascotaId={mascotaId}
          region={region ?? null}
          profesionales={profesionales}
          titulo={titulo ?? "Registrar atención"}
          onCerrar={() => setAbierta(false)}
          onGuardada={() => {
            setAbierta(false);
            onGuardada?.();
          }}
        />
      )}
    </div>
  );
}

function Visita({
  cuentaId,
  procedimientos,
  sugeridos,
  inicial,
  pieza,
  superficies,
  mascotaId,
  region,
  profesionales,
  titulo,
  onCerrar,
  onGuardada,
}: {
  cuentaId: string;
  procedimientos: Procedimiento[];
  sugeridos: Procedimiento[];
  inicial: Procedimiento | null;
  pieza?: number;
  superficies: string[];
  mascotaId?: string;
  region: string | null;
  profesionales: string[];
  titulo: string;
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const { lista: catalogo, porId } = useInsumos();
  const esDental = procedimientos.some((procedimiento) => necesitaPieza(procedimiento) || procedimiento.aplica_a === "boca");
  const busquedaRef = useRef<HTMLInputElement>(null);

  const nuevaLinea = (procedimiento: Procedimiento): Linea => ({
    clave: ++ultimaClave,
    procedimiento,
    precio: formatoPrecio(procedimiento.one_time_price),
    pieza: necesitaPieza(procedimiento) && pieza !== undefined ? String(pieza) : "",
    superficies: procedimiento.aplica_a === "superficie" ? superficies : [],
    materiales: (procedimiento.receta ?? [])
      .filter((linea) => porId.has(linea.insumo_id))
      .map((linea) => ({ insumo_id: linea.insumo_id, cantidad: Number(linea.cantidad), cobrar: true })),
    abierta: false,
  });

  const [lineas, setLineas] = useState<Linea[]>(() => (inicial ? [nuevaLinea(inicial)] : []));
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string>(sugeridos.length > 0 ? "__sugeridos" : "__todos");

  // Pantalla completa: Escape cierra y el fondo no se desplaza. `onCerrar`
  // llega como función nueva en cada render del padre; con una referencia el
  // efecto corre una sola vez y no le roba el foco a quien está escribiendo.
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  }, [onCerrar]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cerrarRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    busquedaRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previo;
    };
  }, []);

  const grupos = useMemo(() => porCategoria(procedimientos), [procedimientos]);
  const normalizar = (texto: string) => texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const termino = normalizar(busqueda.trim());
  const visibles = termino
    ? procedimientos.filter((procedimiento) => normalizar(`${procedimiento.name} ${procedimiento.categoria ?? ""}`).includes(termino))
    : categoria === "__sugeridos"
      ? sugeridos
      : categoria === "__todos"
        ? procedimientos
        : procedimientos.filter((procedimiento) => (procedimiento.categoria ?? "Otros") === categoria);
  const cuantas = new Map<string, number>();
  for (const linea of lineas) cuantas.set(linea.procedimiento.id, (cuantas.get(linea.procedimiento.id) ?? 0) + 1);

  const agregar = (procedimiento: Procedimiento) => setLineas((actuales) => [...actuales, nuevaLinea(procedimiento)]);
  const cambiar = (clave: number, cambio: Partial<Linea>) =>
    setLineas((actuales) => actuales.map((linea) => (linea.clave === clave ? { ...linea, ...cambio } : linea)));
  const cambiarMaterial = (clave: number, insumo: string, cambio: Partial<MaterialElegido>) =>
    setLineas((actuales) =>
      actuales.map((linea) =>
        linea.clave === clave
          ? { ...linea, materiales: linea.materiales.map((material) => (material.insumo_id === insumo ? { ...material, ...cambio } : material)) }
          : linea,
      ),
    );

  // Totales de la visita.
  let totalProcedimientos = 0;
  let totalCobro = 0;
  let totalCosto = 0;
  const problemas: string[] = [];
  for (const linea of lineas) {
    const { costo, cobro } = totalesMateriales(linea.materiales, porId);
    totalProcedimientos += aNumero(linea.precio);
    totalCobro += cobro;
    totalCosto += costo;
    if (necesitaPieza(linea.procedimiento) && !piezaPorNumero(Number(linea.pieza))) problemas.push(`${linea.procedimiento.name}: indica la pieza`);
    if (linea.procedimiento.aplica_a === "superficie" && linea.superficies.length === 0) problemas.push(`${linea.procedimiento.name}: marca las superficies`);
  }
  const total = totalProcedimientos + totalCobro;
  const margen = total - totalCosto;
  const cambiaOdontograma = lineas.some((linea) => linea.procedimiento.resultado_odontograma && linea.pieza);

  const cargaUtil = JSON.stringify(
    lineas.map((linea) => ({
      producto_id: linea.procedimiento.id,
      precio: linea.precio === "" ? null : aNumero(linea.precio),
      pieza: linea.pieza === "" ? null : Number(linea.pieza),
      superficies: linea.superficies,
      insumos: linea.materiales.filter((material) => material.cantidad > 0),
    })),
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={titulo} className="fixed inset-0 z-50 flex items-stretch justify-center sm:p-4 lg:p-8">
      <div className="absolute inset-0 bg-foreground/40" onClick={onCerrar} aria-hidden="true" />
      <ActionForm
        action={registrarAtenciones}
        success={lineas.length === 1 ? "Atención registrada" : `${lineas.length} procedimientos registrados`}
        onSuccess={onGuardada}
        className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-surface shadow-2xl sm:rounded-2xl sm:border sm:border-border"
      >
        <input type="hidden" name="cuenta_id" value={cuentaId} />
        <input type="hidden" name="lineas" value={cargaUtil} />
        {mascotaId && <input type="hidden" name="mascota_id" value={mascotaId} />}
        {region && <input type="hidden" name="region" value={region} />}

        <header className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <Stethoscope size={18} className="text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{titulo}</h2>
            <p className="text-xs text-muted-foreground">Agrega todo lo que se hizo en esta visita. Los materiales parten de la receta de cada procedimiento.</p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="ml-auto flex size-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
          >
            <X size={18} />
          </button>
        </header>

        {/* En celular todo corre en una columna; en pantalla grande, arancel y visita lado a lado. */}
        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:overflow-hidden">
          {/* Arancel */}
          <section className="flex min-w-0 flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r">
            <div className="space-y-2.5 border-b border-border px-4 py-3">
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  ref={busquedaRef}
                  value={busqueda}
                  onChange={(event) => setBusqueda(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (visibles[0]) {
                        agregar(visibles[0]);
                        setBusqueda("");
                      }
                    }
                  }}
                  placeholder="Buscar procedimiento… (Enter agrega el primero)"
                  aria-label="Buscar procedimiento"
                  className="w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 lg:flex-wrap lg:overflow-visible">
                {[
                  ...(sugeridos.length > 0 ? [["__sugeridos", "Sugeridos"]] : []),
                  ["__todos", "Todos"],
                  ...grupos.map(([nombre]) => [nombre, nombre]),
                ].map(([valor, etiqueta]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => {
                      setCategoria(valor);
                      setBusqueda("");
                    }}
                    className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                      categoria === valor && !termino
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            </div>
            <ul className="max-h-[45vh] divide-y divide-border overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
              {visibles.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nada con “{busqueda}”.</li>}
              {visibles.map((procedimiento) => {
                const veces = cuantas.get(procedimiento.id) ?? 0;
                return (
                  <li key={procedimiento.id}>
                    <button
                      type="button"
                      onClick={() => agregar(procedimiento)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{procedimiento.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {[
                            termino || categoria === "__sugeridos" || categoria === "__todos" ? procedimiento.categoria : null,
                            procedimiento.duracion_min ? `${procedimiento.duracion_min} min` : null,
                            procedimiento.es_urgencia ? "urgencia" : null,
                            (procedimiento.receta?.length ?? 0) > 0 ? `${procedimiento.receta?.length} materiales` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {procedimiento.one_time_price ? pesos.format(Number(procedimiento.one_time_price)) : "—"}
                      </span>
                      <span
                        className={`flex size-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          veces > 0 ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
                        }`}
                      >
                        {veces > 0 ? veces : <Plus size={14} aria-hidden="true" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Esta visita */}
          <section className="flex min-w-0 flex-col bg-surface-muted/30 lg:min-h-0">
            <div className="px-4 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Esta visita {lineas.length > 0 && `· ${lineas.length} ${lineas.length === 1 ? "procedimiento" : "procedimientos"}`}
              </p>
              {lineas.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                  Elige a la izquierda lo que se hizo. Puedes agregar varios, y el mismo más de una vez (dos restauraciones en piezas distintas).
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {lineas.map((linea) => {
                    const { costo, cobro } = totalesMateriales(linea.materiales, porId);
                    const resultado = linea.procedimiento.resultado_odontograma as EstadoPieza | null;
                    const sinUsar = catalogo.filter((insumo) => insumo.activo && !linea.materiales.some((material) => material.insumo_id === insumo.id));
                    return (
                      <li key={linea.clave} className="rounded-xl border border-border bg-surface shadow-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
                          <div className="min-w-0 flex-1 basis-full sm:basis-0">
                            <p className="text-sm font-medium text-foreground">{linea.procedimiento.name}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              {linea.procedimiento.categoria}
                              {resultado && linea.pieza && (
                                <span className="flex items-center gap-1">
                                  · deja
                                  <span className="size-2 rounded-full" style={{ background: INFO_ESTADO[resultado].color }} />
                                  {INFO_ESTADO[resultado].label.toLowerCase()}
                                </span>
                              )}
                            </p>
                          </div>
                          {necesitaPieza(linea.procedimiento) && (
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              Pieza
                              <input
                                value={linea.pieza}
                                onChange={(event) => cambiar(linea.clave, { pieza: event.target.value.replace(/\D/g, "").slice(0, 2) })}
                                inputMode="numeric"
                                placeholder="36"
                                aria-label={`Pieza de ${linea.procedimiento.name}`}
                                className={`w-14 rounded-md border bg-background px-2 py-1.5 text-center text-sm tabular-nums text-foreground ${
                                  linea.pieza && !piezaPorNumero(Number(linea.pieza)) ? "border-danger" : "border-border"
                                }`}
                              />
                            </label>
                          )}
                          <label className="relative">
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                            <input
                              value={linea.precio}
                              onChange={(event) => cambiar(linea.clave, { precio: event.target.value })}
                              onBlur={() => cambiar(linea.clave, { precio: linea.precio === "" ? "" : aNumero(linea.precio).toLocaleString("es-CL") })}
                              inputMode="numeric"
                              aria-label={`Precio de ${linea.procedimiento.name}`}
                              className="w-32 rounded-md border border-border bg-background py-1.5 pl-6 pr-2 text-right text-sm tabular-nums text-foreground"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setLineas((actuales) => actuales.filter((item) => item.clave !== linea.clave))}
                            aria-label={`Quitar ${linea.procedimiento.name}`}
                            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger sm:ml-0"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>

                        {linea.procedimiento.aplica_a === "superficie" && (
                          <div className="flex items-center gap-1.5 px-3.5 pb-3">
                            <span className="mr-1 text-xs text-muted-foreground">Superficies</span>
                            {SUPERFICIES.map((superficie) => {
                              const marcada = linea.superficies.includes(superficie);
                              return (
                                <button
                                  key={superficie}
                                  type="button"
                                  aria-pressed={marcada}
                                  onClick={() =>
                                    cambiar(linea.clave, {
                                      superficies: marcada ? linea.superficies.filter((item) => item !== superficie) : [...linea.superficies, superficie],
                                    })
                                  }
                                  className={`size-8 rounded-md border text-xs font-semibold transition-colors ${
                                    marcada ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {superficie}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className="border-t border-border">
                          <button
                            type="button"
                            onClick={() => cambiar(linea.clave, { abierta: !linea.abierta })}
                            aria-expanded={linea.abierta}
                            className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                          >
                            <Package size={13} aria-hidden="true" />
                            <span className="flex-1">
                              {linea.materiales.length === 0
                                ? "Sin materiales · agregar"
                                : `${linea.materiales.length} ${linea.materiales.length === 1 ? "material" : "materiales"} · costo ${pesos.format(costo)}${
                                    cobro > 0 ? ` · se cobran ${pesos.format(cobro)}` : ""
                                  }`}
                            </span>
                            <ChevronDown size={14} className={`transition-transform ${linea.abierta ? "rotate-180" : ""}`} aria-hidden="true" />
                          </button>
                          {linea.abierta && (
                            <div className="space-y-1 px-3.5 pb-3">
                              {linea.materiales.map((material) => {
                                const insumo = porId.get(material.insumo_id);
                                if (!insumo) return null;
                                return (
                                  <div key={material.insumo_id} className="flex items-center gap-2 rounded-lg bg-surface-muted/60 px-2.5 py-1.5">
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm text-foreground">{insumo.nombre}</span>
                                      <span className="block text-[11px] text-muted-foreground">
                                        {pesos.format(Number(insumo.costo))} / {insumo.unidad}
                                        {insumo.stock !== null && Number(insumo.stock) <= Number(insumo.stock_minimo ?? 0) ? " · stock bajo" : ""}
                                      </span>
                                    </span>
                                    {insumo.cobrable && (
                                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Cobrar aparte al paciente">
                                        <input
                                          type="checkbox"
                                          checked={material.cobrar}
                                          onChange={(event) => cambiarMaterial(linea.clave, material.insumo_id, { cobrar: event.target.checked })}
                                          className="size-4 accent-[var(--primary)]"
                                        />
                                        Cobrar {pesos.format(Number(insumo.precio_venta ?? 0))}
                                      </label>
                                    )}
                                    <div className="flex items-center rounded-md border border-border bg-background">
                                      <button
                                        type="button"
                                        aria-label={`Menos ${insumo.nombre}`}
                                        onClick={() => cambiarMaterial(linea.clave, material.insumo_id, { cantidad: Math.max(0, material.cantidad - 1) })}
                                        className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
                                      >
                                        <Minus size={13} aria-hidden="true" />
                                      </button>
                                      <input
                                        value={material.cantidad}
                                        onChange={(event) =>
                                          cambiarMaterial(linea.clave, material.insumo_id, { cantidad: Number(event.target.value.replace(",", ".")) || 0 })
                                        }
                                        inputMode="decimal"
                                        aria-label={`Cantidad de ${insumo.nombre}`}
                                        className="w-10 bg-transparent text-center text-sm tabular-nums text-foreground focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        aria-label={`Más ${insumo.nombre}`}
                                        onClick={() => cambiarMaterial(linea.clave, material.insumo_id, { cantidad: material.cantidad + 1 })}
                                        className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
                                      >
                                        <Plus size={13} aria-hidden="true" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      aria-label={`Quitar ${insumo.nombre}`}
                                      onClick={() =>
                                        cambiar(linea.clave, { materiales: linea.materiales.filter((item) => item.insumo_id !== material.insumo_id) })
                                      }
                                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                                    >
                                      <X size={14} aria-hidden="true" />
                                    </button>
                                  </div>
                                );
                              })}
                              {sinUsar.length > 0 && (
                                <select
                                  aria-label="Agregar material"
                                  value=""
                                  onChange={(event) => {
                                    const id = event.target.value;
                                    if (id) cambiar(linea.clave, { materiales: [...linea.materiales, { insumo_id: id, cantidad: 1, cobrar: true }] });
                                  }}
                                  className="mt-1 w-full rounded-lg border border-dashed border-border bg-background px-2.5 py-2 text-sm text-muted-foreground"
                                >
                                  <option value="">+ Agregar material usado</option>
                                  {[...new Set(sinUsar.map((insumo) => insumo.categoria ?? "Otros"))].map((grupo) => (
                                    <optgroup key={grupo} label={grupo}>
                                      {sinUsar
                                        .filter((insumo) => (insumo.categoria ?? "Otros") === grupo)
                                        .map((insumo) => (
                                          <option key={insumo.id} value={insumo.id}>
                                            {insumo.nombre}
                                          </option>
                                        ))}
                                    </optgroup>
                                  ))}
                                </select>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Cierre de la visita */}
            <div className="space-y-3 border-t border-border bg-surface px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Profesional">
                  <Select name="profesional" defaultValue={profesionales[0] ?? ""}>
                    <option value="">Sin indicar</option>
                    {profesionales.map((profesional) => (
                      <option key={profesional}>{profesional}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Fecha">
                  <Input name="fecha" type="date" defaultValue={hoy()} />
                </Field>
                <Field label="Nota de la visita">
                  <Input name="nota" placeholder={esDental ? "Anestesia local, tolera bien" : "Tranquilo, sin sedación"} />
                </Field>
              </div>

              <div className="flex flex-wrap items-end justify-between gap-3">
                <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">Procedimientos</dt>
                  <dd className="text-right tabular-nums text-foreground">{pesos.format(totalProcedimientos)}</dd>
                  <dt className="text-muted-foreground">Materiales cobrados</dt>
                  <dd className="text-right tabular-nums text-foreground">{pesos.format(totalCobro)}</dd>
                  <dt className="text-muted-foreground">Costo materiales · margen</dt>
                  <dd className={`text-right tabular-nums ${margen < 0 ? "text-danger" : "text-success"}`}>
                    {pesos.format(totalCosto)} · {total > 0 ? `${Math.round((margen / total) * 100)}%` : "—"}
                  </dd>
                </dl>
                <div className="flex w-full flex-col items-end gap-2 sm:w-auto">
                  <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-foreground">
                    {cambiaOdontograma && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          defaultChecked
                          onChange={(event) => {
                            const oculto = event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="actualizar_odontograma"]');
                            if (oculto) oculto.value = event.currentTarget.checked ? "si" : "no";
                          }}
                          className="size-4 accent-[var(--primary)]"
                        />
                        Actualizar odontograma
                        <input type="hidden" name="actualizar_odontograma" defaultValue="si" />
                      </label>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="pagado" value="si" className="size-4 accent-[var(--primary)]" /> Pagado
                    </label>
                  </div>
                  {problemas.length > 0 && <p className="text-right text-xs font-medium text-warning">{problemas[0]}</p>}
                  <ActionSubmit pendingLabel="Registrando…" disabled={lineas.length === 0 || problemas.length > 0} className="w-full sm:w-auto sm:min-w-64">
                    {lineas.length === 0
                      ? "Agrega un procedimiento"
                      : `Registrar ${lineas.length === 1 ? "atención" : `${lineas.length} procedimientos`} · ${pesos.format(total)}`}
                  </ActionSubmit>
                </div>
              </div>
            </div>
          </section>
        </div>
      </ActionForm>
    </div>,
    document.body,
  );
}
