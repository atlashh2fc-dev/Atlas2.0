"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, ChevronRight, MapPin, Search, Store } from "lucide-react";

import { Badge } from "@/components/ui";
import { compactRut } from "@/lib/rut";
import { ETAPA_INFO, ETAPAS, type ClienteTerreno, type Etapa } from "@/lib/terreno";
import { cn } from "@/lib/utils";

const hace = new Intl.RelativeTimeFormat("es-CL", { numeric: "auto" });
const diaHora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const soloDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" });

function cuandoLabel(iso: string | null, ahora: number): string | null {
  if (!iso) return null;
  const dias = Math.round((new Date(iso).getTime() - ahora) / 86_400_000);
  if (dias === 0) return "hoy";
  return hace.format(dias, "day");
}

/** 0 vencida o de hoy, 1 por visitar, 2 el resto: lo que hay que hacer hoy va arriba. */
function prioridad(cliente: ClienteTerreno, hoy: string): number {
  if (cliente.proxima_visita_at && soloDia.format(new Date(cliente.proxima_visita_at)) <= hoy) return 0;
  if (cliente.etapa === "no_visitado") return 1;
  return 2;
}

function sinTildes(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Cartera del vendedor. Arriba, la búsqueda (nombre, RUT, comuna o
 * dirección) y las etapas como filtro; abajo, una tarjeta grande por cliente.
 * Los "por visitar" van primero por defecto: es lo que hay que hacer hoy.
 */
export function ListaClientes({ clientes, error, ahora }: { clientes: ClienteTerreno[]; error: boolean; ahora: string }) {
  const ahoraMs = new Date(ahora).getTime();
  const hoy = soloDia.format(new Date(ahora));
  const [filtro, setFiltro] = useState<Etapa | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");

  const conteo = useMemo(() => {
    const porEtapa = Object.fromEntries(ETAPAS.map((etapa) => [etapa, 0])) as Record<Etapa, number>;
    for (const cliente of clientes) porEtapa[cliente.etapa] += 1;
    return porEtapa;
  }, [clientes]);

  const visibles = useMemo(() => {
    const termino = sinTildes(busqueda.trim());
    const rutTermino = compactRut(busqueda);
    return clientes
      .filter((cliente) => filtro === "todos" || cliente.etapa === filtro)
      .filter((cliente) => {
        if (!termino) return true;
        const texto = sinTildes(
          [cliente.lead?.full_name, cliente.nombre_contacto, cliente.comuna, cliente.direccion, cliente.rubro].filter(Boolean).join(" "),
        );
        const rut = cliente.lead?.rut ? compactRut(cliente.lead.rut) : "";
        return texto.includes(termino) || (rutTermino.length >= 3 && rut.includes(rutTermino));
      })
      .sort((a, b) => {
        // Lo vencido o de hoy arriba (lo más antiguo primero), luego los por
        // visitar y al final el resto, lo más reciente primero.
        const pa = prioridad(a, hoy);
        const pb = prioridad(b, hoy);
        if (pa !== pb) return pa - pb;
        if (pa === 0) return (a.proxima_visita_at ?? "").localeCompare(b.proxima_visita_at ?? "");
        return b.etapa_at.localeCompare(a.etapa_at);
      });
  }, [clientes, filtro, busqueda, hoy]);

  if (clientes.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-border bg-surface p-6 text-center">
        <span className="icon-chip mx-auto size-12 rounded-xl" data-tone="primary" aria-hidden="true">
          <Store size={22} />
        </span>
        <p className="mt-4 text-base font-semibold">{error ? "No pudimos cargar tus clientes" : "Aún no tienes clientes"}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {error
            ? "Revisa la señal y vuelve a abrir esta pantalla."
            : "Ingresa el primer comercio que vas a visitar. Si tienes el RUT, completamos sus datos."}
        </p>
        {!error && (
          <Link
            href="/terreno/nuevo"
            className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground"
          >
            Ingresar cliente
          </Link>
        )}
      </div>
    );
  }

  const chips: { id: Etapa | "todos"; label: string; total: number }[] = [
    { id: "todos", label: "Todos", total: clientes.length },
    ...ETAPAS.map((etapa) => ({ id: etapa, label: ETAPA_INFO[etapa].corto, total: conteo[etapa] })),
  ];

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Buscar cliente</span>
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
          placeholder="Nombre, RUT o comuna"
          className="h-12 w-full rounded-xl border border-border-strong/70 bg-surface pl-11 pr-4 text-base shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </label>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="group" aria-label="Filtrar por etapa">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setFiltro(chip.id)}
            aria-pressed={filtro === chip.id}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium",
              filtro === chip.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-foreground",
            )}
          >
            {chip.label}
            <span className={cn("tabular-nums", filtro === chip.id ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {chip.total}
            </span>
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Ningún cliente coincide. Prueba con otro nombre o cambia el filtro.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visibles.map((cliente) => {
            const info = ETAPA_INFO[cliente.etapa];
            const cuando = cuandoLabel(cliente.ultima_visita_at, ahoraMs);
            const volver = cliente.proxima_visita_at ? new Date(cliente.proxima_visita_at) : null;
            const vencida = volver !== null && soloDia.format(volver) <= hoy;
            const lugar = [cliente.direccion, cliente.comuna].filter(Boolean).join(", ");
            return (
              <li key={cliente.lead_id}>
                <Link
                  href={`/terreno/clientes/${cliente.lead_id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm active:bg-surface-muted"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-[15px] font-semibold">{cliente.lead?.full_name ?? "Sin nombre"}</p>
                    {lugar && (
                      <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                        <MapPin size={14} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{lugar}</span>
                      </p>
                    )}
                    {volver && (
                      <p className={cn("flex items-center gap-1.5 text-sm font-medium", vencida ? "text-warning" : "text-foreground")}>
                        <CalendarClock size={14} className="shrink-0" aria-hidden="true" />
                        {vencida && volver.getTime() < ahoraMs ? "Volver (atrasado): " : "Volver: "}
                        {diaHora.format(volver)}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={info.tone}>{info.corto}</Badge>
                      <span>
                        {cliente.visitas === 0
                          ? "Sin visitas"
                          : `${cliente.visitas} ${cliente.visitas === 1 ? "visita" : "visitas"}${cuando ? ` · última ${cuando}` : ""}`}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={20} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
