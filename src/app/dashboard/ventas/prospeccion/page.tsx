import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Undo2 } from "lucide-react";

import { deshacerToque, registrarToque } from "@/app/actions/prospeccion";
import { ContactarProspecto } from "@/components/contactar-prospecto";
import { Badge, Callout, EmptyState, NavTabs, PageHeader, SectionCard, StatCard, SubmitButton } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile } from "@/lib/citas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import {
  ETIQUETA_RESULTADO,
  celularChileno,
  enlaceWhatsapp,
  esResultado,
  haceCuanto,
  mensajeDeWhatsapp,
  senalDe,
  type Prospecto,
} from "@/lib/prospeccion";
import { createClient } from "@/lib/supabase/server";
import { PESTANAS_VENTAS } from "@/lib/ventas-pestanas";

/**
 * La bandeja de prospección: quien abrió, hizo clic o respondió la campaña de
 * correo, ordenado por temperatura. Es el mismo listado que el resumen diario
 * de Atlas Lead manda por correo, pero acá se trabaja: WhatsApp en un clic que
 * queda anotado, y un resultado que decide si vuelve en unos días, sale de la
 * bandeja o pasa al pipeline como negocio.
 */

const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fechaCorta = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });

const ESTADO: Record<Prospecto["estado"], { texto: string; tono: "info" | "warning" | "neutral" }> = {
  nuevo: { texto: "Sin contactar", tono: "info" },
  volvio: { texto: "Volvió a abrir", tono: "warning" },
  seguimiento: { texto: "Toca seguimiento", tono: "neutral" },
};

type Toque = {
  id: string;
  lead_id: string;
  resultado: string;
  nota: string | null;
  seguir_at: string | null;
  opportunity_id: string | null;
  hecho_por: string | null;
  created_at: string;
  leads: { full_name: string | null; extra: Record<string, unknown> | null } | { full_name: string | null; extra: Record<string, unknown> | null }[] | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};

function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

