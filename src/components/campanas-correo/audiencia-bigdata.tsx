"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Database, Loader2, Users } from "lucide-react";

import { contarAudienciaCorreo, opcionesDeAudienciaCorreo, transferirAudienciaCorreo } from "@/app/actions/campanas-correo";
import { Button, Callout, Field, Input, useToast } from "@/components/ui";
import {
  CARGO_LABEL,
  CONTACTO_LABEL,
  TAMANO_LABEL,
  formatearNumero,
  type ConteoAudiencia,
  type FiltrosAudiencia,
  type OpcionConConteo,
  type OpcionesAudiencia,
} from "@/lib/campanas-correo";
import { cn } from "@/lib/utils";

type Props = {
  campanaId: string;
  nombreCampana: string;
  audienciaActual: { total: number; nombre: string | null; cargada_at?: string | null };
  /** Una campaña cancelada no recibe audiencia. */
  deshabilitado?: string | null;
};

const MAXIMO_POR_DEFECTO = 5000;

function Chips({
  opciones,
  elegidas,
  onCambio,
  etiqueta,
  formato,
  limite = 24,
}: {
  opciones: OpcionConConteo[];
  elegidas: string[];
  onCambio: (valores: string[]) => void;
  etiqueta: string;
  formato?: (valor: string) => string;
  limite?: number;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const visibles = verTodas ? opciones : opciones.slice(0, limite);
  return (
    <fieldset>
      <legend className="text-[13px] font-medium text-foreground">{etiqueta}</legend>
      <p className="mt-0.5 text-xs text-muted-foreground">{elegidas.length ? `${elegidas.length} elegidas` : "Sin elegir: entran todas"}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visibles.map((opcion) => {
          const activa = elegidas.includes(opcion.valor);
          return (
            <button
              key={opcion.valor}
              type="button"
              aria-pressed={activa}
              onClick={() => onCambio(activa ? elegidas.filter((valor) => valor !== opcion.valor) : [...elegidas, opcion.valor])}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors sm:min-h-8",
                activa ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-surface text-foreground hover:border-primary/50",
              )}
            >
              {formato ? formato(opcion.valor) : opcion.valor}
              <span className="tabular-nums text-muted-foreground">{formatearNumero(opcion.contactos)}</span>
            </button>
          );
        })}
        {opciones.length > limite && (
          <button type="button" onClick={() => setVerTodas((valor) => !valor)} className="min-h-11 rounded-full px-3 text-xs font-medium text-primary hover:underline sm:min-h-8">
            {verTodas ? "Ver menos" : `Ver las ${opciones.length}`}
          </button>
        )}
      </div>
    </fieldset>
  );
}

