/**
 * El informe diario de marketing: un solo correo con todo lo que hace el
 * equipo de marketing con IA (Atlas Órbita) y lo que vuelve.
 *
 * Responde, en este orden, lo que quien dirige necesita saber cada mañana:
 * ¿se hizo lo que dijimos que se haría? (correo, grupos, Reels), ¿qué volvió?
 * (aperturas, clics, respuestas, reuniones, negocios), ¿qué decidió el
 * cerebro y qué alertas hay?, ¿cómo está el equipo?, ¿qué toca hoy? y, al
 * final, la revisión del circuito que antes era el informe completo.
 *
 * Puro a propósito: recibe los datos ya leídos y devuelve asunto y HTML, para
 * poder probarlo sin base ni red.
 */

export type CampanaDeCorreo = {
  id: string;
  nombre: string;
  activa: boolean;
  limite_diario: number | null;
  base: number;
  contactados: number;
  pendientes: number | null;
  enviados: number;
  enviados_24h: number;
  fallidos_24h: number;
  abrieron: number;
  abrieron_24h: number;
  clics: number;
  clics_24h: number;
  rebotes: number;
  respuestas: number;
  respuestas_24h: number;
  bajas: number;
  ultimo_envio: string | null;
};

export type RespuestaDeCorreo = {
  campana_id: string;
  empresa: string | null;
  recibida_at: string | null;
  intencion: string | null;
  resumen: string | null;
  siguiente: string | null;
};

export type ResumenDeCorreo = {
  marca: string;
  enviados_hoy: number;
  cupo_diario: number | null;
  campanas: CampanaDeCorreo[];
  respuestas_7d: RespuestaDeCorreo[];
};

export type PiezaDelInforme = {
  title: string;
  channel: string;
  format: string;
  status: string;
  agent: string | null;
  target: string | null;
  body: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  external_id: string | null;
};

export type AgenteDelInforme = {
  codigo: string;
  nombre: string;
  persona: string | null;
  motor: string | null;
  activo: boolean;
  ultimo_estado: string;
  ultimo_evento_at: string | null;
  ultimo_resumen: string | null;
};

export type EventoDelInforme = {
  agente_codigo: string;
  tipo: string;
  resumen: string | null;
  relacionado_con: string | null;
  ocurrido_at: string;
};

export type RevisionDelCircuito = { revision: string; estado: string; detalle: string };

export type DatosDelInforme = {
  empresa: string;
  /** ISO. El informe cubre las 24 horas anteriores. */
  ahora: string;
  correo: ResumenDeCorreo | null;
  /** Por qué no hay datos de correo (el puente no respondió, no está configurado…). */
  correoError: string | null;
  /** Piezas del calendario cuya hora cayó en las últimas 24 h. */
  piezas: PiezaDelInforme[];
  /** Piezas programadas para las próximas 24 h. */
  proximas: PiezaDelInforme[];
  agentes: AgenteDelInforme[];
  /** Eventos de la red en las últimas 24 h (sin latidos). */
  eventos: EventoDelInforme[];
  /** Último análisis escrito por el Líder de resultados o el CEO, si existe. */
  analisis: { titulo: string; contenido: string; created_at: string } | null;
  ventas: Record<string, number | string>;
  revisiones: RevisionDelCircuito[];
  /** Publicaciones en grupos comprometidas por día. */
  metaGrupos: number;
};

// ---------------------------------------------------------------------------

