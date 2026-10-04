import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Orbit, RefreshCw } from "lucide-react";

import { CifrasOrbita } from "@/components/orbita/cifras-orbita";
import { MonitorOrbita } from "@/components/orbita/monitor-orbita";
import { ObjetivosOrbita, ObjetivosOrbitaCargando } from "@/components/orbita/objetivos-orbita";
import { Callout, EmptyState, PageHeader, buttonClasses } from "@/components/ui";
import { getCurrentProfile } from "@/lib/auth";
import {
  CODIGO_CEO,
  CODIGO_GUARDIAN,
  COLUMNAS_AGENTE,
  COLUMNAS_EVENTO,
  ESTADOS_AGENTE,
  VENTANA_PULSOS_MS,
  conexionesValidas,
  enLista,
  resumenDeOrbita,
  type AgenteOrbita,
  type EventoOrbita,
} from "@/lib/orbita";
import { periodoValido } from "@/lib/orbita-objetivos";
import { createClient } from "@/lib/supabase/server";

/**
 * Órbita · el monitor de los agentes de marketing con IA.
 *
 * Quién está trabajando, quién falló, qué se están pasando y cuánto rinde la
 * red, y arriba de todo, si se cumplió lo pedido (objetivos por día, semana y
 * mes, con su evidencia). Los agentes se declaran y reportan solos por /api/orbita/eventos; acá
 * se mira. La parte de cliente se refresca con cada evento (Realtime) y cada
 * 15 s como respaldo.
 */

const HORA = 60 * 60 * 1000;

export default async function OrbitaPage({ searchParams }: { searchParams: Promise<{ periodo?: string }> }) {
  await connection();
  const periodo = periodoValido((await searchParams).periodo);
  const ahora = new Date();
  const hace24h = new Date(ahora.getTime() - 24 * HORA).toISOString();
  const hace7d = new Date(ahora.getTime() - 7 * 24 * HORA).toISOString();
  const haceUnRato = new Date(ahora.getTime() - VENTANA_PULSOS_MS).toISOString();

  const supabase = await createClient();
  // Conteos sin traer filas: el Guardián late cada hora y la semana pesa.
  const contar = () => supabase.from("orbita_eventos").select("id", { count: "exact", head: true });
  // Los turnos que cuentan son los de los agentes de marketing: los chequeos
  // del Guardián inflaban la cifra sin que nadie publicara ni enviara nada.
  const contarTurnos = () => contar().neq("agente_codigo", CODIGO_GUARDIAN);

  const [agentesR, actividadR, pulsosR, fin24, error24, fin7, finConError7, error7, recuperaciones7, decisionesCeo7, perfil] = await Promise.all([
    supabase.from("orbita_agentes").select(COLUMNAS_AGENTE).order("codigo").limit(200),
    supabase.from("orbita_eventos").select(COLUMNAS_EVENTO).neq("tipo", "pulso").order("ocurrido_at", { ascending: false }).limit(40),
    supabase
      .from("orbita_eventos")
      .select(COLUMNAS_EVENTO)
      .not("relacionado_con", "is", null)
      .gte("ocurrido_at", haceUnRato)
      .order("ocurrido_at", { ascending: false })
      .limit(60),
    contarTurnos().eq("tipo", "fin").gte("ocurrido_at", hace24h),
    contarTurnos().eq("tipo", "error").gte("ocurrido_at", hace24h),
    contarTurnos().eq("tipo", "fin").gte("ocurrido_at", hace7d),
    contarTurnos().eq("tipo", "fin").eq("estado", "error").gte("ocurrido_at", hace7d),
    contarTurnos().eq("tipo", "error").gte("ocurrido_at", hace7d),
    contar().eq("tipo", "recuperacion").gte("ocurrido_at", hace7d),
    contar().eq("tipo", "decision").eq("agente_codigo", CODIGO_CEO).gte("ocurrido_at", hace7d),
    getCurrentProfile(),
  ]);

  const error = agentesR.error ?? actividadR.error ?? pulsosR.error;
  if (error) console.error("[orbita] no se pudo leer la red", error.message);

  const agentes: AgenteOrbita[] = ((agentesR.data ?? []) as unknown as AgenteOrbita[]).map((agente) => ({
    ...agente,
    conexiones: conexionesValidas(agente.conexiones),
    ultimo_estado: enLista(ESTADOS_AGENTE, agente.ultimo_estado) ? agente.ultimo_estado : "inactivo",
  }));
  const actividad = (actividadR.data ?? []) as unknown as EventoOrbita[];
  const pulsos = (pulsosR.data ?? []) as unknown as EventoOrbita[];
  const resumen = resumenDeOrbita(agentes, {
    fin24: fin24.count ?? 0,
    error24: error24.count ?? 0,
    fin7: fin7.count ?? 0,
    finConError7: finConError7.count ?? 0,
    error7: error7.count ?? 0,
    recuperaciones7: recuperaciones7.count ?? 0,
    decisionesCeo7: decisionesCeo7.count ?? 0,
  });
  const esAdmin = perfil?.role === "admin";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Órbita"
        icon={Orbit}
        description="Tus agentes de marketing con IA, en vivo: quién está trabajando, quién necesita ayuda y qué se están pasando entre ellos."
        meta={<span>Atlas Órbita · horas de Chile</span>}
      />

      {error ? (
        <Callout tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>No pudimos leer la red de agentes. Siguen trabajando y sus eventos quedan guardados; vuelve a intentarlo en un momento.</span>
            <Link href="/dashboard/orbita" className={buttonClasses({ variant: "secondary", size: "sm" })}>
              <RefreshCw size={14} aria-hidden="true" />
              Reintentar
            </Link>
          </div>
        </Callout>
      ) : agentes.length === 0 ? (
        <div className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={Orbit}
            title="Órbita todavía no tiene agentes"
            description="Los agentes aparecen solos cuando el sistema de marketing se conecta: cada uno se declara con su rol, su horario y sus conexiones, y desde ese momento reporta lo que hace."
            action={
              esAdmin ? (
                <Link href="/dashboard/admin/integraciones" className={buttonClasses({ variant: "secondary" })}>
                  Ver la conexión en Integraciones
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {/* Lo que se pidió va primero; si la fuente del correo tarda, el resto no espera. */}
          <Suspense key={periodo} fallback={<ObjetivosOrbitaCargando />}>
            <ObjetivosOrbita periodo={periodo} />
          </Suspense>
          <CifrasOrbita resumen={resumen} />
          <MonitorOrbita agentes={agentes} actividad={actividad} pulsos={pulsos} ahora={ahora.toISOString()} />
        </>
      )}
    </div>
  );
}
