"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeft, CalendarCheck2, CalendarPlus, Check, Clock, Loader2, Search, UserRound } from "lucide-react";

import { diasConHoras, horasLibres, reservar } from "@/app/reservar/acciones";
import {
  agruparHoras,
  archivoCalendario,
  celularValido,
  serviciosPorCategoria,
  type HoraLibre,
  type ProfesionalPublico,
  type ReservaHecha,
  type ReservaPublica,
  type ServicioPublico,
} from "@/lib/reserva";

const ZONA = "America/Santiago";
const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short" });
const numeroDia = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric" });
const mesCorto = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", month: "short" });
const fechaLarga = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, weekday: "long", day: "numeric", month: "long" });
const horaCorta = new Intl.DateTimeFormat("es-CL", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

type Paso = "servicio" | "profesional" | "hora" | "datos";

const ESPECIES = ["Perro", "Gato", "Conejo", "Ave", "Otro"];

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function duracionLegible(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

/** Botón grande de opción: toda la fila se toca (≥ 44 px). */
function Opcion({ activo, onClick, children, etiqueta }: { activo?: boolean; onClick: () => void; children: React.ReactNode; etiqueta?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      aria-label={etiqueta}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        activo ? "border-primary bg-primary/5" : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      {children}
    </button>
  );
}

export function AsistenteDeReserva({ slug, datos, embebido }: { slug: string; datos: ReservaPublica; embebido: boolean }) {
  const esVet = datos.edicion === "vet";
  const esBarber = datos.edicion === "barber";
  const pasos: Paso[] = datos.profesionales.length > 1 ? ["servicio", "profesional", "hora", "datos"] : ["servicio", "hora", "datos"];
  const [paso, setPaso] = useState<Paso>("servicio");
  const [servicio, setServicio] = useState<ServicioPublico | null>(null);
  const [profesional, setProfesional] = useState<ProfesionalPublico | null>(datos.profesionales.length === 1 ? datos.profesionales[0] : null);
  const [busqueda, setBusqueda] = useState("");
  // Cada respuesta se guarda con la consulta que la pidió: si la persona
  // cambió de servicio o de día mientras tanto, la respuesta vieja no se muestra.
  const [respuestaDias, setRespuestaDias] = useState<{ clave: string; lista: string[] } | null>(null);
  const [diaElegido, setDia] = useState<string | null>(null);
  const [respuestaHoras, setRespuestaHoras] = useState<{ clave: string; lista: HoraLibre[] } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [hora, setHora] = useState<HoraLibre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hecha, setHecha] = useState<ReservaHecha | null>(null);
  const [cargando, iniciar] = useTransition();
  const [telefono, setTelefono] = useState("");
  const [telefonoTocado, setTelefonoTocado] = useState(false);

  const indice = pasos.indexOf(paso);

  const grupos = useMemo(() => {
    const termino = busqueda.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const lista = termino
      ? datos.servicios.filter((item) => `${item.nombre} ${item.categoria ?? ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(termino))
      : datos.servicios;
    return serviciosPorCategoria(lista);
  }, [busqueda, datos.servicios]);

  const claveDias = paso === "hora" && servicio ? `${servicio.id}:${profesional?.id ?? "*"}` : null;
  const dias = claveDias && respuestaDias?.clave === claveDias ? respuestaDias.lista : null;
  const dia = dias ? (diaElegido && dias.includes(diaElegido) ? diaElegido : dias[0] ?? null) : null;
  const claveHoras = claveDias && dia ? `${claveDias}:${dia}:${recarga}` : null;
  const horas = claveHoras && respuestaHoras?.clave === claveHoras ? respuestaHoras.lista : null;

  // Al llegar a «Día y hora», se piden los días con horas libres.
  useEffect(() => {
    if (!claveDias || !servicio) return;
    let vigente = true;
    diasConHoras(slug, servicio.id, profesional?.id ?? null).then((lista) => {
      if (vigente) setRespuestaDias({ clave: claveDias, lista });
    });
    return () => {
      vigente = false;
    };
  }, [claveDias, servicio, profesional, slug]);

  useEffect(() => {
    if (!claveHoras || !servicio || !dia) return;
    let vigente = true;
    horasLibres(slug, servicio.id, profesional?.id ?? null, dia).then((lista) => {
      if (vigente) setRespuestaHoras({ clave: claveHoras, lista });
    });
    return () => {
      vigente = false;
    };
  }, [claveHoras, servicio, profesional, dia, slug]);

  function ir(destino: Paso) {
    setError(null);
    setPaso(destino);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function volver() {
    if (indice > 0) ir(pasos[indice - 1]);
  }

  function enviar(formulario: FormData) {
    if (!servicio || !hora) return;
    setError(null);
    iniciar(async () => {
      const resultado = await reservar({
        slug,
        servicio: servicio.id,
        profesional: hora.profesional_id,
        inicio: hora.inicio,
        nombre: String(formulario.get("nombre") ?? ""),
        telefono: String(formulario.get("telefono") ?? ""),
        correo: String(formulario.get("correo") ?? ""),
        mascota: String(formulario.get("mascota") ?? ""),
        especie: String(formulario.get("especie") ?? ""),
        nota: String(formulario.get("nota") ?? ""),
        sitio: String(formulario.get("sitio") ?? ""),
      });
      if (resultado.ok) {
        setHecha(resultado.reserva);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setError(resultado.error);
      if (resultado.horaOcupada) {
        setHora(null);
        setPaso("hora");
        setRecarga((valor) => valor + 1);
      }
    });
  }

  const profesionalDeHora = hora ? datos.profesionales.find((item) => item.id === hora.profesional_id) ?? profesional : profesional;

  if (hecha) {
    const enlace = `${typeof window !== "undefined" ? window.location.origin : ""}/reservar/cita/${hecha.token}`;
    const ics = archivoCalendario({ inicio: hecha.inicio, minutos: servicio?.duracion ?? 30, titulo: `${hecha.servicio} · ${hecha.empresa}`, lugar: hecha.empresa, enlace });
    return (
      <section className="space-y-5 text-center" aria-live="polite">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-bg text-success">
          <CalendarCheck2 size={28} aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">¡Listo, tu hora quedó reservada!</h2>
          <p className="text-sm text-muted-foreground">Te llegará un mensaje con estos datos. Antes de la cita te pediremos confirmarla.</p>
        </div>
        <dl className="space-y-2 rounded-xl border border-border bg-surface p-4 text-left text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Cuándo</dt><dd className="text-right font-medium">{capitalizar(fechaLarga.format(new Date(hecha.inicio)))}, {horaCorta.format(new Date(hecha.inicio))}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Servicio</dt><dd className="text-right font-medium">{hecha.servicio}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Con</dt><dd className="text-right font-medium">{hecha.profesional}</dd></div>
        </dl>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}
            download="mi-hora.ics"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <CalendarPlus size={16} aria-hidden="true" /> Guardar en mi calendario
          </a>
          <a href={`/reservar/cita/${hecha.token}`} className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
            Ver o cancelar mi hora
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {/* Progreso: dónde estoy y cuánto falta. */}
      <ol className="flex items-center gap-2" aria-label="Pasos de la reserva">
        {pasos.map((nombre, posicion) => (
          <li key={nombre} className="flex flex-1 flex-col gap-1">
            <span className={`h-1.5 rounded-full ${posicion <= indice ? "bg-primary" : "bg-border"}`} aria-hidden="true" />
            <span className={`text-[11px] ${posicion === indice ? "font-medium text-foreground" : "text-muted-foreground"}`} aria-current={posicion === indice ? "step" : undefined}>
              {{ servicio: "Servicio", profesional: esBarber ? "Barbero" : "Con quién", hora: "Día y hora", datos: "Tus datos" }[nombre]}
            </span>
          </li>
        ))}
      </ol>

      {indice > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={volver} className="inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} aria-hidden="true" /> Volver
          </button>
          {paso !== "datos" && <span className="truncate text-muted-foreground">{servicio?.nombre}</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {paso === "servicio" && (
        <section className="space-y-4" aria-labelledby="titulo-servicio">
          <h2 id="titulo-servicio" className="text-lg font-semibold tracking-tight">¿Qué necesitas?</h2>
          {datos.servicios.length > 8 && (
            <label className="relative block">
              <span className="sr-only">Buscar servicio</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder={esVet ? "Consulta, vacuna, ecografía…" : esBarber ? "Corte, barba, fade…" : "Limpieza, evaluación, blanqueamiento…"}
                className="h-11 w-full rounded-xl border border-border-strong/70 bg-surface pl-9 pr-3 text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>
          )}
          {grupos.length === 0 && <p className="text-sm text-muted-foreground">No encontramos «{busqueda}». Prueba con otra palabra.</p>}
          {grupos.map((grupo) => (
            <div key={grupo.categoria} className="space-y-2">
              {grupos.length > 1 && <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo.categoria}</h3>}
              <div className="space-y-2">
                {grupo.servicios.map((item) => (
                  <Opcion
                    key={item.id}
                    activo={servicio?.id === item.id}
                    onClick={() => {
                      setServicio(item);
                      setHora(null);
                      ir(pasos[1]);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">{item.nombre}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={12} aria-hidden="true" /> {duracionLegible(item.duracion)}
                      </span>
                    </span>
                    {item.precio ? <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">{pesos.format(item.precio)}</span> : null}
                  </Opcion>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {paso === "profesional" && (
        <section className="space-y-3" aria-labelledby="titulo-profesional">
          <h2 id="titulo-profesional" className="text-lg font-semibold tracking-tight">¿Con quién?</h2>
          <Opcion
            activo={profesional === null}
            onClick={() => {
              setProfesional(null);
              setHora(null);
              ir("hora");
            }}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground"><UserRound size={18} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">Cualquiera disponible</span>
              <span className="block text-xs text-muted-foreground">Te mostramos la primera hora libre de todo el equipo</span>
            </span>
          </Opcion>
          {datos.profesionales.map((item) => (
            <Opcion
              key={item.id}
              activo={profesional?.id === item.id}
              onClick={() => {
                setProfesional(item);
                setHora(null);
                ir("hora");
              }}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: item.color }} aria-hidden="true">
                {item.nombre.replace(/^Dra?\.\s*/i, "").split(" ").slice(0, 2).map((parte) => parte[0]).join("").toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{item.nombre}</span>
                {item.especialidad && <span className="block text-xs text-muted-foreground">{item.especialidad}</span>}
              </span>
            </Opcion>
          ))}
        </section>
      )}

      {paso === "hora" && (
        <section className="space-y-4" aria-labelledby="titulo-hora">
          <h2 id="titulo-hora" className="text-lg font-semibold tracking-tight">Elige el día y la hora</h2>
          {dias === null ? (
            <div className="flex gap-2" aria-busy="true" aria-label="Buscando días disponibles">
              {Array.from({ length: 5 }).map((_, posicion) => <span key={posicion} className="h-16 w-14 animate-pulse rounded-xl bg-surface-muted" />)}
            </div>
          ) : dias.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted-foreground">
              No quedan horas en las próximas dos semanas{profesional ? ` con ${profesional.nombre}` : ""}. {profesional ? "Prueba con otra persona del equipo o " : ""}escríbenos para buscarte un espacio.
            </p>
          ) : (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Días con horas libres">
              {dias.map((fecha) => {
                const instante = new Date(`${fecha}T12:00:00Z`);
                const activo = fecha === dia;
                return (
                  <button
                    key={fecha}
                    type="button"
                    role="option"
                    aria-selected={activo}
                    onClick={() => {
                      setDia(fecha);
                      setHora(null);
                    }}
                    className={`flex min-h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl border text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      activo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:border-border-strong"
                    }`}
                  >
                    <span className={activo ? "" : "text-muted-foreground"}>{diaCorto.format(instante).replace(".", "")}</span>
                    <span className="text-lg font-semibold leading-tight">{numeroDia.format(instante)}</span>
                    <span className={activo ? "" : "text-muted-foreground"}>{mesCorto.format(instante).replace(".", "")}</span>
                  </button>
                );
              })}
            </div>
          )}

          {dia && dias && dias.length > 0 && (
            horas === null ? (
              <div className="grid grid-cols-4 gap-2" aria-busy="true" aria-label="Buscando horas">
                {Array.from({ length: 8 }).map((_, posicion) => <span key={posicion} className="h-11 animate-pulse rounded-lg bg-surface-muted" />)}
              </div>
            ) : horas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ese día se acaba de llenar. Elige otro.</p>
            ) : (
              agruparHoras(horas).map((grupo) => (
                <div key={grupo.titulo} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo.titulo}</h3>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {grupo.horas.map((item) => (
                      <button
                        key={item.inicio}
                        type="button"
                        onClick={() => {
                          setHora(item);
                          ir("datos");
                        }}
                        className={`min-h-11 rounded-lg border text-sm font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          hora?.inicio === item.inicio ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-foreground hover:border-primary"
                        }`}
                      >
                        {item.hora}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </section>
      )}

      {paso === "datos" && servicio && hora && (
        <section className="space-y-4" aria-labelledby="titulo-datos">
          <h2 id="titulo-datos" className="text-lg font-semibold tracking-tight">Tus datos</h2>
          <div className="rounded-xl border border-border bg-surface-muted/40 p-4 text-sm">
            <p className="font-medium text-foreground">{servicio.nombre}</p>
            <p className="text-muted-foreground">
              {capitalizar(fechaLarga.format(new Date(hora.inicio)))} a las {hora.hora}
              {profesionalDeHora ? ` · con ${profesionalDeHora.nombre}` : ""}
            </p>
          </div>
          <form action={enviar} className="space-y-4">
            {/* Trampa para robots: una persona no ve este campo. */}
            <input type="text" name="sitio" tabIndex={-1} autoComplete="off" className="absolute left-[-9999px] h-0 w-0 opacity-0" aria-hidden="true" />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{esVet ? "Tu nombre y apellido" : "Nombre y apellido"}</span>
              <input name="nombre" required minLength={3} maxLength={80} autoComplete="name" className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Celular (WhatsApp)</span>
              <input
                name="telefono"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="9 1234 5678"
                value={telefono}
                onChange={(evento) => setTelefono(evento.target.value)}
                onBlur={() => setTelefonoTocado(true)}
                aria-invalid={telefonoTocado && !celularValido(telefono) ? true : undefined}
                aria-describedby="ayuda-telefono"
                className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 aria-[invalid=true]:border-danger"
              />
              <span id="ayuda-telefono" className={`text-xs ${telefonoTocado && !celularValido(telefono) ? "text-danger" : "text-muted-foreground"}`}>
                {telefonoTocado && !celularValido(telefono) ? "Son 9 dígitos y empieza con 9." : "Por aquí te confirmamos la hora."}
              </span>
            </label>
            {esVet && (
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Nombre de tu mascota</span>
                  <input name="mascota" required maxLength={60} className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Especie</span>
                  <select name="especie" defaultValue="Perro" className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                    {ESPECIES.map((especie) => <option key={especie}>{especie}</option>)}
                  </select>
                </label>
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Correo <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <input name="correo" type="email" autoComplete="email" maxLength={120} className="h-11 rounded-lg border border-border-strong/70 bg-surface px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">¿Algo que debamos saber? <span className="font-normal text-muted-foreground">(opcional)</span></span>
              <textarea name="nota" rows={2} maxLength={300} className="rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
            </label>
            <button
              type="submit"
              disabled={cargando}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
            >
              {cargando ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
              {cargando ? "Reservando…" : `Reservar ${hora.hora}`}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Usamos tus datos solo para gestionar tu hora con {datos.empresa}.{embebido ? "" : " Puedes cancelarla desde el enlace que te llegará."}
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
