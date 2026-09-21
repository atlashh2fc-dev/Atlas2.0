import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { Megaphone } from "lucide-react";

import { cancelarCampana, crearCampana, lanzarCampana } from "@/app/actions/campanas-clinica";
import { CreatePanel } from "@/components/create-panel";
import { Badge, EmptyState, Field, Input, PageHeader, SectionCard, Select, SubmitButton } from "@/components/ui";
import { ETIQUETA_CANAL, ETIQUETA_ESTADO_CAMPANA, SEGMENTOS } from "@/lib/campanas-clinica";
import { ZONA_CLINICA, fechaEnChile } from "@/lib/citas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Campañas de la clínica.
 *
 * Un segmento de la propia clínica, un mensaje y una fecha. Al lanzarse deja
 * un mensaje por destinatario en la misma cola que los recordatorios, y el
 * resultado se lee de ahí: cuántos salieron, cuántos llegaron, cuántos
 * respondieron y cuántos agendaron después.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cuando = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA_CLINICA, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type Campana = { id: string; nombre: string; segmento: string; parametros: Record<string, unknown>; canal: string; asunto: string | null; texto: string; programada_para: string | null; estado: string; destinatarios: number; lanzada_at: string | null; created_at: string };
type Resultado = { origen_ref: string | null; cuenta_id: string | null; estado: string; canal: string };

