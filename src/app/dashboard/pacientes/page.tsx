import Link from "next/link";
import { EspecieYRaza } from "@/components/especie-y-raza";
import { razasDe } from "@/lib/anatomia";
import { unstable_noStore as noStore } from "next/cache";
import { Search } from "lucide-react";

import { crearPaciente } from "@/app/actions/pacientes";
import { CreatePanel } from "@/components/create-panel";
import { Badge, EmptyState, Field, Input, PageHeader, SectionCard, Select } from "@/components/ui";
import { PACIENTES_POR_EDICION, VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { REPORT_TIME_ZONE } from "@/lib/report-range";
import { estadoVacuna } from "@/lib/mascotas";
import { createClient } from "@/lib/supabase/server";

/**
 * Pacientes (Dental) o tutores con sus mascotas (Vet).
 *
 * Es la puerta de entrada de una clínica: buscar a alguien, ver en qué va y
 * abrir su ficha. Las vistas son las que usa una recepción para llamar: quién
 * tiene un presupuesto abierto, quién lleva días sin responder y, en Vet, qué
 * mascotas tienen la vacuna vencida o por vencer.
 */

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: REPORT_TIME_ZONE, day: "2-digit", month: "short" });
const DIA = 24 * 60 * 60 * 1000;

type Ficha = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  commune: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  sales_opportunities: { id: string; name: string; status: string; one_time_amount: number | null; next_action_at: string | null; created_at: string }[];
  mascotas?: { id: string; nombre: string; especie: string; proxima_vacuna: string | null }[];
};

