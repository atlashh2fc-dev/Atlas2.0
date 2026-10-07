"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, List, Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { guardarCampanaCorreo, vistaPreviaCorreo } from "@/app/actions/campanas-correo";
import { Button, Callout, Field, Input, Select, useToast } from "@/components/ui";
import { CONDICIONES, PASO_NUEVO, type Cabecera, type DatosCampana, type Paso, type Remitente } from "@/lib/campanas-correo";
import { cn } from "@/lib/utils";

import { SubirImagen } from "./subir-imagen";

const TEXTAREA =
  "w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm placeholder:text-muted-foreground/70 focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

type Inicial = {
  nombre: string;
  remitenteId?: string;
  limiteDiario: number | null;
  ctaUrl: string | null;
  ctaTexto: string | null;
  cabecera: Cabecera;
  pasos: Paso[];
};

type Props = {
  modo: "crear" | "editar";
  campanaId?: string;
  version?: number;
  remitentes: Remitente[];
  variables: { clave: string; descripcion: string }[];
  maxPasos: number;
  imagenMb: number;
  inicial: Inicial;
  /** Con texto, la campaña no se puede editar acá y se explica por qué. */
  bloqueo?: string | null;
  /** La cabecera de la marca lleva título y bajada (Altius); si no, solo imagen. */
  cabeceraConTexto?: boolean;
};

function nombreDelPaso(indice: number): string {
  return indice === 0 ? "Primer correo" : `Seguimiento ${indice}`;
}

function pasoValido(paso: Paso) {
  return paso.asunto.trim().length >= 3 && paso.cuerpo.trim().length >= 10;
}

/**
 * Los correos de una campaña: datos, cabecera y cada paso de la secuencia, con
 * la vista previa exacta que arma Atlas Lead (el mismo HTML que va a llegar).
 */