const esc = (valor: unknown): string =>
  String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const recortar = (texto: string | null | undefined, max: number) => {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max - 1).trimEnd()}…` : limpio;
};

const COLOR = { ok: "#16794a", aviso: "#9a6700", alerta: "#b42318", neutro: "#64748b", texto: "#0f172a", suave: "#334155", borde: "#e5e7eb", fondo: "#f8fafc" };

const ESTADO_AGENTE: Record<string, { label: string; color: string }> = {
  ok: { label: "Sano", color: COLOR.ok },
  corriendo: { label: "Trabajando", color: "#0369a1" },
  error: { label: "Con error", color: COLOR.alerta },
  atrasado: { label: "Atrasado", color: COLOR.aviso },
  inactivo: { label: "Sin actividad", color: COLOR.neutro },
};

const CANAL: Record<string, string> = {
  facebook_grupo: "Grupos de Facebook",
  instagram: "Instagram",
  facebook: "Facebook (Página)",
  email: "Correo",
  meta_ads: "Anuncios de Meta",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  web: "Sitio web",
};

const esTurno = (pieza: PiezaDelInforme) => (pieza.external_id ?? "").startsWith("plan-");
const esDeGrupo = (pieza: PiezaDelInforme) => pieza.channel === "facebook_grupo" && !esTurno(pieza);

function horaChile(iso: string | null): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(fecha);
}

function fechaChile(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}

function haceCuanto(iso: string | null, ahora: number): string {
  if (!iso) return "sin actividad";
  const minutos = Math.round((ahora - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutos)) return "sin actividad";
  if (minutos < 60) return `hace ${Math.max(minutos, 1)} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

export type CumplimientoDelDia = {
  grupos: { publicadas: number; esperando: number; fallidas: number; meta: number };
  reels: { publicados: number; programados: number; fallidos: number };
  correo: { enviados24h: number; cupo: number | null; pendientes: number; activas: number } | null;
  volvio: { aperturas: number; clics: number; respuestas: number; bajas: number };
};

/** Lo comprometido frente a lo hecho en las últimas 24 horas. */
export function cumplimientoDelDia(datos: Pick<DatosDelInforme, "piezas" | "correo" | "metaGrupos">): CumplimientoDelDia {
  const grupos = datos.piezas.filter(esDeGrupo);
  const reels = datos.piezas.filter((pieza) => pieza.format === "reel" && !esTurno(pieza));
  const campanas = datos.correo?.campanas ?? [];
  const sumar = (clave: keyof CampanaDeCorreo) => campanas.reduce((total, campana) => total + (Number(campana[clave]) || 0), 0);
  return {
    grupos: {
      publicadas: grupos.filter((pieza) => pieza.status === "publicado").length,
      // "Programado" con la hora ya pasada es un post que espera la aprobación del grupo.
      esperando: grupos.filter((pieza) => pieza.status === "programado").length,
      fallidas: grupos.filter((pieza) => pieza.status === "fallido" || pieza.status === "pausado").length,
      meta: datos.metaGrupos,
    },
    reels: {
      publicados: reels.filter((pieza) => pieza.status === "publicado").length,
      programados: reels.filter((pieza) => pieza.status === "programado").length,
      fallidos: reels.filter((pieza) => pieza.status === "fallido").length,
    },
    correo: datos.correo
      ? {
          enviados24h: sumar("enviados_24h"),
          cupo: datos.correo.cupo_diario,
          pendientes: campanas.filter((campana) => campana.activa).reduce((total, campana) => total + (campana.pendientes ?? 0), 0),
          activas: campanas.filter((campana) => campana.activa).length,
        }
      : null,
    volvio: { aperturas: sumar("abrieron_24h"), clics: sumar("clics_24h"), respuestas: sumar("respuestas_24h"), bajas: sumar("bajas") },
  };
}

