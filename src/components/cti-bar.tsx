"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  ContactRound,
  Delete,
  Grid3X3,
  LoaderCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Search,
  UserRound,
  Wifi,
} from "lucide-react";
import type { Profile, AgentStatusReason } from "@/lib/types";
import {
  getMyDialerOperatingMode,
  getMyIncomingDialContext,
  getMySipCredentials,
  listMyAutomaticDialHistory,
  listMyDialerContacts,
  type AgentDialerHistoryItem,
  type AgentDialerOperatingMode,
  type DialerContact,
  type IncomingDialContext,
} from "@/app/actions/agent-sip";
import {
  listActiveStatusReasons,
  getMyCurrentStatus,
  setMyCurrentStatus,
  heartbeat,
} from "@/app/actions/agent-status";
import { StatusDot, Input, Select, type BadgeTone } from "@/components/ui";
import {
  beginLegalIntercallBreak,
  LEGAL_INTERCALL_BREAK_SECONDS,
} from "@/lib/intercall-break";
import { cn } from "@/lib/utils";

const HEARTBEAT_MS = 20_000;
const SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN ?? "ws-atlas.geimser.cl";
const SIP_WSS_SERVER =
  process.env.NEXT_PUBLIC_SIP_WSS_SERVER ?? `wss://${SIP_DOMAIN}:8089/ws`;
const MOBILE_SUBSCRIBER_DIGITS = 8;
const MAX_RECONNECT_DELAY_MS = 15_000;

type RegState = "idle" | "connecting" | "registered" | "error";
type CallState = "idle" | "calling" | "ringing" | "in_call" | "ending";
type DialerView = "keypad" | "recents" | "contacts";
type RingbackPlayback = {
  context: AudioContext;
  oscillator: OscillatorNode;
  gain: GainNode;
  cadenceTimer: ReturnType<typeof setTimeout> | null;
};

type DialerRecent = {
  phone: string;
  name: string | null;
  calledAt: string;
};

const KEYPAD = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "0", letters: "+" },
];

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * El usuario solo escribe los ocho dígitos posteriores a +56 9. También
 * acepta pegar 981406609, 56981406609 o +56 9 8140 6609.
 */
function subscriberFromPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0056")) digits = digits.slice(4);
  if (digits.startsWith("56") && digits.length >= 10) digits = digits.slice(2);
  if (digits.startsWith("9") && digits.length === 9) digits = digits.slice(1);
  if (digits.length > MOBILE_SUBSCRIBER_DIGITS) {
    digits = digits.slice(-MOBILE_SUBSCRIBER_DIGITS);
  }
  return digits.slice(0, MOBILE_SUBSCRIBER_DIGITS);
}

function fullChileMobile(subscriber: string): string | null {
  return subscriber.length === MOBILE_SUBSCRIBER_DIGITS ? `569${subscriber}` : null;
}

function formatSubscriber(subscriber: string): string {
  return [subscriber.slice(0, 4), subscriber.slice(4, 8)].filter(Boolean).join(" ");
}

function formatChileMobile(phone: string): string {
  const subscriber = subscriberFromPhone(phone);
  return subscriber.length === MOBILE_SUBSCRIBER_DIGITS
    ? `+56 9 ${formatSubscriber(subscriber)}`
    : phone;
}

function contactInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatRecentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function automaticAttemptLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "En cola",
    originating: "Marcando",
    ringing: "Timbrando",
    answered: "Contestada",
    bridged: "En conversación",
    no_answer: "No contesta",
    busy: "Ocupado",
    failed: "Fallida",
    abandoned: "Abandonada",
    voicemail: "Buzón de voz",
    completed: "Completada",
  };
  return labels[status] ?? status;
}

function automaticAttemptTone(status: string): string {
  if (status === "completed" || status === "bridged" || status === "answered") {
    return "bg-success-bg text-success";
  }
  if (status === "failed" || status === "abandoned") {
    return "bg-danger-bg text-danger";
  }
  if (status === "busy" || status === "no_answer" || status === "voicemail") {
    return "bg-warning-bg text-warning";
  }
  return "bg-surface-muted text-muted-foreground";
}

