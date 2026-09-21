"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Box, ChevronLeft, Maximize2, RotateCcw, ScanLine } from "lucide-react";

import { marcarAtencionPagada } from "@/app/actions/atenciones";
import { registrarEnOdontograma } from "@/app/actions/odontograma";
import { AtencionForm } from "@/components/atencion-form";
import { pesos, type Atencion, type Procedimiento } from "@/lib/arancel";
import { ActionForm, ActionSubmit, Badge, Field, Input, Select } from "@/components/ui";
import {
  AVANCES,
  ESTADOS,
  INFO_AVANCE,
  INFO_ESTADO,
  SUPERFICIES,
  estadoActual,
  nombreSuperficie,
  ordenarRegistros,
  piezaPorNumero,
  piezasDe,
  superficiesVigentes,
  type Denticion,
  type EstadoPieza,
  type Pieza,
  type RegistroOdontograma,
  type Superficie,
} from "@/lib/odontograma";

import type { EstadoVisible, Vista } from "./boca-3d";

/**
 * Odontograma de la ficha: la boca en 3D a la izquierda y, a la derecha, el
 * plan de tratamiento o, si se eligió una pieza, su estado, su historia y el
 * formulario para registrar lo que el odontólogo encuentra o hace.
 */

const Boca3D = dynamic(() => import("./boca-3d").then((modulo) => modulo.Boca3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <Box size={18} className="mr-2 animate-pulse" aria-hidden="true" /> Preparando la boca en 3D…
    </div>
  ),
});

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

const SINTOMAS = ["Sin síntomas", "Sensibilidad al frío", "Sensibilidad a lo dulce", "Dolor al masticar", "Dolor espontáneo", "Dolor nocturno", "Sangrado", "Movilidad", "Inflamación"];
const DIAGNOSTICOS = ["Caries de esmalte", "Caries de dentina", "Caries profunda", "Caries interproximal", "Pulpitis reversible", "Pulpitis irreversible", "Necrosis pulpar", "Fractura de cúspide", "Fractura coronaria", "Edentulismo parcial", "Resto radicular", "Enfermedad periodontal"];
const TRATAMIENTOS = ["Restauración de resina compuesta", "Incrustación", "Sellante de fosas y fisuras", "Tratamiento de conducto", "Corona de disilicato de litio", "Corona metal-porcelana", "Implante oseointegrado", "Extracción simple", "Extracción quirúrgica", "Destartraje y pulido", "Prótesis removible", "Blanqueamiento"];

const VISTAS: { id: Vista; label: string }[] = [
  { id: "frontal", label: "Frente" },
  { id: "superior", label: "Superior" },
  { id: "inferior", label: "Inferior" },
  { id: "derecha", label: "Derecha" },
  { id: "izquierda", label: "Izquierda" },
];

/** Cruz de cinco superficies, como en el odontograma en papel. */
function Superficies({
  pieza,
  pintadas,
  elegidas,
  onToggle,
}: {
  pieza: Pieza;
  pintadas: Map<Superficie, EstadoPieza>;
  elegidas?: Set<Superficie>;
  onToggle?: (superficie: Superficie) => void;
}) {
  // En la carta, la línea media queda al centro: en los cuadrantes 1 y 4 lo
  // mesial mira a la derecha; en 2 y 3, a la izquierda.
  const mesialDerecha = pieza.cuadrante === 1 || pieza.cuadrante === 4;
  const zonas: { superficie: Superficie; puntos: string }[] = [
    { superficie: "V", puntos: "0,0 60,0 44,16 16,16" },
    { superficie: "L", puntos: "16,44 44,44 60,60 0,60" },
    { superficie: mesialDerecha ? "D" : "M", puntos: "0,0 16,16 16,44 0,60" },
    { superficie: mesialDerecha ? "M" : "D", puntos: "60,0 60,60 44,44 44,16" },
    { superficie: "O", puntos: "16,16 44,16 44,44 16,44" },
  ];
  return (
    <svg viewBox="-2 -2 64 64" className="size-24" role="group" aria-label="Superficies de la pieza">
      {zonas.map(({ superficie, puntos }) => {
        const estado = pintadas.get(superficie);
        const elegida = elegidas?.has(superficie);
        return (
          <polygon
            key={superficie}
            points={puntos}
            onClick={onToggle ? () => onToggle(superficie) : undefined}
            className={onToggle ? "cursor-pointer" : undefined}
            fill={elegida ? "var(--primary)" : estado ? INFO_ESTADO[estado].color : "var(--surface)"}
            fillOpacity={elegida ? 0.85 : estado ? 0.9 : 1}
            stroke="var(--foreground)"
            strokeOpacity={0.35}
            strokeWidth={1.2}
          >
            <title>{nombreSuperficie(superficie, pieza)}</title>
          </polygon>
        );
      })}
    </svg>
  );
}