export default async function ProspeccionPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  noStore();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { empresa: empresaPropia } = await contextoDeMiEmpresa();
  const { vista = "cola" } = await searchParams;
  const ahora = new Date();
  const inicioHoy = instanteEnChile(fechaEnChile(ahora), "00:00");
  const haceSieteDias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

  const supabase = await createClient();
  const [{ data: colaData, error }, { data: toquesData }] = await Promise.all([
    supabase.rpc("bandeja_de_prospeccion", { p_dias: 14 }),
    supabase
      .from("prospeccion_toques")
      .select("id, lead_id, resultado, nota, seguir_at, opportunity_id, hecho_por, created_at, leads(full_name, extra), profiles(full_name)")
      .gte("created_at", haceSieteDias.toISOString())
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const cola = (colaData ?? []) as Prospecto[];
  const toques = (toquesData ?? []) as unknown as Toque[];
  const calientes = cola.filter((p) => p.respondio || p.clic || p.estado === "volvio");
  const sinGestionUnDia = cola.filter((p) => p.estado === "nuevo" && p.primera_senal_at && ahora.getTime() - new Date(p.primera_senal_at).getTime() > 24 * 60 * 60 * 1000);
  const hechosHoy = toques.filter((t) => new Date(t.created_at) >= inicioHoy);
  const remitente = (profile.full_name ?? "").split(" ")[0] || "el equipo";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prospección"
        description={`${empresaPropia ?? "Tu empresa"} · quienes mostraron interés en la campaña de correo y esperan que les escribas. El correo de Atlas es el aviso; la gestión se anota acá.`}
      />
      <NavTabs tabs={PESTANAS_VENTAS} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Por contactar" value={cola.length} hint="Abrieron, hicieron clic o respondieron en 14 días" />
        <StatCard label="Calientes" value={calientes.length} hint="Respondieron, hicieron clic o volvieron a abrir" tone={calientes.length > 0 ? "warn" : "default"} />
        <StatCard label="Más de un día sin gestión" value={sinGestionUnDia.length} hint="El interés se enfría rápido" tone={sinGestionUnDia.length > 0 ? "danger" : "good"} />
        <StatCard label="Gestionados hoy" value={hechosHoy.length} hint={`${toques.length} en los últimos 7 días`} tone="good" />
      </div>

      <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
        {[
          { clave: "cola", texto: `Por contactar · ${cola.length}`, href: "/dashboard/ventas/prospeccion" },
          { clave: "historial", texto: "Gestionados · 7 días", href: "/dashboard/ventas/prospeccion?vista=historial" },
        ].map((opcion) => {
          const activa = (vista === "historial" ? "historial" : "cola") === opcion.clave;
          return (
            <Link
              key={opcion.clave}
              href={opcion.href}
              aria-current={activa ? "page" : undefined}
              className={`rounded px-3 py-1 font-medium transition-colors ${activa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {opcion.texto}
            </Link>
          );
        })}
      </div>

      {error && <Callout tone="danger">No se pudo leer la bandeja: {error.message}</Callout>}

      {vista !== "historial" ? (
        <SectionCard
          title="Por contactar"
          description="Ordenado por temperatura: quien respondió, quien hizo clic, quien volvió a abrir y quien abrió más de una vez. Al escribirle vuelve en 3 días si no pasa nada; si vuelve a abrir antes, sube."
        >
          {cola.length === 0 ? (
            <EmptyState title="Bandeja al día" description="Nadie con interés espera gestión. Cuando alguien abra o haga clic en la campaña, aparece acá." />
          ) : (
            <ul className="divide-y divide-border">
              {cola.map((p) => {
                const celular = celularChileno(p.telefono);
                const canal = celular ? "whatsapp" : p.telefono ? "llamada" : "correo";
                const enlace = celular
                  ? enlaceWhatsapp(celular, mensajeDeWhatsapp({ remitente, empresaPropia: empresaPropia ?? "nuestro equipo", empresa: p.empresa }))
                  : p.telefono
                    ? `tel:${p.telefono.replace(/[^\d+]/g, "")}`
                    : p.email
                      ? `mailto:${p.email}`
                      : null;
                const etiqueta = celular ? "WhatsApp" : p.telefono ? `Llamar ${p.telefono}` : "Escribir correo";
                const estado = ESTADO[p.estado];
                const tono = p.respondio || p.clic ? "success" : "neutral";
                return (
                  <li key={p.lead_id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/dashboard/leads/${p.lead_id}`} className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
                          {p.empresa ?? p.contacto ?? p.email ?? "Sin nombre"}
                        </Link>
                        <Badge tone={estado.tono}>{estado.texto}</Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.contacto && p.contacto !== p.empresa ? p.contacto : null, p.telefono, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge tone={tono}>{senalDe(p)}</Badge>
                        <span>{haceCuanto(p.ultima_senal_at, ahora)}</span>
                        {p.campana && <span className="truncate">· {p.campana}</span>}
                        {p.ultimo_resultado && esResultado(p.ultimo_resultado) && p.ultimo_toque_at && (
                          <span>· {ETIQUETA_RESULTADO[p.ultimo_resultado]} el {fechaCorta.format(new Date(p.ultimo_toque_at))}{p.toques > 1 ? ` (${p.toques} intentos)` : ""}</span>
                        )}
                        {p.respondio && (
                          <Link href="/dashboard/ventas/respuestas" className="text-primary hover:underline">Ver su respuesta</Link>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
                      <ContactarProspecto leadId={p.lead_id} canal={canal} enlace={enlace} etiqueta={etiqueta} />
                      <Resultado leadId={p.lead_id} resultado="interesado" texto="Interesado" />
                      <Resultado leadId={p.lead_id} resultado="no_interesa" texto="No interesa" />
                      {p.telefono && <Resultado leadId={p.lead_id} resultado="numero_malo" texto="Número no sirve" />}
                      <Resultado leadId={p.lead_id} resultado="posponer" texto="En una semana" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Gestionados en los últimos 7 días" description="Lo que se hizo con cada prospecto. Lo tuyo de las últimas 24 horas se puede deshacer, salvo lo que ya pasó al pipeline.">
          {toques.length === 0 ? (
            <EmptyState title="Sin gestiones todavía" description="Cada WhatsApp, llamada o resultado que anotes en la bandeja aparece acá." />
          ) : (
            <ul className="divide-y divide-border">
              {toques.map((t) => {
                const lead = primero(t.leads);
                const nombre = String(lead?.extra?.company_name ?? lead?.full_name ?? "Prospecto");
                const quien = primero(t.profiles)?.full_name ?? "—";
                const deshacible = t.hecho_por === profile.id && t.resultado !== "interesado" && ahora.getTime() - new Date(t.created_at).getTime() < 24 * 60 * 60 * 1000;
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {esResultado(t.resultado) ? ETIQUETA_RESULTADO[t.resultado] : t.resultado} · {quien} · {fechaHora.format(new Date(t.created_at))}
                        {t.seguir_at ? ` · vuelve el ${fechaCorta.format(new Date(t.seguir_at))}` : ""}
                        {t.nota ? ` · ${t.nota}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.opportunity_id && (
                        <Link href={`/dashboard/ventas/${t.opportunity_id}`} className="text-xs text-primary hover:underline">Ver negocio</Link>
                      )}
                      {deshacible && (
                        <form action={deshacerToque}>
                          <input type="hidden" name="toque_id" value={t.id} />
                          <SubmitButton size="sm" variant="ghost" pendingLabel="…"><Undo2 size={12} aria-hidden="true" /> Deshacer</SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}

function Resultado({ leadId, resultado, texto }: { leadId: string; resultado: string; texto: string }) {
  return (
    <form action={registrarToque}>
      <input type="hidden" name="lead_id" value={leadId} />
      <input type="hidden" name="resultado" value={resultado} />
      <SubmitButton size="sm" variant={resultado === "interesado" ? "secondary" : "ghost"} pendingLabel="…">{texto}</SubmitButton>
    </form>
  );
}
