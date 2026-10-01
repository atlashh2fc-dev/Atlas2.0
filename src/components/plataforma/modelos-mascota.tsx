"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, PawPrint, RotateCw, Sparkles } from "lucide-react";

import { Badge, Button, useToast } from "@/components/ui";
import { NOMBRE_REGION, RAZAS, razaDe, type Region } from "@/lib/anatomia";
import { LISTA_MOTORES, MOTORES_3D, costoDePrueba, type ModeloDeMascota, type Motor3D } from "@/lib/mascota-modelos";
import { cn } from "@/lib/utils";

const Animal3D = dynamic(() => import("@/components/mascota3d/animal-3d").then((modulo) => modulo.Animal3D), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Preparando el visor…</div>,
});

const usd = (valor: number) => `US$${valor.toFixed(2).replace(".", ",")}`;
const VISTA = { nombre: "derecha" as const, clave: 0 };

/**
 * Modelos realistas por raza: se genera una prueba (foto de estudio + un
 * modelo 3D por motor), se miran en el mismo visor de la ficha —con sus zonas
 * clínicas— y se elige uno. El elegido reemplaza al procedural en todas las
 * fichas de esa raza.
 */
export function ModelosMascota({ iniciales }: { iniciales: ModeloDeMascota[] }) {
  const { toast } = useToast();
  const [modelos, setModelos] = useState(iniciales);
  const [clave, setClave] = useState(`${RAZAS[1].especie}/${RAZAS[1].nombre}`);
  const [motores, setMotores] = useState<Motor3D[]>(LISTA_MOTORES);
  const [pidiendo, setPidiendo] = useState(false);

  const [especie, nombre] = clave.split("/") as ["Perro" | "Gato", string];
  const raza = useMemo(() => razaDe(especie, nombre), [especie, nombre]);
  const deLaRaza = modelos.filter((modelo) => modelo.especie === especie && modelo.raza === nombre);
  // De cada motor, el intento más reciente (y el elegido, aunque sea más viejo).
  const visibles = LISTA_MOTORES.flatMap((motor) => {
    const delMotor = deLaRaza.filter((modelo) => modelo.motor === motor);
    const ultimo = delMotor[0];
    const elegido = delMotor.find((modelo) => modelo.elegido);
    return [...new Set([elegido, ultimo].filter((modelo): modelo is ModeloDeMascota => Boolean(modelo)))];
  });
  const foto = deLaRaza.find((modelo) => modelo.foto_url)?.foto_url ?? null;
  const pendientes = modelos.some((modelo) => modelo.estado === "generando" || modelo.estado === "guardando");
  const costo = costoDePrueba(motores);

  const consultar = useCallback(async (opciones?: RequestInit) => {
    const respuesta = await fetch("/api/plataforma/mascotas", { cache: "no-store", ...opciones });
    const json = (await respuesta.json().catch(() => null)) as { modelos?: ModeloDeMascota[]; error?: string } | null;
    if (!respuesta.ok || !json?.modelos) throw new Error(json?.error ?? "No se pudo consultar.");
    setModelos(json.modelos);
  }, []);

  // Mientras haya modelos en la cola, se consulta cada pocos segundos (eso mismo los avanza).
  useEffect(() => {
    if (!pendientes) return;
    const reloj = setInterval(() => void consultar().catch(() => undefined), 6000);
    return () => clearInterval(reloj);
  }, [pendientes, consultar]);

  const generar = async () => {
    setPidiendo(true);
    try {
      await consultar({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ especie, raza: nombre, motores }) });
      toast({ tone: "success", message: "Foto lista. Los modelos 3D tardan unos minutos." });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo generar." });
    } finally {
      setPidiendo(false);
    }
  };

  const cambiar = async (id: string, cambio: { elegido?: boolean; giro?: number }, mensaje: string) => {
    try {
      await consultar({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...cambio }) });
      toast({ tone: "success", message: mensaje });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo guardar." });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Razas" className="space-y-5">
        {(["Perro", "Gato"] as const).map((grupo) => (
          <div key={grupo}>
            <p className="mb-1.5 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{grupo === "Perro" ? "Perros" : "Gatos"}</p>
            <ul className="space-y-0.5">
              {RAZAS.filter((item) => item.especie === grupo).map((item) => {
                const id = `${item.especie}/${item.nombre}`;
                const suyos = modelos.filter((modelo) => modelo.especie === item.especie && modelo.raza === item.nombre);
                const tiene = suyos.some((modelo) => modelo.elegido);
                const enCola = suyos.some((modelo) => modelo.estado === "generando" || modelo.estado === "guardando");
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setClave(id)}
                      aria-current={id === clave ? "true" : undefined}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors",
                        id === clave ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                      )}
                    >
                      <span className="flex-1 truncate">{item.nombre}</span>
                      {enCola ? (
                        <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label="Generando" />
                      ) : tiene ? (
                        <Check size={14} className="text-success" aria-label="Con modelo realista" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {raza.nombre} <span className="font-normal text-muted-foreground">· {raza.especie}</span>
            </h2>
            <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <legend className="sr-only">Motores 3D</legend>
              {LISTA_MOTORES.map((motor) => (
                <label key={motor} className="flex min-h-8 items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={motores.includes(motor)}
                    onChange={(event) => setMotores((actuales) => (event.target.checked ? [...actuales, motor] : actuales.filter((item) => item !== motor)))}
                    className="size-4 accent-[var(--primary)]"
                  />
                  {MOTORES_3D[motor].nombre}
                  <span className="text-muted-foreground">{MOTORES_3D[motor].precio === null ? "· precio s/d" : `· ${usd(MOTORES_3D[motor].precio!)}`}</span>
                </label>
              ))}
            </fieldset>
          </div>
          <Button onClick={generar} disabled={pidiendo || motores.length === 0}>
            {pidiendo ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {pidiendo ? "Haciendo la foto…" : `Generar prueba · ${usd(costo.total)}${costo.incompleto ? " +" : ""}`}
          </Button>
        </div>

        {deLaRaza.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <PawPrint size={22} className="text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">Sin pruebas para {raza.nombre}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Genera una prueba: se hace una foto de estudio de la raza y, con ella, un modelo 3D por motor. Los comparas aquí, girándolos y tocando sus zonas, y eliges el que irá en las fichas.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            {foto && (
              <figure className="overflow-hidden rounded-xl border border-border bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- imagen del bucket público, sin optimizar */}
                <img src={foto} alt={`Foto de partida: ${raza.nombre}`} className="h-72 w-full bg-surface-muted object-contain" />
                <figcaption className="px-3 py-2.5 text-sm text-muted-foreground">Foto de partida</figcaption>
              </figure>
            )}
            {visibles.map((modelo) => (
              <TarjetaModelo
                key={modelo.id}
                modelo={modelo}
                raza={raza}
                onElegir={() => cambiar(modelo.id, { elegido: true }, `${MOTORES_3D[modelo.motor].nombre} queda en las fichas de ${raza.nombre}.`)}
                onQuitar={() => cambiar(modelo.id, { elegido: false }, `${raza.nombre} vuelve al modelo dibujado.`)}
                onGirar={() => cambiar(modelo.id, { giro: (modelo.giro + 180) % 360 }, "Orientación corregida.")}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TarjetaModelo({
  modelo,
  raza,
  onElegir,
  onQuitar,
  onGirar,
}: {
  modelo: ModeloDeMascota;
  raza: ReturnType<typeof razaDe>;
  onElegir: () => void;
  onQuitar: () => void;
  onGirar: () => void;
}) {
  const [zona, setZona] = useState<Region | null>(null);
  const [encima, setEncima] = useState<Region | null>(null);
  const listo = modelo.estado === "listo" && modelo.modelo_url;
  const visorModelo = useMemo(() => (listo ? { url: modelo.modelo_url!, giro: modelo.giro } : null), [listo, modelo.modelo_url, modelo.giro]);

  return (
    <figure className={cn("flex flex-col overflow-hidden rounded-xl border bg-surface", modelo.elegido ? "border-success" : "border-border")}>
      <div className="relative h-72 bg-surface-muted">
        {visorModelo ? (
          <>
            <Animal3D raza={raza} etapa="adulto" marcadores={[]} seleccionada={zona} onSelect={(region) => setZona(region)} onHover={setEncima} vista={VISTA} modelo={visorModelo} />
            {(encima ?? zona) && (
              <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/85 px-2.5 py-0.5 text-xs font-medium text-slate-700 shadow-sm">
                {NOMBRE_REGION[(encima ?? zona)!]}
              </span>
            )}
          </>
        ) : modelo.estado === "fallido" ? (
          <p className="flex h-full items-center justify-center px-4 text-center text-sm text-danger">{modelo.error ?? "El motor falló."}</p>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            {modelo.estado === "guardando" ? "Guardando el modelo…" : "Generando el 3D (unos minutos)…"}
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-sm font-medium text-foreground">{MOTORES_3D[modelo.motor].nombre}</span>
        {modelo.elegido && <Badge tone="success">En las fichas</Badge>}
        {modelo.segundos !== null && <span className="text-xs text-muted-foreground">{Math.round(modelo.segundos / 60) || 1} min</span>}
        {listo && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={onGirar} title="Si quedó mirando al revés">
              <RotateCw size={14} aria-hidden="true" /> Girar
            </Button>
            {modelo.elegido ? (
              <Button size="sm" variant="ghost" onClick={onQuitar}>
                Quitar
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onElegir}>
                Usar este
              </Button>
            )}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
