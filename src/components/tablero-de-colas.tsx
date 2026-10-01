import Link from "next/link";
import type { ReactNode } from "react";
import { Layers, Mail, MessageCircle, Users } from "lucide-react";

import { Avatar, Badge, EmptyState, buttonClasses, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Tablero en vivo por cola: lo que espera en cada canal digital contra su
 * nivel de servicio, y cada miembro con su estado de voz y sus canales
 * digitales. Es la vista con la que un supervisor decide a quién mover de
 * cola; sin contenido de conversaciones, solo metadatos.
 */

export type MiembroDeCola = {
  id: string;
  nombre: string;
  conectado: boolean;
  estado: string | null;
  en_pausa: boolean;
  telefono: string | null;
  correo_prendido: boolean;
  whatsapp_prendido: boolean;
  recibe_correo: boolean;
  recibe_whatsapp: boolean;
  correos: number;
  whatsapp: number;
};

export type ColaEnVivo = {
  id: string;
  nombre: string;
  modo: "least_loaded" | "manual";
  sla_whatsapp_segundos: number;
  sla_correo_segundos: number;
  max_correos: number;
  max_whatsapp: number | null;
  canales: string[];
  correo: {
    pendientes: number;
    sin_asignar: number;
    vencidos: number;
    mas_antiguo: string | null;
    atendidos_hoy: number;
    mediana_respuesta_minutos: number | null;
  };
  whatsapp: {
    abiertas: number;
    sin_asignar: number;
    sin_responder: number;
    vencidas: number;
    mas_antigua: string | null;
  };
  miembros: MiembroDeCola[];
};

const CANAL: Record<string, { texto: string; tono: string }> = {
  voice: { texto: "Voz", tono: "primary" },
  whatsapp: { texto: "WhatsApp", tono: "green" },
  email: { texto: "Correo", tono: "teal" },
};

const TELEFONO: Record<string, string> = {
  available: "esperando llamada",
  ringing: "sonando",
  on_call: "en llamada",
  wrap_up: "tipificando",
  paused: "en pausa",
  pausing: "pausando",
  offline: "sin teléfono",
};

function duracion(segundos: number): string {
  const minutos = Math.round(segundos / 60);
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h${minutos % 60 ? ` ${minutos % 60} min` : ""}`;
  return `${Math.floor(horas / 24)} d${horas % 24 ? ` ${horas % 24} h` : ""}`;
}

type TonoCifra = "neutral" | "warn" | "danger" | "good";

/**
 * Una cifra dentro de la franja dividida del canal. El color solo aparece
 * cuando hay algo que atender; "al día" no se pinta de verde (un cero va gris).
 */
function Cifra({ etiqueta, valor, tono = "neutral", ayuda }: { etiqueta: string; valor: string | number; tono?: TonoCifra; ayuda?: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5" title={ayuda}>
      <p className="truncate text-[11px] text-muted-foreground">{etiqueta}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold leading-tight tabular-nums",
          tono === "danger" ? "text-danger" : tono === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {typeof valor === "number" ? valor.toLocaleString("es-CL") : valor}
      </p>
    </div>
  );
}

/** Franja de un canal: su ícono y nombre arriba, las cifras en una grilla dividida. */
function FranjaDeCanal({ icono: Icono, tono, titulo, children }: { icono: typeof Mail; tono: string; titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span className="icon-chip size-5 rounded-md" data-tone={tono} aria-hidden="true">
          <Icono size={11} />
        </span>
        {titulo}
      </p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border @md:grid-cols-3 @4xl:grid-cols-6">
        {children}
      </div>
    </div>
  );
}

function CanalDelMiembro({ prendido, recibe, carga, tope }: { prendido: boolean; recibe: boolean; carga: number; tope: number | null }) {
  const texto = !prendido ? "Apagado" : recibe ? "Recibe" : "No recibe";
  const tono = !prendido ? "neutral" : recibe ? "success" : "warning";
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={tono}>{texto}</Badge>
      <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
        {carga}
        {tope ? `/${tope}` : ""}
      </span>
    </span>
  );
}

/** Avatar con su punto de presencia: verde conectado, ámbar en pausa, gris fuera. */
function AvatarConPresencia({ nombre, semilla, conectado, enPausa }: { nombre: string; semilla: string; conectado: boolean; enPausa: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar name={nombre} seed={semilla} size="sm" className={cn(!conectado && "opacity-60")} />
      <span
        aria-hidden="true"
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface",
          conectado ? (enPausa ? "bg-warning" : "bg-success") : "bg-border-strong",
        )}
      />
    </span>
  );
}

/**
 * Salud de la cola en una palabra: fuera de plazo (o nadie recibe lo que
 * espera) es rojo; lo que espera sin dueño o sin respuesta, ámbar.
 */
function saludDeLaCola(cola: ColaEnVivo, tieneCorreo: boolean, tieneWhatsapp: boolean, recibenCorreo: number, recibenWhatsapp: number): { tono: BadgeTone; texto: string } {
  const vencidos = (tieneCorreo ? cola.correo.vencidos : 0) + (tieneWhatsapp ? cola.whatsapp.vencidas : 0);
  const sinReceptor = (tieneCorreo && recibenCorreo === 0 && cola.correo.pendientes > 0) || (tieneWhatsapp && recibenWhatsapp === 0 && cola.whatsapp.abiertas > 0);
  if (vencidos > 0) return { tono: "danger", texto: `${vencidos} fuera de plazo` };
  if (sinReceptor) return { tono: "danger", texto: "Nadie recibe" };
  const pendientes = (tieneCorreo ? cola.correo.sin_asignar : 0) + (tieneWhatsapp ? cola.whatsapp.sin_asignar + cola.whatsapp.sin_responder : 0);
  if (pendientes > 0) return { tono: "warning", texto: "Requiere atención" };
  return { tono: "neutral", texto: "Al día" };
}

export function TableroDeColas({ colas, ahora, puedeMover }: { colas: ColaEnVivo[]; ahora: number; puedeMover: boolean }) {
  return (
    <section aria-labelledby="colas-en-vivo" className="space-y-3">
      <div className="px-1">
        <h2 id="colas-en-vivo" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
          Colas en vivo
          {colas.length > 0 && (
            <span className="rounded-md bg-surface-muted px-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground">{colas.length}</span>
          )}
        </h2>
        <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">
          Lo que espera en cada canal contra su nivel de servicio, y quién puede recibirlo ahora. Voz la reparte el discador; correo y WhatsApp, la cola.
        </p>
      </div>
      {colas.length === 0 ? (
        <div className="atlas-panel rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState icon={Layers} title="Sin colas a tu alcance" description="Cuando una cola tenga miembros de tus equipos, aparece acá." className="py-6" />
        </div>
      ) : (
        <div className={cn("grid gap-4", colas.length > 1 && "2xl:grid-cols-2")}>
          {colas.map((cola) => {
            const tieneCorreo = cola.canales.includes("email");
            const tieneWhatsapp = cola.canales.includes("whatsapp");
            const conectados = cola.miembros.filter((m) => m.conectado).length;
            const recibenCorreo = cola.miembros.filter((m) => m.recibe_correo).length;
            const recibenWhatsapp = cola.miembros.filter((m) => m.recibe_whatsapp).length;
            const esperaCorreo = cola.correo.mas_antiguo ? (ahora - Date.parse(cola.correo.mas_antiguo)) / 1000 : null;
            const esperaWhatsapp = cola.whatsapp.mas_antigua ? (ahora - Date.parse(cola.whatsapp.mas_antigua)) / 1000 : null;
            const salud = saludDeLaCola(cola, tieneCorreo, tieneWhatsapp, recibenCorreo, recibenWhatsapp);
            return (
              <section
                key={cola.id}
                aria-label={`Cola ${cola.nombre}`}
                className="atlas-panel @container overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
              >
                <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={cola.nombre} seed={cola.id} shape="square" size="md" icon={Layers} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <h3 className="truncate text-sm font-semibold text-foreground">{cola.nombre}</h3>
                        <Badge tone={salud.tono} dot>{salud.texto}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {cola.canales.map((canal) => CANAL[canal]?.texto ?? canal).join(" · ")}
                        {cola.canales.length > 0 ? " · " : ""}
                        {cola.modo === "manual" ? "Reparto manual" : "Reparto automático"} · {conectados} de {cola.miembros.length} conectados
                      </p>
                    </div>
                  </div>
                  {puedeMover && (
                    <Link href={`/dashboard/operacion/colas/${cola.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      <Users size={14} aria-hidden="true" /> Mover ejecutivos
                    </Link>
                  )}
                </header>

                {(tieneCorreo || tieneWhatsapp) && (
                  <div className="space-y-3 border-t border-border px-4 py-3">
                    {tieneCorreo && (
                      <FranjaDeCanal icono={Mail} tono="teal" titulo="Correo">
                        <Cifra etiqueta="Esperan respuesta" valor={cola.correo.pendientes} />
                        <Cifra
                          etiqueta="Fuera de plazo"
                          valor={cola.correo.vencidos}
                          tono={cola.correo.vencidos > 0 ? "danger" : "neutral"}
                          ayuda={`Plazo de primera respuesta: ${duracion(cola.sla_correo_segundos)}`}
                        />
                        <Cifra etiqueta="Sin dueño" valor={cola.correo.sin_asignar} tono={cola.correo.sin_asignar > 0 ? "warn" : "neutral"} />
                        <Cifra
                          etiqueta="Mayor espera"
                          valor={esperaCorreo === null ? "—" : duracion(esperaCorreo)}
                          tono={esperaCorreo !== null && esperaCorreo > cola.sla_correo_segundos ? "danger" : "neutral"}
                        />
                        <Cifra
                          etiqueta="1.ª respuesta (7 d)"
                          valor={cola.correo.mediana_respuesta_minutos === null ? "—" : duracion(cola.correo.mediana_respuesta_minutos * 60)}
                          ayuda="Mediana de los últimos 7 días"
                        />
                        <Cifra etiqueta="Reciben ahora" valor={recibenCorreo} tono={recibenCorreo === 0 && cola.correo.pendientes > 0 ? "danger" : "neutral"} />
                      </FranjaDeCanal>
                    )}

                    {tieneWhatsapp && (
                      <FranjaDeCanal icono={MessageCircle} tono="green" titulo="WhatsApp">
                        <Cifra etiqueta="Abiertas" valor={cola.whatsapp.abiertas} />
                        <Cifra etiqueta="Sin responder" valor={cola.whatsapp.sin_responder} tono={cola.whatsapp.sin_responder > 0 ? "warn" : "neutral"} />
                        <Cifra
                          etiqueta="Fuera de plazo"
                          valor={cola.whatsapp.vencidas}
                          tono={cola.whatsapp.vencidas > 0 ? "danger" : "neutral"}
                          ayuda={`Plazo de respuesta: ${duracion(cola.sla_whatsapp_segundos)}`}
                        />
                        <Cifra etiqueta="Sin dueño" valor={cola.whatsapp.sin_asignar} tono={cola.whatsapp.sin_asignar > 0 ? "warn" : "neutral"} />
                        <Cifra
                          etiqueta="Mayor espera"
                          valor={esperaWhatsapp === null ? "—" : duracion(esperaWhatsapp)}
                          tono={esperaWhatsapp !== null && esperaWhatsapp > cola.sla_whatsapp_segundos ? "danger" : "neutral"}
                        />
                        <Cifra etiqueta="Reciben ahora" valor={recibenWhatsapp} tono={recibenWhatsapp === 0 && cola.whatsapp.abiertas > 0 ? "danger" : "neutral"} />
                      </FranjaDeCanal>
                    )}
                  </div>
                )}

                {cola.miembros.length > 0 && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[34rem] text-[13px]">
                      <thead className="bg-surface-raised text-left text-xs text-muted-foreground">
                        <tr className="border-b border-border">
                          <th scope="col" className="h-9 px-4 font-medium">Ejecutivo</th>
                          {tieneCorreo && <th scope="col" className="h-9 px-4 font-medium">Correo</th>}
                          {tieneWhatsapp && <th scope="col" className="h-9 px-4 font-medium">WhatsApp</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {cola.miembros.map((miembro) => (
                          <tr key={miembro.id} className="transition-colors hover:bg-surface-muted/55">
                            <td className="px-4 py-2.5">
                              <span className="flex min-w-0 items-center gap-2.5">
                                <AvatarConPresencia nombre={miembro.nombre} semilla={miembro.id} conectado={miembro.conectado} enPausa={miembro.en_pausa} />
                                <span className="min-w-0">
                                  <span className={cn("block truncate font-medium", miembro.conectado ? "text-foreground" : "text-muted-foreground")}>{miembro.nombre}</span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {miembro.conectado
                                      ? `${miembro.estado ?? "Sin estado"}${miembro.telefono && TELEFONO[miembro.telefono] ? ` · ${TELEFONO[miembro.telefono]}` : ""}`
                                      : "Desconectado"}
                                  </span>
                                </span>
                              </span>
                            </td>
                            {tieneCorreo && (
                              <td className="px-4 py-2.5">
                                <CanalDelMiembro prendido={miembro.correo_prendido} recibe={miembro.recibe_correo} carga={miembro.correos} tope={cola.max_correos} />
                              </td>
                            )}
                            {tieneWhatsapp && (
                              <td className="px-4 py-2.5">
                                <CanalDelMiembro prendido={miembro.whatsapp_prendido} recibe={miembro.recibe_whatsapp} carga={miembro.whatsapp} tope={cola.max_whatsapp} />
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
