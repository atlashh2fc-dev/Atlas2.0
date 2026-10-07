import Link from "next/link";
import { EspecieYRaza } from "@/components/especie-y-raza";
import { razasDe } from "@/lib/anatomia";
import { connection } from "next/server";
import { ChevronRight, FileUp, PawPrint, Scissors, Search, SearchX, Users } from "lucide-react";

import { crearPaciente } from "@/app/actions/pacientes";
import { CreatePanel } from "@/components/create-panel";
import { Avatar, Badge, EmptyState, Field, Input, PageHeader, SectionCard, SegmentTabs, Select, Table, Tbody, Td, Th, Thead, Tr, buttonClasses } from "@/components/ui";
import { ATENCION_POR_EDICION, PACIENTES_POR_EDICION, VENTAS_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { REPORT_TIME_ZONE } from "@/lib/report-range";
import { estadoVacuna } from "@/lib/mascotas";
import { createClient } from "@/lib/supabase/server";

/**
 * Pacientes (Dental), tutores con sus mascotas (Vet) o clientes (Barber).
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
  barber: [
    { id: "todos", label: "Todos" },
    { id: "abiertos", label: "Paquete abierto" },
    { id: "sin_respuesta", label: "Sin respuesta +7 días" },
  ],
} as const;

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vista?: string }>;
}) {
  await connection();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = clinicaDe(edicion);
  const voc = PACIENTES_POR_EDICION[clinica];
  const ventas = VENTAS_POR_EDICION[clinica];
  const atencion = ATENCION_POR_EDICION[clinica];
  const esVet = clinica === "vet";
  const esBarber = clinica === "barber";
  const IconoFicha = esVet ? PawPrint : esBarber ? Scissors : Users;
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

  const enVista = (ficha: Ficha, id: string) => {
    const abierto = abiertoDe(ficha);
    switch (id) {
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
  };
  const fichas = todas.filter((ficha) => enVista(ficha, vista));

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
        icon={IconoFicha}
        description={voc.descripcion}
        meta={
          <span>
            <span className="font-medium text-foreground">{todas.length.toLocaleString("es-CL")}</span>{" "}
            {todas.length === 1 ? voc.singular.toLowerCase() : voc.titulo.toLowerCase()}
            {todas.length >= 500 ? " (primeros 500)" : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/pacientes/importar" className={buttonClasses({ variant: "ghost" })}>
            <FileUp size={16} aria-hidden="true" /> Importar desde Excel
          </Link>
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
            ) : esBarber ? (
              <Field label="Cumpleaños (opcional)">
                <Input name="nacimiento" type="date" />
              </Field>
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
          </div>
        }
      />

      <SectionCard>
        {/* Vistas y búsqueda pegadas a la lista, como en Attio o HubSpot. */}
        <div className="flex flex-col gap-2 border-b border-border px-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentTabs
            label="Vistas"
            activeId={vistas.some((otra) => otra.id === vista) ? vista : "todos"}
            tabs={vistas.map((opcion) => ({
              id: opcion.id,
              label: opcion.label,
              href: hrefVista(opcion.id),
              count: todas.filter((ficha) => enVista(ficha, opcion.id)).length,
              tone: opcion.id === "sin_respuesta" || opcion.id === "vacunas" ? ("warning" as const) : undefined,
            }))}
          />
          <form className="relative w-full pb-2 lg:w-80 lg:pb-0" action="/dashboard/pacientes">
            {vista !== "todos" && <input type="hidden" name="vista" value={vista} />}
            <Search size={15} className="pointer-events-none absolute left-3 top-[1.125rem] -translate-y-1/2 text-muted-foreground lg:top-1/2" aria-hidden="true" />
            <Input name="q" defaultValue={busqueda} placeholder="Buscar por nombre, celular, correo o RUT" className="pl-9" aria-label="Buscar" />
          </form>
        </div>
        {busqueda && (
          <p className="border-b border-border bg-surface-raised px-5 py-2 text-xs text-muted-foreground">
            {fichas.length.toLocaleString("es-CL")} {fichas.length === 1 ? "resultado" : "resultados"} para «{busqueda}»
          </p>
        )}

        {error ? (
          <p className="px-5 py-6 text-sm text-danger">No se pudieron leer las fichas. Vuelve a cargar para reintentar.</p>
        ) : fichas.length === 0 ? (
          <EmptyState
            icon={busqueda ? SearchX : IconoFicha}
            title={busqueda ? "Nadie coincide con la búsqueda" : `Todavía no hay ${voc.titulo.toLowerCase()} en esta vista`}
            description={busqueda ? "Prueba con el celular o solo el apellido." : `Crea la primera ficha con "${voc.nuevo}".`}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>{voc.singular}</Th>
                <Th>Contacto</Th>
                <Th>{esVet ? "Mascotas" : esBarber ? atencion.profesional : "Previsión"}</Th>
                <Th>{ventas.negocio} abierto</Th>
                <Th>Próxima acción</Th>
                <Th className="w-10">
                  <span className="sr-only">Abrir</span>
                </Th>
              </Thead>
              <Tbody>
                {fichas.map((ficha) => {
                  const abierto = abiertoDe(ficha);
                  const aceptados = ficha.sales_opportunities.filter((negocio) => negocio.status === "ganada").length;
                  const vencida = abierto?.next_action_at && new Date(abierto.next_action_at) < ahora;
                  const valor = String(ficha.metadata?.[esBarber ? "profesional" : "prevision"] ?? "");
                  return (
                    <Tr key={ficha.id}>
                      <Td>
                        <Link href={`/dashboard/pacientes/${ficha.id}`} className="flex min-w-0 items-center gap-3">
                          <Avatar name={ficha.name} size="md" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground group-hover:text-primary">{ficha.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {ficha.commune ?? "Sin comuna"}
                              {aceptados > 0 ? ` · ${aceptados} aceptado${aceptados === 1 ? "" : "s"}` : ""}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <span className={`block tabular-nums ${ficha.phone ? "text-foreground" : "text-muted-foreground"}`}>{ficha.phone ?? "Sin celular"}</span>
                        {ficha.email && <span className="block max-w-56 truncate text-xs text-muted-foreground">{ficha.email}</span>}
                      </Td>
                      <Td>
                        {esVet ? (
                          (ficha.mascotas ?? []).length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {(ficha.mascotas ?? []).map((mascota) => {
                                const estado = estadoVacuna(mascota.proxima_vacuna, ahora);
                                return (
                                  <span key={mascota.id} className="inline-flex items-center gap-2 whitespace-nowrap">
                                    <span className="text-foreground">{mascota.nombre}</span>
                                    <span className="text-xs text-muted-foreground">{mascota.especie.toLowerCase()}</span>
                                    {estado === "vencida" && <Badge tone="danger">Vacuna vencida</Badge>}
                                    {estado === "por_vencer" && <Badge tone="warning">Vacuna por vencer</Badge>}
                                  </span>
                                );
                              })}
                            </div>
                          )
                        ) : (
                          <span className={valor ? "text-foreground" : "text-muted-foreground"}>{valor || "—"}</span>
                        )}
                      </Td>
                      <Td>
                        {abierto ? (
                          <>
                            <span className="block text-foreground">{abierto.name}</span>
                            <span className="block text-xs tabular-nums text-muted-foreground">{pesos.format(Number(abierto.one_time_amount ?? 0))}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {abierto?.next_action_at ? (
                          vencida ? (
                            <Badge tone="danger">Vencida · {fecha.format(new Date(abierto.next_action_at)).replace(".", "")}</Badge>
                          ) : (
                            <span className="text-foreground">{fecha.format(new Date(abierto.next_action_at)).replace(".", "")}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="pl-0 pr-3">
                        <Link
                          href={`/dashboard/pacientes/${ficha.id}`}
                          aria-label={`Abrir la ficha de ${ficha.name}`}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/50 transition-colors hover:bg-surface-muted hover:text-primary group-hover:text-primary"
                        >
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
