import Link from "next/link";
import { connection } from "next/server";
import { ChevronRight, Inbox, MailPlus, Plug, Send } from "lucide-react";

import { BotonDeAccion } from "@/components/campanas-correo/boton-de-accion";
import { Badge, Callout, EmptyState, PageHeader, SectionCard, SegmentTabs, buttonClasses } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { ESTADO_CAMPANA, formatearNumero, porcentaje, type CampanaResumen } from "@/lib/campanas-correo";
import { campanasDeCorreo, capacidadesDeCorreo, correosSinAsociar, empresaActual } from "@/lib/campanas-correo.server";

/**
 * Campañas de correo de la empresa.
 *
 * Se arman y se miden acá; las envía Atlas Lead, que sigue funcionando solo.
 * La audiencia sale de Bigdata. Una persona y el agente de Órbita usan las
 * mismas puertas, y cada acción queda en el registro de la campaña.
 */

const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type Vista = "en_curso" | "borradores" | "todas";
const EN_CURSO = new Set(["enviando", "en_espera", "programada", "pausada"]);

function Cifra({ label, valor, detalle }: { label: string; valor: string; detalle: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{valor}</dd>
      <p className="mt-2 text-xs text-muted-foreground">{detalle}</p>
    </div>
  );
}

function Avance({ campana }: { campana: CampanaResumen }) {
  const base = campana.metricas?.base ?? 0;
  const contactados = campana.metricas?.contactados ?? 0;
  if (!base) return <span className="text-xs text-muted-foreground">Sin audiencia</span>;
  const pct = Math.min(100, Math.round((contactados / base) * 100));
  return (
    <div className="min-w-[120px]">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la campaña">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {formatearNumero(contactados)} de {formatearNumero(base)}
      </p>
    </div>
  );
}

