"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, Camera, Check, Circle, Loader2, LocateFixed, MapPinOff, Minus, Plus, RefreshCw } from "lucide-react";

import { registrarVisitaTerreno } from "@/app/actions/terreno";
import { ETAPA_INFO, MODELOS_POINT, MOTIVO_LABEL, MOTIVOS, RESULTADOS, type Motivo, type Resultado } from "@/lib/terreno";
import { cn } from "@/lib/utils";
import { BOTON_PRIMARIO, InputTerreno } from "./campos";

type Ubicacion =
  | { estado: "buscando" }
  | { estado: "lista"; lat: number; lng: number; precision: number }
  | { estado: "error"; motivo: string };

const MOTIVOS_SIN_GPS = ["No di permiso de ubicación", "Sin señal de GPS", "El teléfono no tiene GPS"];

/** Atajos para "cuándo vuelves": días desde hoy, a las 10:00 del teléfono. */
const ATAJOS_VUELTA = [
  { label: "Mañana", dias: 1 },
  { label: "En 3 días", dias: 3 },
  { label: "En una semana", dias: 7 },
];

/** "2026-10-12T10:00" en la hora del teléfono, como lo usa datetime-local. */
function enDias(dias: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  fecha.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

/** Reduce la foto antes de subirla: en la calle la señal es poca. */
async function comprimir(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) return file;
    return new File([blob], "visita.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function mensajeGeo(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "No diste permiso para usar la ubicación.";
  if (error.code === error.TIMEOUT) return "El GPS tardó demasiado.";
  return "No pudimos leer la ubicación.";
}

/**
 * Registro de una visita en una sola pantalla, en el orden en que pasa en la
 * calle: la ubicación se toma sola al abrir, el vendedor elige cómo le fue,
 * saca la foto del local y guarda. Abajo, lo que falta, para que nunca se
 * quede pegado sin saber por qué el botón no avanza.
 */
export function RegistrarVisita({ leadId, nombre }: { leadId: string; nombre: string }) {
  const router = useRouter();
  const [ubicacion, setUbicacion] = useState<Ubicacion>({ estado: "buscando" });
  const [sinUbicacion, setSinUbicacion] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [motivo, setMotivo] = useState<Motivo | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [modelo, setModelo] = useState<string>(MODELOS_POINT[0]);
  const [modeloOtro, setModeloOtro] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparandoFoto, setPreparandoFoto] = useState(false);
  const [nota, setNota] = useState("");
  const [proxima, setProxima] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputFoto = useRef<HTMLInputElement>(null);

  // Los setState van en callbacks (del GPS o de una promesa), nunca directo
  // dentro del efecto que la dispara al abrir.
  const leerUbicacion = useCallback(() => {
    if (!("geolocation" in navigator)) {
      void Promise.resolve().then(() => setUbicacion({ estado: "error", motivo: "Este teléfono no entrega ubicación." }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setUbicacion({
          estado: "lista",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy),
        }),
      (err) => setUbicacion({ estado: "error", motivo: mensajeGeo(err) }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    leerUbicacion();
  }, [leerUbicacion]);

  function reintentarUbicacion() {
    setUbicacion({ estado: "buscando" });
    leerUbicacion();
  }

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function elegirFoto(event: React.ChangeEvent<HTMLInputElement>) {
    const archivo = event.target.files?.[0];
    event.target.value = "";
    if (!archivo) return;
    setPreparandoFoto(true);
    const lista = await comprimir(archivo);
    setFoto(lista);
    setPreview(URL.createObjectURL(lista));
    setPreparandoFoto(false);
  }

  const ubicacionOk = ubicacion.estado === "lista" || (ubicacion.estado === "error" && sinUbicacion.trim() !== "");
  const resultadoOk =
    resultado !== null &&
    (resultado !== "descartado" || motivo !== null) &&
    (resultado !== "vendido" || (cantidad >= 1 && (modelo !== "Otro" || modeloOtro.trim() !== "")));
  const listo = resultadoOk && foto !== null && ubicacionOk;

  const pendientes = [
    { ok: resultadoOk, label: resultado === "descartado" && !motivo ? "Motivo" : resultado === "vendido" && !resultadoOk ? "Modelo del lector" : "Resultado" },
    { ok: foto !== null, label: "Foto del local" },
    { ok: ubicacionOk, label: ubicacion.estado === "error" ? "Por qué no hay ubicación" : "Ubicación" },
  ];

  function guardar() {
    if (!listo || !resultado || !foto) return;
    setError(null);
    const data = new FormData();
    data.set("lead_id", leadId);
    data.set("etapa", resultado);
    if (resultado === "descartado" && motivo) data.set("motivo", motivo);
    if (resultado === "vendido") {
      data.set("pos_cantidad", String(cantidad));
      data.set("pos_modelo", modelo === "Otro" ? modeloOtro.trim() : modelo);
    }
    if (ubicacion.estado === "lista") {
      data.set("lat", String(ubicacion.lat));
      data.set("lng", String(ubicacion.lng));
      data.set("precision_m", String(ubicacion.precision));
    } else {
      data.set("sin_ubicacion", sinUbicacion.trim());
    }
    data.set("nota", nota);
    // datetime-local viene en la hora del teléfono; viaja como instante.
    if (proxima && resultado !== "vendido" && resultado !== "descartado") data.set("proxima_at", new Date(proxima).toISOString());
    data.set("foto", foto);
    startTransition(async () => {
      const respuesta = await registrarVisitaTerreno(data);
      if (respuesta.ok) router.push(`/terreno/clientes/${leadId}?visita=1`);
      else setError(respuesta.message);
    });
  }

  return (
    <div className="space-y-6 pb-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Registrar visita</p>
        <h1 className="mt-0.5 text-xl font-semibold leading-tight">{nombre}</h1>
      </div>

      {/* Ubicación: se toma sola; solo pide algo si falla. */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border p-3.5 text-sm",
          ubicacion.estado === "lista" && "border-success/30 bg-success/5",
          ubicacion.estado === "buscando" && "border-border bg-surface",
          ubicacion.estado === "error" && "border-warning/40 bg-warning/5",
        )}
        role="status"
      >
        {ubicacion.estado === "buscando" && <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
        {ubicacion.estado === "lista" && <LocateFixed size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />}
        {ubicacion.estado === "error" && <MapPinOff size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">
            {ubicacion.estado === "buscando" && "Tomando tu ubicación…"}
            {ubicacion.estado === "lista" && `Ubicación lista (±${ubicacion.precision} m)`}
            {ubicacion.estado === "error" && ubicacion.motivo}
          </p>
          {ubicacion.estado === "error" && (
            <>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS_SIN_GPS.map((texto) => (
                  <button
                    key={texto}
                    type="button"
                    onClick={() => setSinUbicacion(texto)}
                    aria-pressed={sinUbicacion === texto}
                    className={cn(
                      "min-h-11 rounded-full border px-3 text-sm",
                      sinUbicacion === texto ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
                    )}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <button type="button" onClick={reintentarUbicacion} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary">
                <RefreshCw size={15} aria-hidden="true" />
                Intentar de nuevo
              </button>
            </>
          )}
        </div>
      </div>

      <fieldset className="space-y-2.5">
        <legend className="mb-1 text-base font-semibold">¿Cómo te fue?</legend>
        {RESULTADOS.map((opcion) => {
          const info = ETAPA_INFO[opcion];
          const activo = resultado === opcion;
          return (
            <button
              key={opcion}
              type="button"
              onClick={() => setResultado(opcion)}
              aria-pressed={activo}
              className={cn(
                "flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left",
                activo ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-surface",
              )}
            >
              {activo ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check size={15} aria-hidden="true" />
                </span>
              ) : (
                <Circle size={24} className="shrink-0 text-border-strong" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{info.label}</span>
                <span className="block text-sm text-muted-foreground">{info.hint}</span>
              </span>
            </button>
          );
        })}
      </fieldset>

      {resultado === "descartado" && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">¿Por qué no sigue?</legend>
          <div className="grid grid-cols-1 gap-2">
            {MOTIVOS.map((opcion) => (
              <button
                key={opcion}
                type="button"
                onClick={() => setMotivo(opcion)}
                aria-pressed={motivo === opcion}
                className={cn(
                  "min-h-12 rounded-xl border px-4 text-left text-[15px] font-medium",
                  motivo === opcion ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border bg-surface",
                )}
              >
                {MOTIVO_LABEL[opcion]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {resultado === "vendido" && (
        <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <legend className="sr-only">Detalle de la venta</legend>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Lectores vendidos</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCantidad((n) => Math.max(1, n - 1))}
                aria-label="Uno menos"
                className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface"
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                {cantidad}
              </span>
              <button
                type="button"
                onClick={() => setCantidad((n) => Math.min(50, n + 1))}
                aria-label="Uno más"
                className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-semibold">Modelo</span>
            <div className="flex flex-wrap gap-2">
              {MODELOS_POINT.map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  onClick={() => setModelo(opcion)}
                  aria-pressed={modelo === opcion}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-medium",
                    modelo === opcion ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
                  )}
                >
                  {opcion}
                </button>
              ))}
            </div>
            {modelo === "Otro" && (
              <InputTerreno value={modeloOtro} onChange={(event) => setModeloOtro(event.target.value)} placeholder="¿Qué modelo?" aria-label="Otro modelo" />
            )}
          </div>
        </fieldset>
      )}

      <div className="space-y-2">
        <span className="text-base font-semibold">Foto del local</span>
        <input ref={inputFoto} type="file" accept="image/*" capture="environment" className="sr-only" onChange={elegirFoto} tabIndex={-1} aria-hidden="true" />
        {preview ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
            <img src={preview} alt="Foto tomada" className="max-h-64 w-full rounded-xl object-cover" />
            <button
              type="button"
              onClick={() => inputFoto.current?.click()}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary"
            >
              <RefreshCw size={15} aria-hidden="true" />
              Tomar otra
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputFoto.current?.click()}
            disabled={preparandoFoto}
            className="flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-surface text-[15px] font-medium text-foreground active:bg-surface-muted"
          >
            {preparandoFoto ? <Loader2 size={26} className="animate-spin" aria-hidden="true" /> : <Camera size={26} aria-hidden="true" />}
            {preparandoFoto ? "Preparando foto…" : "Tomar foto de la fachada o del local"}
          </button>
        )}
      </div>

      {resultado && resultado !== "vendido" && resultado !== "descartado" && (
        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
            <CalendarClock size={18} aria-hidden="true" />
            ¿Cuándo vuelves? <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {ATAJOS_VUELTA.map((atajo) => {
              const valor = enDias(atajo.dias);
              return (
                <button
                  key={atajo.label}
                  type="button"
                  onClick={() => setProxima(proxima === valor ? "" : valor)}
                  aria-pressed={proxima === valor}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-medium",
                    proxima === valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
                  )}
                >
                  {atajo.label}
                </button>
              );
            })}
          </div>
          <InputTerreno
            type="datetime-local"
            value={proxima}
            onChange={(event) => setProxima(event.target.value)}
            aria-label="Fecha y hora de la próxima visita"
          />
        </fieldset>
      )}

      <label className="block space-y-1.5">
        <span className="text-base font-semibold">
          Nota <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
        </span>
        <textarea
          value={nota}
          onChange={(event) => setNota(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Ej.: volver el jueves en la tarde, habla con la dueña"
          className="w-full rounded-xl border border-border-strong/70 bg-surface px-3.5 py-3 text-base shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Acción fija abajo, con lo que falta a la vista. */}
      <div className="sticky bottom-20 z-10 -mx-4 space-y-2.5 border-t border-border bg-background/95 px-4 pb-2 pt-3 backdrop-blur">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Lo que falta">
          {pendientes.map((item) => (
            <li key={item.label} className={cn("flex items-center gap-1", item.ok ? "text-success" : "text-muted-foreground")}>
              {item.ok ? <Check size={13} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
              {item.label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={guardar} disabled={!listo || pending} className={BOTON_PRIMARIO}>
          {pending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
          {pending ? "Guardando visita…" : "Guardar visita"}
        </button>
      </div>
    </div>
  );
}
