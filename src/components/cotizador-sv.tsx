"use client";

import { useState } from "react";
import { Calculator, CheckCircle2, Eye, Mail, MessageCircle } from "lucide-react";

import {
  cargarCotizadorSv,
  enviarCotizacionSvPorCorreo,
  registrarCotizacionSvWhatsapp,
  type ContextoCotizadorSv,
  type CotizacionSv,
} from "@/app/actions/cotizador-sv";
import { FirmaComercial } from "@/components/cotizador-equifax";
import { Button, Callout, Field, Input, SlideOver } from "@/components/ui";
import { formatoPesos, formatoUf } from "@/lib/equifax-cotizador/catalogo";
import { firmaDesdePerfil } from "@/lib/equifax-cotizador/propuesta";
import { celularChileno, enlaceWhatsapp } from "@/lib/prospeccion";
import { PLAN_BASE, PLAZOS, PLAZO_MINIMO, resumenPropuesta, simular, type PlazoMeses } from "@/lib/sv-cotizador/plan";
import { EMPRESA_SV, correoHtmlSv, mensajeWhatsappSv, type DatosPropuestaSv } from "@/lib/sv-cotizador/propuesta";
import { cn } from "@/lib/utils";

/** Lo que la propuesta deja en la tipificación: el motivo y la observación. */
export type ResultadoCotizacionSv = {
  canal: "correo" | "whatsapp";
  destinatario: string;
  folio: string;
  resumen: string;
};

function numero(valor: string): number {
  // Tolera "39.485,65", "39485.65" y "$ 39.485".
  const limpio = valor.replace(/[^\d,.-]/g, "");
  const normalizado = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/\.(?=\d{3}(\D|$))/g, "");
  return Number(normalizado);
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" });

const fallaDeRed = (): { ok: false; error: string } => ({
  ok: false,
  error: "No se pudo contactar al servidor. Recarga la página (Ctrl + F5) e inténtalo de nuevo; la propuesta no salió.",
});

/**
 * Cotizador de Secretaria Virtual: el Plan Base del documento comercial (2 UF
 * + IVA, lunes a viernes, 42 horas semanales), simulado en pesos con la UF
 * del día y por plazo, con las condiciones particulares que la ejecutiva ya
 * conversó. Sale por correo desde el buzón de la empresa o por WhatsApp.
 */
