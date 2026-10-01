import Link from "next/link";
import { Layers, Users } from "lucide-react";

import { Badge, EmptyState, SectionCard, buttonClasses } from "@/components/ui";
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

function Cifra({ etiqueta, valor, tono = "neutral", ayuda }: { etiqueta: string; valor: string | number; tono?: "neutral" | "warn" | "danger" | "good"; ayuda?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background px-3 py-2" title={ayuda}>
      <p className="truncate text-xs text-muted-foreground">{etiqueta}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tono === "danger" ? "text-danger" : tono === "warn" ? "text-warning" : tono === "good" ? "text-success" : "text-foreground",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

function CanalDelMiembro({ prendido, recibe, carga, tope }: { prendido: boolean; recibe: boolean; carga: number; tope: number | null }) {
  const texto = !prendido ? "Apagado" : recibe ? "Recibe" : "No recibe";
  const tono = !prendido ? "neutral" : recibe ? "success" : "warning";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={tono}>{texto}</Badge>
      <span className="text-xs tabular-nums text-muted-foreground">
        {carga}
        {tope ? `/${tope}` : ""}
      </span>
    </span>
  );
}

export function TableroDeColas({ colas, ahora, puedeMover }: { colas: ColaEnVivo[]; ahora: number; puedeMover: boolean }) {
  return (
    <SectionCard
      icon={Layers}
      tone="teal"
      title="Colas en vivo"
      description="Lo que espera en cada canal contra su nivel de servicio, y quién puede recibirlo ahora. Voz la reparte el discador; correo y WhatsApp, la cola."
    >
      {colas.length === 0 ? (
        <EmptyState icon={Layers} title="Sin colas a tu alcance" description="Cuando una cola tenga miembros de tus equipos, aparece acá." className="py-6" />
      ) : (
        <div className="divide-y divide-border">
          {colas.map((cola) => {
            const tieneCorreo = cola.canales.includes("email");
            const tieneWhatsapp = cola.canales.includes("whatsapp");
            const conectados = cola.miembros.filter((m) => m.conectado).length;
            const recibenCorreo = cola.miembros.filter((m) => m.recibe_correo).length;
            const recibenWhatsapp = cola.miembros.filter((m) => m.recibe_whatsapp).length;
            const esperaCorreo = cola.correo.mas_antiguo ? (ahora - Date.parse(cola.correo.mas_antiguo)) / 1000 : null;
            const esperaWhatsapp = cola.whatsapp.mas_antigua ? (ahora - Date.parse(cola.whatsapp.mas_antigua)) / 1000 : null;
            return (
              <section key={cola.id} aria-label={`Cola ${cola.nombre}`} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{cola.nombre}</h3>
                    {cola.canales.map((canal) => (
                      <Badge key={canal} tone="neutral">
                        {CANAL[canal]?.texto ?? canal}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {cola.modo === "manual" ? "Reparto manual" : "Reparto automático"} · {conectados} de {cola.miembros.length} conectados
                    </span>
                  </div>
                  {puedeMover && (
                    <Link href={`/dashboard/operacion/colas/${cola.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                      <Users size={14} aria-hidden="true" /> Mover ejecutivos
                    </Link>
                  )}
                </div>

                {tieneCorreo && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    <Cifra etiqueta="Correo · esperan respuesta" valor={cola.correo.pendientes} />
                    <Cifra
                      etiqueta="Correo · fuera de plazo"
                      valor={cola.correo.vencidos}
                      tono={cola.correo.vencidos > 0 ? "danger" : "good"}
                      ayuda={`Plazo de primera respuesta: ${duracion(cola.sla_correo_segundos)}`}
                    />
                    <Cifra etiqueta="Correo · sin dueño" valor={cola.correo.sin_asignar} tono={cola.correo.sin_asignar > 0 ? "warn" : "neutral"} />
                    <Cifra
                      etiqueta="Correo · mayor espera"
                      valor={esperaCorreo === null ? "—" : duracion(esperaCorreo)}
                      tono={esperaCorreo !== null && esperaCorreo > cola.sla_correo_segundos ? "danger" : "neutral"}
                    />
                    <Cifra
                      etiqueta="Correo · 1.ª respuesta (7 d)"
                      valor={cola.correo.mediana_respuesta_minutos === null ? "—" : duracion(cola.correo.mediana_respuesta_minutos * 60)}
                      ayuda="Mediana de los últimos 7 días"
                    />
                    <Cifra etiqueta="Correo · reciben ahora" valor={recibenCorreo} tono={recibenCorreo === 0 && cola.correo.pendientes > 0 ? "danger" : "neutral"} />
                  </div>
                )}

                {tieneWhatsapp && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    <Cifra etiqueta="WhatsApp · abiertas" valor={cola.whatsapp.abiertas} />
                    <Cifra etiqueta="WhatsApp · sin responder" valor={cola.whatsapp.sin_responder} tono={cola.whatsapp.sin_responder > 0 ? "warn" : "neutral"} />
                    <Cifra
                      etiqueta="WhatsApp · fuera de plazo"
                      valor={cola.whatsapp.vencidas}
                      tono={cola.whatsapp.vencidas > 0 ? "danger" : "good"}
                      ayuda={`Plazo de respuesta: ${duracion(cola.sla_whatsapp_segundos)}`}
                    />
                    <Cifra etiqueta="WhatsApp · sin dueño" valor={cola.whatsapp.sin_asignar} tono={cola.whatsapp.sin_asignar > 0 ? "warn" : "neutral"} />
                    <Cifra
                      etiqueta="WhatsApp · mayor espera"
                      valor={esperaWhatsapp === null ? "—" : duracion(esperaWhatsapp)}
                      tono={esperaWhatsapp !== null && esperaWhatsapp > cola.sla_whatsapp_segundos ? "danger" : "neutral"}
                    />
                    <Cifra etiqueta="WhatsApp · reciben ahora" valor={recibenWhatsapp} tono={recibenWhatsapp === 0 && cola.whatsapp.abiertas > 0 ? "danger" : "neutral"} />
                  </div>
                )}

                {cola.miembros.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[36rem] text-sm">
                      <thead className="border-b border-border text-left text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="h-10 px-4 font-medium">Ejecutivo</th>
                          <th scope="col" className="h-10 px-4 font-medium">Voz</th>
                          {tieneCorreo && <th scope="col" className="h-10 px-4 font-medium">Correo</th>}
                          {tieneWhatsapp && <th scope="col" className="h-10 px-4 font-medium">WhatsApp</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {cola.miembros.map((miembro) => (
                          <tr key={miembro.id} className={cn(!miembro.conectado && "text-muted-foreground")}>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-2">
                                <span className={cn("size-2 rounded-full", miembro.conectado ? (miembro.en_pausa ? "bg-warning" : "bg-success") : "bg-border-strong")} aria-hidden="true" />
                                <span className="font-medium">{miembro.nombre}</span>
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {miembro.conectado
                                ? `${miembro.estado ?? "Sin estado"}${miembro.telefono && TELEFONO[miembro.telefono] ? ` · ${TELEFONO[miembro.telefono]}` : ""}`
                                : "Desconectado"}
                            </td>
                            {tieneCorreo && (
                              <td className="px-4 py-3">
                                <CanalDelMiembro prendido={miembro.correo_prendido} recibe={miembro.recibe_correo} carga={miembro.correos} tope={cola.max_correos} />
                              </td>
                            )}
                            {tieneWhatsapp && (
                              <td className="px-4 py-3">
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
    </SectionCard>
  );
}