const VISTAS = {
  dental: [
    { id: "todos", label: "Todos" },
    { id: "abiertos", label: "Presupuesto abierto" },
    { id: "sin_respuesta", label: "Sin respuesta +7 días" },
    { id: "aceptados", label: "Con tratamiento aceptado" },
  ],
  vet: [
    { id: "todos", label: "Todos" },
    { id: "vacunas", label: "Vacuna vencida o por vencer" },
    { id: "abiertos", label: "Plan abierto" },
    { id: "sin_respuesta", label: "Sin respuesta +7 días" },
  ],
} as const;

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vista?: string }>;
}) {
  noStore();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = edicion === "vet" ? "vet" : "dental";
  const voc = PACIENTES_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const esVet = clinica === "vet";
  const { q = "", vista = "todos" } = await searchParams;
  const busqueda = q.trim();

  const supabase = await createClient();
  let consulta = supabase
    .from("sales_companies")
    .select(
      `id, name, phone, email, commune, metadata, created_at, sales_opportunities(id, name, status, one_time_amount, next_action_at, created_at)${esVet ? ", mascotas(id, nombre, especie, proxima_vacuna)" : ""}`,
    )
    .order("name")
    .limit(500);
  if (busqueda) {
    const patron = `%${busqueda.replace(/[%_,()]/g, " ")}%`;
    consulta = consulta.or(`name.ilike.${patron},phone.ilike.${patron},email.ilike.${patron},rut.ilike.${patron}`);
  }
  const { data, error } = await consulta;

  const ahora = new Date();
  const todas = (data ?? []) as unknown as Ficha[];
  const abiertoDe = (ficha: Ficha) => ficha.sales_opportunities.find((negocio) => negocio.status === "abierta") ?? null;
  const diasDesde = (instante: string) => Math.floor((ahora.getTime() - new Date(instante).getTime()) / DIA);

  const fichas = todas.filter((ficha) => {
    const abierto = abiertoDe(ficha);
    switch (vista) {
      case "abiertos":
        return abierto !== null;
      case "sin_respuesta":
        return abierto !== null && abierto.next_action_at !== null && diasDesde(abierto.next_action_at) >= 7;
      case "aceptados":
        return ficha.sales_opportunities.some((negocio) => negocio.status === "ganada");
      case "vacunas":
        return (ficha.mascotas ?? []).some((mascota) => {
          const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
          return estado === "vencida" || estado === "por_vencer";
        });
      default:
        return true;
    }
  });

  const vistas = VISTAS[clinica];
  const hrefVista = (id: string) => {
    const parametros = new URLSearchParams();
    if (busqueda) parametros.set("q", busqueda);
    if (id !== "todos") parametros.set("vista", id);
    const cadena = parametros.toString();
    return `/dashboard/pacientes${cadena ? `?${cadena}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={voc.titulo}
        description={voc.descripcion}
        actions={
          <CreatePanel
            label={voc.nuevo}
            title={voc.nuevo}
            description="Con el nombre y un teléfono o correo basta para empezar. Lo demás se completa en la ficha."
            action={crearPaciente}
            submitLabel="Crear ficha"
            successLabel="Ficha creada"
          >
            <Field label="Nombre y apellido">
              <Input name="nombre" required placeholder={ventas.cuentaPlaceholder} data-autofocus />
            </Field>
            <Field label="Celular">
              <Input name="telefono" inputMode="tel" placeholder="+56 9 1234 5678" />
            </Field>
            <Field label="Correo">
              <Input name="email" type="email" placeholder="nombre@correo.cl" />
            </Field>
            <Field label="RUT (opcional)">
              <Input name="rut" placeholder="12.345.678-9" />
            </Field>
            {esVet ? (
              <>
                <Field label="Nombre de la mascota">
                  <Input name="mascota" placeholder="Luna" />
                </Field>
                <EspecieYRaza
                  razas={{
                    Perro: razasDe("Perro").map(({ nombre, peso }) => ({ nombre, peso })),
                    Gato: razasDe("Gato").map(({ nombre, peso }) => ({ nombre, peso })),
                  }}
                />
                <Field label="Sexo">
                  <Select name="sexo" defaultValue="">
                    <option value="">Sin dato</option>
                    <option>Hembra</option>
                    <option>Macho</option>
                  </Select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Previsión">
                  <Select name="prevision" defaultValue="">
                    <option value="">Sin dato</option>
                    {["Fonasa", "Isapre Banmédica", "Isapre Colmena", "Isapre Consalud", "Isapre Cruz Blanca", "Particular"].map((opcion) => (
                      <option key={opcion}>{opcion}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Fecha de nacimiento">
                  <Input name="nacimiento" type="date" />
                </Field>
              </>
            )}
            <Field label="Comuna">
              <Input name="comuna" placeholder="Providencia" />
            </Field>
            <Field label="Cómo llegó">
              <Select name="origen" defaultValue="">
                <option value="">Sin dato</option>
                {ventas.origenes.map((origen) => (
                  <option key={origen.value} value={origen.value}>
                    {origen.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">El {ventas.negocio.toLowerCase()} se crea después, desde la ficha.</p>
          </CreatePanel>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Vistas" className="flex flex-wrap gap-1.5">
          {vistas.map((opcion) => (
            <Link
              key={opcion.id}
              href={hrefVista(opcion.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                vista === opcion.id || (opcion.id === "todos" && !vistas.some((otra) => otra.id === vista))
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground"
              }`}
            >
              {opcion.label}
            </Link>
          ))}
        </nav>
        <form className="relative w-full lg:w-80" action="/dashboard/pacientes">
          {vista !== "todos" && <input type="hidden" name="vista" value={vista} />}
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input name="q" defaultValue={busqueda} placeholder="Buscar por nombre, celular, correo o RUT" className="pl-9" aria-label="Buscar" />
        </form>
      </div>

      <SectionCard
        title={`${fichas.length} ${fichas.length === 1 ? voc.singular.toLowerCase() : voc.titulo.toLowerCase()}`}
        description={busqueda ? `Resultados para "${busqueda}"` : undefined}
      >
        {error ? (
          <p className="px-4 py-6 text-sm text-danger">No se pudieron leer las fichas. Vuelve a cargar para reintentar.</p>
        ) : fichas.length === 0 ? (
          <EmptyState
            title={busqueda ? "Nadie coincide con la búsqueda" : `Todavía no hay ${voc.titulo.toLowerCase()} en esta vista`}
            description={busqueda ? "Prueba con el celular o solo el apellido." : `Crea la primera ficha con "${voc.nuevo}".`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{voc.singular}</th>
                  <th className="px-3 py-2 font-medium">Contacto</th>
                  <th className="px-3 py-2 font-medium">{esVet ? "Mascotas" : "Previsión"}</th>
                  <th className="px-3 py-2 font-medium">{ventas.negocio} abierto</th>
                  <th className="px-4 py-2 font-medium">Próxima acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fichas.map((ficha) => {
                  const abierto = abiertoDe(ficha);
                  const aceptados = ficha.sales_opportunities.filter((negocio) => negocio.status === "ganada").length;
                  const vencida = abierto?.next_action_at && new Date(abierto.next_action_at) < ahora;
                  return (
                    <tr key={ficha.id} className="transition-colors hover:bg-surface-muted/50">
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/pacientes/${ficha.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                          {ficha.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {ficha.commune ?? "Sin comuna"}
                          {aceptados > 0 ? ` · ${aceptados} aceptado${aceptados === 1 ? "" : "s"}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        <p>{ficha.phone ?? "—"}</p>
                        <p className="truncate text-xs">{ficha.email ?? ""}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        {esVet ? (
                          <div className="flex flex-wrap gap-1">
                            {(ficha.mascotas ?? []).map((mascota) => {
                              const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
                              return (
                                <Badge
                                  key={mascota.id}
                                  tone={estado === "vencida" ? "danger" : estado === "por_vencer" ? "warning" : "neutral"}
                                >
                                  {mascota.nombre} · {mascota.especie.toLowerCase()}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{String(ficha.metadata?.prevision ?? "—")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {abierto ? (
                          <>
                            <p className="text-foreground">{abierto.name}</p>
                            <p className="text-xs tabular-nums text-muted-foreground">{pesos.format(Number(abierto.one_time_amount ?? 0))}</p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 ${vencida ? "text-danger" : "text-muted-foreground"}`}>
                        {abierto?.next_action_at
                          ? `${vencida ? "Vencida · " : ""}${fecha.format(new Date(abierto.next_action_at))}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
