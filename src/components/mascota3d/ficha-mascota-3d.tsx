"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ChevronLeft, PawPrint, RotateCcw } from "lucide-react";

import { cambiarRazaMascota, registrarEnMascota } from "@/app/actions/mascotas";
import { AtencionForm } from "@/components/atencion-form";
import { ActionForm, ActionSubmit, Badge, Field, Input, Select } from "@/components/ui";
import { pesos, type Atencion, type Procedimiento } from "@/lib/arancel";
import {
  INFO_TIPO,
  NOMBRE_REGION,
  SUGERENCIAS,
  TIPOS,
  aniosDe,
  etapaDe,
  razaDe,
  razasDe,
  type Region,
  type TipoRegistro,
} from "@/lib/anatomia";
import { ETIQUETA_VACUNA, edad, estadoVacuna } from "@/lib/mascotas";
import { AVANCES, INFO_AVANCE, type Avance } from "@/lib/odontograma";

import type { Marcador, VistaAnimal } from "./animal-3d";

const Animal3D = dynamic(() => import("./animal-3d").then((modulo) => modulo.Animal3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <PawPrint size={18} className="mr-2 animate-pulse" aria-hidden="true" /> Preparando la mascota en 3D…
    </div>
  ),
});

export type MascotaFicha = {
  id: string;
  nombre: string;
  especie: string;
  raza: string | null;
  sexo: string | null;
  nacimiento: string | null;
  peso_kg: number | null;
  esterilizado: boolean;
  proxima_vacuna: string | null;
};

export type RegistroMascota = {
  id: string;
  mascota_id: string;
  region: Region;
  punto: [number, number, number] | null;
  tipo: TipoRegistro;
  titulo: string;
  detalle: string | null;
  avance: Avance;
  profesional: string | null;
  fecha: string;
  created_at: string;
};

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const ETAPA = { cachorro: "Cachorro", adulto: "Adulto", senior: "Senior" } as const;

const VISTAS: { id: VistaAnimal; label: string }[] = [
  { id: "derecha", label: "Lado derecho" },
  { id: "izquierda", label: "Lado izquierdo" },
  { id: "frente", label: "Frente" },
  { id: "arriba", label: "Arriba" },
];