export function EditorCorreos({ modo, campanaId, version, remitentes, variables, maxPasos, imagenMb, inicial, bloqueo, cabeceraConTexto: cabeceraFija }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [nombre, setNombre] = useState(inicial.nombre);
  const [remitenteId, setRemitenteId] = useState(inicial.remitenteId ?? remitentes[0]?.id ?? "");
  const [limite, setLimite] = useState<string>(inicial.limiteDiario ? String(inicial.limiteDiario) : "");
  const [ctaUrl, setCtaUrl] = useState(inicial.ctaUrl ?? "");
  const [ctaTexto, setCtaTexto] = useState(inicial.ctaTexto ?? "");
  const [cabecera, setCabecera] = useState<Cabecera>(inicial.cabecera);
  const [pasos, setPasos] = useState<Paso[]>(inicial.pasos.length ? inicial.pasos : [{ ...PASO_NUEVO, espera_dias_habiles: 0 }]);
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const [guardando, startGuardar] = useTransition();
  const [masOpciones, setMasOpciones] = useState(Boolean(inicial.ctaUrl || inicial.ctaTexto));
  const ultimoCampo = useRef<{ paso: number; campo: "asunto" | "cuerpo"; elemento: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const remitente = remitentes.find((item) => item.id === remitenteId) ?? null;
  const cabeceraConTexto = modo === "crear" ? Boolean(remitente?.cabecera_con_texto) : Boolean(cabeceraFija);
  const deshabilitado = Boolean(bloqueo);

  const datos: DatosCampana = useMemo(
    () => ({
      nombre: nombre.trim(),
      remitente_id: modo === "crear" ? remitenteId : undefined,
      limite_diario: limite ? Math.max(1, Math.floor(Number(limite))) : null,
      cta_url: ctaUrl.trim() || null,
      cta_texto: ctaTexto.trim() || null,
      cabecera: { ...cabecera, titulo: cabecera.titulo?.trim() || null, bajada: cabecera.bajada?.trim() || null, precio: cabecera.precio?.trim() || null },
      pasos: pasos.map((paso, indice) => ({ ...paso, asunto: paso.asunto.trim(), cuerpo: paso.cuerpo.trim(), espera_dias_habiles: indice === 0 ? 0 : paso.espera_dias_habiles })),
    }),
    [nombre, modo, remitenteId, limite, ctaUrl, ctaTexto, cabecera, pasos],
  );

  const errores = {
    nombre: datos.nombre.length < 3 ? "Ponle un nombre de al menos 3 letras." : null,
    remitente: modo === "crear" && !remitenteId ? "Elige el remitente." : null,
    limite: limite && (!Number.isFinite(Number(limite)) || Number(limite) < 1 || Number(limite) > 1000) ? "Entre 1 y 1.000 correos por día." : null,
    cabecera: cabeceraConTexto && cabecera.imagen_url && !cabecera.titulo?.trim() ? "La cabecera con imagen necesita un título: se lee aunque el correo bloquee las imágenes." : null,
    pasos: pasos.map((paso) => ({
      asunto: paso.asunto.trim().length < 3 ? "Escribe el asunto." : null,
      cuerpo: paso.cuerpo.trim().length < 10 ? "Escribe el texto del correo." : null,
    })),
  };
  const hayErrores = Boolean(errores.nombre || errores.remitente || errores.limite || errores.cabecera || errores.pasos.some((paso) => paso.asunto || paso.cuerpo));

  // ---- Vista previa ----------------------------------------------------
  const [pasoPrevia, setPasoPrevia] = useState(0);
  const [previa, setPrevia] = useState<{ html: string; asunto: string; empresa: string } | null>(null);
  const [previaError, setPreviaError] = useState<string | null>(null);
  const [cargandoPrevia, setCargandoPrevia] = useState(false);
  const pedido = useRef(0);
  const puedePrevia = (modo === "editar" ? Boolean(campanaId) : Boolean(remitenteId)) && pasos.every(pasoValido);

  const actualizarPrevia = useCallback(async () => {
    if (!puedePrevia) return;
    const numero = ++pedido.current;
    setCargandoPrevia(true);
    const resultado = await vistaPreviaCorreo({
      campanaId: modo === "editar" ? campanaId : undefined,
      paso: Math.min(pasoPrevia, pasos.length - 1),
      borrador: datos,
    });
    if (numero !== pedido.current) return;
    setCargandoPrevia(false);
    if (resultado.ok) {
      setPrevia({ html: resultado.html, asunto: resultado.asunto, empresa: resultado.empresaEjemplo });
      setPreviaError(null);
    } else {
      setPreviaError(resultado.error);
    }
  }, [puedePrevia, modo, campanaId, pasoPrevia, pasos.length, datos]);

  useEffect(() => {
    const espera = setTimeout(() => void actualizarPrevia(), 900);
    return () => clearTimeout(espera);
  }, [actualizarPrevia]);

  // ---- Edición ---------------------------------------------------------
  function cambiarPaso(indice: number, cambio: Partial<Paso>) {
    setPasos((actuales) => actuales.map((paso, i) => (i === indice ? { ...paso, ...cambio } : paso)));
  }

  function insertar(texto: string) {
    const destino = ultimoCampo.current;
    const indice = destino?.paso ?? pasos.length - 1;
    const campo = destino?.campo ?? "cuerpo";
    const actual = pasos[indice]?.[campo] ?? "";
    const elemento = destino?.elemento;
    const inicio = elemento?.selectionStart ?? actual.length;
    const fin = elemento?.selectionEnd ?? actual.length;
    const nuevo = `${actual.slice(0, inicio)}${texto}${actual.slice(fin)}`;
    cambiarPaso(indice, { [campo]: nuevo });
    requestAnimationFrame(() => {
      if (!elemento) return;
      elemento.focus();
      elemento.setSelectionRange(inicio + texto.length, inicio + texto.length);
    });
  }

  function guardar() {
    setIntentoGuardar(true);
    if (hayErrores) {
      toast({ tone: "danger", message: "Revisa los campos marcados antes de guardar." });
      return;
    }
    startGuardar(async () => {
      const resultado = await guardarCampanaCorreo({ campanaId: modo === "editar" ? campanaId : undefined, version, datos });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      if (modo === "crear") {
        toast({ tone: "success", message: "Borrador guardado. Ahora elige a quién le llega." });
        router.push(`/dashboard/campanas-correo/${resultado.campana.id}?tab=audiencia`);
      } else {
        toast({ tone: "success", message: "Correos guardados" });
        router.refresh();
      }
    });
  }

  const mostrar = (mensaje: string | null) => (intentoGuardar ? mensaje : null);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
      <div className="space-y-5">
        {bloqueo && <Callout tone="warning">{bloqueo}</Callout>}

        <section className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="datos-titulo">
          <h2 id="datos-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
            Datos
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nombre interno" className="sm:col-span-2">
              <Input value={nombre} onChange={(evento) => setNombre(evento.target.value)} placeholder="Dental · Clínicas RM · Octubre" disabled={deshabilitado} aria-invalid={Boolean(mostrar(errores.nombre))} data-autofocus />
              {mostrar(errores.nombre) && <span className="text-xs text-danger">{errores.nombre}</span>}
            </Field>
            {modo === "crear" ? (
              <Field label="Remitente">
                <Select value={remitenteId} onChange={(evento) => setRemitenteId(evento.target.value)}>
                  {remitentes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.marca} · {item.email}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">
                  {remitente?.responder_a ? `Las respuestas llegan a ${remitente.responder_a}.` : "Solo remitentes con dominio ya verificado en Atlas Lead."}
                </span>
              </Field>
            ) : null}
            <Field label="Correos nuevos por día (opcional)">
              <Input type="number" inputMode="numeric" min={1} max={1000} value={limite} onChange={(evento) => setLimite(evento.target.value)} placeholder="Sin tope propio" disabled={deshabilitado} />
              <span className={cn("text-xs", mostrar(errores.limite) ? "text-danger" : "text-muted-foreground")}>
                {mostrar(errores.limite) ?? "Se reparte a lo largo de las horas de envío. Los seguimientos no lo gastan."}
              </span>
            </Field>
          </div>
        </section>

        <section className="atlas-panel rounded-xl border border-border bg-surface p-5 shadow-sm" aria-labelledby="cabecera-titulo">
          <h2 id="cabecera-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
            Cabecera
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">La imagen que abre el correo. Opcional.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className={cabeceraConTexto ? "" : "sm:col-span-2"}>
              <SubirImagen etiqueta="Imagen de cabecera" valor={cabecera.imagen_url} onCambio={(url) => setCabecera((actual) => ({ ...actual, imagen_url: url }))} maxMb={imagenMb} ayuda="Ancho recomendado: 1200 px." disabled={deshabilitado} />
            </div>
            {cabeceraConTexto && (
              <div className="space-y-3">
                <Field label="Título">
                  <Input value={cabecera.titulo ?? ""} onChange={(evento) => setCabecera((actual) => ({ ...actual, titulo: evento.target.value }))} placeholder="Tu clínica, *siempre* agendando" disabled={deshabilitado} />
                  <span className={cn("text-xs", mostrar(errores.cabecera) ? "text-danger" : "text-muted-foreground")}>
                    {mostrar(errores.cabecera) ?? "La palabra entre *asteriscos* se destaca."}
                  </span>
                </Field>
                <Field label="Bajada">
                  <Input value={cabecera.bajada ?? ""} onChange={(evento) => setCabecera((actual) => ({ ...actual, bajada: evento.target.value }))} placeholder="Una frase que explique la oferta" disabled={deshabilitado} />
                </Field>
                <Field label="Precio (opcional)">
                  <Input value={cabecera.precio ?? ""} onChange={(evento) => setCabecera((actual) => ({ ...actual, precio: evento.target.value }))} placeholder="$29.990 al mes" disabled={deshabilitado} />
                </Field>
              </div>
            )}
          </div>
        </section>

        <section className="atlas-panel rounded-xl border border-border bg-surface shadow-sm" aria-labelledby="correos-titulo">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
            <div>
              <h2 id="correos-titulo" className="text-[15px] font-semibold tracking-tight text-foreground">
                Correos
              </h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">El primero sale al inicio; cada seguimiento, los días hábiles que indiques después del anterior.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-y border-border bg-surface-raised px-5 py-2.5">
            <span className="mr-1 text-xs text-muted-foreground">Insertar:</span>
            {variables.map((variable) => (
              <button
                key={variable.clave}
                type="button"
                title={variable.descripcion}
                disabled={deshabilitado}
                onMouseDown={(evento) => evento.preventDefault()}
                onClick={() => insertar(variable.clave)}
                className="h-7 rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                {variable.clave.replace(/[[\]]/g, "")}
              </button>
            ))}
            <button
              type="button"
              disabled={deshabilitado}
              onMouseDown={(evento) => evento.preventDefault()}
              onClick={() => insertar("\n\n[BULLETS]\n- Primer punto\n- Segundo punto\n\n")}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
            >
              <List size={12} aria-hidden="true" /> Lista
            </button>
          </div>

          <ol className="divide-y divide-border">
            {pasos.map((paso, indice) => (
              <li key={indice} className="px-5 py-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs text-primary tabular-nums">{indice + 1}</span>
                    {nombreDelPaso(indice)}
                  </h3>
                  {indice > 0 && !deshabilitado && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPasos((actuales) => actuales.filter((_, i) => i !== indice))} aria-label={`Quitar ${nombreDelPaso(indice).toLowerCase()}`}>
                      <Trash2 size={14} aria-hidden="true" /> Quitar
                    </Button>
                  )}
                </div>
                {indice > 0 && (
                  <div className="mb-4 grid gap-3 sm:grid-cols-[140px_1fr]">
                    <Field label="Días hábiles después">
                      <Input type="number" inputMode="numeric" min={0} max={30} value={paso.espera_dias_habiles} onChange={(evento) => cambiarPaso(indice, { espera_dias_habiles: Math.max(0, Math.min(30, Number(evento.target.value) || 0)) })} disabled={deshabilitado} />
                    </Field>
                    <Field label="A quién">
                      <Select value={paso.condicion} onChange={(evento) => cambiarPaso(indice, { condicion: evento.target.value as Paso["condicion"] })} disabled={deshabilitado}>
                        {CONDICIONES.map((condicion) => (
                          <option key={condicion.valor} value={condicion.valor}>
                            {condicion.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                <div className="space-y-3">
                  <Field label="Asunto">
                    <Input
                      value={paso.asunto}
                      maxLength={200}
                      onChange={(evento) => cambiarPaso(indice, { asunto: evento.target.value })}
                      onFocus={(evento) => (ultimoCampo.current = { paso: indice, campo: "asunto", elemento: evento.currentTarget })}
                      placeholder={indice === 0 ? "[Nombre], ¿tu agenda se llena sola?" : "¿Lo alcanzaste a ver?"}
                      disabled={deshabilitado}
                      aria-invalid={Boolean(mostrar(errores.pasos[indice]?.asunto))}
                    />
                    {mostrar(errores.pasos[indice]?.asunto ?? null) && <span className="text-xs text-danger">{errores.pasos[indice]?.asunto}</span>}
                  </Field>
                  <Field label="Texto">
                    <textarea
                      value={paso.cuerpo}
                      rows={9}
                      maxLength={8000}
                      onChange={(evento) => cambiarPaso(indice, { cuerpo: evento.target.value })}
                      onFocus={(evento) => (ultimoCampo.current = { paso: indice, campo: "cuerpo", elemento: evento.currentTarget })}
                      placeholder={"Hola [Nombre],\n\nEscribe aquí el correo tal como lo va a leer el cliente. Deja una línea en blanco entre párrafos.\n\nSaludos"}
                      className={TEXTAREA}
                      disabled={deshabilitado}
                      aria-invalid={Boolean(mostrar(errores.pasos[indice]?.cuerpo))}
                    />
                    <span className={cn("text-xs", mostrar(errores.pasos[indice]?.cuerpo ?? null) ? "text-danger" : "text-muted-foreground")}>
                      {mostrar(errores.pasos[indice]?.cuerpo ?? null) ?? "La firma y el enlace de baja los agrega Atlas Lead. Un enlace de agenda solo en su línea se vuelve botón."}
                    </span>
                  </Field>
                  <SubirImagen etiqueta="Imagen dentro del correo (opcional)" valor={paso.imagen_url} onCambio={(url) => cambiarPaso(indice, { imagen_url: url })} maxMb={imagenMb} disabled={deshabilitado} />
                </div>
              </li>
            ))}
          </ol>
          {!deshabilitado && pasos.length < maxPasos && (
            <div className="border-t border-border px-5 py-3">
              <Button type="button" variant="secondary" onClick={() => setPasos((actuales) => [...actuales, { ...PASO_NUEVO }])}>
                <Plus size={15} aria-hidden="true" /> Agregar seguimiento
              </Button>
            </div>
          )}
        </section>

        <section className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <button type="button" onClick={() => setMasOpciones((abierto) => !abierto)} aria-expanded={masOpciones} className="flex w-full items-center justify-between px-5 py-4 text-left">
            <span>
              <span className="block text-[15px] font-semibold tracking-tight text-foreground">Botón del correo</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">Si no lo cambias, usa el del remitente{remitente?.cta_texto ? ` («${remitente.cta_texto}»)` : ""}.</span>
            </span>
            <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform", masOpciones && "rotate-180")} aria-hidden="true" />
          </button>
          {masOpciones && (
            <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2">
              <Field label="Texto del botón">
                <Input value={ctaTexto} maxLength={60} onChange={(evento) => setCtaTexto(evento.target.value)} placeholder={remitente?.cta_texto ?? "Agenda una demo →"} disabled={deshabilitado} />
              </Field>
              <Field label="Enlace del botón">
                <Input type="url" inputMode="url" value={ctaUrl} onChange={(evento) => setCtaUrl(evento.target.value)} placeholder={remitente?.cta_url ?? "https://"} disabled={deshabilitado} />
              </Field>
            </div>
          )}
        </section>

        {!deshabilitado && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
            {intentoGuardar && hayErrores && <span className="mr-auto text-xs text-danger">Hay campos por completar.</span>}
            <Button type="button" onClick={guardar} disabled={guardando}>
              {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {modo === "crear" ? "Guardar y elegir audiencia" : "Guardar correos"}
            </Button>
          </div>
        )}
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start" aria-label="Vista previa del correo">
        <div className="atlas-panel overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Así llega</h2>
              <p className="truncate text-xs text-muted-foreground">{previa ? `Asunto: ${previa.asunto}` : "El mismo correo que arma Atlas Lead"}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void actualizarPrevia()} disabled={!puedePrevia || cargandoPrevia} aria-label="Actualizar vista previa">
              <RefreshCw size={14} className={cargandoPrevia ? "animate-spin" : ""} aria-hidden="true" />
            </Button>
          </div>
          {pasos.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" role="tablist" aria-label="Correo a mostrar">
              {pasos.map((_, indice) => (
                <button
                  key={indice}
                  type="button"
                  role="tab"
                  aria-selected={pasoPrevia === indice}
                  onClick={() => setPasoPrevia(indice)}
                  className={cn("h-8 shrink-0 rounded-md px-2.5 text-xs font-medium", pasoPrevia === indice ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-surface-muted")}
                >
                  {indice + 1}. {nombreDelPaso(indice)}
                </button>
              ))}
            </div>
          )}
          <div className="relative bg-surface-muted">
            {previa ? (
              <iframe title="Vista previa del correo" srcDoc={previa.html} sandbox="" className={cn("h-[640px] w-full bg-white transition-opacity", cargandoPrevia && "opacity-60")} />
            ) : (
              <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {cargandoPrevia ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : puedePrevia ? "Preparando la vista previa…" : "Escribe el asunto y el texto de cada correo para verlo como le llega al cliente."}
              </div>
            )}
          </div>
          {previaError && (
            <p role="alert" className="border-t border-border px-4 py-3 text-xs text-danger">
              {previaError}
            </p>
          )}
          {previa && !previaError && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Con datos de {previa.empresa}, un contacto real de la base.</p>}
        </div>
      </aside>
    </div>
  );
}
