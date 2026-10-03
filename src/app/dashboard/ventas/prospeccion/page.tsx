import Link from "next/link";
import { connection } from "next/server";
import { Briefcase, CheckCheck, ChevronRight, Flame, History, Inbox, Undo2 } from "lucide-react";

import { deshacerToque } from "@/app/actions/prospeccion";
import { BandejaProspeccion, type FilaProspecto } from "@/components/bandeja-prospeccion";
import { RespuestasDelAgente, type BorradorAgente, type ConfigAgente } from "@/components/respuestas-del-agente";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { masReciente, recortar, tiempoRelativo, type Canal, type UltimaLinea } from "@/components/pipeline-kit";
import { Avatar, Badge, Callout, EmptyState, NavTabs, PageHeader, SegmentTabs, SubmitButton, buttonClasses, type BadgeTone, type SegmentTab } from "@/components/ui";
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
import { cn } from "@/lib/utils";
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

/** El color del resultado solo cuando dice algo: interesado avanza, un número malo es un problema. */
const TONO_RESULTADO: Record<string, BadgeTone> = {
  interesado: "success",
  numero_malo: "danger",
  whatsapp: "info",
  llamada: "info",
  correo: "info",
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

const RUTA = "/dashboard/ventas/prospeccion";

/** «1 hizo clic», «6 volvieron a abrir»: la cifra con su verbo en número. */
function cuantos(n: number, singular: string, plural: string) {
  return `${n.toLocaleString("es-CL")} ${n === 1 ? singular : plural}`;
}

/**
 * Los filtros rápidos de la lista, debajo de las pestañas. Cada indicador de
 * arriba abre uno de estos: la cifra y la lista que la compone son lo mismo.
 */
function FiltrosRapidos({ filtros, activo }: { filtros: { id: string; label: string; href: string; count: number }[]; activo: string }) {
  return (
    <nav aria-label="Filtrar la lista" className="flex flex-wrap items-center gap-1">
      {filtros.map((filtro) => {
        const esActivo = filtro.id === activo;
        return (
          <Link
            key={filtro.id}
            href={filtro.href}
            aria-current={esActivo ? "true" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              esActivo ? "bg-foreground/[0.07] text-foreground" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            )}
          >
            {filtro.label}
            <span className="tabular-nums opacity-70">{filtro.count.toLocaleString("es-CL")}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default async function ProspeccionPage({ searchParams }: { searchParams: Promise<{ vista?: string; filtro?: string }> }) {
  await connection();
  const profile = await requireProfile(["admin", "supervisor"]);
  const { empresa: empresaPropia } = await contextoDeMiEmpresa();
  const { vista = "cola", filtro } = await searchParams;
  const ahora = new Date();
  const inicioHoy = instanteEnChile(fechaEnChile(ahora), "00:00");
  const haceSieteDias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

  const supabase = await createClient();
  const [
    { data: colaData, error },
    { data: toquesData },
    { data: configAgente },
    { data: borradoresData },
    { data: porWhatsappData },
    { data: ultimosWhatsappData },
    { data: enviadosPorIaData },
    { data: correosRecibidosData },
  ] = await Promise.all([
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
      .select("id, para_email, asunto, cuerpo, intencion, razonamiento, escalar, created_at, opportunity_id, lead_id")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: false })
      .limit(50),
    // Quién contestó por WhatsApp: ese ya está conversando en el teléfono.
    supabase
      .from("prospeccion_whatsapp")
      .select("lead_id")
      .eq("direction", "inbound")
      .gte("occurred_at", new Date(ahora.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1000),
    // La última línea de cada tarjeta: lo último que se dijo por WhatsApp (en
    // cualquier sentido), lo que la IA contestó por correo y lo que el
    // prospecto escribió de vuelta. En lote y con tope, nunca uno por uno.
    supabase.from("prospeccion_whatsapp").select("lead_id, direction, texto, occurred_at").order("occurred_at", { ascending: false }).limit(1000),
    supabase.from("sales_agent_drafts").select("lead_id, cuerpo, decidido_at").eq("estado", "enviado").not("lead_id", "is", null).order("decidido_at", { ascending: false }).limit(300),
    supabase.from("inbound_emails").select("lead_id, subject, preview, received_at").not("lead_id", "is", null).order("received_at", { ascending: false }).limit(300),
  ]);
  if (error) console.error("[prospeccion] bandeja:", error.message);
  const respondieronPorWhatsapp = new Set((porWhatsappData ?? []).map((fila) => fila.lead_id as string));

  // Lo último que se dijo con cada prospecto, por fuente; gana la más reciente.
  const primeraPorLead = <T,>(filas: T[] | null, lead: (fila: T) => string, linea: (fila: T) => UltimaLinea | null) => {
    const mapa = new Map<string, UltimaLinea>();
    for (const fila of filas ?? []) {
      const id = lead(fila);
      if (mapa.has(id)) continue;
      const valor = linea(fila);
      if (valor?.texto) mapa.set(id, valor);
    }
    return mapa;
  };
  const ultimoWhatsapp = primeraPorLead(ultimosWhatsappData, (f) => f.lead_id as string, (f) =>
    f.texto ? { texto: recortar(f.texto as string), canal: "whatsapp", at: f.occurred_at as string, prefijo: f.direction === "inbound" ? null : "Tú" } : null,
  );
  const porIa = primeraPorLead(enviadosPorIaData, (f) => f.lead_id as string, (f) =>
    f.decidido_at ? { texto: recortar(f.cuerpo as string), canal: "correo", at: f.decidido_at as string, prefijo: "IA", ia: true } : null,
  );
  const porCorreoRecibido = primeraPorLead(correosRecibidosData, (f) => f.lead_id as string, (f) => ({
    texto: recortar(f.preview as string | null) || recortar(f.subject as string | null),
    canal: "correo",
    at: f.received_at as string,
  }));

  // Los marcados "no contactar" se ven en la lista (al final), pero no son trabajo pendiente.
  const todos = (colaData ?? []) as Prospecto[];
  const cola = todos.filter((p) => !p.no_contactar);
  const toques = (toquesData ?? []) as unknown as Toque[];
  const CANAL_DEL_TOQUE: Record<string, Canal> = { whatsapp: "whatsapp", llamada: "llamada", correo: "correo" };
  const porNota = primeraPorLead(toques, (t) => t.lead_id, (t) =>
    t.nota ? { texto: recortar(t.nota), canal: CANAL_DEL_TOQUE[t.resultado] ?? "nota", at: t.created_at, prefijo: "Nota" } : null,
  );
  /** Sin conversación, la línea es el último correo de la campaña: de qué se le habló. */
  const lineaDeCampana = (p: Prospecto): UltimaLinea | null => {
    const correos = p.correos ?? [];
    const leido = [...correos].reverse().find((c) => c.abierto_at);
    if (leido?.abierto_at) return { texto: asuntoLegible(leido.asunto), canal: "correo", at: leido.abierto_at, prefijo: "Leyó" };
    const ultimo = correos[correos.length - 1];
    if (ultimo?.enviado_at) return { texto: asuntoLegible(ultimo.asunto), canal: "correo", at: ultimo.enviado_at, prefijo: "Le enviamos" };
    return null;
  };
  const calientes = cola.filter((p) => p.respondio || p.clic || p.estado === "volvio");
  // El desglose sin repetir a nadie, en el orden de la bandeja: quien respondió
  // y además hizo clic cuenta como respuesta. Suma exactamente «Muy interesados».
  const respondieron = calientes.filter((p) => p.respondio).length;
  const hicieronClic = calientes.filter((p) => !p.respondio && p.clic).length;
  const volvieron = calientes.length - respondieron - hicieronClic;
  const desgloseCalientes =
    [
      respondieron > 0 ? cuantos(respondieron, "respondió", "respondieron") : null,
      hicieronClic > 0 ? cuantos(hicieronClic, "hizo clic", "hicieron clic") : null,
      volvieron > 0 ? cuantos(volvieron, "volvió a abrir", "volvieron a abrir") : null,
    ]
      .filter(Boolean)
      .join(" · ") || "Nadie respondió, hizo clic ni volvió a abrir";
  const sinGestionUnDia = cola.filter((p) => p.estado === "nuevo" && p.primera_senal_at && ahora.getTime() - new Date(p.primera_senal_at).getTime() > 24 * 60 * 60 * 1000);
  const hechosHoy = toques.filter((t) => new Date(t.created_at) >= inicioHoy);
  const remitente = (profile.full_name ?? "").split(" ")[0] || "el equipo";
  const borradores = (borradoresData ?? []) as BorradorAgente[];
  const config = (configAgente ?? null) as ConfigAgente;
  // Sin agente y sin nada pendiente, la vista de respuestas sería una puerta a un cuarto vacío.
  const conAgente = Boolean(config?.enabled) || borradores.length > 0;
  const vistaActiva = vista === "historial" ? "historial" : vista === "respuestas" && conAgente ? "respuestas" : "cola";
  // Un filtro que no es de esta vista se ignora: la lista nunca queda vacía por un enlace viejo.
  const filtroCola = vistaActiva === "cola" && (filtro === "interesados" || filtro === "esperando") ? filtro : "todos";
  const filtroHistorial = vistaActiva === "historial" && filtro === "hoy" ? "hoy" : "semana";
  const sinGestionIds = new Set(sinGestionUnDia.map((p) => p.lead_id));
  const visibles =
    filtroCola === "interesados"
      ? todos.filter((p) => !p.no_contactar && (p.respondio || p.clic || p.estado === "volvio"))
      : filtroCola === "esperando"
        ? todos.filter((p) => sinGestionIds.has(p.lead_id))
        : todos;
  const toquesVisibles = filtroHistorial === "hoy" ? hechosHoy : toques;

  // «Te respondieron» contaba borradores del asistente, no personas: con 7 muy
  // interesados marcaba 0 y parecía que se perdían respuestas. Se llama por lo que es.
  const pestanas: SegmentTab[] = [
    { id: "cola", label: "Por contactar", href: RUTA, count: cola.length },
    ...(conAgente ? [{ id: "respuestas", label: "Respuestas por aprobar", href: `${RUTA}?vista=respuestas`, count: borradores.length }] : []),
    { id: "historial", label: "Ya contactados", href: `${RUTA}?vista=historial`, count: toques.length },
  ];
  const ayuda =
    vistaActiva === "cola"
      ? "Una tarjeta por persona, con lo último que se habló. Primero los más interesados: escríbele y después anota cómo te fue; nadie sale de esta lista hasta que lo anotes."
      : vistaActiva === "respuestas"
        ? "Lo que el asistente propone contestar a quien respondió tu campaña. Nada sale hasta que lo apruebes."
        : "Contactados en los últimos 7 días. Lo tuyo de las últimas 24 horas se puede deshacer, salvo lo que ya pasó a Negocios.";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ventas"
        icon={Briefcase}
        description={`${empresaPropia ?? "Tu empresa"} · a quién escribirle hoy: personas que abrieron, hicieron clic o respondieron tu campaña de correo.`}
      />
      <NavTabs tabs={PESTANAS_VENTAS} />

      <KpiStrip columns={3}>
        <KpiStripItem
          label="Esperan que les escribas"
          value={cola.length.toLocaleString("es-CL")}
          icon={Inbox}
          tone={sinGestionUnDia.length > 0 ? "warn" : "default"}
          detail={sinGestionUnDia.length > 0 ? `${sinGestionUnDia.length} llevan más de un día: el interés se enfría` : "Nadie lleva más de un día esperando"}
          href={RUTA}
          active={vistaActiva === "cola" && filtroCola === "todos"}
        />
        <KpiStripItem
          label="Muy interesados"
          value={calientes.length.toLocaleString("es-CL")}
          icon={Flame}
          detail={desgloseCalientes}
          progress={cola.length > 0 ? (calientes.length / cola.length) * 100 : undefined}
          href={`${RUTA}?filtro=interesados`}
          active={vistaActiva === "cola" && filtroCola === "interesados"}
        />
        <KpiStripItem
          label="Contactados hoy"
          value={hechosHoy.length.toLocaleString("es-CL")}
          icon={CheckCheck}
          tone={hechosHoy.length > 0 ? "good" : "default"}
          detail={`${toques.length} en los últimos 7 días`}
          href={`${RUTA}?vista=historial&filtro=hoy`}
          active={vistaActiva === "historial" && filtroHistorial === "hoy"}
        />
      </KpiStrip>

      {error && <Callout tone="danger">No se pudo leer la bandeja de prospección. Vuelve a cargar la página; si sigue igual, avisa a soporte.</Callout>}

      {/* Las tres vistas son pestañas pegadas a la lista que filtran, como en HubSpot. */}
      <section className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="border-b border-border px-3">
          <SegmentTabs tabs={pestanas} activeId={vistaActiva} label="Qué ver" />
        </div>
        <div className="space-y-2 border-b border-border/70 bg-surface-raised px-5 py-2.5">
          <p className="text-xs text-muted-foreground">{ayuda}</p>
          {vistaActiva === "cola" && todos.length > 0 && (
            <FiltrosRapidos
              activo={filtroCola}
              filtros={[
                { id: "todos", label: "Todos", href: RUTA, count: cola.length },
                { id: "interesados", label: "Muy interesados", href: `${RUTA}?filtro=interesados`, count: calientes.length },
                { id: "esperando", label: "Más de un día esperando", href: `${RUTA}?filtro=esperando`, count: sinGestionUnDia.length },
              ]}
            />
          )}
          {vistaActiva === "historial" && toques.length > 0 && (
            <FiltrosRapidos
              activo={filtroHistorial}
              filtros={[
                { id: "semana", label: "Últimos 7 días", href: `${RUTA}?vista=historial`, count: toques.length },
                { id: "hoy", label: "Hoy", href: `${RUTA}?vista=historial&filtro=hoy`, count: hechosHoy.length },
              ]}
            />
          )}
        </div>

        {vistaActiva === "respuestas" ? (
          <RespuestasDelAgente config={config} borradores={borradores} />
        ) : vistaActiva === "cola" ? (
          todos.length === 0 ? (
            <EmptyState icon={Inbox} title="Estás al día" description="Nadie espera que le escribas. Cuando alguien abra o haga clic en tu campaña de correo, aparece acá." />
          ) : visibles.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={filtroCola === "interesados" ? "Nadie muy interesado por ahora" : "Nadie lleva más de un día esperando"}
              description="El resto de la lista sigue esperando que le escribas."
              action={<Link href={RUTA} className={buttonClasses({ variant: "secondary", size: "sm" })}>Ver a todos</Link>}
            />
          ) : (
            <div className="p-3">
              {/* Con otro filtro es otra lista: se monta de nuevo para no arrastrar tarjetas de la anterior como «Gestionado». */}
              <BandejaProspeccion
                key={filtroCola}
                filas={visibles.map((p): FilaProspecto => {
                  const celular = celularChileno(p.telefono);
                  const porWhatsapp = respondieronPorWhatsapp.has(p.lead_id);
                  const correos = p.correos ?? [];
                  const canal = celular ? "whatsapp" : p.telefono ? "llamada" : "correo";
                  const enlace = celular
                    ? enlaceWhatsapp(celular, porWhatsapp ? "" : mensajeDeWhatsapp({ remitente, empresaPropia: empresaPropia ?? "nuestro equipo", empresa: p.empresa, respondio: p.respondio, toques: p.toques, tema: temaDeLosCorreos(correos) }))
                    : p.telefono
                      ? `tel:${p.telefono.replace(/[^\d+]/g, "")}`
                      : p.email
                        ? `mailto:${p.email}`
                        : null;
                  const conversacion = masReciente(ultimoWhatsapp.get(p.lead_id), porIa.get(p.lead_id), porCorreoRecibido.get(p.lead_id), porNota.get(p.lead_id));
                  const linea = conversacion ?? lineaDeCampana(p);
                  // La hora de la tarjeta es la de lo último que pasó: un mensaje o la señal.
                  const ultimo = [linea?.at, p.ultima_senal_at].filter((valor): valor is string => Boolean(valor)).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()).pop() ?? null;
                  return {
                    leadId: p.lead_id,
                    nombre: p.empresa ?? p.contacto ?? p.email ?? "Sin nombre",
                    columna: p.estado,
                    estado: ESTADO[p.estado],
                    caliente: p.respondio || p.clic || p.estado === "volvio",
                    hace: tiempoRelativo(ultimo, ahora),
                    linea,
                    datos: [p.contacto && p.contacto !== p.empresa ? p.contacto : null, p.telefono, p.email].filter(Boolean).join(" · ") || "Sin datos de contacto",
                    senal: senalDe(p, porWhatsapp),
                    tonoSenal: p.respondio || p.clic ? "success" : "neutral",
                    haceCuanto: haceCuanto(p.ultima_senal_at, ahora),
                    campana: p.campana,
                    ultimoToque:
                      p.ultimo_resultado && esResultado(p.ultimo_resultado) && p.ultimo_toque_at
                        ? `${ETIQUETA_RESULTADO[p.ultimo_resultado]} el ${fechaCorta.format(new Date(p.ultimo_toque_at))}${p.toques > 1 ? ` (${p.toques} intentos)` : ""}`
                        : null,
                    // «Ver su respuesta» abre la del agente de correo; la de WhatsApp está en el teléfono.
                    respondio: p.respondio && !porWhatsapp,
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
            </div>
          )
        ) : toques.length === 0 || toquesVisibles.length === 0 ? (
          <EmptyState
            icon={History}
            title={toques.length === 0 ? "Todavía no contactas a nadie" : "Hoy todavía no contactas a nadie"}
            description="Cada WhatsApp, llamada o resultado que anotes en Por contactar aparece acá."
            action={<Link href={RUTA} className={buttonClasses({ variant: "secondary", size: "sm" })}>Ir a Por contactar</Link>}
          />
        ) : (
          <ul className="divide-y divide-border/70">
            {toquesVisibles.map((t) => {
              const lead = primero(t.leads);
              const nombre = String(lead?.extra?.company_name ?? lead?.full_name ?? "Prospecto");
              // Sin autor: lo anotó el eco de un mensaje enviado desde la app del teléfono.
              const quien = primero(t.profiles)?.full_name ?? (t.hecho_por ? "—" : "Desde tu WhatsApp");
              const deshacible = t.hecho_por === profile.id && t.resultado !== "interesado" && ahora.getTime() - new Date(t.created_at).getTime() < 24 * 60 * 60 * 1000;
              return (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-muted/55">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={nombre} shape="square" size="md" />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span className="truncate text-[13px] font-medium text-foreground">{nombre}</span>
                        <Badge tone={TONO_RESULTADO[t.resultado] ?? "neutral"}>{esResultado(t.resultado) ? ETIQUETA_RESULTADO[t.resultado] : t.resultado}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {quien} · {fechaHora.format(new Date(t.created_at))}
                        {t.seguir_at ? ` · vuelve el ${fechaCorta.format(new Date(t.seguir_at))}` : ""}
                        {t.nota ? ` · ${t.nota}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.opportunity_id && (
                      <Link href={`/dashboard/ventas/${t.opportunity_id}`} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                        Ver negocio <ChevronRight size={13} aria-hidden="true" />
                      </Link>
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
      </section>
    </div>
  );
}
