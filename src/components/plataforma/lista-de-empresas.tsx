"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building2, ChevronRight, Search } from "lucide-react";

import { Avatar, Badge, EmptyState } from "@/components/ui";
import type { Edicion } from "@/lib/ediciones";

export type FilaEmpresa = {
  id: string;
  nombre: string;
  slug: string;
  edicion: Edicion;
  edicionNombre: string;
  activa: boolean;
  miembrosActivos: number;
  aplicaciones: number;
  actividad: string;
  iniciales: string;
};

/**
 * Lista de empresas: una fila por empresa, con lo que se mira antes de entrar
 * (edición, gente, aplicaciones, si la usan). La fila completa abre la empresa.
 */
export function ListaDeEmpresas({ filas }: { filas: FilaEmpresa[] }) {
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLocaleLowerCase("es");
    if (!texto) return filas;
    return filas.filter((fila) => `${fila.nombre} ${fila.slug}`.toLocaleLowerCase("es").includes(texto));
  }, [busqueda, filas]);

  return (
    <div className="space-y-4">
      {filas.length > 6 && (
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Buscar empresa</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar empresa"
            className="h-9 w-full rounded-lg border border-border-strong/70 bg-surface pl-9 pr-3 text-sm text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      )}

      <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        {visibles.length === 0 && (
          <li>
            <EmptyState
              icon={filas.length === 0 ? Building2 : Search}
              title={filas.length === 0 ? "Todavía no hay empresas" : `Ninguna empresa coincide con «${busqueda}»`}
              description={filas.length === 0 ? "Crea la primera con «Nueva empresa»." : "Prueba con otra parte del nombre o la clave."}
            />
          </li>
        )}
        {visibles.map((fila) => (
          <li key={fila.id}>
            <Link
              href={`/plataforma/empresas/${fila.id}`}
              className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-muted/60"
            >
              <Avatar name={fila.nombre} seed={fila.slug} size="lg" shape="square" className={fila.activa ? "" : "opacity-50"} />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{fila.nombre}</span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {fila.edicionNombre} · {fila.miembrosActivos} {fila.miembrosActivos === 1 ? "miembro" : "miembros"} ·{" "}
                  {fila.aplicaciones} {fila.aplicaciones === 1 ? "aplicación" : "aplicaciones"}
                </span>
              </span>

              <span className="hidden w-36 shrink-0 text-right sm:block">
                <span className="block text-xs text-muted-foreground">Último ingreso</span>
                <span className="mt-0.5 block text-[13px] text-foreground">{fila.actividad}</span>
              </span>

              <span className="w-24 shrink-0">
                <Badge tone={fila.activa ? "success" : "neutral"}>{fila.activa ? "Activa" : "Suspendida"}</Badge>
              </span>

              <ChevronRight size={16} className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
