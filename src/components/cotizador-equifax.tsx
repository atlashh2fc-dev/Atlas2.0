"use client";

import { useMemo, useState } from "react";
import { Calculator, CheckCircle2, Eye, Mail, MessageCircle, Plus, Trash2, UserRound } from "lucide-react";

import {
  cargarCotizador,
  enviarCotizacionPorCorreo,
  guardarMiFirma,
  registrarCotizacionWhatsapp,
  type ContextoCotizador,
  type CotizacionEnviada,
} from "@/app/actions/cotizador-equifax";
import { Button, Callout, Field, Input, Select, SlideOver } from "@/components/ui";
import {
  DOA_ETIQUETA,
  FRECUENCIA_ETIQUETA,
  PLANES_MORA_CONTROL,
  PRODUCTOS,
  TAMANOS_PARTNER_CHECK,
  TRAMOS,
  configInicial,
  cotizarLinea,
  definicion,
  etiquetaCobro,
  formatoPesos,
  formatoUf,
  totales,
  type ConfigLinea,
  type LineaCotizada,
  type ProductoClave,
} from "@/lib/equifax-cotizador/catalogo";
import { LOGO_EQUIFAX_PNG_BASE64 } from "@/lib/equifax-cotizador/logo";
import { correoHtml, firmaDesdePerfil, mensajeWhatsapp, type DatosPropuesta } from "@/lib/equifax-cotizador/propuesta";
import { celularChileno, enlaceWhatsapp } from "@/lib/prospeccion";

/** Lo que la propuesta deja listo en «Datos comerciales Equifax» de la tipificación. */
export type ResultadoCotizacion = {
  canal: "correo" | "whatsapp";
  destinatario: string;
  productos: string[];
  uf: number | null;
  q: number | null;
  correo: string | null;
  resumen: string;
};

type Linea = { id: number; config: ConfigLinea };

const LOGO_VISTA_PREVIA = `data:image/png;base64,${LOGO_EQUIFAX_PNG_BASE64}`;

let siguienteId = 1;
const nuevaLinea = (clave: ProductoClave): Linea => ({ id: siguienteId++, config: configInicial(clave) });

function numero(valor: string): number {
  // Tolera "40.779,5", "40779.5" y "$ 1.200.000".
  const limpio = valor.replace(/[^\d,.-]/g, "");
  const normalizado = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/\.(?=\d{3}(\D|$))/g, "");
  return Number(normalizado);
}

