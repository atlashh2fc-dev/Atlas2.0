"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, PawPrint, Sparkles, TriangleAlert } from "lucide-react";

import { Badge, Button, EmptyState, useToast } from "@/components/ui";
import { COSTO_POR_RAZA, type RazaDeClinica } from "@/lib/mascota-modelos";

const usd = (valor: number) => `US$${valor.toFixed(2).replace(".", ",")}`;
const claveDe = (raza: RazaDeClinica) => `${raza.especie}/${raza.raza}`;
const cuantas = (n: number) => `${n} ${n === 1 ? "mascota" : "mascotas"}`;

/**
 * Las razas de las mascotas de la clínica, con el estado de su modelo 3D y un
 * botón para pedir el realista. El modelo tarda unos minutos: mientras hay
 * alguno en camino se consulta solo, y al terminar queda puesto en las fichas.
 */
export function ModelosDeLaClinica({ iniciales }: { iniciales: RazaDeClinica[] }) {
  const { toast } = useToast();
  const [razas, setRazas] = useState(iniciales);
  // Razas que se están pidiendo ahora mismo (la foto tarda unos segundos).
  const [pidiendo, setPidiendo] = useState<string[]>([]);

  const faltan = razas.filter((raza) => raza.estado === "dibujada" || raza.estado === "fallida");
  const enCamino = razas.some((raza) => raza.estado === "generando");

  const consultar = useCallback(async (opciones?: RequestInit) => {
    const respuesta = await fetch("/api/clinica/mascotas", { cache: "no-store", ...opciones });
    const json = (await respuesta.json().catch(() => null)) as { razas?: RazaDeClinica[]; error?: string } | null;
    if (!respuesta.ok || !json?.razas) throw new Error(json?.error ?? "No se pudo consultar.");
    setRazas(json.razas);
  }, []);

  // Mientras haya modelos en camino se consulta cada pocos segundos (eso mismo los avanza).
  useEffect(() => {
    if (!enCamino) return;
    const reloj = setInterval(() => void consultar().catch(() => undefined), 6000);
    return () => clearInterval(reloj);
  }, [enCamino, consultar]);

  const pedir = async (lista: RazaDeClinica[]) => {
    setPidiendo(lista.map(claveDe));
    let pedidas = 0;
    try {
      // De a una: cada pedido hace primero la foto de la raza.
      for (const raza of lista) {
        await consultar({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ especie: raza.especie, raza: raza.raza }) });
        pedidas += 1;
        setPidiendo((actuales) => actuales.filter((clave) => clave !== claveDe(raza)));
      }
      toast({ tone: "success", message: pedidas === 1 ? "Modelo en camino. Tarda unos minutos y queda puesto solo." : `${pedidas} modelos en camino. Tardan unos minutos y quedan puestos solos.` });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo pedir el modelo." });
    } finally {
      setPidiendo([]);
    }
  };

  if (razas.length === 0) {
    return (
      <EmptyState
        icon={PawPrint}
        title="Todavía no hay mascotas"
        description="Cuando registres mascotas, aquí aparecen sus razas para pedir el modelo realista de cada una."
        className="rounded-xl border border-dashed border-border"
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          {faltan.length === 0
            ? "Todas tus razas ya tienen su modelo realista o lo tienen en camino."
            : `${faltan.length === 1 ? "Falta 1 raza" : `Faltan ${faltan.length} razas`}. Cada modelo cuesta ${usd(COSTO_POR_RAZA)} y se hace una sola vez por raza.`}
        </p>
        {faltan.length > 1 && (
          <Button onClick={() => pedir(faltan)} disabled={pidiendo.length > 0}>
            {pidiendo.length > 0 ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {pidiendo.length > 0 ? "Pidiendo…" : `Generar las ${faltan.length} que faltan · ${usd(COSTO_POR_RAZA * faltan.length)}`}
          </Button>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {razas.map((raza) => {
          const clave = claveDe(raza);
          const ahora = pidiendo.includes(clave);
          return (
            <li key={clave} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
              <div className="flex size-20 flex-none items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-muted-foreground">
                {raza.foto_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagen del bucket público, sin optimizar
                  <img src={raza.foto_url} alt={`Foto de estudio: ${raza.raza}`} className="size-full object-cover" />
                ) : (
                  <PawPrint size={22} aria-hidden="true" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-semibold text-foreground">{raza.raza}</p>
                <p className="text-xs text-muted-foreground">{raza.especie} · {cuantas(raza.mascotas)}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
                  {raza.estado === "realista" ? (
                    <Badge tone="success"><Check size={12} aria-hidden="true" /> Modelo realista</Badge>
                  ) : raza.estado === "generando" || ahora ? (
                    <Badge tone="info"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Generando</Badge>
                  ) : raza.estado === "fallida" ? (
                    <Badge tone="danger"><TriangleAlert size={12} aria-hidden="true" /> No resultó</Badge>
                  ) : (
                    <Badge tone="neutral">Dibujada</Badge>
                  )}
                  {(raza.estado === "dibujada" || raza.estado === "fallida") && !ahora && (
                    <Button size="sm" variant="secondary" onClick={() => pedir([raza])} disabled={pidiendo.length > 0}>
                      <Sparkles size={13} aria-hidden="true" />
                      {raza.estado === "fallida" ? "Reintentar" : "Generar"}
                    </Button>
                  )}
                </div>
                {raza.error && <p className="mt-1.5 text-xs text-danger">{raza.error}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
