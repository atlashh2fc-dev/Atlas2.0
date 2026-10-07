"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Plus, Save, X } from "lucide-react";

import { ajustarCampanaCorreo } from "@/app/actions/campanas-correo";
import { Button, Callout, Field, Input, useToast } from "@/components/ui";
import { DIAS, PROGRAMACION_POR_DEFECTO, describirProgramacion, type Programacion } from "@/lib/campanas-correo";
import { cn } from "@/lib/utils";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function hoyEnChile(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Cuándo envía la campaña: inicio, término, días y ventanas, siempre en hora
 * de Chile. Se puede ajustar con la campaña enviando: no toca los correos.
 */
export function ProgramacionCampana({
  campanaId,
  version,
  inicial,
  limiteDiario,
  deshabilitado,
}: {
  campanaId: string;
  version: number;
  inicial: Programacion | null;
  limiteDiario: number | null;
  deshabilitado?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [programacion, setProgramacion] = useState<Programacion>(inicial ?? PROGRAMACION_POR_DEFECTO);
  const [limite, setLimite] = useState(limiteDiario ? String(limiteDiario) : "");
  const [guardando, startGuardar] = useTransition();
  const hoy = hoyEnChile();

  const errores = useMemo(() => {
    const lista: string[] = [];
    if (!programacion.dias.length) lista.push("Elige al menos un día.");
    if (!programacion.ventanas.length) lista.push("Agrega al menos un horario.");
    programacion.ventanas.forEach((ventana, indice) => {
      if (!HORA.test(ventana.inicio) || !HORA.test(ventana.fin) || minutos(ventana.fin) <= minutos(ventana.inicio)) {
        lista.push(`El horario ${indice + 1} tiene que terminar después de empezar.`);
      }
    });
    if (programacion.inicio_hora && !programacion.inicio_fecha) lista.push("Elige la fecha de inicio o deja la hora vacía.");
    if (programacion.fin_fecha && programacion.inicio_fecha && programacion.fin_fecha < programacion.inicio_fecha) lista.push("La fecha de término es anterior al inicio.");
    if (programacion.fin_fecha && programacion.fin_fecha < hoy) lista.push("La fecha de término ya pasó.");
    if (limite && (Number(limite) < 1 || Number(limite) > 1000)) lista.push("El límite diario va de 1 a 1.000.");
    return lista;
  }, [programacion, limite, hoy]);

  function cambiar(cambio: Partial<Programacion>) {
    setProgramacion((actual) => ({ ...actual, ...cambio }));
  }

  function guardar() {
    if (errores.length) {
      toast({ tone: "danger", message: errores[0] });
      return;
    }
    startGuardar(async () => {
      const resultado = await ajustarCampanaCorreo({
        campanaId,
        version,
        limiteDiario: limite ? Math.floor(Number(limite)) : null,
        programacion: {
          ...programacion,
          inicio_fecha: programacion.inicio_fecha || null,
          inicio_hora: programacion.inicio_fecha ? programacion.inicio_hora || "00:00" : null,
          fin_fecha: programacion.fin_fecha || null,
          fin_hora: programacion.fin_fecha ? programacion.fin_hora || "23:59" : null,
        },
      });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: "Programación guardada" });
      router.refresh();
    });
  }

  const resumen = describirProgramacion(programacion, limite ? Number(limite) : null);
  const bloqueado = Boolean(deshabilitado);

  return (
    <div className="max-w-3xl space-y-5">
      {deshabilitado && <Callout tone="warning">{deshabilitado}</Callout>}
      <section className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="fechas-titulo">
        <h2 id="fechas-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
          Fechas
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Todo en hora de Chile. Sin fecha de inicio, empieza apenas la lances.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Empieza">
              <Input type="date" min={hoy} value={programacion.inicio_fecha ?? ""} onChange={(evento) => cambiar({ inicio_fecha: evento.target.value || null })} disabled={bloqueado} />
            </Field>
            <Field label="Hora">
              <Input type="time" value={programacion.inicio_hora ?? ""} onChange={(evento) => cambiar({ inicio_hora: evento.target.value || null })} disabled={bloqueado || !programacion.inicio_fecha} />
            </Field>
          </div>
          <div className="grid grid-cols-[1fr_110px] gap-2">
            <Field label="Termina (opcional)">
              <Input type="date" min={programacion.inicio_fecha ?? hoy} value={programacion.fin_fecha ?? ""} onChange={(evento) => cambiar({ fin_fecha: evento.target.value || null })} disabled={bloqueado} />
            </Field>
            <Field label="Hora">
              <Input type="time" value={programacion.fin_hora ?? ""} onChange={(evento) => cambiar({ fin_hora: evento.target.value || null })} disabled={bloqueado || !programacion.fin_fecha} />
            </Field>
          </div>
        </div>
      </section>

      <section className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="dias-titulo">
        <h2 id="dias-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
          Días y horarios
        </h2>
        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-foreground">Días de envío</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIAS.map((dia) => {
              const activo = programacion.dias.includes(dia.valor);
              return (
                <button
                  key={dia.valor}
                  type="button"
                  aria-pressed={activo}
                  aria-label={dia.label}
                  title={dia.label}
                  disabled={bloqueado}
                  onClick={() => cambiar({ dias: activo ? programacion.dias.filter((valor) => valor !== dia.valor) : [...programacion.dias, dia.valor] })}
                  className={cn(
                    "size-11 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60",
                    activo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:border-primary/50",
                  )}
                >
                  {dia.corto}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-[13px] font-medium text-foreground">Horarios</legend>
          <p className="text-xs text-muted-foreground">Fuera de estos horarios no sale ningún correo. El límite diario se reparte dentro de ellos.</p>
          <ul className="mt-2 space-y-2">
            {programacion.ventanas.map((ventana, indice) => (
              <li key={indice} className="flex flex-wrap items-center gap-2">
                <Clock size={15} className="text-muted-foreground" aria-hidden="true" />
                <Input type="time" aria-label={`Inicio del horario ${indice + 1}`} className="w-[120px]" value={ventana.inicio} onChange={(evento) => cambiar({ ventanas: programacion.ventanas.map((item, i) => (i === indice ? { ...item, inicio: evento.target.value } : item)) })} disabled={bloqueado} />
                <span className="text-sm text-muted-foreground">a</span>
                <Input type="time" aria-label={`Fin del horario ${indice + 1}`} className="w-[120px]" value={ventana.fin} onChange={(evento) => cambiar({ ventanas: programacion.ventanas.map((item, i) => (i === indice ? { ...item, fin: evento.target.value } : item)) })} disabled={bloqueado} />
                {programacion.ventanas.length > 1 && !bloqueado && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => cambiar({ ventanas: programacion.ventanas.filter((_, i) => i !== indice) })} aria-label={`Quitar horario ${indice + 1}`}>
                    <X size={14} aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {programacion.ventanas.length < 6 && !bloqueado && (
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => cambiar({ ventanas: [...programacion.ventanas, { inicio: "15:00", fin: "18:00" }] })}>
              <Plus size={14} aria-hidden="true" /> Agregar horario
            </Button>
          )}
        </fieldset>

        <Field label="Correos nuevos por día (opcional)" className="mt-5 max-w-xs">
          <Input type="number" inputMode="numeric" min={1} max={1000} value={limite} onChange={(evento) => setLimite(evento.target.value)} placeholder="Sin tope propio" disabled={bloqueado} />
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <p className="mr-auto text-sm text-foreground">{errores.length ? <span className="text-danger">{errores[0]}</span> : resumen}</p>
        {!bloqueado && (
          <Button type="button" onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            Guardar programación
          </Button>
        )}
      </div>
    </div>
  );
}