export function Odontograma({
  cuentaId,
  registros,
  denticionSugerida,
  edad,
  profesionales,
  arancel,
  atenciones,
}: {
  cuentaId: string;
  arancel: Procedimiento[];
  atenciones: Atencion[];
  registros: RegistroOdontograma[];
  denticionSugerida: Denticion;
  edad: string | null;
  profesionales: string[];
}) {
  const [denticion, setDenticion] = useState<Denticion>(denticionSugerida);
  const [seleccionada, setSeleccionada] = useState<number | null>(null);
  const [vista, setVista] = useState<{ nombre: Vista; clave: number }>({ nombre: "frontal", clave: 0 });
  const [estadoNuevo, setEstadoNuevo] = useState<EstadoPieza>("caries");
  const [rayosX, setRayosX] = useState(false);
  const [modoPieza, setModoPieza] = useState<"atender" | "hallazgo">("atender");
  const [modoPanel, setModoPanel] = useState<"plan" | "atenciones" | "general">("plan");
  const [superficiesNuevas, setSuperficiesNuevas] = useState<Set<Superficie>>(new Set());

  const piezas = useMemo(() => piezasDe(denticion), [denticion]);
  const actuales = useMemo(() => estadoActual(registros), [registros]);
  const estados = useMemo(() => {
    const mapa = new Map<number, EstadoVisible>();
    for (const [numero, registro] of actuales) {
      mapa.set(numero, { estado: registro.estado, avance: registro.avance, superficies: superficiesVigentes(registros, numero) });
    }
    return mapa;
  }, [actuales, registros]);

  const delaDenticion = piezas.map((pieza) => estados.get(pieza.numero));
  const resumen = {
    porTratar: delaDenticion.filter((item) => item && INFO_ESTADO[item.estado].grupo === "patologia" && item.avance !== "en_curso").length,
    enTratamiento: delaDenticion.filter((item) => item && item.avance === "en_curso").length,
    tratadas: delaDenticion.filter((item) => item && INFO_ESTADO[item.estado].grupo === "tratado" && item.avance === "terminado").length,
    ausentes: delaDenticion.filter((item) => item && item.estado === "ausente").length,
  };

  // Plan: lo que sigue abierto, primero lo que está en curso.
  const plan = [...actuales.values()]
    .filter((registro) => piezas.some((pieza) => pieza.numero === registro.pieza) && registro.avance !== "terminado" && registro.estado !== "sano")
    .sort((a, b) => AVANCES.indexOf(b.avance) - AVANCES.indexOf(a.avance) || a.pieza - b.pieza);

  const pieza = seleccionada ? piezaPorNumero(seleccionada) : null;
  const historia = pieza ? ordenarRegistros(registros.filter((registro) => registro.pieza === pieza.numero)) : [];
  const actual = pieza ? actuales.get(pieza.numero) : undefined;
  const atencionesDePieza = pieza ? atenciones.filter((atencion) => atencion.pieza === pieza.numero) : [];
  const cobrado = atenciones.filter((atencion) => atencion.pagado).reduce((total, atencion) => total + Number(atencion.precio), 0);
  const porCobrar = atenciones.filter((atencion) => !atencion.pagado).reduce((total, atencion) => total + Number(atencion.precio), 0);

  const elegir = (numero: number) => {
    setSeleccionada(numero);
    setSuperficiesNuevas(new Set());
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Odontograma</h2>
          <p className="text-xs text-muted-foreground">
            Gira con el mouse, acerca con la rueda y toca una pieza para ver su historia o registrar un hallazgo.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 text-xs">
          {(["permanente", "temporal"] as const).map((opcion) => (
            <button
              key={opcion}
              type="button"
              onClick={() => {
                setDenticion(opcion);
                setSeleccionada(null);
              }}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${denticion === opcion ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {opcion === "permanente" ? "Adulto · 32 piezas" : "Niño · 20 piezas"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Escena. */}
        <div className="relative">
          <div
            className="relative h-[460px] sm:h-[540px]"
            style={{
              background:
                "radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--primary) 30%, #0f172a) 0%, #0b1120 55%, #05070d 100%)",
            }}
          >
            <Boca3D piezas={piezas} estados={estados} seleccionada={seleccionada} onSelect={elegir} vista={vista} rayosX={rayosX} />

            <button
              type="button"
              onClick={() => setRayosX((valor) => !valor)}
              aria-pressed={rayosX}
              className={`absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur transition-colors ${
                rayosX ? "bg-sky-300 text-slate-950" : "bg-black/45 text-slate-200 hover:bg-white/15"
              }`}
            >
              <ScanLine size={14} aria-hidden="true" /> Rayos X
            </button>

            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 text-[11px] text-slate-300">
              <span className="rounded-full bg-black/40 px-2 py-0.5 backdrop-blur">
                {denticion === "permanente" ? "Dentición permanente" : "Dentición temporal"}
                {edad ? ` · ${edad}` : ""}
                {denticion !== denticionSugerida ? " · cambiada a mano" : ""}
              </span>
              {(vista.nombre === "superior" || vista.nombre === "inferior") && (
                <span className="w-fit rounded-full bg-black/40 px-2 py-0.5 backdrop-blur">
                  Vista oclusal · arcada {vista.nombre}
                </span>
              )}
            </div>

            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 p-1 backdrop-blur">
              {VISTAS.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  onClick={() => setVista((previa) => ({ nombre: opcion.id, clave: previa.clave + 1 }))}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    vista.nombre === opcion.id ? "bg-white text-slate-900" : "text-slate-200 hover:bg-white/15"
                  }`}
                >
                  {opcion.label}
                </button>
              ))}
              <button
                type="button"
                aria-label="Volver a la vista inicial"
                onClick={() => {
                  setSeleccionada(null);
                  setVista((previa) => ({ nombre: "frontal", clave: previa.clave + 1 }));
                }}
                className="rounded-full p-1.5 text-slate-200 hover:bg-white/15"
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-border bg-border text-center sm:grid-cols-4">
            {[
              { label: "Por tratar", valor: resumen.porTratar, color: "#dc2626" },
              { label: "En tratamiento", valor: resumen.enTratamiento, color: "#0ea5e9" },
              { label: "Tratadas", valor: resumen.tratadas, color: "#2563eb" },
              { label: "Ausentes", valor: resumen.ausentes, color: "#94a3b8" },
            ].map((item) => (
              <div key={item.label} className="bg-surface px-3 py-2.5">
                <p className="text-xl font-semibold tabular-nums text-foreground">{item.valor}</p>
                <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5">
            {ESTADOS.filter((estado) => estado !== "sano").map((estado) => (
              <span key={estado} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2.5 rounded-sm" style={{ background: INFO_ESTADO[estado].color }} />
                {INFO_ESTADO[estado].label}
              </span>
            ))}
          </div>
        </div>

        {/* Panel. */}
        <div className="border-t border-border xl:border-l xl:border-t-0">
          {!pieza ? (
            <div className="flex h-full flex-col">
              <div className="flex gap-1 border-b border-border px-3 pt-2">
                {([
                  ["plan", `Plan (${plan.length})`],
                  ["atenciones", `Atenciones (${atenciones.length})`],
                  ["general", "Atención general"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setModoPanel(id)}
                    className={`border-b-2 px-2.5 pb-2 text-sm transition-colors ${
                      modoPanel === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {modoPanel === "plan" && (
                <>
                  <p className="px-4 pt-3 text-xs text-muted-foreground">Lo diagnosticado y lo que está en curso. Toca una fila o una pieza para atenderla.</p>
              {plan.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Sin tratamientos pendientes. Toca una pieza en la boca para registrar un hallazgo.
                </p>
              ) : (
                <ul className="max-h-[560px] divide-y divide-border overflow-y-auto">
                  {plan.map((registro) => {
                    const info = INFO_ESTADO[registro.estado];
                    return (
                      <li key={registro.id}>
                        <button type="button" onClick={() => elegir(registro.pieza)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted/60">
                          <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums text-white" style={{ background: info.color }}>
                            {registro.pieza}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">
                              {info.label}
                              {registro.superficies.length > 0 && <span className="font-normal text-muted-foreground"> · {registro.superficies.join("")}</span>}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{registro.tratamiento ?? registro.diagnostico ?? "Sin tratamiento definido"}</span>
                          </span>
                          <Badge tone={INFO_AVANCE[registro.avance].tono}>{INFO_AVANCE[registro.avance].label}</Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
                </>
              )}
              {modoPanel === "atenciones" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="grid grid-cols-2 gap-px border-b border-border bg-border text-center">
                    <div className="bg-surface px-3 py-2">
                      <p className="text-base font-semibold tabular-nums text-foreground">{pesos.format(cobrado)}</p>
                      <p className="text-[11px] text-muted-foreground">Cobrado</p>
                    </div>
                    <div className="bg-surface px-3 py-2">
                      <p className={`text-base font-semibold tabular-nums ${porCobrar > 0 ? "text-warning" : "text-foreground"}`}>{pesos.format(porCobrar)}</p>
                      <p className="text-[11px] text-muted-foreground">Por cobrar</p>
                    </div>
                  </div>
                  {atenciones.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">Todavía no hay atenciones. Toca una pieza y elige Atender.</p>
                  ) : (
                    <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                      {atenciones.map((atencion) => (
                        <li key={atencion.id} className="flex items-start gap-3 px-4 py-2.5">
                          <button
                            type="button"
                            disabled={atencion.pieza === null}
                            onClick={() => atencion.pieza !== null && elegir(atencion.pieza)}
                            className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-muted text-sm font-semibold tabular-nums text-foreground disabled:cursor-default"
                          >
                            {atencion.pieza ?? "—"}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {atencion.descripcion}
                              {atencion.es_urgencia && <span className="ml-1.5 text-xs font-medium text-danger">urgencia</span>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {fecha.format(new Date(`${atencion.fecha}T12:00:00Z`))}
                              {atencion.profesional ? ` · ${atencion.profesional}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium tabular-nums text-foreground">{pesos.format(Number(atencion.precio))}</p>
                            <ActionForm action={marcarAtencionPagada} success={atencion.pagado ? "Marcada por cobrar" : "Marcada pagada"}>
                              <input type="hidden" name="atencion_id" value={atencion.id} />
                              <input type="hidden" name="cuenta_id" value={cuentaId} />
                              <input type="hidden" name="pagado" value={atencion.pagado ? "no" : "si"} />
                              <button type="submit" className={`text-[11px] font-medium hover:underline ${atencion.pagado ? "text-success" : "text-warning"}`}>
                                {atencion.pagado ? "Pagado" : "Por cobrar · marcar pagado"}
                              </button>
                            </ActionForm>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {modoPanel === "general" && (
                <div className="px-4 py-4">
                  <AtencionForm
                    cuentaId={cuentaId}
                    arancel={arancel}
                    aplica={["boca"]}
                    profesionales={profesionales}
                    titulo="Atención de toda la boca"
                    onGuardada={() => setModoPanel("atenciones")}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-[720px] overflow-y-auto">
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <button type="button" onClick={() => setSeleccionada(null)} aria-label="Volver al plan" className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground">
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-foreground">
                    Pieza {pieza.numero}
                  </p>
                  <p className="text-xs text-muted-foreground">{pieza.nombre}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ background: INFO_ESTADO[actual?.estado ?? "sano"].color, color: actual ? "#fff" : "#334155" }}>
                      {INFO_ESTADO[actual?.estado ?? "sano"].label}
                    </span>
                    {actual && <Badge tone={INFO_AVANCE[actual.avance].tono}>{INFO_AVANCE[actual.avance].label}</Badge>}
                  </div>
                </div>
                <Superficies pieza={pieza} pintadas={superficiesVigentes(registros, pieza.numero)} />
              </div>

              <div className="border-b border-border px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historia de la pieza</p>
                {historia.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin registros: la pieza figura sana.</p>
                ) : (
                  <ol className="space-y-3">
                    {historia.map((registro) => (
                      <li key={registro.id} className="relative border-l-2 pl-3" style={{ borderColor: INFO_ESTADO[registro.estado].color }}>
                        <p className="text-sm font-medium text-foreground">
                          {INFO_ESTADO[registro.estado].label}
                          {registro.superficies.length > 0 && (
                            <span className="font-normal text-muted-foreground">
                              {" · "}
                              {(registro.superficies as Superficie[]).map((superficie) => nombreSuperficie(superficie, pieza)).join(", ").toLowerCase()}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fecha.format(new Date(`${registro.fecha}T12:00:00Z`))} · {INFO_AVANCE[registro.avance].label}
                          {registro.profesional ? ` · ${registro.profesional}` : ""}
                        </p>
                        {(registro.sintoma || registro.diagnostico || registro.tratamiento || registro.nota) && (
                          <dl className="mt-1 space-y-0.5 text-xs">
                            {registro.sintoma && <div><dt className="inline text-muted-foreground">Síntoma: </dt><dd className="inline text-foreground">{registro.sintoma}</dd></div>}
                            {registro.diagnostico && <div><dt className="inline text-muted-foreground">Diagnóstico: </dt><dd className="inline text-foreground">{registro.diagnostico}</dd></div>}
                            {registro.tratamiento && <div><dt className="inline text-muted-foreground">Tratamiento: </dt><dd className="inline text-foreground">{registro.tratamiento}</dd></div>}
                            {registro.nota && <div><dt className="inline text-muted-foreground">Nota: </dt><dd className="inline text-foreground">{registro.nota}</dd></div>}
                          </dl>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {atencionesDePieza.length > 0 && (
                <div className="border-b border-border px-4 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atenciones en esta pieza</p>
                  <ul className="space-y-1.5">
                    {atencionesDePieza.map((atencion) => (
                      <li key={atencion.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{atencion.descripcion}</span>
                          <span className="block text-xs text-muted-foreground">
                            {fecha.format(new Date(`${atencion.fecha}T12:00:00Z`))}
                            {atencion.profesional ? ` · ${atencion.profesional}` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block tabular-nums text-foreground">{pesos.format(Number(atencion.precio))}</span>
                          <span className={`block text-[11px] ${atencion.pagado ? "text-success" : "text-warning"}`}>{atencion.pagado ? "Pagado" : "Por cobrar"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <Superficies
                    pieza={pieza}
                    pintadas={new Map()}
                    elegidas={superficiesNuevas}
                    onToggle={(superficie) =>
                      setSuperficiesNuevas((previas) => {
                        const siguientes = new Set(previas);
                        if (siguientes.has(superficie)) siguientes.delete(superficie);
                        else siguientes.add(superficie);
                        return siguientes;
                      })
                    }
                  />
                  <div className="text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Superficies</p>
                    <p>Toca las caras que se tratan o que están afectadas.</p>
                    <p className="mt-1">{SUPERFICIES.filter((superficie) => superficiesNuevas.has(superficie)).map((superficie) => nombreSuperficie(superficie, pieza)).join(", ") || "Ninguna todavía"}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-0.5 text-sm">
                  {([
                    ["atender", "Atender"],
                    ["hallazgo", "Registrar hallazgo"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setModoPieza(id)}
                      className={`rounded-md px-2 py-1.5 font-medium transition-colors ${modoPieza === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {modoPieza === "atender" && (
                <div className="px-4 py-4">
                  <AtencionForm
                    key={`atender-${pieza.numero}`}
                    cuentaId={cuentaId}
                    arancel={arancel}
                    aplica={["pieza", "superficie"]}
                    pieza={pieza.numero}
                    superficies={[...superficiesNuevas]}
                    profesionales={profesionales}
                    onGuardada={() => setSuperficiesNuevas(new Set())}
                    titulo={`Atender la pieza ${pieza.numero}`}
                  />
                </div>
              )}

              {modoPieza === "hallazgo" && (
              <ActionForm
                key={pieza.numero}
                action={registrarEnOdontograma}
                success={`Pieza ${pieza.numero} registrada`}
                onSuccess={() => setSuperficiesNuevas(new Set())}
                className="space-y-3 px-4 py-4"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registrar en la pieza {pieza.numero}</p>
                <input type="hidden" name="cuenta_id" value={cuentaId} />
                <input type="hidden" name="pieza" value={pieza.numero} />
                <input type="hidden" name="estado" value={estadoNuevo} />
                {[...superficiesNuevas].map((superficie) => (
                  <input key={superficie} type="hidden" name="superficies" value={superficie} />
                ))}

                <div className="flex flex-wrap gap-1.5">
                  {ESTADOS.map((estado) => (
                    <button
                      key={estado}
                      type="button"
                      onClick={() => setEstadoNuevo(estado)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        estadoNuevo === estado ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="size-2 rounded-full" style={{ background: INFO_ESTADO[estado].color }} />
                      {INFO_ESTADO[estado].label}
                    </button>
                  ))}
                </div>

                {INFO_ESTADO[estadoNuevo].porSuperficie && superficiesNuevas.size === 0 && (
                  <p className="text-xs font-medium text-warning">Marca las superficies afectadas en la cruz de arriba.</p>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Avance">
                    <Select name="avance" defaultValue="diagnostico">
                      {AVANCES.map((avance) => (
                        <option key={avance} value={avance}>
                          {INFO_AVANCE[avance].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Fecha">
                    <Input name="fecha" type="date" defaultValue={hoy()} />
                  </Field>
                </div>
                <Field label="Síntoma que refiere">
                  <Input name="sintoma" list="odontograma-sintomas" placeholder="Sensibilidad al frío" />
                </Field>
                <Field label="Diagnóstico">
                  <Input name="diagnostico" list="odontograma-diagnosticos" placeholder="Caries de dentina" />
                </Field>
                <Field label="Tratamiento">
                  <Input name="tratamiento" list="odontograma-tratamientos" placeholder="Restauración de resina compuesta" />
                </Field>
                <Field label="Profesional">
                  <Select name="profesional" defaultValue={profesionales[0] ?? ""}>
                    <option value="">Sin indicar</option>
                    {profesionales.map((profesional) => (
                      <option key={profesional}>{profesional}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nota">
                  <Input name="nota" placeholder="Paciente prefiere atenderse en la tarde" />
                </Field>
                <ActionSubmit className="w-full" pendingLabel="Guardando…">
                  <Maximize2 size={14} aria-hidden="true" /> Registrar en la pieza {pieza.numero}
                </ActionSubmit>
                <datalist id="odontograma-sintomas">{SINTOMAS.map((valor) => <option key={valor} value={valor} />)}</datalist>
                <datalist id="odontograma-diagnosticos">{DIAGNOSTICOS.map((valor) => <option key={valor} value={valor} />)}</datalist>
                <datalist id="odontograma-tratamientos">{TRATAMIENTOS.map((valor) => <option key={valor} value={valor} />)}</datalist>
              </ActionForm>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
