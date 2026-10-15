"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/** Avisa al indicador de canales de la barra que se ponga al día al tiro. */
export const EVENTO_CHAT_NUEVO = "atlas:chat-nuevo";

const REVISION_MS = 20_000;
/** Al cargar la página solo se muestran (sin sonido) los chats recientes. */
const RECIENTE_AL_CARGAR_MS = 2 * 60 * 60 * 1000;
const PREFIJO_TITULO = /^💬 \(\d+\) /;

type Chat = {
  id: string;
  nombre: string;
  canal: string;
  campana: string | null;
  ultimoEntrante: string;
  sinLeer: number;
  vistaPrevia: string | null;
};

type Fila = {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  canal: string | null;
  unread_count: number | null;
  last_inbound_at: string | null;
  campaigns: { name: string } | { name: string }[] | null;
};

function etiquetaCanal(canal: string): string {
  if (canal === "instagram") return "Instagram";
  if (canal === "messenger") return "Messenger";
  return "WhatsApp";
}

function rutaDelChat(id: string): string {
  return `/dashboard/conversaciones/whatsapp?status=all&conversation=${id}`;
}

/** ¿Está mirando justo ese chat? Entonces la bandeja ya se lo muestra. */
function estaMirando(id: string): boolean {
  if (document.visibilityState !== "visible") return false;
  const url = new URL(window.location.href);
  return url.pathname === "/dashboard/conversaciones/whatsapp" && url.searchParams.get("conversation") === id;
}

/**
 * Dos notas cortas y suaves: se oyen por el audífono aunque esté en una
 * llamada, sin taparle la voz al cliente.
 */
function sonarAviso(contextoRef: { current: AudioContext | null }) {
  const Constructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return;
  const contexto = contextoRef.current ?? new Constructor();
  contextoRef.current = contexto;
  void contexto
    .resume()
    .then(() => {
      const inicio = contexto.currentTime;
      [880, 1175].forEach((frecuencia, i) => {
        const oscilador = contexto.createOscillator();
        const volumen = contexto.createGain();
        oscilador.type = "sine";
        oscilador.frequency.value = frecuencia;
        const t = inicio + i * 0.16;
        volumen.gain.setValueAtTime(0, t);
        volumen.gain.linearRampToValueAtTime(0.12, t + 0.02);
        volumen.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
        oscilador.connect(volumen);
        volumen.connect(contexto.destination);
        oscilador.start(t);
        oscilador.stop(t + 0.3);
      });
    })
    .catch(() => undefined);
}

/**
 * Aviso de chat nuevo en cualquier pantalla del CRM.
 *
 * El 15-10-2026 la secretaria virtual de Geimser derivaba chats de WhatsApp
 * a la ejecutiva mientras ella llamaba, y lo único que cambiaba era un número
 * chico en la barra que se refrescaba cada 30 s: se enteraba al cambiar de
 * vista. Ahora, cuando un cliente le escribe en un chat asignado a ella (y
 * no lo está atendiendo el bot), suena, aparece una tarjeta arriba a la
 * derecha que se queda hasta que la abre o la deja para después, y si está
 * en otra pestaña o ventana sale una notificación del sistema.
 *
 * Realtime avisa al instante; la revisión cada 20 s cubre una conexión caída.
 * Corre aunque la pestaña esté oculta: es una consulta directa a la base,
 * no una función de Vercel, y es justo cuando más falta hace.
 */