function capitalizar(valor: string): string {
  const limpio = valor.toLowerCase();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/**
 * Elegir a quién le llega: filtros de Bigdata con el conteo en vivo, y la carga
 * en tramos (Bigdata → CRM → Atlas Lead) con su avance.
 */
export function AudienciaBigdata({ campanaId, nombreCampana, audienciaActual, deshabilitado }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [opciones, setOpciones] = useState<OpcionesAudiencia | null>(null);
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosAudiencia>({ contacto: "ambos", solo_activas: true, excluir_clientes_equifax: false });
  const [conteo, setConteo] = useState<ConteoAudiencia | null>(null);
  const [errorConteo, setErrorConteo] = useState<string | null>(null);
  const [contando, setContando] = useState(false);
  const [maximo, setMaximo] = useState(String(MAXIMO_POR_DEFECTO));
  const [carga, setCarga] = useState<{ cargados: number; objetivo: number; bajas: number; bloqueados: number; terminado: boolean } | null>(null);
  const [cargando, setCargando] = useState(false);
  const cancelar = useRef(false);
  const pedidoConteo = useRef(0);

  const regionesElegidas = useMemo(() => filtros.regiones ?? [], [filtros.regiones]);

  // Si la persona se va de la pestaña, la carga se detiene; si cierra la página, se le avisa.
  useEffect(() => () => {
    cancelar.current = true;
  }, []);
  useEffect(() => {
    if (!cargando) return;
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [cargando]);

  useEffect(() => {
    let vigente = true;
    void opcionesDeAudienciaCorreo({ regiones: regionesElegidas }).then((resultado) => {
      if (!vigente) return;
      if (resultado.ok) {
        setOpciones(resultado.opciones);
        setErrorOpciones(null);
      } else {
        setErrorOpciones(resultado.error);
      }
    });
    return () => {
      vigente = false;
    };
  }, [regionesElegidas]);

  useEffect(() => {
    const numero = ++pedidoConteo.current;
    const espera = setTimeout(async () => {
      setContando(true);
      try {
        const resultado = await contarAudienciaCorreo(filtros);
        if (numero !== pedidoConteo.current) return;
        // Un conteo fallido no deja a la vista el número de otros filtros.
        setConteo(resultado.ok ? resultado.conteo : null);
        setErrorConteo(resultado.ok ? null : resultado.error);
      } catch {
        if (numero === pedidoConteo.current) {
          setConteo(null);
          setErrorConteo("No se pudo contar la audiencia. Inténtalo de nuevo.");
        }
      } finally {
        if (numero === pedidoConteo.current) setContando(false);
      }
    }, 450);
    return () => clearTimeout(espera);
  }, [filtros]);

  function cambiar(cambio: Partial<FiltrosAudiencia>) {
    setFiltros((actuales) => ({ ...actuales, ...cambio }));
  }

  const objetivo = Math.min(conteo?.contactos ?? 0, Math.max(1, Math.floor(Number(maximo) || MAXIMO_POR_DEFECTO)));

  async function cargar() {
    if (!conteo?.contactos) return;
    cancelar.current = false;
    setCargando(true);
    setCarga({ cargados: 0, objetivo, bajas: 0, bloqueados: 0, terminado: false });
    let despues: string | null = null;
    let loteId: string | null = null;
    let cargados = 0;
    let bajas = 0;
    let bloqueados = 0;
    const nombre = `${nombreCampana} · Bigdata ${new Date().toLocaleDateString("es-CL")}`;
    try {
      for (;;) {
        if (cancelar.current) {
          // El lote queda a medias y sin asignar: la campaña mantiene su audiencia anterior.
          setCarga(null);
          break;
        }
        const tramo = await transferirAudienciaCorreo({ campanaId, filtros, despues, loteId, cargados, maximo: objetivo, nombre });
        if (!tramo.ok) throw new Error(tramo.error);
        despues = tramo.despues;
        loteId = tramo.loteId;
        cargados = tramo.cargados;
        bajas += tramo.dadosDeBaja;
        bloqueados += tramo.bloqueados;
        setCarga({ cargados, objetivo, bajas, bloqueados, terminado: tramo.terminado });
        if (tramo.terminado) {
          toast({ tone: "success", message: `Audiencia lista: ${formatearNumero(tramo.totalLote)} contactos` });
          router.refresh();
          break;
        }
        if (cancelar.current) {
          // El lote queda a medias y sin asignar: la campaña mantiene su audiencia anterior.
          toast({ tone: "info", message: "Carga detenida. La campaña sigue con su audiencia anterior." });
          setCarga(null);
          break;
        }
      }
    } catch (fallo) {
      toast({ tone: "danger", message: fallo instanceof Error ? fallo.message : "No se pudo cargar la audiencia." });
      setCarga(null);
    } finally {
      setCargando(false);
    }
  }

  const avance = carga ? Math.min(100, Math.round((carga.cargados / Math.max(1, carga.objetivo)) * 100)) : 0;
  const comunas = (opciones?.comunas ?? []).filter((comuna) => !comuna.region || regionesElegidas.includes(comuna.region));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        {deshabilitado && <Callout tone="warning">{deshabilitado}</Callout>}
        {errorOpciones && <Callout tone="danger">No pudimos leer los filtros de Bigdata: {errorOpciones}</Callout>}

        <section className="atlas-panel space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="donde-titulo">
          <div>
            <h2 id="donde-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
              Empresas
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Dónde están, a qué se dedican y de qué tamaño son.</p>
          </div>
          {!opciones && !errorOpciones ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Cargando los filtros de Bigdata…
            </div>
          ) : opciones ? (
            <>
              <Chips etiqueta="Región" opciones={opciones.regiones} elegidas={regionesElegidas} onCambio={(regiones) =>
                  cambiar({
                    regiones,
                    // Las comunas de una región que se quitó dejan de filtrar.
                    comunas: (filtros.comunas ?? []).filter((comuna) =>
                      (opciones.comunas ?? []).some((opcion) => opcion.valor === comuna && (!opcion.region || regiones.includes(opcion.region))),
                    ),
                  })
                } limite={16} />
              {regionesElegidas.length > 0 && comunas.length > 0 && (
                <Chips etiqueta="Comuna" opciones={comunas} elegidas={filtros.comunas ?? []} onCambio={(valores) => cambiar({ comunas: valores })} formato={capitalizar} limite={30} />
              )}
              <Chips etiqueta="Rubro" opciones={opciones.rubros} elegidas={filtros.rubros ?? []} onCambio={(rubros) => cambiar({ rubros })} formato={capitalizar} limite={12} />
              <Chips etiqueta="Tamaño (por ventas en el SII)" opciones={opciones.tamanos} elegidas={filtros.tamanos ?? []} onCambio={(tamanos) => cambiar({ tamanos })} formato={(valor) => TAMANO_LABEL[valor] ?? valor} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trabajadores desde">
                  <Input type="number" inputMode="numeric" min={0} value={filtros.trabajadores_min ?? ""} onChange={(evento) => cambiar({ trabajadores_min: evento.target.value === "" ? null : Math.max(0, Number(evento.target.value)) })} placeholder="Cualquiera" />
                </Field>
                <Field label="Trabajadores hasta">
                  <Input type="number" inputMode="numeric" min={0} value={filtros.trabajadores_max ?? ""} onChange={(evento) => cambiar({ trabajadores_max: evento.target.value === "" ? null : Math.max(0, Number(evento.target.value)) })} placeholder="Cualquiera" />
                </Field>
              </div>
              <Field label="Nombre de la empresa contiene (opcional)">
                <Input value={filtros.nombre_contiene ?? ""} onChange={(evento) => cambiar({ nombre_contiene: evento.target.value })} placeholder="Clínica, Dental, Transportes…" />
              </Field>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-8">
                  <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={filtros.solo_activas ?? true} onChange={(evento) => cambiar({ solo_activas: evento.target.checked })} />
                  Solo empresas activas en el SII
                </label>
                <label className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground sm:min-h-8">
                  <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={filtros.excluir_clientes_equifax ?? false} onChange={(evento) => cambiar({ excluir_clientes_equifax: evento.target.checked })} />
                  Excluir clientes de Equifax
                </label>
              </div>
            </>
          ) : null}
        </section>

        <section className="atlas-panel space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="quien-titulo">
          <div>
            <h2 id="quien-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
              A quién en cada empresa
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Un ejecutivo con nombre responde más que un correo general.</p>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="sr-only">Tipo de contacto</legend>
            {(Object.keys(CONTACTO_LABEL) as (keyof typeof CONTACTO_LABEL)[]).map((valor) => (
              <label key={valor} className="flex min-h-11 items-center gap-2.5 text-sm text-foreground sm:min-h-9">
                <input type="radio" name="contacto" className="size-4 accent-[var(--color-primary)]" checked={(filtros.contacto ?? "ambos") === valor} onChange={() => cambiar({ contacto: valor })} />
                {CONTACTO_LABEL[valor]}
              </label>
            ))}
          </fieldset>
          {opciones && filtros.contacto !== "empresa" && (
            <Chips etiqueta="Cargo" opciones={opciones.cargos} elegidas={filtros.cargos ?? []} onCambio={(cargos) => cambiar({ cargos })} formato={(valor) => CARGO_LABEL[valor] ?? valor} />
          )}
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Resumen de la audiencia">
        <div className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users size={14} aria-hidden="true" /> Entran con estos filtros
            {contando && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
          </p>
          <p className={cn("mt-2 text-[32px] font-semibold leading-none tracking-tight tabular-nums", contando && "opacity-60")} aria-live="polite">
            {conteo ? formatearNumero(conteo.contactos) : "—"}
          </p>
          {errorConteo && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errorConteo}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {conteo
              ? `${formatearNumero(conteo.empresas)} empresas · ${formatearNumero(conteo.ejecutivos)} ejecutivos · ${formatearNumero(conteo.correos_generales)} correos generales`
              : "Contactos con correo válido, sin la lista negra de Bigdata."}
          </p>

          <Field label="Cargar como máximo" className="mt-5">
            <Input type="number" inputMode="numeric" min={1} max={50000} value={maximo} onChange={(evento) => setMaximo(evento.target.value)} disabled={cargando} />
            <span className="text-xs text-muted-foreground">Se cargan {formatearNumero(objetivo)}. La campaña los recorre a su ritmo diario.</span>
          </Field>

          {carga && (
            <div className="mt-5" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={avance} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la carga">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${avance}%` }} />
              </div>
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                {carga.terminado ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 size={13} aria-hidden="true" /> {formatearNumero(carga.cargados)} cargados
                  </span>
                ) : (
                  `${formatearNumero(carga.cargados)} de ${formatearNumero(carga.objetivo)}…`
                )}
                {carga.bajas > 0 && ` · ${formatearNumero(carga.bajas)} ya se habían dado de baja y no recibirán correos`}
                {carga.bloqueados > 0 && ` · ${formatearNumero(carga.bloqueados)} en lista negra, omitidos`}
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Button type="button" onClick={() => void cargar()} disabled={Boolean(deshabilitado) || cargando || !conteo?.contactos}>
              {cargando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Database size={16} aria-hidden="true" />}
              {cargando ? "Cargando…" : audienciaActual.total ? "Reemplazar audiencia" : "Usar esta audiencia"}
            </Button>
            {cargando && (
              <Button type="button" variant="ghost" onClick={() => (cancelar.current = true)}>
                Detener
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-4 text-xs text-muted-foreground">
          {audienciaActual.total ? (
            <>
              <p className="font-medium text-foreground">Audiencia actual: {formatearNumero(audienciaActual.total)} contactos</p>
              <p className="mt-1">{audienciaActual.nombre ?? "Cargada antes"}. Reemplazarla no repite el correo a quien ya lo recibió en esta campaña.</p>
            </>
          ) : (
            <p>La campaña todavía no tiene audiencia. Ajusta los filtros, revisa el conteo y cárgala.</p>
          )}
          {opciones?.actualizada_at && <p className="mt-2">Base de Bigdata al {new Date(opciones.actualizada_at).toLocaleDateString("es-CL")}.</p>}
        </div>
      </aside>
    </div>
  );
}