function resumenTotales(lineas: LineaCotizada[]): string {
  const total = totales(lineas);
  return [
    total.mensual > 0 ? `${formatoUf(total.mensual)} UF/mes` : null,
    total.unico > 0 ? `${formatoUf(total.unico)} UF pago único` : null,
    total.anual > 0 ? `${formatoUf(total.anual)} UF/año` : null,
    total.clp > 0 ? `${formatoPesos(total.clp)} publicación` : null,
  ].filter(Boolean).join(" · ") || "Sin valor";
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" });

export function CotizadorEquifax({
  leadId,
  callId,
  cliente,
  onEnviada,
}: {
  leadId: string;
  callId: string;
  cliente: { empresa: string | null; rut: string | null; contacto: string | null; correo: string | null; telefono: string | null };
  onEnviada: (resultado: ResultadoCotizacion) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [contexto, setContexto] = useState<ContextoCotizador | null>(null);
  const [cargando, setCargando] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>(() => [nuevaLinea("mc")]);
  const [valorUf, setValorUf] = useState("");
  const [contacto, setContacto] = useState(cliente.contacto ?? "");
  const [correo, setCorreo] = useState(cliente.correo ?? "");
  const [celular, setCelular] = useState(celularChileno(cliente.telefono) ? cliente.telefono ?? "" : "");
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [enviando, setEnviando] = useState<"correo" | "whatsapp" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<ResultadoCotizacion | null>(null);

  async function abrir() {
    setError(null);
    setAbierto(true);
    if (contexto || cargando) return;
    setCargando(true);
    const respuesta = await cargarCotizador(leadId);
    setCargando(false);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    setContexto(respuesta.data);
    if (respuesta.data.uf) setValorUf(String(respuesta.data.uf.valor));
  }

  const cotizadas = useMemo(() => lineas.map((linea) => cotizarLinea(linea.config)), [lineas]);
  const uf = numero(valorUf);
  const ufValida = Number.isFinite(uf) && uf >= 30000 && uf <= 60000;
  const firma = contexto ? firmaDesdePerfil(contexto.firma) : null;
  const firmaIncompleta = Boolean(contexto && (!contexto.firma.cargo || !contexto.firma.whatsapp));
  const celularValido = celularChileno(celular);
  const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());
  const pubIncompleta = cotizadas.some((linea) => linea.producto === "pub" && (linea.publicacion?.publicar ?? 0) <= 0);
  const listo = Boolean(contexto) && ufValida && cotizadas.length > 0 && !pubIncompleta;

  const datos: DatosPropuesta | null = firma && ufValida
    ? { cliente: { empresa: cliente.empresa, rut: cliente.rut, contacto: contacto.trim() || null }, ejecutivo: firma, lineas: cotizadas, valorUf: uf, fecha: new Date() }
    : null;

  function actualizar(id: number, config: ConfigLinea) {
    setLineas((actuales) => actuales.map((linea) => (linea.id === id ? { ...linea, config } : linea)));
  }

  function terminar(canal: "correo" | "whatsapp", destinatario: string) {
    const total = totales(cotizadas);
    const resultado: ResultadoCotizacion = {
      canal,
      destinatario,
      productos: [...new Set(cotizadas.map((linea) => linea.atlas))],
      uf: total.ufTipificacion,
      q: cotizadas.find((linea) => linea.q != null)?.q ?? null,
      correo: canal === "correo" ? destinatario : correoValido ? correo.trim().toLowerCase() : null,
      resumen: resumenTotales(cotizadas),
    };
    setEnviada(resultado);
    onEnviada(resultado);
    setContexto(null); // recarga el historial la próxima vez que se abra
    setAbierto(false);
  }

  const entrada = () => ({
    leadId,
    callId,
    configs: lineas.map((linea) => linea.config),
    valorUf: uf,
    contacto: contacto.trim() || null,
  });

  async function enviarCorreo() {
    if (!listo || !correoValido || enviando) return;
    setEnviando("correo");
    setError(null);
    const respuesta = await enviarCotizacionPorCorreo({ ...entrada(), para: correo });
    setEnviando(null);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    terminar("correo", correo.trim().toLowerCase());
  }

  async function abrirWhatsapp() {
    if (!listo || !celularValido || !datos || enviando) return;
    // Se abre en el mismo clic: si esperara al servidor, el navegador bloquea la ventana.
    window.open(enlaceWhatsapp(celularValido, mensajeWhatsapp(datos)), "_blank", "noopener,noreferrer");
    setEnviando("whatsapp");
    setError(null);
    const respuesta = await registrarCotizacionWhatsapp({ ...entrada(), celular: celularValido });
    setEnviando(null);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    terminar("whatsapp", `+${celularValido}`);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border border-l-2 border-l-[var(--tone-green)] bg-surface px-4 py-3">
        <span className="icon-chip size-8 shrink-0 rounded-lg" data-tone="green" aria-hidden="true">
          {enviada ? <CheckCircle2 size={17} /> : <Calculator size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{enviada ? "Propuesta enviada" : "Cotizador Equifax"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {enviada
              ? `${enviada.canal === "correo" ? "Por correo a" : "WhatsApp abierto para"} ${enviada.destinatario} · ${enviada.resumen}. Productos y UF quedaron listos en la tipificación.`
              : "Arma la propuesta con los precios vigentes y envíala por correo o WhatsApp sin salir de la ficha."}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={abrir}>
          <Calculator size={14} aria-hidden="true" /> {enviada ? "Cotizar de nuevo" : "Cotizar"}
        </Button>
      </div>

      {/* El formulario de tipificación cierra la gestión con Ctrl/⌘ + Enter:
          dentro del cotizador ese atajo no debe llegar hasta él. */}
      <div onKeyDown={(event) => event.stopPropagation()}>
      <SlideOver
        open={abierto}
        onClose={() => setAbierto(false)}
        width="lg"
        title="Cotizador Equifax"
        description={[cliente.empresa, cliente.rut ? `RUT ${cliente.rut}` : null].filter(Boolean).join(" · ") || undefined}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={abrirWhatsapp} disabled={!listo || !celularValido || enviando !== null} title={celularValido ? undefined : "Escribe un celular chileno"}>
              <MessageCircle size={15} aria-hidden="true" /> {enviando === "whatsapp" ? "Registrando…" : "Abrir WhatsApp"}
            </Button>
            <Button type="button" onClick={enviarCorreo} disabled={!listo || !correoValido || !contexto?.buzon || enviando !== null}>
              <Mail size={15} aria-hidden="true" /> {enviando === "correo" ? "Enviando…" : "Enviar por correo"}
            </Button>
          </>
        }
      >
        {cargando && !contexto && <p className="text-sm text-muted-foreground">Cargando precios, UF del día y tu firma…</p>}

        {contexto && (
          <div className="space-y-6">
            {error && <Callout tone="danger">{error}</Callout>}

            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Productos</h3>
                <Field label={contexto.uf ? "UF del día" : "UF del día (escríbela: no se pudo consultar)"} className="w-44">
                  <Input value={valorUf} onChange={(event) => setValorUf(event.target.value)} inputMode="decimal" aria-invalid={!ufValida} placeholder="39.485,65" />
                </Field>
              </div>

              {lineas.map((linea, indice) => (
                <EditorLinea
                  key={linea.id}
                  linea={linea}
                  cotizada={cotizadas[indice]}
                  valorUf={ufValida ? uf : null}
                  onChange={(config) => actualizar(linea.id, config)}
                  onQuitar={lineas.length > 1 ? () => setLineas((actuales) => actuales.filter((item) => item.id !== linea.id)) : undefined}
                />
              ))}

              {lineas.length < 12 && (
                <label className="flex items-center gap-2 text-sm">
                  <Plus size={15} className="text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Agregar producto</span>
                  <Select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) setLineas((actuales) => [...actuales, nuevaLinea(event.target.value as ProductoClave)]);
                    }}
                    className="max-w-xs"
                  >
                    <option value="">Agregar otro producto…</option>
                    {PRODUCTOS.map((producto) => (
                      <option key={producto.clave} value={producto.clave}>{producto.etiqueta}</option>
                    ))}
                  </Select>
                </label>
              )}

              {lineas.length > 1 && (
                <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm font-semibold text-foreground">Total: {resumenTotales(cotizadas)} + IVA</p>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Destinatario</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Contacto (para el saludo)">
                  <Input value={contacto} onChange={(event) => setContacto(event.target.value)} placeholder="Nombre de la persona" />
                </Field>
                <Field label="Correo">
                  <Input type="email" value={correo} onChange={(event) => setCorreo(event.target.value)} placeholder="correo@empresa.cl" aria-invalid={correo !== "" && !correoValido} />
                </Field>
                <Field label="Celular (WhatsApp)">
                  <Input value={celular} onChange={(event) => setCelular(event.target.value)} inputMode="tel" placeholder="9 1234 5678" aria-invalid={celular !== "" && !celularValido} />
                </Field>
              </div>
              {contexto.buzon ? (
                <p className="text-xs text-muted-foreground">El correo sale desde {contexto.buzon}, con copia oculta a la jefatura comercial.</p>
              ) : (
                <Callout tone="warning">La empresa todavía no tiene un buzón para enviar correos. Puedes mandar la propuesta por WhatsApp; para el correo, un administrador debe conectar el buzón.</Callout>
              )}
              {pubIncompleta && <p className="text-xs text-danger">Publicación Única: escribe el monto de al menos un documento.</p>}
            </section>

            <FirmaComercial contexto={contexto} abierta={firmaIncompleta} onGuardada={(firmaNueva) => setContexto({ ...contexto, firma: firmaNueva })} />

            <section className="space-y-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setVistaPrevia((valor) => !valor)} disabled={!datos}>
                <Eye size={14} aria-hidden="true" /> {vistaPrevia ? "Ocultar vista previa" : "Ver cómo le llega el correo"}
              </Button>
              {vistaPrevia && datos && (
                <iframe
                  title="Vista previa del correo"
                  srcDoc={correoHtml(datos, LOGO_VISTA_PREVIA)}
                  sandbox=""
                  className="h-[640px] w-full rounded-lg border border-border bg-white"
                />
              )}
            </section>

            {contexto.historial.length > 0 && <Historial filas={contexto.historial} />}
          </div>
        )}

        {!contexto && !cargando && error && <Callout tone="danger">{error}</Callout>}
      </SlideOver>
      </div>
    </>
  );
}

function EditorLinea({
  linea,
  cotizada,
  valorUf,
  onChange,
  onQuitar,
}: {
  linea: Linea;
  cotizada: LineaCotizada;
  valorUf: number | null;
  onChange: (config: ConfigLinea) => void;
  onQuitar?: () => void;
}) {
  const { config } = linea;
  const def = definicion(config.producto);
  const tieneDoa = def.doa.length > 0;
  const admiteManual = config.producto !== "bdd" && config.producto !== "pub";
  const opcionesTramo = (tramos: number[], unidad: string) =>
    tramos.map((tramo) => <option key={tramo} value={tramo}>{tramo.toLocaleString("es-CL")} {unidad}</option>);

  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="mb-3 flex items-start gap-3">
        <Select
          value={config.producto}
          onChange={(event) => onChange(configInicial(event.target.value as ProductoClave))}
          className="max-w-xs font-medium"
          aria-label="Producto"
        >
          {PRODUCTOS.map((producto) => <option key={producto.clave} value={producto.clave}>{producto.etiqueta}</option>)}
        </Select>
        {onQuitar && (
          <button type="button" onClick={onQuitar} aria-label="Quitar producto" className="ml-auto flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger">
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {config.producto === "bundle" && (
          <>
            <Field label="Mora Control">
              <Select value={config.mc} onChange={(event) => onChange({ ...config, mc: event.target.value as "4100" | "ilim", precioManual: null })}>
                <option value="4100">MC 4100</option>
                <option value="ilim">MC Ilimitado</option>
              </Select>
            </Field>
            <Field label="Descargas RI al mes">
              <Select value={config.descargas} onChange={(event) => onChange({ ...config, descargas: Number(event.target.value), precioManual: null })}>
                {opcionesTramo(TRAMOS.bundle, "descargas")}
              </Select>
            </Field>
          </>
        )}
        {config.producto === "mc" && (
          <Field label="Plan">
            <Select value={config.plan} onChange={(event) => onChange({ ...config, plan: event.target.value as "4100" | "6900" | "ilim", precioManual: null })}>
              {PLANES_MORA_CONTROL.map((plan) => <option key={plan.clave} value={plan.clave}>{plan.etiqueta}</option>)}
            </Select>
          </Field>
        )}
        {(config.producto === "ri" || config.producto === "malla" || config.producto === "datafinder") && (
          <Field label={config.producto === "ri" ? "Descargas al mes" : "Consultas al mes"}>
            <Select value={config.tramo} onChange={(event) => onChange({ ...config, tramo: Number(event.target.value), precioManual: null })}>
              {opcionesTramo(TRAMOS[config.producto], config.producto === "ri" ? "descargas" : "consultas")}
            </Select>
          </Field>
        )}
        {config.producto === "bolsa" && (
          <Field label="Descargas en 12 meses">
            <Select value={config.tramo} onChange={(event) => onChange({ ...config, tramo: Number(event.target.value), precioManual: null })}>
              {opcionesTramo(TRAMOS.bolsa, "descargas")}
            </Select>
          </Field>
        )}
        {config.producto === "pfm" && (
          <>
            <Field label="Frecuencia">
              <Select value={config.frecuencia} onChange={(event) => onChange({ ...config, frecuencia: event.target.value as "s" | "q" | "m", precioManual: null })}>
                {Object.entries(FRECUENCIA_ETIQUETA).map(([clave, etiqueta]) => <option key={clave} value={clave}>{etiqueta}</option>)}
              </Select>
            </Field>
            <Field label="RUTs a monitorear">
              <Input type="number" min={1} max={5000} value={config.ruts} onChange={(event) => onChange({ ...config, ruts: Math.max(1, Math.min(5000, Number(event.target.value) || 1)), precioManual: null })} />
            </Field>
          </>
        )}
        {config.producto === "pc" && (
          <Field label="Tamaño de la empresa">
            <Select value={config.tamano} onChange={(event) => onChange({ ...config, tamano: event.target.value as "micro" | "pequena" | "mediana", precioManual: null })}>
              {TAMANOS_PARTNER_CHECK.map((tamano) => <option key={tamano.clave} value={tamano.clave}>{tamano.etiqueta} · {tamano.uf} UF al año</option>)}
            </Select>
          </Field>
        )}
        {config.producto === "bdd" && (
          <>
            <Field label="Universo">
              <Select value={config.universo} onChange={(event) => onChange({ ...config, universo: event.target.value as "personas" | "empresas" })}>
                <option value="empresas">Empresas</option>
                <option value="personas">Personas</option>
              </Select>
            </Field>
            <Field label="Cantidad de RUT">
              <Input type="number" min={100} step={100} value={config.registros} onChange={(event) => onChange({ ...config, registros: Math.max(1, Number(event.target.value) || 1) })} />
            </Field>
            <Field label="Valor BackOffice (UF, opcional)">
              <CampoDecimal valor={config.ufBackoffice} onValor={(ufBackoffice) => onChange({ ...config, ufBackoffice })} placeholder="Por evaluar" />
            </Field>
          </>
        )}
        {tieneDoa && "doa" in config && (
          <Field label="Descuento DOA">
            <Select value={config.doa} onChange={(event) => onChange({ ...config, doa: Number(event.target.value), precioManual: null } as ConfigLinea)}>
              {def.doa.map((doa) => <option key={doa} value={doa}>{DOA_ETIQUETA[doa]}</option>)}
            </Select>
          </Field>
        )}
        {admiteManual && (
          <Field label="Precio ofrecido (UF, opcional)">
            <CampoDecimal
              valor={"precioManual" in config ? config.precioManual ?? null : null}
              onValor={(precioManual) => onChange({ ...config, precioManual } as ConfigLinea)}
              placeholder={cotizada.ufVenta != null ? formatoUf(cotizada.ufVenta) : ""}
            />
          </Field>
        )}
      </div>

      {config.producto === "pub" && (
        <EditorPublicacion config={config} onChange={onChange} />
      )}

      <PrecioLinea cotizada={cotizada} valorUf={valorUf} />
    </div>
  );
}

/**
 * Número con decimales escrito a la chilena ("2,5"). Guarda el texto aparte
 * para que la coma no desaparezca mientras se escribe; se vacía cuando la
 * configuración lo reinicia (cambiar de tramo borra el precio a mano).
 */
function CampoDecimal({ valor, onValor, placeholder }: { valor: number | null; onValor: (valor: number | null) => void; placeholder?: string }) {
  const [texto, setTexto] = useState(valor == null ? "" : String(valor).replace(".", ","));
  const [previo, setPrevio] = useState(valor);
  if (valor !== previo) {
    setPrevio(valor);
    if (valor == null) setTexto("");
  }
  return (
    <Input
      inputMode="decimal"
      value={texto}
      placeholder={placeholder}
      onChange={(event) => {
        setTexto(event.target.value);
        const convertido = numero(event.target.value);
        onValor(event.target.value.trim() && Number.isFinite(convertido) ? convertido : null);
      }}
    />
  );
}

function EditorPublicacion({ config, onChange }: { config: Extract<ConfigLinea, { producto: "pub" }>; onChange: (config: ConfigLinea) => void }) {
  const cambiarDocumento = (indice: number, campo: "monto" | "abonos", valor: string) =>
    onChange({ ...config, documentos: config.documentos.map((doc, i) => (i === indice ? { ...doc, [campo]: valor ? numero(valor) : 0 } : doc)) });
  return (
    <div className="mt-3 space-y-2">
      <Field label="% a cobrar sobre lo publicado (neto)" className="w-56">
        <CampoDecimal valor={config.pct} onValor={(pct) => onChange({ ...config, pct: pct ?? 15 })} placeholder="15" />
      </Field>
      {config.documentos.map((doc, indice) => (
        <div key={indice} className="flex flex-wrap items-end gap-3">
          <Field label={`Documento ${indice + 1}: monto total ($)`} className="w-48">
            <Input inputMode="numeric" value={doc.monto ? doc.monto.toLocaleString("es-CL") : ""} onChange={(event) => cambiarDocumento(indice, "monto", event.target.value)} placeholder="1.200.000" />
          </Field>
          <Field label="Abonos ($)" className="w-40">
            <Input inputMode="numeric" value={doc.abonos ? doc.abonos.toLocaleString("es-CL") : ""} onChange={(event) => cambiarDocumento(indice, "abonos", event.target.value)} placeholder="0" />
          </Field>
          {config.documentos.length > 1 && (
            <button type="button" onClick={() => onChange({ ...config, documentos: config.documentos.filter((_, i) => i !== indice) })} aria-label={`Quitar documento ${indice + 1}`} className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {config.documentos.length < 12 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...config, documentos: [...config.documentos, { monto: 0, abonos: 0 }] })}>
          <Plus size={13} aria-hidden="true" /> Otro documento
        </Button>
      )}
    </div>
  );
}

function PrecioLinea({ cotizada, valorUf }: { cotizada: LineaCotizada; valorUf: number | null }) {
  if (cotizada.publicacion) {
    const pub = cotizada.publicacion;
    return (
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">A publicar {formatoPesos(pub.publicar)}</span>
        <span className="text-muted-foreground">Neto {formatoPesos(pub.neto)} + IVA {formatoPesos(pub.iva)}</span>
        <span className="ml-auto text-base font-bold text-foreground">Total {formatoPesos(pub.total)}</span>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{etiquetaCobro(cotizada)}</span>
      {cotizada.descuento > 0 && cotizada.ufLista != null && (
        <span className="text-muted-foreground"><s>{formatoUf(cotizada.ufLista)} UF</s> −{cotizada.descuento}%</span>
      )}
      {cotizada.ufVenta != null ? (
        <span className="ml-auto text-right">
          <span className="text-base font-bold text-foreground">{formatoUf(cotizada.ufVenta)} UF + IVA</span>
          {valorUf && <span className="block text-xs text-muted-foreground">≈ {formatoPesos(cotizada.ufVenta * valorUf)} + IVA</span>}
        </span>
      ) : (
        <span className="ml-auto text-muted-foreground">{cotizada.nota}</span>
      )}
      {cotizada.descuentoFueraDeDoa && (
        <p className="w-full text-xs text-warning">
          {definicion(cotizada.producto).doa.length
            ? `El descuento supera el máximo DOA de este producto (${Math.max(...definicion(cotizada.producto).doa)}%): confirma la autorización antes de enviar.`
            : "Este producto no tiene descuento DOA: confirma la autorización antes de enviar."}
        </p>
      )}
      {cotizada.nota && cotizada.ufVenta != null && <p className="w-full text-xs text-muted-foreground">{cotizada.nota}</p>}
    </div>
  );
}

function FirmaComercial({
  contexto,
  abierta,
  onGuardada,
}: {
  contexto: ContextoCotizador;
  abierta: boolean;
  onGuardada: (firma: ContextoCotizador["firma"]) => void;
}) {
  const [editando, setEditando] = useState(abierta);
  const [cargo, setCargo] = useState(contexto.firma.cargo ?? "Ejecutivo Comercial");
  const [whatsapp, setWhatsapp] = useState(contexto.firma.whatsapp ?? "");
  const [correo, setCorreo] = useState(contexto.firma.correo ?? "");
  const [frase, setFrase] = useState(contexto.firma.firma ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firma = firmaDesdePerfil(contexto.firma);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const respuesta = await guardarMiFirma({ cargo, whatsapp, correo, firma: frase });
    setGuardando(false);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    onGuardada(respuesta.data);
    setEditando(false);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <UserRound size={15} className="text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">Tu firma</h3>
        {!editando && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(true)} className="ml-auto">Editar</Button>
        )}
      </div>
      {!editando ? (
        <p className="text-sm text-muted-foreground">
          {firma.nombre} · {firma.cargo} · Equifax Chile
          {firma.whatsapp ? ` · ${firma.whatsapp}` : ""}
          {firma.correo ? ` · ${firma.correo}` : ""}
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-background p-4">
          {abierta && <p className="text-xs text-muted-foreground">Completa tu firma una vez: queda guardada para todas tus propuestas.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cargo">
              <Select value={cargo} onChange={(event) => setCargo(event.target.value)}>
                <option>Ejecutivo Comercial</option>
                <option>Ejecutiva Comercial</option>
              </Select>
            </Field>
            <Field label="Tu WhatsApp">
              <Input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} inputMode="tel" placeholder="+56 9 1234 5678" />
            </Field>
            <Field label="Correo en la firma">
              <Input type="email" value={correo} onChange={(event) => setCorreo(event.target.value)} placeholder={contexto.firma.correoAcceso} />
            </Field>
            <Field label="Frase (opcional)">
              <Input value={frase} onChange={(event) => setFrase(event.target.value)} placeholder="Tu aliado en gestión de riesgo" maxLength={160} />
            </Field>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            {!abierta && <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(false)}>Cancelar</Button>}
            <Button type="button" variant="secondary" size="sm" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar firma"}</Button>
          </div>
        </div>
      )}
    </section>
  );
}

const ESTADO_ENVIO: Record<CotizacionEnviada["estado"], string> = {
  enviando: "Enviando",
  enviada: "Enviada",
  fallida: "No salió",
  whatsapp_abierto: "WhatsApp",
};

function Historial({ filas }: { filas: CotizacionEnviada[] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Propuestas anteriores a este cliente</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {filas.map((fila) => {
          const montos = [
            fila.uf_mensual > 0 ? `${formatoUf(fila.uf_mensual)} UF/mes` : null,
            fila.uf_unico > 0 ? `${formatoUf(fila.uf_unico)} UF único` : null,
            fila.uf_anual > 0 ? `${formatoUf(fila.uf_anual)} UF/año` : null,
            fila.clp_total > 0 ? formatoPesos(fila.clp_total) : null,
          ].filter(Boolean).join(" · ");
          return (
            <li key={fila.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="text-foreground">{fila.productos.join(", ")}</span>
              <span className="text-muted-foreground">{montos}</span>
              <span className={`ml-auto text-xs ${fila.estado === "fallida" ? "text-danger" : "text-muted-foreground"}`}>
                {ESTADO_ENVIO[fila.estado]} · {fila.destinatario} · {fechaHora(fila.created_at)}{fila.agente ? ` · ${fila.agente}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