export function AvisoChatNuevo({ userId }: { userId: string }) {
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const vistosRef = useRef<Map<string, string>>(new Map());
  const descartadosRef = useRef<Map<string, string>>(new Map());
  const primeraRef = useRef(true);
  const audioRef = useRef<AudioContext | null>(null);

  const revisar = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, contact_name, contact_phone, canal, unread_count, last_inbound_at, campaigns(name)")
      .eq("assigned_to", userId)
      .in("status", ["open", "pending"])
      .gt("unread_count", 0)
      .or("ai_state.is.null,ai_state.neq.auto")
      .not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false })
      .limit(20);
    if (error || !data) return;

    const filas = data as unknown as Fila[];
    const primera = primeraRef.current;
    primeraRef.current = false;
    const nuevos: Fila[] = [];
    for (const fila of filas) {
      const visto = vistosRef.current.get(fila.id);
      const llego = fila.last_inbound_at as string;
      if (primera) {
        if (Date.now() - new Date(llego).getTime() <= RECIENTE_AL_CARGAR_MS) nuevos.push(fila);
      } else if (!visto || new Date(llego) > new Date(visto)) {
        nuevos.push(fila);
      }
      vistosRef.current.set(fila.id, llego);
    }

    // Un mensaje nuevo vuelve a mostrar lo que había dejado para después.
    for (const fila of nuevos) descartadosRef.current.delete(fila.id);

    const ids = filas.map((f) => f.id);
    const { data: mensajes } = ids.length
      ? await supabase
          .from("whatsapp_messages")
          .select("conversation_id, text_body, message_type, created_at")
          .in("conversation_id", ids)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(60)
      : { data: [] };
    const vistaPrevia = new Map<string, string>();
    for (const m of (mensajes ?? []) as { conversation_id: string; text_body: string | null; message_type: string | null }[]) {
      if (vistaPrevia.has(m.conversation_id)) continue;
      const texto = m.text_body?.trim() || (m.message_type && m.message_type !== "text" ? `[${m.message_type}]` : "");
      if (texto) vistaPrevia.set(m.conversation_id, texto);
    }

    const aChat = (f: Fila): Chat => {
      const campana = Array.isArray(f.campaigns) ? f.campaigns[0]?.name : f.campaigns?.name;
      return {
        id: f.id,
        nombre: f.contact_name?.trim() || f.contact_phone || "Cliente",
        canal: f.canal ?? "whatsapp",
        campana: campana ?? null,
        ultimoEntrante: f.last_inbound_at as string,
        sinLeer: f.unread_count ?? 1,
        vistaPrevia: vistaPrevia.get(f.id) ?? null,
      };
    };
    const idsNuevos = new Set(nuevos.map((f) => f.id));
    setChats((actuales) => {
      // En pantalla: lo que acaba de llegar más lo que ya estaba y sigue sin
      // leer. Un chat viejo sin leer no aparece solo porque siga ahí.
      const enPantalla = new Set(actuales.map((c) => c.id));
      return filas
        .filter((f) => idsNuevos.has(f.id) || enPantalla.has(f.id))
        .filter((f) => descartadosRef.current.get(f.id) !== f.last_inbound_at)
        .filter((f) => !estaMirando(f.id))
        .map(aChat)
        .slice(0, 4);
    });

    const conAviso = nuevos.filter((f) => !estaMirando(f.id));
    if (primera || conAviso.length === 0) return;

    window.dispatchEvent(new Event(EVENTO_CHAT_NUEVO));
    sonarAviso(audioRef);
    try {
      if ((document.hidden || !document.hasFocus()) && "Notification" in window && Notification.permission === "granted") {
        const fila = conAviso[0];
        const nombre = fila.contact_name?.trim() || fila.contact_phone || "Un cliente";
        const notificacion = new Notification(`💬 ${etiquetaCanal(fila.canal ?? "whatsapp")} nuevo`, {
          body: `${nombre}: ${vistaPrevia.get(fila.id) ?? "te escribió"}`,
          tag: `atlas-chat-${fila.id}`,
        });
        notificacion.onclick = () => {
          window.focus();
          router.push(rutaDelChat(fila.id));
          notificacion.close();
        };
      }
    } catch (err) {
      console.error("Aviso de chat: no se pudo mostrar la notificación", err);
    }
  }, [router, userId]);

  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | null = null;
    const pronto = () => {
      if (espera) clearTimeout(espera);
      espera = setTimeout(() => void revisar(), 400);
    };
    pronto();
    const supabase = createClient();
    const canal = supabase
      .channel(`aviso-chat-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations", filter: `assigned_to=eq.${userId}` },
        pronto,
      )
      .subscribe();
    const intervalo = window.setInterval(() => void revisar(), REVISION_MS);
    return () => {
      if (espera) clearTimeout(espera);
      window.clearInterval(intervalo);
      void supabase.removeChannel(canal);
    };
  }, [revisar, userId]);

  // El permiso de notificaciones se pide con el primer clic: así el
  // navegador lo muestra en vez de bloquearlo en silencio.
  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    const pedir = () => void Notification.requestPermission().catch(() => undefined);
    window.addEventListener("pointerdown", pedir, { once: true });
    return () => window.removeEventListener("pointerdown", pedir);
  }, []);

  // Con la pestaña oculta, el título cuenta los chats que esperan.
  useEffect(() => {
    const limpiar = () => {
      document.title = document.title.replace(PREFIJO_TITULO, "");
    };
    const poner = () => {
      limpiar();
      if (document.hidden && chats.length > 0) document.title = `💬 (${chats.length}) ${document.title}`;
    };
    poner();
    document.addEventListener("visibilitychange", poner);
    return () => {
      document.removeEventListener("visibilitychange", poner);
      limpiar();
    };
  }, [chats.length]);

  function quitar(chat: Chat) {
    descartadosRef.current.set(chat.id, chat.ultimoEntrante);
    setChats((actuales) => actuales.filter((c) => c.id !== chat.id));
  }

  if (chats.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Chats nuevos"
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-20 z-[95] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {chats.map((chat) => (
        <div
          key={chat.id}
          className="pointer-events-auto rounded-xl border border-success/40 bg-surface-solid p-3 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
              <MessageCircle size={16} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-success">
                {etiquetaCanal(chat.canal)} nuevo{chat.sinLeer > 1 ? ` · ${chat.sinLeer} mensajes` : ""}
              </p>
              <p className="truncate text-sm font-semibold text-foreground">{chat.nombre}</p>
              {chat.vistaPrevia && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{chat.vistaPrevia}</p>}
              {chat.campana && <p className="mt-1 truncate text-xs text-muted-foreground">{chat.campana}</p>}
            </div>
            <button
              type="button"
              onClick={() => quitar(chat)}
              aria-label={`Dejar para después el chat de ${chat.nombre}`}
              title="Dejar para después (vuelve si escribe de nuevo)"
              className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              quitar(chat);
              router.push(rutaDelChat(chat.id));
            }}
            className="mt-2.5 flex h-9 w-full items-center justify-center rounded-lg bg-success text-sm font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abrir chat
          </button>
        </div>
      ))}
    </div>
  );
}