/** Lo que hay que mirar primero: en rojo lo que no se cumplió. */
export function alertasDelInforme(datos: DatosDelInforme, cumplimiento: CumplimientoDelDia): string[] {
  const alertas: string[] = [];
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(new Date(Date.parse(datos.ahora) - 86_400_000));
  const ayerFueHabil = !["Sat", "Sun"].includes(dia);

  if (cumplimiento.grupos.publicadas < cumplimiento.grupos.meta) {
    alertas.push(
      `Grupos: ${cumplimiento.grupos.publicadas} publicaciones visibles de ${cumplimiento.grupos.meta} comprometidas` +
        (cumplimiento.grupos.esperando ? `, ${cumplimiento.grupos.esperando} esperando aprobación` : "") +
        (cumplimiento.grupos.fallidas ? `, ${cumplimiento.grupos.fallidas} eliminadas o rechazadas` : "") +
        ".",
    );
  }
  if (datos.correoError) alertas.push(`Correo: sin datos (${datos.correoError}).`);
  if (cumplimiento.correo) {
    if (cumplimiento.correo.activas === 0) alertas.push("Correo: no hay ninguna campaña activa.");
    else if (ayerFueHabil && cumplimiento.correo.enviados24h === 0 && cumplimiento.correo.pendientes > 0) {
      alertas.push(`Correo: no salió ningún correo en 24 horas y hay ${cumplimiento.correo.pendientes} contactos esperando.`);
    }
  }
  if (cumplimiento.reels.fallidos > 0) alertas.push(`Reels: ${cumplimiento.reels.fallidos} no se publicaron.`);

  const caidos = datos.agentes.filter((agente) => agente.activo && (agente.ultimo_estado === "error" || agente.ultimo_estado === "atrasado"));
  if (caidos.length > 0) {
    alertas.push(`Equipo: ${caidos.length} de ${datos.agentes.length} no cumplieron su turno (${caidos.map((agente) => agente.persona ?? agente.nombre).join(", ")}).`);
  }
  for (const revision of datos.revisiones) if (revision.estado === "alerta") alertas.push(`${revision.revision}: ${revision.detalle}`);
  return alertas;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const titulo = (texto: string) => `<h3 style="margin:28px 0 8px;font-size:15px;color:${COLOR.texto}">${esc(texto)}</h3>`;
const nota = (texto: string) => `<p style="margin:6px 0 0;color:${COLOR.neutro};font-size:12px">${texto}</p>`;

function cifra(valor: string | number, etiqueta: string, color: string = COLOR.texto): string {
  return `<td style="padding:10px 12px;background:${COLOR.fondo};border-radius:6px;vertical-align:top">
    <strong style="font-size:21px;color:${color}">${esc(valor)}</strong><br>
    <span style="color:${COLOR.neutro};font-size:12px">${esc(etiqueta)}</span></td>`;
}

const celda = (contenido: string, extra = "") => `<td style="padding:7px 10px;border-bottom:1px solid ${COLOR.borde};color:${COLOR.suave};${extra}">${contenido}</td>`;
const cabecera = (textos: string[]) =>
  `<tr>${textos.map((texto) => `<th style="padding:7px 10px;border-bottom:2px solid ${COLOR.borde};color:${COLOR.neutro};font-size:11px;text-align:left;font-weight:600">${esc(texto)}</th>`).join("")}</tr>`;
const tabla = (filas: string) => `<table style="border-collapse:collapse;width:100%;font-size:13px">${filas}</table>`;

export function armarInformeDeMarketing(datos: DatosDelInforme): { asunto: string; html: string; alertas: string[] } {
  const ahora = Date.parse(datos.ahora);
  const cumplimiento = cumplimientoDelDia(datos);
  const alertas = alertasDelInforme(datos, cumplimiento);
  const porCodigo = new Map(datos.agentes.map((agente) => [agente.codigo, agente]));
  const quien = (codigo: string | null) => {
    const agente = codigo ? porCodigo.get(codigo) : undefined;
    return agente ? (agente.persona ?? agente.nombre) : (codigo ?? "");
  };
  const numero = (clave: string) => Number(datos.ventas[clave] ?? 0) || 0;

  // 1 · Lo comprometido y lo hecho
  const g = cumplimiento.grupos;
  const colorGrupos = g.publicadas >= g.meta ? COLOR.ok : g.publicadas > 0 ? COLOR.aviso : COLOR.alerta;
  const c = cumplimiento.correo;
  const hecho = `<table style="border-collapse:separate;border-spacing:6px 0;width:100%;margin:0 -6px"><tr>
    ${cifra(`${g.publicadas} de ${g.meta}`, "publicaciones visibles en grupos", colorGrupos)}
    ${cifra(c ? `${c.enviados24h}${c.cupo ? ` de ${c.cupo}` : ""}` : "sin dato", "correos enviados (cupo diario)", c && c.enviados24h > 0 ? COLOR.ok : COLOR.aviso)}
    ${cifra(cumplimiento.reels.publicados, "Reels publicados")}
    ${cifra(c ? c.pendientes : "sin dato", "contactos por escribir")}
  </tr></table>`;

  // 2 · Lo que volvió
  const volvio = `<table style="border-collapse:separate;border-spacing:6px 0;width:100%;margin:0 -6px"><tr>
    ${cifra(cumplimiento.volvio.aperturas, "abrieron un correo")}
    ${cifra(cumplimiento.volvio.clics, "hicieron clic")}
    ${cifra(Math.max(cumplimiento.volvio.respuestas, numero("respuestas_recibidas")), "respuestas", cumplimiento.volvio.respuestas + numero("respuestas_recibidas") > 0 ? COLOR.ok : COLOR.texto)}
    ${cifra(numero("reuniones_agendadas"), "reuniones agendadas")}
    ${cifra(numero("negocios_nuevos"), "negocios nuevos")}
  </tr></table>`;

  // 3 · Correo por campaña
  const campanas = (datos.correo?.campanas ?? []).filter((campana) => campana.activa || campana.enviados_24h > 0 || campana.abrieron_24h > 0);
  const correo = datos.correo
    ? campanas.length === 0
      ? `<p style="margin:0;color:${COLOR.suave};font-size:13px">No hay campañas activas ni movimiento en 24 horas.</p>`
      : tabla(
          cabecera(["Campaña", "Base", "Escritos", "Faltan", "Enviados 24 h", "Abrieron", "Clics", "Respuestas", "Bajas"]) +
            campanas
              .map(
                (campana) =>
                  `<tr>${celda(`${campana.activa ? "" : `<span style="color:${COLOR.neutro}">(pausada)</span> `}${esc(recortar(campana.nombre.replace(/^Altius\s*·\s*/i, ""), 58))}`)}${celda(String(campana.base || "—"))}${celda(String(campana.contactados))}${celda(campana.pendientes === null ? "—" : String(campana.pendientes))}${celda(`<strong>${campana.enviados_24h}</strong>${campana.fallidos_24h ? ` <span style="color:${COLOR.alerta}">(${campana.fallidos_24h} fallaron)</span>` : ""}`)}${celda(`${campana.abrieron}${campana.abrieron_24h ? ` <span style="color:${COLOR.ok}">+${campana.abrieron_24h}</span>` : ""}`)}${celda(`${campana.clics}${campana.clics_24h ? ` <span style="color:${COLOR.ok}">+${campana.clics_24h}</span>` : ""}`)}${celda(String(campana.respuestas))}${celda(String(campana.bajas))}</tr>`,
              )
              .join(""),
        ) + nota("Abrieron y clics son personas distintas desde que partió la campaña; en verde, las de las últimas 24 horas. El correo sale de lunes a viernes.")
    : `<p style="margin:0;color:${COLOR.alerta};font-size:13px">Sin datos de correo: ${esc(datos.correoError ?? "el puente con Atlas Lead no respondió")}.</p>`;

  const respuestas = (datos.correo?.respuestas_7d ?? []).slice(0, 8);
  const respuestasHtml =
    respuestas.length === 0
      ? ""
      : titulo("Respuestas de los últimos 7 días") +
        tabla(
          respuestas
            .map((respuesta) => `<tr>${celda(`<strong>${esc(respuesta.empresa ?? "Sin nombre")}</strong>${respuesta.intencion ? ` · ${esc(respuesta.intencion)}` : ""}<br>${esc(recortar(respuesta.resumen, 220))}${respuesta.siguiente ? `<br><span style="color:${COLOR.neutro}">Siguiente: ${esc(recortar(respuesta.siguiente, 160))}</span>` : ""}`)}</tr>`)
            .join(""),
        );

  // 4 · Publicaciones por canal
  const canales = new Map<string, { total: number; publicadas: number; esperando: number; fallidas: number }>();
  for (const pieza of datos.piezas) {
    if (esTurno(pieza) || pieza.channel === "email") continue;
    const fila = canales.get(pieza.channel) ?? { total: 0, publicadas: 0, esperando: 0, fallidas: 0 };
    fila.total += 1;
    if (pieza.status === "publicado") fila.publicadas += 1;
    else if (pieza.status === "programado") fila.esperando += 1;
    else if (pieza.status === "fallido" || pieza.status === "pausado") fila.fallidas += 1;
    canales.set(pieza.channel, fila);
  }
  const publicaciones =
    canales.size === 0
      ? `<p style="margin:0;color:${COLOR.alerta};font-size:13px">No se registró ninguna publicación en 24 horas.</p>`
      : tabla(
          cabecera(["Canal", "Se intentaron", "Visibles", "Esperan aprobación", "Eliminadas o fallidas"]) +
            [...canales]
              .map(([canal, fila]) => `<tr>${celda(esc(CANAL[canal] ?? canal))}${celda(String(fila.total))}${celda(`<strong style="color:${fila.publicadas > 0 ? COLOR.ok : COLOR.alerta}">${fila.publicadas}</strong>`)}${celda(String(fila.esperando))}${celda(fila.fallidas > 0 ? `<span style="color:${COLOR.alerta}">${fila.fallidas}</span>` : "0")}</tr>`)
              .join(""),
        );
  const fallidas = datos.piezas.filter((pieza) => !esTurno(pieza) && (pieza.status === "fallido" || pieza.status === "pausado")).slice(0, 6);
  const fallidasHtml =
    fallidas.length === 0
      ? ""
      : `<p style="margin:10px 0 4px;font-size:12px;color:${COLOR.neutro};font-weight:600">Por qué fallaron</p>` +
        tabla(fallidas.map((pieza) => `<tr>${celda(`<strong>${esc(recortar(pieza.target ?? pieza.title, 50))}</strong><br>${esc(recortar(pieza.body, 190) || "Sin motivo registrado")}`)}</tr>`).join(""));

  // 5 · Decisiones y alertas del equipo
  const decisiones = datos.eventos.filter((evento) => evento.tipo === "decision" || evento.tipo === "tarea").slice(0, 8);
  const avisos = datos.eventos.filter((evento) => evento.tipo === "alerta").slice(0, 8);
  const linea = (evento: EventoDelInforme) =>
    `<li style="margin:0 0 5px">${esc(quien(evento.agente_codigo))}${evento.relacionado_con ? ` → ${esc(quien(evento.relacionado_con))}` : ""}: ${esc(recortar(evento.resumen, 240))}</li>`;
  const cerebro =
    (datos.analisis
      ? `<div style="padding:10px 12px;background:${COLOR.fondo};border-radius:6px;font-size:13px;color:${COLOR.suave};white-space:pre-line"><strong>${esc(datos.analisis.titulo)}</strong>\n${esc(recortar(datos.analisis.contenido.replace(/[#*`]/g, ""), 1400))}</div>`
      : "") +
    (decisiones.length > 0
      ? `<p style="margin:12px 0 4px;font-size:12px;color:${COLOR.neutro};font-weight:600">Decisiones y encargos</p><ul style="margin:0;padding-left:18px;font-size:13px;color:${COLOR.suave}">${decisiones.map(linea).join("")}</ul>`
      : "") +
    (avisos.length > 0
      ? `<p style="margin:12px 0 4px;font-size:12px;color:${COLOR.neutro};font-weight:600">Alertas del equipo</p><ul style="margin:0;padding-left:18px;font-size:13px;color:${COLOR.suave}">${avisos.map(linea).join("")}</ul>`
      : "");

  // 6 · Equipo
  const equipo = tabla(
    datos.agentes
      .map((agente) => {
        const estado = ESTADO_AGENTE[agente.ultimo_estado] ?? ESTADO_AGENTE.inactivo;
        return `<tr>${celda(`<strong>${esc(agente.persona ?? agente.nombre)}</strong>${agente.persona ? `<br><span style="color:${COLOR.neutro};font-size:12px">${esc(agente.nombre)}</span>` : ""}`, "white-space:nowrap")}${celda(`<span style="color:${estado.color};font-weight:600">${estado.label}</span><br><span style="color:${COLOR.neutro};font-size:12px">${esc(haceCuanto(agente.ultimo_evento_at, ahora))}</span>`, "white-space:nowrap")}${celda(esc(recortar(agente.ultimo_resumen, 170) || "—"))}</tr>`;
      })
      .join(""),
  );

  // 7 · Hoy toca
  const proximas = datos.proximas.filter((pieza) => !esTurno(pieza));
  const turnos = datos.proximas.filter(esTurno);
  const hoyToca =
    proximas.length + turnos.length === 0
      ? `<p style="margin:0;color:${COLOR.aviso};font-size:13px">No hay nada programado para las próximas 24 horas.</p>`
      : tabla(
          [...turnos, ...proximas]
            .sort((a, b) => Date.parse(a.scheduled_at ?? "") - Date.parse(b.scheduled_at ?? ""))
            .slice(0, 14)
            .map((pieza) => `<tr>${celda(esc(horaChile(pieza.scheduled_at)), "white-space:nowrap;font-variant-numeric:tabular-nums")}${celda(esc(CANAL[pieza.channel] ?? pieza.channel), "white-space:nowrap")}${celda(esc(recortar(pieza.title, 90)))}</tr>`)
            .join(""),
        ) + (cumplimiento.correo && cumplimiento.correo.pendientes > 0 ? nota(`Correo: quedan ${cumplimiento.correo.pendientes} contactos por escribir en las campañas activas${cumplimiento.correo.cupo ? ` (salen hasta ${cumplimiento.correo.cupo} al día, de lunes a viernes)` : ""}.`) : "");

  // 8 · Circuito
  const SIGNO: Record<string, string> = { ok: "✓", aviso: "!", alerta: "✕", sin_datos: "·" };
  const circuito = tabla(
    datos.revisiones
      .map((revision) => `<tr>${celda(`<span style="color:${revision.estado === "ok" ? COLOR.ok : revision.estado === "alerta" ? COLOR.alerta : revision.estado === "aviso" ? COLOR.aviso : COLOR.neutro};font-weight:600">${SIGNO[revision.estado] ?? "·"} ${esc(revision.revision)}</span>`, "white-space:nowrap")}${celda(esc(revision.detalle))}</tr>`)
      .join(""),
  );

  const cabeceraAlertas =
    alertas.length === 0
      ? `<p style="margin:0 0 4px;padding:10px 12px;background:#ecfdf3;border-radius:6px;color:${COLOR.ok};font-size:13px;font-weight:600">Se cumplió lo comprometido. Sin alertas.</p>`
      : `<div style="padding:10px 12px;background:#fef3f2;border-radius:6px;font-size:13px;color:${COLOR.alerta}"><strong>${alertas.length === 1 ? "1 punto que mirar primero" : `${alertas.length} puntos que mirar primero`}</strong><ul style="margin:6px 0 0;padding-left:18px">${alertas.map((alerta) => `<li style="margin:0 0 3px">${esc(alerta)}</li>`).join("")}</ul></div>`;

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;color:${COLOR.texto}">
    <h2 style="margin:0 0 2px">Marketing · ${esc(datos.empresa)}</h2>
    <p style="margin:0 0 16px;color:${COLOR.neutro};font-size:13px">Informe diario del equipo de marketing con IA · ${esc(fechaChile(datos.ahora))} · últimas 24 horas</p>
    ${cabeceraAlertas}
    ${titulo("1 · Lo comprometido y lo hecho")}${hecho}
    ${titulo("2 · Lo que volvió")}${volvio}
    ${nota(`Hay <strong>${numero("negocios_abiertos")}</strong> negocios abiertos, <strong>${numero("para_hoy")}</strong> con acción para hoy y <strong>${numero("esperando_tu_revision")}</strong> respuesta(s) redactada(s) esperando tu visto bueno.`)}
    ${titulo("3 · Correo por campaña")}${correo}${respuestasHtml}
    ${titulo("4 · Publicaciones por canal")}${publicaciones}${fallidasHtml}
    ${cerebro ? titulo("5 · Análisis y decisiones del equipo") + cerebro : ""}
    ${titulo("6 · El equipo")}${equipo}
    ${titulo("7 · Hoy toca")}${hoyToca}
    ${titulo("8 · Revisión del circuito")}${circuito}
    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">Este correo llega todos los días, esté todo bien o no. Si un día no llega, el vigilante se cayó.</p>
  </div>`;

  const partes = [`${g.publicadas} de ${g.meta} en grupos`, c ? `${c.enviados24h} correos` : "correo sin dato", `${Math.max(cumplimiento.volvio.respuestas, numero("respuestas_recibidas"))} respuestas`];
  const asunto = `${alertas.length > 0 ? `⚠ ${alertas.length} · ` : ""}Marketing ${datos.empresa} · ${partes.join(" · ")}`;
  return { asunto, html, alertas };
}