export default async function CampanasCorreoPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await connection();
  const perfil = await requireProfile(["admin", "supervisor"]);
  const { ver } = await searchParams;
  const vista: Vista = ver === "borradores" || ver === "todas" ? ver : "en_curso";
  const empresa = await empresaActual();

  if (!empresa) {
    return <Callout tone="danger">No se pudo identificar la empresa que estás mirando. Vuelve a entrar e inténtalo otra vez.</Callout>;
  }

  const capacidades = await capacidadesDeCorreo(empresa.slug);
  if (!capacidades.ok) {
    // Solo es "sin conectar" si Atlas Lead lo dice; un 404 de otra cosa es una falla.
    const sinConectar = capacidades.status === 404 && /no está conectada/i.test(capacidades.error);
    return (
      <div className="space-y-5">
        <PageHeader title="Campañas de correo" icon={Send} description="Arma, programa y mide los correos de la empresa. Los envía Atlas Lead." />
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          {sinConectar ? (
            <EmptyState
              icon={Plug}
              title={`${empresa.nombre} todavía no está conectada a Atlas Lead`}
              description={
                perfil.role === "admin"
                  ? "Al conectarla, las campañas que la empresa ya tiene en Atlas Lead aparecen acá y puedes crear nuevas desde sus remitentes."
                  : "Pídele a administración que conecte la empresa a Atlas Lead desde esta misma pantalla."
              }
              action={
                perfil.role === "admin" ? (
                  <BotonDeAccion accion={{ tipo: "conectar" }} exito="Empresa conectada a Atlas Lead" pendiente="Conectando…">
                    <Plug size={16} aria-hidden="true" /> Conectar Atlas Lead
                  </BotonDeAccion>
                ) : undefined
              }
            />
          ) : (
            <EmptyState icon={Plug} title="No pudimos hablar con Atlas Lead" description={`${capacidades.error}. Las campañas siguen enviando según su horario; vuelve a cargar en un rato.`} />
          )}
        </div>
      </div>
    );
  }

  const lista = await campanasDeCorreo(empresa.slug);
  const sinAsociar = lista.ok && (lista.datos.correos_sin_asociar ?? 0) > 0 ? await correosSinAsociar(empresa.slug) : null;
  const campanas = lista.ok ? lista.datos.campanas : [];
  const ultimos30 = lista.ok ? lista.datos.por_dia : [];
  const suma = (campo: "enviados" | "abrieron" | "respuestas") => ultimos30.reduce((total, dia) => total + (Number(dia[campo]) || 0), 0);
  const enviados30 = suma("enviados");

  const conteo = {
    en_curso: campanas.filter((campana) => EN_CURSO.has(campana.estado)).length,
    borradores: campanas.filter((campana) => campana.estado === "borrador").length,
    todas: campanas.length,
  };
  const visibles = campanas.filter((campana) =>
    vista === "todas" ? true : vista === "borradores" ? campana.estado === "borrador" : EN_CURSO.has(campana.estado),
  );
  const sinRemitentes = capacidades.datos.remitentes.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campañas de correo"
        icon={Send}
        description={`Arma, programa y mide los correos de ${empresa.nombre}. Los envía Atlas Lead en hora de Chile; la audiencia sale de Bigdata.`}
        actions={
          sinRemitentes ? undefined : (
            <Link href="/dashboard/campanas-correo/nueva" className={buttonClasses({ variant: "primary" })}>
              <MailPlus size={16} aria-hidden="true" /> Nueva campaña
            </Link>
          )
        }
      />

      {!lista.ok && <Callout tone="danger">No se pudieron leer las campañas: {lista.error}. Vuelve a cargar para reintentar.</Callout>}
      {sinRemitentes && (
        <Callout tone="warning">
          La empresa no tiene todavía un remitente verificado en Atlas Lead, y una campaña nueva necesita salir desde uno. Pide al equipo de Atlas Lead que
          habilite el dominio de la empresa; apenas exista, vas a poder crear campañas acá.
        </Callout>
      )}

      <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Cifra label="Enviados hoy" valor={formatearNumero(lista.ok ? lista.datos.enviados_hoy : 0)} detalle={capacidades.datos.empresa.cupo_diario ? `Cupo de la empresa: ${formatearNumero(capacidades.datos.empresa.cupo_diario)} por día` : "Día de Chile"} />
        <Cifra label="Enviados en 30 días" valor={formatearNumero(enviados30)} detalle={`${conteo.en_curso} ${conteo.en_curso === 1 ? "campaña en curso" : "campañas en curso"}`} />
        <Cifra label="Abrieron" valor={porcentaje(suma("abrieron"), enviados30)} detalle={`${formatearNumero(suma("abrieron"))} aperturas en 30 días`} />
        <Cifra label="Respondieron" valor={formatearNumero(suma("respuestas"))} detalle="Respuestas en 30 días; llegan a la bandeja de Correo" />
      </dl>

      <SectionCard className="pt-0">
        <div className="border-b border-border px-3">
          <SegmentTabs
            label="Vistas de campañas"
            activeId={vista}
            tabs={[
              { id: "en_curso", label: "En curso", href: "/dashboard/campanas-correo", count: conteo.en_curso },
              { id: "borradores", label: "Borradores", href: "/dashboard/campanas-correo?ver=borradores", count: conteo.borradores },
              { id: "todas", label: "Todas", href: "/dashboard/campanas-correo?ver=todas", count: conteo.todas },
            ]}
          />
        </div>
        {visibles.length === 0 ? (
          <EmptyState
            icon={Send}
            title={vista === "borradores" ? "No hay borradores" : vista === "en_curso" ? "No hay campañas en curso" : "Todavía no hay campañas"}
            description={sinRemitentes ? "Cuando la empresa tenga un remitente verificado, podrás crear la primera." : 'Crea una con "Nueva campaña": escribes los correos, eliges la audiencia en Bigdata y decides cuándo sale.'}
            action={
              sinRemitentes ? undefined : (
                <Link href="/dashboard/campanas-correo/nueva" className={buttonClasses({ variant: "secondary" })}>
                  <MailPlus size={16} aria-hidden="true" /> Nueva campaña
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Campaña</th>
                  <th className="px-3 py-2.5 font-medium">Estado</th>
                  <th className="px-3 py-2.5 font-medium">Avance</th>
                  <th className="px-3 py-2.5 text-right font-medium">Enviados</th>
                  <th className="px-3 py-2.5 text-right font-medium">Abrieron</th>
                  <th className="px-3 py-2.5 text-right font-medium">Respuestas</th>
                  <th className="px-3 py-2.5 font-medium">Último envío</th>
                  <th className="w-8" aria-hidden="true" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {visibles.map((campana) => {
                  const estado = ESTADO_CAMPANA[campana.estado] ?? ESTADO_CAMPANA.borrador;
                  const m = campana.metricas;
                  return (
                    <tr key={campana.id} className="group relative transition-colors hover:bg-surface-muted/55">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/campanas-correo/${campana.id}`} className="font-medium text-foreground after:absolute after:inset-0 focus:outline-none focus-visible:underline">
                          {campana.nombre}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {campana.remitente.marca}
                          {campana.remitente.email ? ` · ${campana.remitente.email}` : ""}
                          {campana.origen === "consola" ? " · armada en Atlas Lead" : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={estado.tone}>{estado.label}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <Avance campana={campana} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatearNumero(m?.enviados)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{m ? porcentaje(m.abrieron, m.contactados) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatearNumero(m?.respuestas)}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{m?.ultimo_envio ? cuando.format(new Date(m.ultimo_envio)).replace(".", "") : "—"}</td>
                      <td className="pr-4">
                        <ChevronRight size={15} className="text-muted-foreground/50 group-hover:text-primary" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {sinAsociar?.ok && sinAsociar.datos.correos.length > 0 && (
        <SectionCard
          title={`${sinAsociar.datos.total} ${sinAsociar.datos.total === 1 ? "correo llegó" : "correos llegaron"} sin campaña`}
          description="Llegaron a la casilla de respuestas y no calzaron con ningún envío: puede ser un cliente que escribió desde otra dirección. Respóndelo desde tu correo y descártalo acá."
        >
          <ul className="divide-y divide-border/70 border-t border-border">
            {sinAsociar.datos.correos.map((correo) => (
              <li key={correo.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <Inbox size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {correo.nombre ? `${correo.nombre} · ` : ""}
                    <a href={`mailto:${correo.remitente}`} className="text-primary hover:underline">
                      {correo.remitente}
                    </a>
                  </p>
                  <p className="mt-0.5 text-sm text-foreground">{correo.asunto || "(sin asunto)"}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{correo.extracto}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <time className="text-xs tabular-nums text-muted-foreground" dateTime={correo.recibido_at}>
                    {cuando.format(new Date(correo.recibido_at)).replace(".", "")}
                  </time>
                  <BotonDeAccion variant="ghost" size="sm" accion={{ tipo: "descartar", correoId: correo.id }} exito="Correo descartado" pendiente="…">
                    Descartar
                  </BotonDeAccion>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
