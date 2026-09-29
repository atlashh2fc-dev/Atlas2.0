import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { CheckCheck, Flame, History, Inbox, Undo2 } from "lucide-react";

import { deshacerToque } from "@/app/actions/prospeccion";
import { BandejaProspeccion, type FilaProspecto } from "@/components/bandeja-prospeccion";
import { RespuestasDelAgente, type BorradorAgente, type ConfigAgente } from "@/components/respuestas-del-agente";
import { Callout, EmptyState, MetricCard, NavTabs, PageHeader, SectionCard, SubmitButton } from "@/components/ui";
import { VistaSegmentada } from "@/components/vista-segmentada";
import { requireProfile } from "@/lib/auth";
import { ZONA_CLINICA, fechaEnChile, instanteEnChile } from "@/lib/citas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import {
  ETIQUETA_RESULTADO,
  asuntoLegible,
  celularChileno,
  enlaceWhatsapp,
  esResultado,
  haceCuanto,
  mensajeDeWhatsapp,
  senalDe,
  temaDeLosCorreos,
  type Prospecto,
} from "@/lib/prospeccion";
import { createClient } from "@/lib/supabase/server";
import { PESTANAS_VENTAS } from "@/lib/ventas-pestanas";

/**
 * La bandeja de prospección: quien abrió, hizo clic o respondió la campaña de
 * correo, ordenado por temperatura. Es el mismo listado que el resumen diario
 * de Atlas Lead manda por correo, pero acá se trabaja: WhatsApp en un clic que
 * queda anotado, y un resultado que decide si vuelve en unos días, sale de la
 * bandeja o pasa al pipeline como negocio. Las respuestas que el agente
 * propone son la tercera vista: quien contestó es lo más caliente que hay.
 */

const fechaHora = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fechaCorta = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "numeric", month: "short" });