export function FichaMascota3D({
  cuentaId,
  mascotas,
  registros,
  atenciones,
  arancel,
  profesionales,
}: {
  cuentaId: string;
  mascotas: MascotaFicha[];
  registros: RegistroMascota[];
  atenciones: Atencion[];
  arancel: Procedimiento[];
  profesionales: string[];
}) {
  const [mascotaId, setMascotaId] = useState(mascotas[0]?.id ?? "");
  const [region, setRegion] = useState<Region | null>(null);
  const [punto, setPunto] = useState<[number, number, number] | null>(null);
  const [encima, setEncima] = useState<Region | null>(null);
  const [vista, setVista] = useState<{ nombre: VistaAnimal; clave: number }>({ nombre: "derecha", clave: 0 });
  const [modo, setModo] = useState<"registrar" | "atender">("registrar");
  const [panel, setPanel] = useState<"historia" | "atenciones" | "general">("historia");
  const [tipo, setTipo] = useState<TipoRegistro>("enfermedad");

  const mascota = mascotas.find((item) => item.id === mascotaId) ?? mascotas[0];
  const raza = useMemo(() => razaDe(mascota?.especie, mascota?.raza), [mascota?.especie, mascota?.raza]);
  const anios = aniosDe(mascota?.nacimiento);
  const etapa = etapaDe(raza.especie, anios);
  const historia = useMemo(
    () =>
      registros
        .filter((registro) => registro.mascota_id === mascota?.id)
        .sort((a, b) => (b.fecha === a.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha))),
    [registros, mascota?.id],
  );
  const suyas = atenciones.filter((atencion) => atencion.mascota_id === mascota?.id);
  const marcadores: Marcador[] = [
    ...historia.map((registro) => ({
      id: registro.id,
      region: registro.region,
      punto: registro.punto,
      tipo: registro.tipo,
      activo: registro.avance !== "terminado",
    })),
    ...(region && punto ? [{ id: "nuevo", region, punto, tipo, activo: true }] : []),
  ];

  if (!mascota) {
    return <p className="rounded-xl border border-border bg-surface p-6 text-sm text-muted-foreground">Este tutor todavía no tiene mascotas registradas.</p>;
  }

  const vacuna = estadoVacuna(mascota.proxima_vacuna);
  const deLaZona = region ? historia.filter((registro) => registro.region === region) : [];
  const abiertos = historia.filter((registro) => registro.avance !== "terminado");

  const elegirZona = (zona: Region, lugar: [number, number, number] | null) => {
    setRegion(zona);
    setPunto(lugar);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {mascotas.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMascotaId(item.id);
                setRegion(null);
                setPunto(null);
              }}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
                item.id === mascota.id ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <PawPrint size={14} aria-hidden="true" /> {item.nombre}
            </button>
          ))}
        </div>
        <ActionForm action={cambiarRazaMascota} success="Raza actualizada" className="flex items-center gap-2">
          <input type="hidden" name="mascota_id" value={mascota.id} />
          <Select name="raza" defaultValue={raza.nombre} key={mascota.id} fieldSize="sm" aria-label="Raza">
            {razasDe(raza.especie).map((opcion) => (
              <option key={opcion.nombre}>{opcion.nombre}</option>
            ))}
          </Select>
          <ActionSubmit size="sm" variant="secondary" pendingLabel="…">
            Cambiar raza
          </ActionSubmit>
        </ActionForm>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-border px-4 py-2.5 text-sm">
        <span className="font-semibold text-foreground">{mascota.nombre}</span>
        <span className="text-muted-foreground">{raza.especie} · {raza.nombre}</span>
        <span className="text-muted-foreground">
          {edad(mascota.nacimiento) ?? "Edad sin dato"} · {ETAPA[etapa]}
        </span>
        <span className="text-muted-foreground">
          {mascota.sexo ?? "Sexo sin dato"}
          {mascota.esterilizado ? " · esterilizado" : ""}
        </span>
        <span className="text-muted-foreground">{mascota.peso_kg ? `${mascota.peso_kg} kg` : `Peso típico ${raza.peso}`}</span>
        <Badge tone={vacuna === "vencida" ? "danger" : vacuna === "por_vencer" ? "warning" : vacuna === "al_dia" ? "success" : "neutral"}>{ETIQUETA_VACUNA[vacuna]}</Badge>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative">
          <div
            className="relative h-[440px] sm:h-[520px]"
            style={{ background: "radial-gradient(ellipse at 50% 38%, color-mix(in srgb, var(--primary) 22%, #fbf6f1) 0%, #efe6dd 55%, #e2d5c8 100%)" }}
          >
            <Animal3D
              raza={raza}
              etapa={etapa}
              marcadores={marcadores}
              seleccionada={region}
              onSelect={(zona, lugar) => elegirZona(zona, lugar)}
              onHover={setEncima}
              vista={vista}
            />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
              <span className="w-fit rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
                {encima ? NOMBRE_REGION[encima] : "Toca una zona del cuerpo"}
              </span>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/85 p-1 shadow-sm backdrop-blur">
              {VISTAS.map((opcion) => (
                <button
                  key={opcion.id}
                  type="button"
                  onClick={() => setVista((previa) => ({ nombre: opcion.id, clave: previa.clave + 1 }))}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${vista.nombre === opcion.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-900/10"}`}
                >
                  {opcion.label}
                </button>
              ))}
              <button
                type="button"
                aria-label="Volver a la vista inicial"
                onClick={() => {
                  setRegion(null);
                  setPunto(null);
                  setVista((previa) => ({ nombre: "derecha", clave: previa.clave + 1 }));
                }}
                className="rounded-full p-1.5 text-slate-700 hover:bg-slate-900/10"
              >
                <RotateCcw size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5">
            {TIPOS.map((item) => (
              <span key={item} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ background: INFO_TIPO[item].color }} />
                {INFO_TIPO[item].label}
              </span>
            ))}
            <span className="text-[11px] text-muted-foreground">· marcador grande: en curso</span>
          </div>
        </div>

        <div className="border-t border-border xl:border-l xl:border-t-0">
          {!region ? (
            <div className="flex h-full flex-col">
              <div className="flex gap-1 border-b border-border px-3 pt-2">
                {([
                  ["historia", `Historia (${historia.length})`],
                  ["atenciones", `Atenciones (${suyas.length})`],
                  ["general", "Atención general"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPanel(id)}
                    className={`border-b-2 px-2.5 pb-2 text-sm transition-colors ${panel === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {panel === "historia" &&
                (historia.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin registros. Toca una zona del cuerpo para registrar un hallazgo.</p>
                ) : (
                  <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                    {abiertos.length > 0 && <li className="bg-surface-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">En curso o por hacer</li>}
                    {[...abiertos, ...historia.filter((registro) => registro.avance === "terminado")].map((registro, indice) => (
                      <li key={registro.id}>
                        {indice === abiertos.length && abiertos.length > 0 && (
                          <p className="bg-surface-muted/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Historia</p>
                        )}
                        <button type="button" onClick={() => elegirZona(registro.region, registro.punto)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-muted/60">
                          <span className="mt-1 size-2.5 flex-shrink-0 rounded-full" style={{ background: INFO_TIPO[registro.tipo].color }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-foreground">{registro.titulo}</span>
                            <span className="block text-xs text-muted-foreground">
                              {NOMBRE_REGION[registro.region]} · {INFO_TIPO[registro.tipo].label} · {fecha.format(new Date(`${registro.fecha}T12:00:00Z`))}
                            </span>
                          </span>
                          <Badge tone={INFO_AVANCE[registro.avance].tono}>{INFO_AVANCE[registro.avance].label}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
              {panel === "atenciones" &&
                (suyas.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">Sin atenciones todavía.</p>
                ) : (
                  <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
                    {suyas.map((atencion) => (
                      <li key={atencion.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {atencion.descripcion}
                            {atencion.es_urgencia && <span className="ml-1.5 text-xs text-danger">urgencia</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {fecha.format(new Date(`${atencion.fecha}T12:00:00Z`))}
                            {atencion.region ? ` · ${NOMBRE_REGION[atencion.region as Region] ?? atencion.region}` : ""}
                            {atencion.profesional ? ` · ${atencion.profesional}` : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm tabular-nums text-foreground">{pesos.format(Number(atencion.precio))}</span>
                          <span className={`block text-[11px] ${atencion.pagado ? "text-success" : "text-warning"}`}>{atencion.pagado ? "Pagado" : "Por cobrar"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
              {panel === "general" && (
                <div className="px-4 py-4">
                  <AtencionForm
                    key={`general-${mascota.id}`}
                    cuentaId={cuentaId}
                    arancel={arancel}
                    aplica={["mascota"]}
                    mascotaId={mascota.id}
                    profesionales={profesionales}
                    titulo={`Atención de ${mascota.nombre}`}
                    onGuardada={() => setPanel("atenciones")}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="max-h-[720px] overflow-y-auto">
              <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setRegion(null);
                    setPunto(null);
                  }}
                  aria-label="Volver a la historia"
                  className="mt-0.5 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div>
                  <p className="text-base font-semibold text-foreground">{NOMBRE_REGION[region]}</p>
                  <p className="text-xs text-muted-foreground">
                    {mascota.nombre} · {punto ? "punto marcado en el modelo" : "toda la zona"}
                  </p>
                </div>
              </div>

              <div className="border-b border-border px-4 py-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Historia de la zona</p>
                {deLaZona.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin registros en esta zona.</p>
                ) : (
                  <ol className="space-y-3">
                    {deLaZona.map((registro) => (
                      <li key={registro.id} className="border-l-2 pl-3" style={{ borderColor: INFO_TIPO[registro.tipo].color }}>
                        <p className="text-sm font-medium text-foreground">{registro.titulo}</p>
                        <p className="text-xs text-muted-foreground">
                          {INFO_TIPO[registro.tipo].label} · {fecha.format(new Date(`${registro.fecha}T12:00:00Z`))} · {INFO_AVANCE[registro.avance].label}
                          {registro.profesional ? ` · ${registro.profesional}` : ""}
                        </p>
                        {registro.detalle && <p className="mt-0.5 text-xs text-foreground">{registro.detalle}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="border-b border-border px-4 py-3">
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-0.5 text-sm">
                  {([
                    ["registrar", "Registrar"],
                    ["atender", "Atender"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setModo(id)}
                      className={`rounded-md px-2 py-1.5 font-medium transition-colors ${modo === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {modo === "registrar" ? (
                <ActionForm
                  key={`${mascota.id}-${region}`}
                  action={registrarEnMascota}
                  success="Registro guardado"
                  onSuccess={() => setPunto(null)}
                  className="space-y-3 px-4 py-4"
                >
                  <input type="hidden" name="mascota_id" value={mascota.id} />
                  <input type="hidden" name="region" value={region} />
                  <input type="hidden" name="tipo" value={tipo} />
                  {punto && <input type="hidden" name="punto" value={JSON.stringify(punto)} />}
                  <div className="flex flex-wrap gap-1.5">
                    {TIPOS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setTipo(item)}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                          tipo === item ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <span className="size-2 rounded-full" style={{ background: INFO_TIPO[item].color }} />
                        {INFO_TIPO[item].label}
                      </button>
                    ))}
                  </div>
                  <Field label="Qué se encontró o qué se hizo">
                    <Input name="titulo" required list={`sugerencias-${region}`} placeholder={SUGERENCIAS[region]?.[0] ?? "Describe el hallazgo"} />
                  </Field>
                  <datalist id={`sugerencias-${region}`}>
                    {(SUGERENCIAS[region] ?? []).map((valor) => (
                      <option key={valor} value={valor} />
                    ))}
                  </datalist>
                  <Field label="Detalle">
                    <Input name="detalle" placeholder="Signos, dosis, indicaciones al tutor" />
                  </Field>
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
                  <Field label="Profesional">
                    <Select name="profesional" defaultValue={profesionales[0] ?? ""}>
                      <option value="">Sin indicar</option>
                      {profesionales.map((profesional) => (
                        <option key={profesional}>{profesional}</option>
                      ))}
                    </Select>
                  </Field>
                  <ActionSubmit className="w-full" pendingLabel="Guardando…">
                    Registrar en {NOMBRE_REGION[region].toLowerCase()}
                  </ActionSubmit>
                </ActionForm>
              ) : (
                <div className="px-4 py-4">
                  <AtencionForm
                    key={`atender-${mascota.id}-${region}`}
                    cuentaId={cuentaId}
                    arancel={arancel}
                    aplica={["region", "mascota"]}
                    mascotaId={mascota.id}
                    region={NOMBRE_REGION[region]}
                    profesionales={profesionales}
                    titulo={`Atender ${NOMBRE_REGION[region].toLowerCase()} de ${mascota.nombre}`}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
