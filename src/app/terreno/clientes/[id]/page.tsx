import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CircleCheck, MapPinned, Navigation, Phone } from "lucide-react";

import { EditarCliente } from "@/components/terreno/editar-cliente";
import { HistorialVisitas } from "@/components/terreno/historial-visitas";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO } from "@/components/terreno/campos";
import { Badge } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CAMPO_LABEL,
  ETAPA_INFO,
  MOTIVO_LABEL,
  camposFaltantes,
  mapaHref,
  type ClienteTerreno,
  type DatosCliente,
  type VisitaTerreno,
} from "@/lib/terreno";
import { firmarFotosTerreno } from "@/lib/terreno.server";

const proximaFormato = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function TerrenoClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string; visita?: string }>;
}) {
  const profile = await requireProfile(["agente", "supervisor", "admin"]);
  const { id } = await params;
  const { nuevo, visita } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const [{ data: fichaData }, { data: visitasData }] = await Promise.all([
    supabase
      .from("terreno_fichas")
      .select(
        "lead_id, campaign_id, vendedor_id, etapa, motivo_salida, nombre_contacto, rubro, direccion, comuna, region, completado_con, pos_cantidad, pos_modelo, visitas, ultima_visita_at, proxima_visita_at, etapa_at, created_at, lead:leads(id, full_name, rut, phone, email)",
      )
      .eq("lead_id", id)
      .maybeSingle(),
    supabase
      .from("terreno_visitas")
      .select("id, lead_id, vendedor_id, etapa_antes, etapa, motivo_salida, nota, lat, lng, precision_m, sin_ubicacion, foto_path, pos_cantidad, pos_modelo, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (!fichaData) notFound();
  const raw = fichaData as unknown as ClienteTerreno;
  const cliente: ClienteTerreno = { ...raw, lead: Array.isArray(raw.lead) ? (raw.lead[0] ?? null) : raw.lead };
  const visitas = (visitasData ?? []) as VisitaTerreno[];
  const fotos = await firmarFotosTerreno(visitas.map((item) => item.foto_path));

  const esDueno = cliente.vendedor_id === profile.id;
  const info = ETAPA_INFO[cliente.etapa];
  const datos: DatosCliente = {
    full_name: cliente.lead?.full_name ?? "",
    rut: cliente.lead?.rut ?? "",
    phone: cliente.lead?.phone ?? "",
    email: cliente.lead?.email ?? "",
    nombre_contacto: cliente.nombre_contacto ?? "",
    rubro: cliente.rubro ?? "",
    direccion: cliente.direccion ?? "",
    comuna: cliente.comuna ?? "",
    region: cliente.region ?? "",
  };
  const faltan = camposFaltantes(datos);
  const mapa = mapaHref({ direccion: cliente.direccion, comuna: cliente.comuna });

  return (
    <div className="space-y-5">
      <Link href="/terreno" className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground">
        <ArrowLeft size={18} aria-hidden="true" />
        Mis clientes
      </Link>

      {nuevo && (
        <div className="flex gap-3 rounded-xl border border-success/30 bg-success/5 p-3.5 text-sm" role="status">
          <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <p>Cliente guardado. Cuando estés en el local, registra la visita.</p>
        </div>
      )}
      {visita && (
        <div className="flex gap-3 rounded-xl border border-success/30 bg-success/5 p-3.5 text-sm" role="status">
          <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <p>
            {cliente.etapa === "vendido"
              ? "¡Venta registrada! Quedó en tu avance del día."
              : "Visita registrada. Sigue con el próximo cliente."}
          </p>
        </div>
      )}

      <section className="space-y-2">
        <h1 className="text-xl font-semibold leading-tight">{datos.full_name || "Sin nombre"}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={info.tone}>{info.label}</Badge>
          {cliente.etapa === "descartado" && cliente.motivo_salida && <span>{MOTIVO_LABEL[cliente.motivo_salida]}</span>}
          {cliente.etapa === "vendido" && cliente.pos_cantidad && (
            <span>
              {cliente.pos_cantidad} {cliente.pos_cantidad === 1 ? "lector" : "lectores"}
              {cliente.pos_modelo ? ` · ${cliente.pos_modelo}` : ""}
            </span>
          )}
          {datos.rut && <span>RUT {datos.rut}</span>}
        </div>
        {cliente.proxima_visita_at && (
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock size={15} aria-hidden="true" />
            Volver: {proximaFormato.format(new Date(cliente.proxima_visita_at))}
          </p>
        )}
      </section>

      {esDueno && (
        <Link href={`/terreno/clientes/${id}/visita`} className={BOTON_PRIMARIO}>
          <MapPinned size={20} aria-hidden="true" />
          Registrar visita
        </Link>
      )}

      {(datos.phone || mapa) && (
        <div className="grid grid-cols-2 gap-2.5">
          {datos.phone ? (
            <a href={`tel:${datos.phone.replace(/\s+/g, "")}`} className={BOTON_SECUNDARIO}>
              <Phone size={18} aria-hidden="true" />
              Llamar
            </a>
          ) : (
            <span />
          )}
          {mapa && (
            <a href={mapa} target="_blank" rel="noreferrer" className={BOTON_SECUNDARIO}>
              <Navigation size={18} aria-hidden="true" />
              Cómo llegar
            </a>
          )}
        </div>
      )}

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">Datos</h2>
          {faltan.length > 0 && (
            <span className="text-xs font-medium text-warning">
              Faltan {faltan.length} de 5
            </span>
          )}
        </div>
        {faltan.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            Completa: {faltan.map((campo) => CAMPO_LABEL[campo].toLowerCase()).join(", ")}.
          </p>
        )}
        <dl className="mt-3 divide-y divide-border text-sm">
          {(["nombre_contacto", "phone", "email", "rubro", "direccion", "comuna", "region"] as const).map((campo) => (
            <div key={campo} className="flex justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">{CAMPO_LABEL[campo]}</dt>
              <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
                {datos[campo] || <span className="font-normal text-muted-foreground">—</span>}
              </dd>
            </div>
          ))}
        </dl>
        {esDueno && <EditarCliente leadId={id} datos={datos} />}
      </section>

      <HistorialVisitas visitas={visitas} fotos={Object.fromEntries(fotos)} />
    </div>
  );
}