export function CotizadorSecretariaVirtual({
  leadId,
  callId,
  cliente,
  onEnviada,
}: {
  leadId: string;
  /** La gestión abierta; sin ella la propuesta queda ligada solo al registro. */
  callId: string | null;
  cliente: { empresa: string | null; rut: string | null; contacto: string | null; correo: string | null; telefono: string | null };
  onEnviada?: (resultado: ResultadoCotizacionSv) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [contexto, setContexto] = useState<ContextoCotizadorSv | null>(null);
  const [cargando, setCargando] = useState(false);
  const [meses, setMeses] = useState<PlazoMeses>(PLAZO_MINIMO);
  const [valorUf, setValorUf] = useState("");
  const [llamadas, setLlamadas] = useState("");
  const [horario, setHorario] = useState("");
  const [excedente, setExcedente] = useState("");
  const [contacto, setContacto] = useState(cliente.contacto ?? "");
  const [correo, setCorreo] = useState(cliente.correo ?? "");
  const [celular, setCelular] = useState(celularChileno(cliente.telefono) ? cliente.telefono ?? "" : "");
  const [vistaPrevia, setVistaPrevia] = useState(false);
  const [enviando, setEnviando] = useState<"correo" | "whatsapp" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState<ResultadoCotizacionSv | null>(null);

  async function abrir() {
    setError(null);
    setAbierto(true);
    if (contexto || cargando) return;
    setCargando(true);
    const respuesta = await cargarCotizadorSv(leadId).catch(fallaDeRed);
    setCargando(false);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    setContexto(respuesta.data);
    if (respuesta.data.uf) setValorUf(String(respuesta.data.uf.valor));
  }

  const uf = numero(valorUf);
  const ufValida = Number.isFinite(uf) && uf >= 30000 && uf <= 60000;
  const sim = simular(meses, ufValida ? uf : null);
  const firma = contexto ? firmaDesdePerfil(contexto.firma) : null;
  const firmaIncompleta = Boolean(contexto && (!contexto.firma.cargo || !contexto.firma.whatsapp));
  const celularValido = celularChileno(celular);
  const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());
  const llamadasNumero = llamadas.trim() ? Math.round(numero(llamadas)) : null;
  const llamadasValidas = llamadasNumero === null || (Number.isFinite(llamadasNumero) && llamadasNumero > 0);
  const listo = Boolean(contexto) && ufValida && llamadasValidas;
  const condiciones = {
    llamadas: llamadasValidas ? llamadasNumero : null,
    horario: horario.trim() || null,
    excedente: excedente.trim() || null,
  };

  const datos = (folio: string | null): DatosPropuestaSv | null =>
    firma && ufValida
      ? {
          cliente: { empresa: cliente.empresa, rut: cliente.rut, contacto: contacto.trim() || null, correo: correo.trim() || cliente.correo, telefono: cliente.telefono },
          ejecutivo: firma,
          meses,
          valorUf: uf,
          condiciones,
          fecha: new Date(),
          folio,
          correoRespuesta: contexto?.buzon ?? null,
        }
      : null;

  const entrada = () => ({
    leadId,
    callId,
    meses,
    valorUf: uf,
    condiciones,
    contacto: contacto.trim() || null,
    correoCliente: correoValido ? correo.trim().toLowerCase() : null,
    telefonoCliente: cliente.telefono,
  });

  function terminar(canal: "correo" | "whatsapp", destinatario: string, folio: string) {
    const resultado: ResultadoCotizacionSv = { canal, destinatario, folio, resumen: resumenPropuesta(meses) };
    setEnviada(resultado);
    onEnviada?.(resultado);
    setContexto(null); // recarga el historial la próxima vez que se abra
    setAbierto(false);
  }

  async function enviarCorreo() {
    if (!listo || !correoValido || enviando) return;
    setEnviando("correo");
    setError(null);
    const respuesta = await enviarCotizacionSvPorCorreo({ ...entrada(), para: correo }).catch(fallaDeRed);
    setEnviando(null);
    if (!respuesta.ok) {
      setError(respuesta.error);
      return;
    }
    terminar("correo", correo.trim().toLowerCase(), respuesta.data.folio);
  }

  async function abrirWhatsapp() {
    if (!listo || !celularValido || enviando) return;
    // La ventana se abre en el mismo clic (si no, el navegador la bloquea) y
    // recibe el mensaje cuando el registro devuelve el N.º de propuesta.
    const ventana = window.open("", "_blank");
    if (ventana) ventana.opener = null;
    setEnviando("whatsapp");
    setError(null);
    const respuesta = await registrarCotizacionSvWhatsapp({ ...entrada(), celular: celularValido }).catch(fallaDeRed);
    setEnviando(null);
    if (!respuesta.ok) {
      ventana?.close();
      setError(respuesta.error);
      return;
    }
    const mensaje = datos(respuesta.data.folio);
    const enlace = mensaje ? enlaceWhatsapp(celularValido, mensajeWhatsappSv(mensaje)) : null;
    if (enlace) {
      if (ventana) ventana.location.href = enlace;
      else window.open(enlace, "_blank", "noopener,noreferrer");
    }
    terminar("whatsapp", `+${celularValido}`, respuesta.data.folio);
  }

  const vista = datos(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <span className="icon-chip size-8 shrink-0 rounded-lg" data-tone="green" aria-hidden="true">
          {enviada ? <CheckCircle2 size={17} /> : <Calculator size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{enviada ? `Propuesta N.º ${enviada.folio} enviada` : "Cotizador Secretaria Virtual"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {enviada
              ? `${enviada.canal === "correo" ? "Por correo a" : "WhatsApp abierto para"} ${enviada.destinatario} · ${enviada.resumen}.${onEnviada ? " La tipificación quedó en Cotización Enviada." : " Quedó en el historial del registro."}`
              : `Simula el ${PLAN_BASE.nombre} en pesos y por plazo, y envía la propuesta sin salir de la ficha.`}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={abrir}>
          <Calculator size={14} aria-hidden="true" /> {enviada ? "Cotizar de nuevo" : "Cotizar"}
        </Button>
      </div>

      {/* La tipificación cierra la gestión con Ctrl/⌘ + Enter: dentro del cotizador ese atajo no debe llegar hasta ella. */}
      <div onKeyDown={(event) => event.stopPropagation()}>
        <SlideOver
          open={abierto}
          onClose={() => setAbierto(false)}
          width="lg"
          title="Cotizador Secretaria Virtual"
          description={[cliente.empresa, cliente.rut ? `RUT ${cliente.rut}` : null].filter(Boolean).join(" · ") || undefined}
          footer={
            <>
              {error && contexto && <p role="alert" className="mr-auto min-w-0 flex-1 text-xs font-medium text-danger">{error}</p>}
              <Button type="button" variant="secondary" onClick={abrirWhatsapp} disabled={!listo || !celularValido || enviando !== null} title={celularValido ? undefined : "Escribe un celular chileno"}>
                <MessageCircle size={15} aria-hidden="true" /> {enviando === "whatsapp" ? "Registrando…" : "Abrir WhatsApp"}
              </Button>
              <Button type="button" onClick={enviarCorreo} disabled={!listo || !correoValido || !contexto?.buzon || enviando !== null}>
                <Mail size={15} aria-hidden="true" /> {enviando === "correo" ? "Enviando…" : "Enviar por correo"}
              </Button>
            </>
          }
        >
          {cargando && !contexto && <p className="text-sm text-muted-foreground">Cargando la UF del día y tu firma…</p>}

          {contexto && (
            <div className="space-y-6">
              {error && <Callout tone="danger">{error}</Callout>}

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{PLAN_BASE.nombre}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {PLAN_BASE.dias} · {PLAN_BASE.horasSemanales} horas semanales · ejecutiva {PLAN_BASE.modalidad.toLowerCase()}
                    </p>
                  </div>
                  <Field label={contexto.uf ? "UF del día" : "UF del día (escríbela: no se pudo consultar)"} className="w-44">
                    <Input value={valorUf} onChange={(event) => setValorUf(event.target.value)} inputMode="decimal" aria-invalid={!ufValida} placeholder="39.485,65" />
                  </Field>
                </div>

                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Plazo del contrato</legend>
                  <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                    {PLAZOS.map((plazo) => {
                      const activo = plazo.meses === meses;
                      return (
                        <button
                          key={plazo.meses}
                          type="button"
                          role="radio"
                          aria-checked={activo}
                          onClick={() => setMeses(plazo.meses)}
                          className={cn(
                            "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            activo ? "border-primary bg-primary/[0.06] font-semibold text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {plazo.etiqueta}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="rounded-xl border border-border bg-background p-4">
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <Cifra etiqueta="Valor mensual" uf={sim.ufNeto} pesos={sim.pesos?.neto} sufijo="+ IVA" />
                    <Cifra etiqueta={`IVA (19 %)`} uf={sim.ufIva} pesos={sim.pesos?.iva} />
                    <Cifra etiqueta="Mensual con IVA" uf={sim.ufTotal} pesos={sim.pesos?.total} />
                    <Cifra etiqueta={`Total ${meses} meses con IVA`} uf={sim.ufTotalPeriodo} pesos={sim.pesos?.totalPeriodo} />
                  </dl>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">Lo que lee el cliente</span>
                    <span className="text-right">
                      <span className="text-base font-semibold text-foreground">{formatoUf(sim.ufNeto)} UF + IVA mensual</span>
                      {sim.pesos && <span className="block text-xs text-muted-foreground">≈ {formatoPesos(sim.pesos.neto)} + IVA · {meses} meses: {formatoUf(sim.ufNetoPeriodo)} UF + IVA</span>}
                    </span>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Condiciones particulares <span className="font-normal text-muted-foreground">(opcional)</span></h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Complétalas si ya las conversaste; si quedan vacías, la propuesta dice que se acuerdan al contratar.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Llamadas incluidas al mes">
                    <Input value={llamadas} onChange={(event) => setLlamadas(event.target.value)} inputMode="numeric" placeholder="Ej.: 300" aria-invalid={!llamadasValidas} />
                  </Field>
                  <Field label="Distribución horaria">
                    <Input value={horario} onChange={(event) => setHorario(event.target.value)} placeholder="Ej.: 09:00 a 18:00" maxLength={160} />
                  </Field>
                  <Field label="Excedentes">
                    <Input value={excedente} onChange={(event) => setExcedente(event.target.value)} placeholder="Ej.: 0,02 UF por llamada adicional" maxLength={160} />
                  </Field>
                </div>
                {!llamadasValidas && <p className="text-xs text-danger">Las llamadas incluidas van en número entero.</p>}
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
                  <p className="text-xs text-muted-foreground">El correo sale desde {contexto.buzon} con tu nombre y firma; la respuesta del cliente vuelve a ese buzón y queda en este registro.</p>
                ) : (
                  <Callout tone="warning">Esta campaña todavía no tiene un buzón para enviar correos. Puedes mandar la propuesta por WhatsApp; para el correo, un administrador debe conectarlo en Configuración › Correo de envío.</Callout>
                )}
              </section>

              <FirmaComercial contexto={contexto} abierta={firmaIncompleta} empresa={EMPRESA_SV} onGuardada={(firmaNueva) => setContexto({ ...contexto, firma: firmaNueva })} />

              <section className="space-y-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setVistaPrevia((valor) => !valor)} disabled={!vista}>
                  <Eye size={14} aria-hidden="true" /> {vistaPrevia ? "Ocultar vista previa" : "Ver cómo le llega el correo"}
                </Button>
                {vistaPrevia && vista && (
                  <iframe title="Vista previa del correo" srcDoc={correoHtmlSv(vista)} sandbox="" className="h-[640px] w-full rounded-lg border border-border bg-white" />
                )}
                {vistaPrevia && <p className="text-xs text-muted-foreground">El N.º de propuesta se asigna al enviarla.</p>}
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

function Cifra({ etiqueta, uf, pesos, sufijo }: { etiqueta: string; uf: number; pesos?: number; sufijo?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="text-right tabular-nums">
        <span className="font-semibold text-foreground">{formatoUf(uf)} UF{sufijo ? ` ${sufijo}` : ""}</span>
        {pesos != null && <span className="block text-xs text-muted-foreground">{formatoPesos(pesos)}</span>}
      </dd>
    </div>
  );
}

const ESTADO_ENVIO: Record<CotizacionSv["estado"], string> = {
  enviando: "Enviando",
  enviada: "Enviada",
  fallida: "No salió",
  whatsapp_abierto: "WhatsApp",
};

function Historial({ filas }: { filas: CotizacionSv[] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Propuestas anteriores a este cliente</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {filas.map((fila) => (
          <li key={fila.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">N.º {fila.folio}</span>
            <span className="text-muted-foreground">{formatoUf(fila.uf_mensual)} UF + IVA mensual · {fila.plazo_meses} meses</span>
            <span className={`ml-auto text-xs ${fila.estado === "fallida" ? "text-danger" : "text-muted-foreground"}`}>
              {fila.respondida_at ? `Respondida ${fechaHora(fila.respondida_at)}` : ESTADO_ENVIO[fila.estado]} · {fila.destinatario} · {fechaHora(fila.created_at)}{fila.agente ? ` · ${fila.agente}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