export function CtiBar({ profile }: { profile: Profile }) {
  const [credential, setCredential] = useState<
    { extension: string; sip_password: string } | null | undefined
  >(undefined);
  const [regState, setRegState] = useState<RegState>("idle");
  const [registrationAttempt, setRegistrationAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [subscriber, setSubscriber] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<DialerView>("keypad");
  const [contacts, setContacts] = useState<DialerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState("");
  const [recents, setRecents] = useState<DialerRecent[]>([]);
  const [incomingContext, setIncomingContext] = useState<IncomingDialContext | null>(null);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [operatingMode, setOperatingMode] = useState<
    AgentDialerOperatingMode | undefined
  >(
    profile.role === "agente"
      ? undefined
      : { mode: "manual", campaigns: [], session: null }
  );
  const [automaticHistory, setAutomaticHistory] = useState<AgentDialerHistoryItem[]>([]);

  const [statusReasons, setStatusReasons] = useState<AgentStatusReason[]>([]);
  const [currentReasonId, setCurrentReasonId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registererRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const callAttemptRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaCleanupRef = useRef<(() => void) | null>(null);
  const ringbackRef = useRef<RingbackPlayback | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomingInviteHandlerRef = useRef<(invitation: any) => void>(() => {});

  const recentStorageKey = `atlas-cti-recents:${profile.id}`;

  useEffect(() => {
    getMySipCredentials()
      .then(setCredential)
      .catch((err) => {
        console.error("CTI: fallo al obtener credenciales SIP propias", err);
        setCredential(null);
      });
  }, []);

  useEffect(() => {
    let disposed = false;
    listMyDialerContacts()
      .then((rows) => {
        if (!disposed) setContacts(rows);
      })
      .catch((err) => console.error("CTI: fallo al cargar agenda", err))
      .finally(() => {
        if (!disposed) setContactsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (profile.role !== "agente") return;
    let disposed = false;

    async function refreshOperatingMode() {
      try {
        const mode = await getMyDialerOperatingMode();
        if (disposed) return;
        setOperatingMode(mode);
      } catch (err) {
        console.error("CTI: fallo al cargar el modo operativo", err);
      }
    }

    async function refreshAutomaticHistory() {
      try {
        const history = await listMyAutomaticDialHistory();
        if (!disposed) setAutomaticHistory(history);
      } catch (err) {
        console.error("CTI: fallo al cargar historial automático", err);
      }
    }

    void refreshOperatingMode();
    void refreshAutomaticHistory();
    const modeTimer = setInterval(refreshOperatingMode, 2_000);
    const historyTimer = setInterval(refreshAutomaticHistory, 10_000);
    return () => {
      disposed = true;
      clearInterval(modeTimer);
      clearInterval(historyTimer);
    };
  }, [profile.role]);

  useEffect(() => {
    let disposed = false;
    try {
      const stored = window.localStorage.getItem(recentStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as DialerRecent[];
        queueMicrotask(() => {
          if (!disposed) setRecents(parsed);
        });
      }
    } catch (err) {
      console.error("CTI: no se pudieron leer los números recientes", err);
    }
    return () => {
      disposed = true;
    };
  }, [recentStorageKey]);

  useEffect(() => {
    if (profile.role !== "agente") return;
    let disposed = false;
    Promise.all([listActiveStatusReasons(), getMyCurrentStatus()])
      .then(async ([reasons, current]) => {
        if (disposed) return;
        const available = reasons.find((reason) => !reason.is_pause) ?? null;
        const currentIsSelectable = Boolean(
          current && reasons.some((reason) => reason.id === current.reason.id)
        );
        const selected = currentIsSelectable ? current?.reason ?? null : available;
        setStatusReasons(reasons);
        setCurrentReasonId(selected?.id ?? null);

        // El login siempre inicia el servicio en Disponible. Esto también
        // reemplaza el estado de sistema "Desconectado" dejado por el logout.
        if (!currentIsSelectable && available) {
          await setMyCurrentStatus(available.id);
        }
      })
      .catch((err) => console.error("CTI: fallo al cargar estado de agente", err));
    return () => {
      disposed = true;
    };
  }, [profile.role]);

  useEffect(() => {
    if (profile.role !== "agente") return;
    let disposed = false;
    function ping() {
      heartbeat().catch((err) => {
        if (!disposed) console.error("CTI: heartbeat falló", err);
      });
    }
    ping();
    const id = setInterval(ping, HEARTBEAT_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [profile.role]);

  async function handleStatusChange(reasonId: string) {
    setCurrentReasonId(reasonId);
    setSavingStatus(true);
    try {
      await setMyCurrentStatus(reasonId);
    } catch (err) {
      console.error("CTI: fallo al guardar estado de agente", err);
    } finally {
      setSavingStatus(false);
    }
  }

  useEffect(() => {
    const trackingCall = callState === "in_call" && callStartedAt;
    const trackingWrapUp = operatingMode?.session?.status === "wrap_up";
    if (!trackingCall && !trackingWrapUp) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [callState, callStartedAt, operatingMode?.session?.status]);

  useEffect(() => {
    return () => {
      const playback = ringbackRef.current;
      ringbackRef.current = null;
      if (playback) {
        if (playback.cadenceTimer) clearTimeout(playback.cadenceTimer);
        try {
          playback.oscillator.stop();
        } catch {
          // El oscilador ya puede haber terminado durante el desmontaje.
        }
        void playback.context.close().catch(() => {});
      }
      mediaCleanupRef.current?.();
      mediaCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!credential) return;
    let disposed = false;
    // Capture this effect's SIP objects so a retry cannot tear down the new
    // connection through the shared refs while the previous cleanup runs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activeUa: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let activeRegisterer: any = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      setRegState("connecting");
      setConnectionError("Restableciendo automáticamente la conexión con la central.");
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        2_000 * 2 ** Math.min(registrationAttempt, 3)
      );
      reconnectTimer = setTimeout(() => {
        if (!disposed) setRegistrationAttempt((attempt) => attempt + 1);
      }, delay);
    }

    async function register(sipUser: string, sipPassword: string) {
      setRegState("connecting");
      setConnectionError(null);
      try {
        const { UserAgent, Registerer, RegistererState } = await import("sip.js");
        // En PJSIP el usuario del REGISTER debe coincidir con el nombre del
        // AOR. Endpoint y AOR comparten la extensión, aunque sean objetos de
        // tipos distintos en Asterisk.
        const uri = UserAgent.makeURI(`sip:${sipUser}@${SIP_DOMAIN}`);
        if (!uri) throw new Error("URI SIP inválida");

        const ua = new UserAgent({
          uri,
          authorizationUsername: sipUser,
          authorizationPassword: sipPassword,
          transportOptions: { server: SIP_WSS_SERVER, traceSip: false },
          logLevel: "error",
        });

        ua.delegate = {
          onInvite: (invitation: unknown) => incomingInviteHandlerRef.current(invitation),
        };

        await ua.start();
        activeUa = ua;
        if (disposed) {
          await ua.stop();
          return;
        }
        uaRef.current = ua;

        const registerer = new Registerer(ua);
        activeRegisterer = registerer;
        registererRef.current = registerer;
        registerer.stateChange.addListener((state: unknown) => {
          if (disposed) return;
          if (state === RegistererState.Registered) {
            setRegState("registered");
            setConnectionError(null);
          } else if (
            state === RegistererState.Unregistered ||
            state === RegistererState.Terminated
          ) {
            scheduleReconnect();
          }
        });

        await registerer.register();
      } catch (err) {
        console.error("CTI: fallo al registrar softphone", err);
        if (!disposed) {
          scheduleReconnect();
        }
      }
    }

    register(credential.extension, credential.sip_password);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      activeRegisterer?.unregister().catch(() => {});
      activeUa?.stop().catch(() => {});
      if (registererRef.current === activeRegisterer) registererRef.current = null;
      if (uaRef.current === activeUa) uaRef.current = null;
    };
  }, [credential, registrationAttempt]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attachRemoteAudio(session: any) {
    mediaCleanupRef.current?.();

    const handler = session.sessionDescriptionHandler;
    const pc = handler?.peerConnection as RTCPeerConnection | undefined;
    const audio = audioRef.current;
    if (!pc || !audio) {
      console.error("CTI: sesión establecida sin PeerConnection o salida de audio");
      return;
    }

    // SIP.js mantiene este stream actualizado cuando llegan tracks. Usarlo
    // evita perder el audio si el evento track ocurre después de Established.
    const remoteStream =
      (handler.remoteMediaStream as MediaStream | undefined) ?? new MediaStream();
    if (!handler.remoteMediaStream) {
      pc.getReceivers().forEach((receiver) => {
        if (receiver.track) remoteStream.addTrack(receiver.track);
      });
    }
    audio.srcObject = remoteStream;

    const playRemoteAudio = () => {
      void audio.play().catch((err) => {
        console.error("CTI: el navegador rechazó la reproducción del audio remoto", err);
      });
    };
    remoteStream.addEventListener("addtrack", playRemoteAudio);
    playRemoteAudio();

    const statsTimer = setInterval(() => {
      void pc
        .getStats()
        .then((stats) => {
          const audioStats: Record<string, unknown>[] = [];
          stats.forEach((report) => {
            if (
              (report.type === "inbound-rtp" || report.type === "outbound-rtp") &&
              (report.kind === "audio" || report.mediaType === "audio")
            ) {
              audioStats.push({
                direction: report.type,
                bytesSent: report.bytesSent,
                bytesReceived: report.bytesReceived,
                packetsSent: report.packetsSent,
                packetsReceived: report.packetsReceived,
                packetsLost: report.packetsLost,
                jitter: report.jitter,
              });
            }
          });
          console.info("CTI: estado RTP", {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            localAudioTracks: pc.getSenders().flatMap((sender) =>
              sender.track?.kind === "audio"
                ? [
                    {
                      enabled: sender.track.enabled,
                      muted: sender.track.muted,
                      readyState: sender.track.readyState,
                    },
                  ]
                : []
            ),
            audioStats,
          });
        })
        .catch((err) => console.error("CTI: no se pudieron leer estadísticas RTP", err));
    }, 5_000);

    mediaCleanupRef.current = () => {
      clearInterval(statsTimer);
      remoteStream.removeEventListener("addtrack", playRemoteAudio);
      audio.pause();
      audio.srcObject = null;
    };
  }

  function detachRemoteAudio() {
    mediaCleanupRef.current?.();
    mediaCleanupRef.current = null;
  }

  function stopLocalRingback() {
    const playback = ringbackRef.current;
    ringbackRef.current = null;
    if (!playback) return;

    if (playback.cadenceTimer) clearTimeout(playback.cadenceTimer);
    try {
      playback.oscillator.stop();
    } catch {
      // Puede detenerse más de una vez si SIP termina al mismo tiempo que el usuario cuelga.
    }
    playback.oscillator.disconnect();
    playback.gain.disconnect();
    void playback.context.close().catch(() => {});
  }

  function startLocalRingback() {
    stopLocalRingback();

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 425;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();

    const playback: RingbackPlayback = {
      context,
      oscillator,
      gain,
      cadenceTimer: null,
    };
    ringbackRef.current = playback;

    function setCadence(audible: boolean) {
      if (ringbackRef.current !== playback) return;
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(audible ? 0.07 : 0, now + 0.025);
      playback.cadenceTimer = setTimeout(
        () => setCadence(!audible),
        audible ? 1_000 : 4_000
      );
    }

    // Se reanuda dentro del clic del usuario para respetar la política de
    // reproducción automática del navegador.
    void context
      .resume()
      .then(() => setCadence(true))
      .catch(() => {
        if (ringbackRef.current === playback) stopLocalRingback();
      });
  }

  function playConnectedChime() {
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = new AudioContextConstructor();
    void context
      .resume()
      .then(() => {
        [659, 880].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + index * 0.13;
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.08, start + 0.015);
          gain.gain.linearRampToValueAtTime(0, start + 0.11);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.12);
        });
        setTimeout(() => void context.close().catch(() => {}), 450);
      })
      .catch(() => void context.close().catch(() => {}));
  }

  function rememberRecent(phone: string, name: string | null) {
    const entry: DialerRecent = {
      phone,
      name,
      calledAt: new Date().toISOString(),
    };
    setRecents((current) => {
      const next = [entry, ...current.filter((item) => item.phone !== phone)].slice(0, 16);
      try {
        window.localStorage.setItem(recentStorageKey, JSON.stringify(next));
      } catch (err) {
        console.error("CTI: no se pudo guardar el número reciente", err);
      }
      return next;
    });
  }

  function selectDialTarget(phone: string, name: string | null = null) {
    const nextSubscriber = subscriberFromPhone(phone);
    setSubscriber(nextSubscriber);
    setSelectedName(name);
    setCallError(
      nextSubscriber.length === MOBILE_SUBSCRIBER_DIGITS
        ? null
        : "Este contacto no tiene un móvil chileno válido."
    );
    setView("keypad");
  }

  async function loadIncomingContext(callAttempt: number) {
    for (let retry = 0; retry < 8; retry += 1) {
      if (callAttemptRef.current !== callAttempt) return;
      try {
        const context = await getMyIncomingDialContext();
        if (context) {
          setIncomingContext(context);
          setSelectedName(context.full_name);
          setSubscriber(subscriberFromPhone(context.phone));
          return;
        }
      } catch (err) {
        console.error("CTI: fallo al cargar contexto de llamada automática", err);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    console.error("CTI: la llamada automática llegó sin contexto asignado");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleIncomingInvite(invitation: any) {
    if (sessionRef.current) {
      invitation.reject?.().catch(() => {});
      return;
    }

    const callAttempt = callAttemptRef.current + 1;
    callAttemptRef.current = callAttempt;
    sessionRef.current = invitation;
    setIsIncomingCall(true);
    setIncomingContext(null);
    setSelectedName(null);
    setSubscriber("");
    setMuted(false);
    setCallError(null);
    setCallState("ringing");
    setExpanded(true);
    void loadIncomingContext(callAttempt);

    try {
      const { SessionState } = await import("sip.js");
      let wasEstablished = false;
      invitation.stateChange.addListener((state: unknown) => {
        if (callAttemptRef.current !== callAttempt) return;
        switch (state) {
          case SessionState.Established:
            wasEstablished = true;
            setCallState("in_call");
            setCallStartedAt(Date.now());
            playConnectedChime();
            attachRemoteAudio(invitation);
            break;
          case SessionState.Terminated:
            if (wasEstablished) beginLegalIntercallBreak();
            detachRemoteAudio();
            setCallState("idle");
            setCallStartedAt(null);
            setIsIncomingCall(false);
            setIncomingContext(null);
            sessionRef.current = null;
            break;
          default:
            break;
        }
      });

      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });
    } catch (err) {
      console.error("CTI: fallo al contestar llamada automática", err);
      detachRemoteAudio();
      setCallState("idle");
      setCallStartedAt(null);
      setIsIncomingCall(false);
      setIncomingContext(null);
      sessionRef.current = null;
      setCallError("La central envió una llamada, pero el teléfono no pudo contestarla.");
    }
  }

  useEffect(() => {
    incomingInviteHandlerRef.current = handleIncomingInvite;
  });

  async function handleCall() {
    const target = fullChileMobile(subscriber);
    if (!target) {
      setCallError("Ingresa los 8 dígitos del móvil.");
      return;
    }
    if (!uaRef.current || regState !== "registered") {
      setCallError("El teléfono se está conectando automáticamente.");
      return;
    }

    try {
      const callAttempt = callAttemptRef.current + 1;
      callAttemptRef.current = callAttempt;
      setIsIncomingCall(false);
      setIncomingContext(null);
      setCallError(null);
      setCallState("calling");
      startLocalRingback();
      const { Inviter, SessionState, UserAgent } = await import("sip.js");
      if (callAttemptRef.current !== callAttempt) return;
      const targetUri = UserAgent.makeURI(`sip:${target}@${SIP_DOMAIN}`);
      if (!targetUri) throw new Error("Destino SIP inválido");

      const inviter = new Inviter(uaRef.current, targetUri, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
        },
      });

      sessionRef.current = inviter;

      let wasEstablished = false;
      inviter.stateChange.addListener((state: unknown) => {
        if (callAttemptRef.current !== callAttempt) return;
        switch (state) {
          case SessionState.Establishing:
            setCallState("ringing");
            break;
          case SessionState.Established:
            wasEstablished = true;
            stopLocalRingback();
            setCallState("in_call");
            setCallStartedAt(Date.now());
            attachRemoteAudio(inviter);
            break;
          case SessionState.Terminated:
            if (wasEstablished) beginLegalIntercallBreak();
            stopLocalRingback();
            detachRemoteAudio();
            setCallState("idle");
            setCallStartedAt(null);
            sessionRef.current = null;
            break;
          default:
            break;
        }
      });

      await inviter.invite();
      rememberRecent(target, selectedName);
    } catch (err) {
      console.error("CTI: fallo al originar llamada", err);
      stopLocalRingback();
      detachRemoteAudio();
      setCallState("idle");
      setCallError("No se pudo iniciar la llamada. Reintenta en unos segundos.");
    }
  }

  async function handleHangup() {
    const session = sessionRef.current;
    const wasEstablished = callState === "in_call";
    callAttemptRef.current += 1;
    stopLocalRingback();
    detachRemoteAudio();
    if (!session) {
      setCallState("idle");
      return;
    }
    setCallState("ending");
    try {
      const { SessionState } = await import("sip.js");
      if (session.state === SessionState.Established) {
        await session.bye();
      } else if (isIncomingCall && typeof session.reject === "function") {
        await session.reject();
      } else {
        await session.cancel();
      }
    } catch (err) {
      console.error("CTI: fallo al colgar", err);
    } finally {
      if (wasEstablished) beginLegalIntercallBreak();
      stopLocalRingback();
      detachRemoteAudio();
      setCallState("idle");
      setCallStartedAt(null);
      setIsIncomingCall(false);
      setIncomingContext(null);
      sessionRef.current = null;
    }
  }

  function toggleMute() {
    const session = sessionRef.current;
    const pc = session?.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const senders = pc.getSenders() as RTCRtpSender[];
    const nextMuted = !muted;
    senders.forEach((sender) => {
      if (sender.track && sender.track.kind === "audio") {
        sender.track.enabled = !nextMuted;
      }
    });
    setMuted(nextMuted);
  }

  const filteredContacts = useMemo(() => {
    const term = contactSearch.trim().toLowerCase();
    if (!term) return contacts;
    const digits = term.replace(/\D/g, "");
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(term) ||
        contact.rut?.toLowerCase().includes(term) ||
        (digits && contact.phone.replace(/\D/g, "").includes(digits))
    );
  }, [contacts, contactSearch]);

  const showStatusSelector = profile.role === "agente" && statusReasons.length > 0;
  if (!credential && !showStatusSelector) return null;

  const regTone: BadgeTone =
    regState === "registered" ? "success" : regState === "connecting" ? "warning" : "danger";
  const statusLabel =
    regState === "registered"
      ? "Teléfono conectado"
      : regState === "connecting"
        ? "Conectando..."
        : "Teléfono desconectado";
  const currentReason = statusReasons.find((reason) => reason.id === currentReasonId) ?? null;
  const availableReasons = statusReasons.filter((reason) => !reason.is_pause);
  const auxReasons = statusReasons.filter(
    (reason) => reason.is_pause && reason.code !== "auxiliar"
  );
  const agentCanCall = profile.role !== "agente" || currentReason === null || !currentReason.is_pause;
  const automaticSessionStatus =
    operatingMode?.mode === "automatic" ? operatingMode.session?.status ?? "offline" : null;
  const automaticWrapUpElapsedSeconds =
    automaticSessionStatus === "wrap_up" && operatingMode?.session?.since
      ? Math.max(
          0,
          Math.floor((now - new Date(operatingMode.session.since).getTime()) / 1000)
        )
      : 0;
  const inAutomaticWrapUp =
    automaticSessionStatus === "wrap_up" && agentCanCall;
  const inLegalIntercallBreak =
    inAutomaticWrapUp &&
    automaticWrapUpElapsedSeconds < LEGAL_INTERCALL_BREAK_SECONDS;
  const legalBreakRemaining = Math.max(
    0,
    LEGAL_INTERCALL_BREAK_SECONDS - automaticWrapUpElapsedSeconds
  );
  const automaticOperationalAvailable =
    regState === "registered" &&
    agentCanCall &&
    automaticSessionStatus === "available";
  const operationalStatusValue = inAutomaticWrapUp ? "__acw" : currentReasonId ?? "";
  const operationalStatusLabel = inLegalIntercallBreak
    ? `Interrupción legal · ${legalBreakRemaining}s`
    : "ACW · tipificación pendiente";
  const validNumber = subscriber.length === MOBILE_SUBSCRIBER_DIGITS;
  const activeCall =
    callState === "in_call" || callState === "calling" || callState === "ringing";
  const incomingFields = incomingContext
    ? Object.entries(incomingContext.extra).filter(
        ([key, value]) =>
          key.toLowerCase() !== "source" &&
          (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      )
    : [];

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-2xl">
      <audio ref={audioRef} autoPlay className="hidden" />

      {showStatusSelector && (
        <div className="flex items-center gap-3 border-b border-border bg-surface px-5 py-3">
          <StatusDot
            tone={
              inAutomaticWrapUp
                ? "warning"
                : currentReason && !currentReason.is_pause
                  ? "success"
                  : "warning"
            }
            className="h-2.5 w-2.5"
          />
          <Select
            fieldSize="sm"
            value={operationalStatusValue}
            onChange={(event) => handleStatusChange(event.target.value)}
            disabled={savingStatus || inAutomaticWrapUp}
            className="border-0 bg-surface-muted font-semibold"
            aria-label="Estado del agente"
          >
            {inAutomaticWrapUp && (
              <option value="__acw">{operationalStatusLabel}</option>
            )}
            {availableReasons.map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
            {auxReasons.length > 0 && (
              <optgroup label="AUX — selecciona un motivo">
                {auxReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    AUX · {reason.label}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
      )}

      {!credential ? null : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center justify-between gap-3 bg-[#12333b] px-5 py-4 text-left text-white"
            aria-expanded={expanded}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                <Phone size={19} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  Teléfono Atlas · {profile.full_name.split(" ")[0]}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
                  <StatusDot tone={regTone} className="h-2 w-2" />
                  {statusLabel}
                </span>
              </span>
            </span>
            {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>

          {expanded && (
            <div className="bg-surface">
              {regState !== "registered" && (
                <div
                  className="mx-4 mt-4 flex items-center gap-3 rounded-xl bg-warning-bg px-3 py-2.5 text-xs text-warning"
                >
                  <LoaderCircle className="shrink-0 animate-spin" size={16} />
                  <span className="flex-1">
                    {connectionError ?? "Conectando automáticamente el teléfono con la central..."}
                  </span>
                </div>
              )}

              {activeCall ? (
                <div className="flex min-h-80 flex-col items-center justify-center bg-[#12333b] px-6 py-8 text-white">
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    <UserRound size={28} />
                  </span>
                  {isIncomingCall && (
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
                      Llamada automática
                      {incomingContext ? ` · ${incomingContext.campaign_name}` : ""}
                    </p>
                  )}
                  <p className="text-lg font-semibold">
                    {selectedName ??
                      (isIncomingCall ? "Cargando datos del contacto..." : "Llamada saliente")}
                  </p>
                  <p className="mt-1 font-mono text-sm text-white/70">
                    {subscriber
                      ? `+56 9 ${formatSubscriber(subscriber)}`
                      : "Identificando número..."}
                  </p>
                  <p className="mt-4 text-sm text-white/75">
                    {callState === "calling" && "Marcando..."}
                    {callState === "ringing" && "Timbrando..."}
                    {callState === "in_call" &&
                      (callStartedAt ? formatElapsed(now - callStartedAt) : "En llamada")}
                  </p>
                  {isIncomingCall && incomingContext && (
                    <div className="mt-5 w-full rounded-2xl bg-white/10 p-4 text-left">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                        <ContextField label="RUT" value={incomingContext.rut ?? "No informado"} />
                        {incomingContext.email && (
                          <ContextField label="Email" value={incomingContext.email} />
                        )}
                        {incomingFields.map(([key, value]) => (
                          <ContextField key={key} label={key} value={String(value)} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-8 flex items-center gap-5">
                    {callState === "in_call" && (
                      <button
                        type="button"
                        onClick={toggleMute}
                        className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                        title={muted ? "Reactivar micrófono" : "Silenciar"}
                      >
                        {muted ? <MicOff size={20} /> : <Mic size={20} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleHangup}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white shadow-lg hover:opacity-90"
                      title="Colgar"
                    >
                      <PhoneOff size={22} />
                    </button>
                  </div>
                </div>
              ) : operatingMode === undefined ? (
                <div className="flex min-h-64 items-center justify-center gap-2 px-6 text-sm text-muted-foreground">
                  <LoaderCircle className="animate-spin" size={18} />
                  Cargando modo operativo...
                </div>
              ) : operatingMode.mode === "automatic" ? (
                <div>
                  <div className="px-4 py-4">
                    <div className="rounded-2xl bg-[#12333b] px-4 py-4 text-white shadow-inner">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                            Discado automático
                          </p>
                          <p className="mt-1 text-base font-semibold">
                            {regState !== "registered"
                              ? "Conectando teléfono..."
                              : !agentCanCall
                                ? `AUX · ${currentReason?.label ?? "Pausa"}`
                                : inLegalIntercallBreak
                                  ? `Interrupción legal · ${legalBreakRemaining}s`
                                  : inAutomaticWrapUp
                                    ? "ACW · tipificación pendiente"
                                    : automaticSessionStatus === "available"
                                      ? "Disponible"
                                      : "Sincronizando con el discador..."}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "mt-0.5 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold",
                            automaticOperationalAvailable
                              ? "bg-emerald-400/15 text-emerald-300"
                              : inAutomaticWrapUp
                                ? "bg-amber-300/15 text-amber-200"
                              : "bg-white/10 text-white/65"
                          )}
                        >
                          <StatusDot
                            tone={
                              automaticOperationalAvailable
                                ? "success"
                                : inAutomaticWrapUp || regState === "connecting"
                                  ? "warning"
                                  : "danger"
                            }
                            className="h-2 w-2"
                          />
                          {automaticOperationalAvailable
                            ? "EN ESPERA"
                            : inLegalIntercallBreak
                              ? "DESCANSO"
                              : inAutomaticWrapUp
                                ? "ACW"
                                : "NO DISPONIBLE"}
                        </span>
                      </div>

                      <p className="mt-3 text-xs leading-relaxed text-white/65">
                        {!agentCanCall
                          ? "Mientras estés en AUX no se asignarán llamadas automáticas."
                          : inLegalIntercallBreak
                            ? "Interrupción efectiva protegida: durante estos 10 segundos no debes realizar tipificación ni otra tarea."
                            : inAutomaticWrapUp
                              ? "Completa y guarda la tipificación. Después quedarás Disponible para la próxima llamada."
                              : automaticOperationalAvailable
                                ? "El discador asignará la próxima llamada. No necesitas marcar ni confirmar manualmente."
                                : "Validando tu disponibilidad con la cola automática."}
                      </p>

                      {operatingMode.campaigns.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {operatingMode.campaigns.map((campaign) => (
                            <span
                              key={campaign.id}
                              className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white/75"
                            >
                              {campaign.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {callError && (
                    <p className="mx-4 mb-3 rounded-xl bg-danger-bg px-3 py-2.5 text-xs text-danger">
                      {callError}
                    </p>
                  )}

                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock3 size={15} className="text-muted-foreground" />
                        <p className="text-sm font-semibold">Mi historial</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Actualización automática
                      </span>
                    </div>

                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {automaticHistory.length === 0 ? (
                        <EmptyDirectory
                          icon={Clock3}
                          title="Aún no hay llamadas"
                          description="Tus llamadas de campaña aparecerán aquí."
                        />
                      ) : (
                        automaticHistory.map((attempt) => (
                          <a
                            key={attempt.id}
                            href={`/dashboard/leads/${attempt.lead_id}`}
                            className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-surface-muted"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                              <Phone size={15} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {attempt.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {formatChileMobile(attempt.phone)} ·{" "}
                                {formatRecentTime(attempt.started_at)}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-1 text-[9px] font-bold",
                                automaticAttemptTone(attempt.status)
                              )}
                            >
                              {automaticAttemptLabel(attempt.status)}
                            </span>
                          </a>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-4 pt-4">
                    <div className="rounded-2xl bg-[#12333b] px-4 py-4 text-white shadow-inner">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                          Móvil Chile
                        </span>
                        {regState === "registered" ? (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
                            <Wifi size={12} />
                            En línea
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="shrink-0 font-mono text-2xl font-semibold text-white/65">
                          +56 9
                        </span>
                        <Input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="tel-national"
                          value={subscriber}
                          onChange={(event) => {
                            setSubscriber(subscriberFromPhone(event.target.value));
                            setSelectedName(null);
                            setCallError(null);
                          }}
                          placeholder="81406609"
                          className="h-auto border-0 bg-transparent p-0 font-mono text-2xl font-semibold tracking-wide text-white placeholder:text-white/25 focus-visible:ring-0"
                          aria-label="Ocho dígitos del número móvil"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSubscriber((value) => value.slice(0, -1));
                            setSelectedName(null);
                          }}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
                          title="Borrar un dígito"
                        >
                          <Delete size={16} />
                        </button>
                      </div>
                      <p className="mt-1 min-h-4 truncate text-xs text-white/55">
                        {selectedName ?? "Escribe 8 dígitos o pega el número completo"}
                      </p>
                    </div>
                  </div>

                  <div className="mx-4 mt-4 grid grid-cols-3 rounded-xl bg-surface-muted p-1">
                    {[
                      { id: "keypad" as const, label: "Teclado", icon: Grid3X3 },
                      { id: "recents" as const, label: "Recientes", icon: Clock3 },
                      { id: "contacts" as const, label: "Contactos", icon: ContactRound },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setView(item.id)}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                            view === item.id
                              ? "bg-surface text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon size={14} />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="min-h-64 px-4 py-4">
                    {view === "keypad" && (
                      <div className="mx-auto grid max-w-64 grid-cols-3 gap-2.5">
                        {KEYPAD.slice(0, 9).map((key) => (
                          <KeypadButton
                            key={key.digit}
                            digit={key.digit}
                            letters={key.letters}
                            onClick={() => {
                              setSelectedName(null);
                              setSubscriber((value) =>
                                value.length < MOBILE_SUBSCRIBER_DIGITS
                                  ? `${value}${key.digit}`
                                  : value
                              );
                            }}
                          />
                        ))}
                        <span />
                        <KeypadButton
                          digit="0"
                          letters="+"
                          onClick={() => {
                            setSelectedName(null);
                            setSubscriber((value) =>
                              value.length < MOBILE_SUBSCRIBER_DIGITS ? `${value}0` : value
                            );
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setSubscriber((value) => value.slice(0, -1));
                            setSelectedName(null);
                          }}
                          className="flex h-14 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted"
                          title="Borrar"
                        >
                          <Delete size={20} />
                        </button>
                      </div>
                    )}

                    {view === "recents" && (
                      <div className="max-h-64 space-y-1 overflow-y-auto">
                        {recents.length === 0 ? (
                          <EmptyDirectory
                            icon={Clock3}
                            title="Aún no hay llamadas"
                            description="Los números que marques aparecerán aquí."
                          />
                        ) : (
                          recents.map((recent) => (
                            <button
                              key={`${recent.phone}-${recent.calledAt}`}
                              type="button"
                              onClick={() => selectDialTarget(recent.phone, recent.name)}
                              className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted"
                            >
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
                                <Phone size={15} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold">
                                  {recent.name ?? formatChileMobile(recent.phone)}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {recent.name ? formatChileMobile(recent.phone) : "Llamada saliente"}
                                </span>
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatRecentTime(recent.calledAt)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    {view === "contacts" && (
                      <div>
                        <div className="relative mb-3">
                          <Search
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                          />
                          <Input
                            value={contactSearch}
                            onChange={(event) => setContactSearch(event.target.value)}
                            placeholder="Buscar nombre, RUT o teléfono"
                            className="pl-9"
                          />
                        </div>
                        <div className="max-h-56 space-y-1 overflow-y-auto">
                          {contactsLoading ? (
                            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                              <LoaderCircle className="animate-spin" size={16} />
                              Cargando contactos...
                            </div>
                          ) : filteredContacts.length === 0 ? (
                            <EmptyDirectory
                              icon={ContactRound}
                              title="Sin contactos"
                              description="No encontramos contactos con teléfono."
                            />
                          ) : (
                            filteredContacts.map((contact) => (
                              <button
                                key={contact.id}
                                type="button"
                                onClick={() => selectDialTarget(contact.phone, contact.name)}
                                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted"
                              >
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-foreground">
                                  {contactInitials(contact.name) || <UserRound size={15} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">
                                    {contact.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {formatChileMobile(contact.phone)}
                                  </span>
                                </span>
                                <Phone size={15} className="text-success" />
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-border px-4 py-4">
                    {callError && <p className="mb-2 text-center text-xs text-danger">{callError}</p>}
                    <button
                      type="button"
                      onClick={handleCall}
                      disabled={!validNumber || regState !== "registered" || !agentCanCall}
                      className={cn(
                        "flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40",
                        regState === "registered"
                          ? "bg-success hover:brightness-95"
                          : "bg-primary hover:bg-primary-hover"
                      )}
                    >
                      {regState !== "registered" ? (
                        <LoaderCircle className="animate-spin" size={18} />
                      ) : (
                        <Phone size={18} />
                      )}
                      {regState !== "registered"
                        ? "Preparando teléfono..."
                        : !agentCanCall
                          ? "Ponte disponible para llamar"
                          : "Llamar"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KeypadButton({
  digit,
  letters,
  onClick,
}: {
  digit: string;
  letters: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-14 flex-col items-center justify-center rounded-full bg-surface-muted text-foreground transition hover:bg-border active:scale-95"
    >
      <span className="text-xl font-semibold leading-none">{digit}</span>
      <span className="mt-1 min-h-2 text-[8px] font-bold tracking-[0.18em] text-muted-foreground">
        {letters}
      </span>
    </button>
  );
}

function EmptyDirectory({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Clock3;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-9 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
        <Icon size={19} />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function ContextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-white/45">
        {label}
      </p>
      <p className="mt-0.5 break-words font-medium text-white/90">{value}</p>
    </div>
  );
}