const ESTADO: Record<Prospecto["estado"], { texto: string; tono: "info" | "warning" | "neutral" | "danger" }> = {
  nuevo: { texto: "Sin contactar", tono: "info" },
  volvio: { texto: "Volvió a abrir", tono: "warning" },
  seguimiento: { texto: "Toca seguimiento", tono: "neutral" },
  no_contactar: { texto: "No contactar", tono: "danger" },
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
  const [{ data: colaData, error }, { data: toquesData }, { data: configAgente }, { data: borradoresData }] = await Promise.all([
    supabase.rpc("bandeja_de_prospeccion", { p_dias: 14 }),
    supabase
      .from("prospeccion_toques")
      .select("id, lead_id, resultado, nota, seguir_at, opportunity_id, hecho_por, created_at, leads(full_name, extra), profiles(full_name)")
      .gte("created_at", haceSieteDias.toISOString())
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("sales_agent_configs").select("enabled, modo").maybeSingle(),
    supabase
      .from("sales_agent_drafts")
      .select("id, para_email, asunto, cuerpo, intencion, razonamiento, escalar, created_at, opportunity_id")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Los marcados "no contactar" se ven en la lista (al final), pero no son trabajo pendiente.
  const todos = (colaData ?? []) as Prospecto[];
  const cola = todos.filter((p) => !p.no_contactar);
  const toques = (toquesData ?? []) as unknown as Toque[];
  const calientes = cola.filter((p) => p.respondio || p.clic || p.estado === "volvio");
  const sinGestionUnDia = cola.filter((p) => p.estado === "nuevo" && p.primera_senal_at && ahora.getTime() - new Date(p.primera_senal_at).getTime() > 24 * 60 * 60 * 1000);
  const hechosHoy = toques.filter((t) => new Date(t.created_at) >= inicioHoy);
  const remitente = (profile.full_name ?? "").split(" ")[0] || "el equipo";
  const borradores = (borradoresData ?? []) as BorradorAgente[];
  const config = (configAgente ?? null) as ConfigAgente;
  // Sin agente y sin nada pendiente, la vista de respuestas sería una puerta a un cuarto vacío.
  const conAgente = Boolean(config?.enabled) || borradores.length > 0;
  const vistaActiva = vista === "historial" ? "historial" : vista === "respuestas" && conAgente ? "respuestas" : "cola";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ventas"
        description={`${empresaPropia ?? "Tu empresa"} · a quién escribirle hoy: personas que abrieron, hicieron clic o respondieron tu campaña de correo.`}
      />
      <NavTabs tabs={PESTANAS_VENTAS} />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Esperan que les escribas"
          value={cola.length}
          hint={sinGestionUnDia.length > 0 ? `${sinGestionUnDia.length} llevan más de un día: el interés se enfría` : "Nadie lleva más de un día esperando"}
          tone={sinGestionUnDia.length > 0 ? "warn" : "default"}
          icon={Inbox}
          iconTone="teal"
        />
        <MetricCard label="Muy interesados" value={calientes.length} hint="Respondieron, hicieron clic o volvieron a abrir" icon={Flame} iconTone="amber" />
        <MetricCard label="Contactados hoy" value={hechosHoy.length} hint={`${toques.length} en los últimos 7 días`} tone={hechosHoy.length > 0 ? "good" : "default"} icon={CheckCheck} iconTone="green" />
      </div>

      <VistaSegmentada
        etiqueta="Qué ver"
        activa={vistaActiva}
        opciones={[
          { clave: "cola", texto: "Por contactar", href: "/dashboard/ventas/prospeccion", cuenta: cola.length },
          ...(conAgente ? [{ clave: "respuestas", texto: "Te respondieron", href: "/dashboard/ventas/prospeccion?vista=respuestas", cuenta: borradores.length }] : []),
          { clave: "historial", texto: "Ya contactados", href: "/dashboard/ventas/prospeccion?vista=historial" },
        ]}
      />

      {error && <Callout tone="danger">No se pudo leer la bandeja: {error.message}</Callout>}

      {vistaActiva === "respuestas" ? (
        <RespuestasDelAgente config={config} borradores={borradores} />
      ) : vistaActiva === "cola" ? (
        <SectionCard
          title="Primero, los más interesados"
          icon={Inbox}
          tone="teal"
          description="Escríbele con un clic y anota cómo te fue. Si no contesta, vuelve a esta lista en 3 días."
        >
          {todos.length === 0 ? (
            <EmptyState icon={Inbox} title="Estás al día" description="Nadie espera que le escribas. Cuando alguien abra o haga clic en tu campaña de correo, aparece acá." />
          ) : (
            <BandejaProspeccion
              filas={todos.map((p): FilaProspecto => {
                const celular = celularChileno(p.telefono);
                const correos = p.correos ?? [];
                const canal = celular ? "whatsapp" : p.telefono ? "llamada" : "correo";
                const enlace = celular
                  ? enlaceWhatsapp(celular, mensajeDeWhatsapp({ remitente, empresaPropia: empresaPropia ?? "nuestro equipo", empresa: p.empresa, respondio: p.respondio, toques: p.toques, tema: temaDeLosCorreos(correos) }))
                  : p.telefono
                    ? `tel:${p.telefono.replace(/[^\d+]/g, "")}`
                    : p.email
                      ? `mailto:${p.email}`
                      : null;
                return {
                  leadId: p.lead_id,
                  nombre: p.empresa ?? p.contacto ?? p.email ?? "Sin nombre",
                  estado: ESTADO[p.estado],
                  datos: [p.contacto && p.contacto !== p.empresa ? p.contacto : null, p.telefono, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto",
                  senal: senalDe(p),
                  tonoSenal: p.respondio || p.clic ? "success" : "neutral",
                  haceCuanto: haceCuanto(p.ultima_senal_at, ahora),
                  campana: p.campana,
                  ultimoToque:
                    p.ultimo_resultado && esResultado(p.ultimo_resultado) && p.ultimo_toque_at
                      ? `${ETIQUETA_RESULTADO[p.ultimo_resultado]} el ${fechaCorta.format(new Date(p.ultimo_toque_at))}${p.toques > 1 ? ` (${p.toques} intentos)` : ""}`
                      : null,
                  respondio: p.respondio,
                  canal,
                  enlace,
                  etiqueta: celular ? "WhatsApp" : p.telefono ? `Llamar ${p.telefono}` : "Escribir correo",
                  telefono: Boolean(p.telefono),
                  abiertos: correos.filter((c) => c.abierto_at).length,
                  correos: correos.map((c) => ({
                    asunto: asuntoLegible(c.asunto),
                    enviado: c.enviado_at ? fechaHora.format(new Date(c.enviado_at)) : null,
                    abierto: c.abierto_at ? fechaHora.format(new Date(c.abierto_at)) : null,
                    clic: c.clic,
                  })),
                  noContactar: p.no_contactar,
                };
              })}
            />
          )}
        </SectionCard>
      ) : (
        <SectionCard title="Contactados en los últimos 7 días" description="Lo tuyo de las últimas 24 horas se puede deshacer, salvo lo que ya pasó a Negocios." icon={History} tone="teal">
          {toques.length === 0 ? (
            <EmptyState icon={History} title="Todavía no contactas a nadie" description="Cada WhatsApp, llamada o resultado que anotes en Por contactar aparece acá." />
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