export default async function CampanasClinicaPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  const esVet = edicion === "vet";
  const { c } = await searchParams;
  const seleccionada = c && UUID.test(c) ? c : null;
  const segmentos = SEGMENTOS.filter((segmento) => esVet || !segmento.soloVet);

  const supabase = await createClient();
  const [{ data: campanasData, error }, { data: resultadosData }] = await Promise.all([
    supabase.from("campanas_de_clinica").select("id, nombre, segmento, parametros, canal, asunto, texto, programada_para, estado, destinatarios, lanzada_at, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("mensajes_salientes").select("origen_ref, cuenta_id, estado, canal").eq("regla", "campana").limit(5000),
  ]);
  const campanas = (campanasData ?? []) as Campana[];
  const resultados = (resultadosData ?? []) as Resultado[];

  const actual = campanas.find((campana) => campana.id === seleccionada) ?? null;
  let vistaPrevia: { total: number; conCelular: number; conCorreo: number } | null = null;
  let agendaron = 0;
  if (actual) {
    const { data: destinatarios } = await supabase.rpc("destinatarios_de_segmento", { p_segmento: actual.segmento, p_parametros: actual.parametros });
    const lista = (destinatarios ?? []) as { cuenta_id: string; telefono: string | null; email: string | null }[];
    vistaPrevia = { total: lista.length, conCelular: lista.filter((fila) => fila.telefono).length, conCorreo: lista.filter((fila) => fila.email).length };
    if (actual.lanzada_at) {
      const cuentas = [...new Set(resultados.filter((fila) => fila.origen_ref === actual.id).map((fila) => fila.cuenta_id).filter(Boolean))] as string[];
      if (cuentas.length) {
        const { count } = await supabase.from("citas").select("id", { count: "exact", head: true }).in("cuenta_id", cuentas.slice(0, 500)).gte("created_at", actual.lanzada_at);
        agendaron = count ?? 0;
      }
    }
  }

  const resumen = (id: string) => {
    const propios = resultados.filter((fila) => fila.origen_ref === id);
    const cuenta = (...estados: string[]) => propios.filter((fila) => estados.includes(fila.estado)).length;
    return { total: propios.length, entregados: cuenta("entregado", "leido", "respondido"), respondidos: cuenta("respondido"), fallidos: cuenta("fallido"), pendientes: cuenta("programado", "enviando") };
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campañas"
        description={`Segmentos de ${empresa ?? "la clínica"}, un mensaje y una fecha. Salen por la misma cola que los recordatorios; los resultados se leen de ahí.`}
        actions={
          <CreatePanel label="Nueva campaña" title="Nueva campaña" description="Elige a quién, escribe el mensaje y decide cuándo. Antes de lanzar vas a ver cuántas fichas entran." action={crearCampana} submitLabel="Guardar borrador" successLabel="Campaña guardada">
            <Field label="Nombre">
              <Input name="nombre" required placeholder={esVet ? "Vacunas de primavera" : "Control semestral"} data-autofocus />
            </Field>
            <Field label="Segmento">
              <Select name="segmento" required defaultValue={segmentos[0]?.id}>
                {segmentos.map((segmento) => (
                  <option key={segmento.id} value={segmento.id}>
                    {segmento.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Parámetro del segmento (días, meses o especie, según el segmento)">
              <Input name="parametro" placeholder="30 · 6 · Perro" />
            </Field>
            <Field label="Canal">
              <Select name="canal" defaultValue="auto">
                {Object.entries(ETIQUETA_CANAL).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Asunto (solo correo)">
              <Input name="asunto" placeholder="Nos vemos en el control" />
            </Field>
            <Field label="Mensaje">
              <textarea
                name="texto"
                required
                rows={5}
                maxLength={2000}
                placeholder={"Hola {{nombre}}, en {{clinica}} tenemos horas para el control de {{mascota}} esta semana. ¿Agendamos?"}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">Puedes usar {"{{nombre}}"}, {"{{mascota}}"} y {"{{clinica}}"}.</p>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Fecha (vacío = al lanzar)">
                <Input type="date" name="fecha" min={fechaEnChile(new Date())} />
              </Field>
              <Field label="Hora">
                <Input type="time" name="hora" defaultValue="10:00" />
              </Field>
            </div>
          </CreatePanel>
        }
      />

      {error && <p className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">No se pudieron leer las campañas. Vuelve a cargar para reintentar.</p>}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <SectionCard title={`Campañas · ${campanas.length}`} description="Las más recientes primero.">
          {campanas.length === 0 ? (
            <EmptyState title="Todavía no hay campañas" description='Crea la primera con "Nueva campaña".' />
          ) : (
            <ul className="divide-y divide-border">
              {campanas.map((campana) => {
                const etiqueta = ETIQUETA_ESTADO_CAMPANA[campana.estado] ?? ETIQUETA_ESTADO_CAMPANA.borrador;
                const r = resumen(campana.id);
                return (
                  <li key={campana.id}>
                    <Link href={`/dashboard/campanas-clinica?c=${campana.id}`} className={`block px-4 py-3 transition-colors hover:bg-surface-muted/60 ${actual?.id === campana.id ? "bg-primary/5" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{campana.nombre}</span>
                        <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {segmentos.find((segmento) => segmento.id === campana.segmento)?.label ?? campana.segmento}
                        {campana.lanzada_at ? ` · ${r.total} enviados · ${r.respondidos} respondieron` : campana.programada_para ? ` · sale ${cuando.format(new Date(campana.programada_para))}` : ""}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {actual ? (
          <SectionCard title={actual.nombre} description={`${segmentos.find((segmento) => segmento.id === actual.segmento)?.label ?? actual.segmento} · ${ETIQUETA_CANAL[actual.canal] ?? actual.canal}${actual.programada_para ? ` · programada para ${cuando.format(new Date(actual.programada_para))}` : ""}`}>
            <div className="space-y-4 px-4 py-4">
              {vistaPrevia && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: actual.lanzada_at ? "Enviados" : "Entran en el segmento", valor: actual.lanzada_at ? resumen(actual.id).total : vistaPrevia.total, detalle: actual.lanzada_at ? `${resumen(actual.id).pendientes} pendientes · ${resumen(actual.id).fallidos} fallidos` : `${vistaPrevia.conCelular} con celular · ${vistaPrevia.conCorreo} con correo` },
                    { label: "Respondieron", valor: resumen(actual.id).respondidos, detalle: `${resumen(actual.id).entregados} entregados` },
                    { label: "Agendaron después", valor: agendaron, detalle: "Citas creadas tras el envío" },
                  ].map((metrica) => (
                    <div key={metrica.label} className="rounded-xl border border-border bg-surface px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">{metrica.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{metrica.valor}</p>
                      <p className="text-xs text-muted-foreground">{metrica.detalle}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-border bg-surface-muted/40 px-4 py-3 text-sm">
                {actual.asunto && actual.canal !== "whatsapp" && <p className="mb-1 font-medium text-foreground">{actual.asunto}</p>}
                <p className="whitespace-pre-wrap text-foreground">{actual.texto}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(actual.estado === "borrador" || actual.estado === "programada") && !actual.lanzada_at && (
                  <form action={lanzarCampana}>
                    <input type="hidden" name="campana_id" value={actual.id} />
                    <SubmitButton pendingLabel="Lanzando…">
                      <Megaphone size={16} aria-hidden="true" /> {actual.programada_para && new Date(actual.programada_para) > new Date() ? "Programar envío" : "Lanzar ahora"}
                    </SubmitButton>
                  </form>
                )}
                {(actual.estado === "borrador" || actual.estado === "programada") && (
                  <form action={cancelarCampana}>
                    <input type="hidden" name="campana_id" value={actual.id} />
                    <SubmitButton variant="ghost" pendingLabel="…">Cancelar</SubmitButton>
                  </form>
                )}
                {actual.lanzada_at && (
                  <Link href="/dashboard/recordatorios" className="self-center text-sm text-primary hover:underline">
                    Ver los mensajes en Recordatorios
                  </Link>
                )}
              </div>
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Elige una campaña" description="A la izquierda están las campañas. Al crear una, verás cuántas fichas entran antes de lanzarla.">
            <EmptyState title="Nada seleccionado" description="Toca una campaña para ver a quién llega y cómo le fue." />
          </SectionCard>
        )}
      </div>
    </div>
  );
}
