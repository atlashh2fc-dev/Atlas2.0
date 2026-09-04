"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Minus,
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
  reportAgentPhoneTelemetry,
  setMyActiveCampaign,
  type AgentPhoneTelemetryPhase,
  type AgentDialerHistoryItem,
  type AgentDialerOperatingMode,
  type DialerContact,
  type IncomingDialContext,
} from "@/app/actions/agent-sip";
import {
  listActiveStatusReasons,
  getMyCurrentStatus,
  enterMyHybridManualMode,
  exitMyHybridManualMode,
  markAgentUnavailable,
  setMyCurrentStatus,
  heartbeat,
} from "@/app/actions/agent-status";
import {
  beginAgendaCallback,
  beginManualCallManagement,
  discardCallTechnicalError,
  getMyPendingCallManagement,
  registerManualCall,
  startLegalIntercallBreak,
  type ManualCallManagement,
} from "@/app/actions/calls";
import { SlideOver, StatusDot, Input, Select, type BadgeTone } from "@/components/ui";
import {
  beginLegalIntercallBreak,
  LEGAL_INTERCALL_BREAK_SECONDS,
} from "@/lib/intercall-break";
import { cn } from "@/lib/utils";
import {
  AGENT_DIAL_REQUEST_EVENT,
  AGENT_FORCE_LOGOUT_EVENT,
  AGENT_MANAGEMENT_CLOSED_EVENT,
  type AgentDialRequestEventDetail,
  type AgentForceLogoutEventDetail,
} from "@/lib/agent-control";

const HEARTBEAT_MS = 20_000;
const SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN ?? "ws-atlas.geimser.cl";
const SIP_WSS_SERVER =
  process.env.NEXT_PUBLIC_SIP_WSS_SERVER ?? `wss://${SIP_DOMAIN}:8089/ws`;
const MOBILE_SUBSCRIBER_DIGITS = 8;
const MAX_RECONNECT_DELAY_MS = 15_000;
/** Reintentos silenciosos antes de avisarle al ejecutivo que su teléfono no conecta. */
const MAX_SILENT_RECONNECT_ATTEMPTS = 3;
/**
 * El teléfono es un panel fijo abajo a la derecha y ahí mismo viven las barras
 * de acción de otras pantallas (por ejemplo el "Guardar y terminar" de la
 * tipificación). Minimizarlo a una burbuja libera esa esquina; la preferencia
 * se recuerda para no obligar al ejecutivo a repetirlo en cada gestión.
 */
const CTI_MINIMIZED_KEY = "atlas.cti.minimized";

type RegState = "idle" | "connecting" | "registered" | "error";
type PhoneIssue = AgentPhoneTelemetryPhase | null;
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
  const router = useRouter();
  const [credential, setCredential] = useState<
    { extension: string; sip_password: string } | null | undefined
  >(undefined);
  const [regState, setRegState] = useState<RegState>("idle");
  const [registrationAttempt, setRegistrationAttempt] = useState(0);
  /** Espejo síncrono de `regState === "registered"` para los efectos. */
  const registeredRef = useRef(false);
  /** El REGISTER no basta: el navegador debe poder capturar audio. */
  const mediaReadyRef = useRef(false);
  /** Evita reescribir `since` en cada render una vez confirmada la capacidad. */
  const readyStatusSyncedRef = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [phoneIssue, setPhoneIssue] = useState<PhoneIssue>(null);
  const [callState, setCallState] = useState<CallState>("idle");
  const [subscriber, setSubscriber] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  // Arranca desplegado en el servidor y en el primer render del cliente: leer
  // localStorage durante el montaje rompería la hidratación.
  const [minimizedPref, setMinimizedPref] = useState(false);
  // Con llamada en curso el panel se despliega igual: minimizado no habría
  // forma de colgar, silenciar ni ver quién llama. Al volver a reposo manda de
  // nuevo la preferencia del ejecutivo.
  const minimized = minimizedPref && callState === "idle";
  const [view, setView] = useState<DialerView>("keypad");
  const [contacts, setContacts] = useState<DialerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState("");
  const [recents, setRecents] = useState<DialerRecent[]>([]);
  const [incomingContext, setIncomingContext] = useState<IncomingDialContext | null>(null);
  // El listener SIP conserva el cierre con el estado del render en que llegó
  // el INVITE. El contexto, en cambio, se resuelve de forma asíncrona; este
  // ref evita perder el lead al colgar por usar un closure anterior.
  const incomingContextRef = useRef<IncomingDialContext | null>(null);
  const automaticManagementOpenedRef = useRef<string | null>(null);
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [operatingMode, setOperatingMode] = useState<
    AgentDialerOperatingMode | undefined
  >(
    profile.role === "agente"
      ? undefined
      : {
          mode: "manual",
          active_campaign_id: null,
          hybrid_manual_status: null,
          campaigns: [],
          session: null,
        }
  );
  const [switchingCampaign, setSwitchingCampaign] = useState(false);
  const [campaignSwitchError, setCampaignSwitchError] = useState<string | null>(null);
  const [automaticHistory, setAutomaticHistory] = useState<AgentDialerHistoryItem[]>([]);
  const [manualCampaignId, setManualCampaignId] = useState("");
  const [hybridManualMode, setHybridManualMode] = useState(false);
  const [hybridTransitionPending, setHybridTransitionPending] = useState(false);
  const [manualRecoveryOpen, setManualRecoveryOpen] = useState(false);
  const [manualRecoveryCampaignId, setManualRecoveryCampaignId] = useState("");
  const [manualRecoveryPhone, setManualRecoveryPhone] = useState("");
  const [manualRecoveryName, setManualRecoveryName] = useState("");
  const [manualRecoveryPending, setManualRecoveryPending] = useState(false);
  const [manualRecoveryError, setManualRecoveryError] = useState<string | null>(null);
  const [pendingTypificationOpening, setPendingTypificationOpening] = useState(false);

  const [statusReasons, setStatusReasons] = useState<AgentStatusReason[]>([]);
  const [currentReasonId, setCurrentReasonId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(profile.role === "agente");
  const [loadingCredential, setLoadingCredential] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registererRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const manualManagementRef = useRef<ManualCallManagement | null>(null);
  const callAttemptRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaCleanupRef = useRef<(() => void) | null>(null);
  const ringbackRef = useRef<RingbackPlayback | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomingInviteHandlerRef = useRef<(invitation: any) => void>(() => {});
  /** Bloquea cualquier reconexión SIP desde que llega una orden administrativa. */
  const forcedLogoutRef = useRef(false);

  const recentStorageKey = `atlas-cti-recents:${profile.id}`;

  function telemetryCode(error: unknown, phase: AgentPhoneTelemetryPhase): string {
    if (error instanceof DOMException && error.name) return error.name;
    if (error && typeof error === "object") {
      const candidate = (error as { code?: unknown; name?: unknown }).code ??
        (error as { name?: unknown }).name;
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    const fallback: Record<AgentPhoneTelemetryPhase, string> = {
      microphone: "MEDIA_ACCESS_FAILED",
      module: "MODULE_LOAD_FAILED",
      wss: "WSS_CONNECT_FAILED",
      register: "REGISTER_FAILED",
    };
    return fallback[phase];
  }

  function telemetryMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : "Fallo sin detalle entregado por el navegador.";
  }

  const recordPhoneTelemetry = useCallback(
    (params: {
      outcome: "failed" | "registered";
      phase: AgentPhoneTelemetryPhase;
      code: string;
      message?: string | null;
    }) => {
      void reportAgentPhoneTelemetry({
        ...params,
        attempt: registrationAttempt,
      }).catch((error) => console.error("CTI: no se pudo registrar telemetría telefónica", error));
    },
    [registrationAttempt]
  );

  function retryPhoneRegistration() {
    if (forcedLogoutRef.current) return;
    setPhoneIssue(null);
    setConnectionError(null);
    setRegState("connecting");
    setRegistrationAttempt((attempt) => attempt + 1);
  }

  useEffect(() => {
    if (profile.role !== "agente") return;

    const onForceLogout = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<AgentForceLogoutEventDetail>;
      forcedLogoutRef.current = true;
      registeredRef.current = false;
      mediaReadyRef.current = false;
      readyStatusSyncedRef.current = null;

      const shutdown = (async () => {
        callAttemptRef.current += 1;
        stopLocalRingback();
        detachRemoteAudio();

        const session = sessionRef.current;
        if (session) {
          try {
            const { SessionState } = await import("sip.js");
            if (session.state === SessionState.Established && typeof session.bye === "function") {
              await session.bye();
            } else if (typeof session.cancel === "function") {
              await session.cancel();
            } else if (typeof session.reject === "function") {
              await session.reject();
            }
          } catch (error) {
            console.error("CTI: no se pudo terminar limpiamente la llamada forzada", error);
            try { session.dispose?.(); } catch { /* ya terminó */ }
          }
        }

        sessionRef.current = null;
        try { await registererRef.current?.unregister(); } catch { /* PBX aplica fallback */ }
        try { await uaRef.current?.stop(); } catch { /* PBX aplica fallback */ }
        registererRef.current = null;
        uaRef.current = null;
        mediaCleanupRef.current?.();
        mediaCleanupRef.current = null;
      })();

      event.detail?.shutdowns.push(shutdown);
    };

    window.addEventListener(AGENT_FORCE_LOGOUT_EVENT, onForceLogout);
    return () => window.removeEventListener(AGENT_FORCE_LOGOUT_EVENT, onForceLogout);
  }, [profile.role]);

  // El handler se toma por ref porque depende del estado vivo del teléfono
  // (registro SIP, llamada en curso) y el listener se suscribe una sola vez.
  const startAgendaCallbackRef = useRef<(detail: AgentDialRequestEventDetail) => Promise<void>>(
    async () => {}
  );

  useEffect(() => {
    const onDialRequest = (event: Event) => {
      const detail = (event as CustomEvent<AgentDialRequestEventDetail>).detail;
      if (!detail?.leadId) return;
      void startAgendaCallbackRef.current(detail).catch((err) =>
        console.error("CTI: no se pudo iniciar la llamada de agenda", err)
      );
    };

    window.addEventListener(AGENT_DIAL_REQUEST_EVENT, onDialRequest);
    return () => window.removeEventListener(AGENT_DIAL_REQUEST_EVENT, onDialRequest);
  }, []);

  useEffect(() => {
    getMySipCredentials()
      .then((value) => {
        setCredential(value);
        setLoadingCredential(false);
      })
      .catch((err) => {
        console.error("CTI: fallo al obtener credenciales SIP propias", err);
        setCredential(null);
        setLoadingCredential(false);
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
      if (window.localStorage.getItem(CTI_MINIMIZED_KEY) === "1") {
        queueMicrotask(() => {
          if (!disposed) setMinimizedPref(true);
        });
      }
    } catch {
      /* la preferencia es opcional: si el storage falla, el panel queda visible */
    }
    return () => {
      disposed = true;
    };
  }, []);

  const toggleMinimized = useCallback((next: boolean) => {
    setMinimizedPref(next);
    try {
      if (next) window.localStorage.setItem(CTI_MINIMIZED_KEY, "1");
      else window.localStorage.removeItem(CTI_MINIMIZED_KEY);
    } catch {
      /* la preferencia es opcional */
    }
  }, []);

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

  const loadAgentStatus = useCallback(async () => {
    if (profile.role !== "agente") return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      // El catálogo AUX y el estado actual son independientes. Antes se
      // cargaban con Promise.all: si una consulta fallaba, desaparecía el
      // selector completo y el ejecutivo no tenía cómo reintentar.
      const [reasonsResult, currentResult] = await Promise.allSettled([
        listActiveStatusReasons(),
        getMyCurrentStatus(),
      ]);

      if (reasonsResult.status === "fulfilled") {
        const reasons = reasonsResult.value;
        setStatusReasons(reasons);

        if (currentResult.status === "fulfilled") {
          const current = currentResult.value;
          const available = reasons.find((reason) => !reason.is_pause) ?? null;
          const currentIsHybrid = current?.reason.code === "llamada_manual";
          const currentIsSelectable = Boolean(
            currentIsHybrid || (current && reasons.some((reason) => reason.id === current.reason.id))
          );
          const selected = currentIsSelectable ? current?.reason ?? null : available;
          setStatusReasons(
            currentIsHybrid && current
              ? [...reasons.filter((reason) => reason.id !== current.reason.id), current.reason]
              : reasons
          );
          setCurrentReasonId(selected?.id ?? null);
          setHybridManualMode(currentIsHybrid);

          // Solo se declara Disponible cuando el teléfono está realmente
          // registrado: marcarlo antes hacía que el discador entregara llamadas
          // a una extensión muerta y el cliente contestaba en el vacío.
          if (!currentIsSelectable && available && registeredRef.current) {
            await setMyCurrentStatus(available.id);
          }
        } else {
          const available = reasons.find((reason) => !reason.is_pause) ?? null;
          setCurrentReasonId((currentId) =>
            currentId && reasons.some((reason) => reason.id === currentId)
              ? currentId
              : available?.id ?? null
          );
          setStatusError("Los AUX están disponibles, pero no se pudo leer tu estado actual.");
          console.error("CTI: fallo al cargar estado actual", currentResult.reason);
        }
      } else {
        setStatusError("No se pudieron cargar los AUX. Reintenta.");
        console.error("CTI: fallo al cargar motivos AUX", reasonsResult.reason);
      }
    } catch (err) {
      setStatusError("No se pudieron cargar los AUX. Reintenta.");
      console.error("CTI: fallo al cargar estado de agente", err);
    } finally {
      setStatusLoading(false);
    }
  }, [profile.role]);

  useEffect(() => {
    queueMicrotask(() => void loadAgentStatus());
  }, [loadAgentStatus]);

  const refreshCurrentAgentStatus = useCallback(async () => {
    if (profile.role !== "agente") return;
    const current = await getMyCurrentStatus();
    if (!current) return;
    setStatusReasons((reasons) =>
      reasons.some((reason) => reason.id === current.reason.id)
        ? reasons
        : [...reasons, current.reason]
    );
    setCurrentReasonId(current.reason.id);
    setHybridManualMode(current.reason.code === "llamada_manual");
  }, [profile.role]);

  useEffect(() => {
    if (profile.role !== "agente") return;
    const onManagementClosed = () => {
      void refreshCurrentAgentStatus().catch((err) =>
        console.error("CTI: no se pudo refrescar el modo tras cerrar la gestión", err)
      );
    };
    window.addEventListener(AGENT_MANAGEMENT_CLOSED_EVENT, onManagementClosed);
    return () => window.removeEventListener(AGENT_MANAGEMENT_CLOSED_EVENT, onManagementClosed);
  }, [profile.role, refreshCurrentAgentStatus]);

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
    const requestedReason = statusReasons.find((reason) => reason.id === reasonId);
    if (
      requestedReason &&
      !requestedReason.is_pause &&
      (!registeredRef.current || !mediaReadyRef.current)
    ) {
      setStatusError(
        "No puedes quedar Disponible hasta conectar el teléfono y autorizar el micrófono."
      );
      return;
    }

    const previous = currentReasonId;
    setCurrentReasonId(reasonId);
    setSavingStatus(true);
    setStatusError(null);
    try {
      await setMyCurrentStatus(reasonId);
      readyStatusSyncedRef.current = requestedReason?.is_pause ? null : reasonId;
    } catch (err) {
      // Sin esto la barra mostraba el estado nuevo mientras la base seguía con
      // el anterior, y el discador actuaba según la base.
      setCurrentReasonId(previous);
      setStatusError(err instanceof Error ? err.message : "No se pudo guardar el estado.");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleActiveCampaignChange(campaignId: string) {
    if (!campaignId || operatingMode?.active_campaign_id === campaignId) return;
    setSwitchingCampaign(true);
    setCampaignSwitchError(null);
    try {
      await setMyActiveCampaign(campaignId);
      setOperatingMode((current) =>
        current ? { ...current, active_campaign_id: campaignId, session: null } : current
      );
    } catch (err) {
      setCampaignSwitchError(
        err instanceof Error ? err.message : "No se pudo cambiar la campaña activa."
      );
    } finally {
      setSwitchingCampaign(false);
    }
  }

  async function handleEnterHybridManualMode() {
    if (!effectiveManualCampaignId) {
      setCallError("Selecciona la campaña donde se registrará la llamada manual.");
      return;
    }
    setHybridTransitionPending(true);
    setCallError(null);
    try {
      await enterMyHybridManualMode(effectiveManualCampaignId);
      await refreshCurrentAgentStatus();
      setExpanded(true);
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "No se pudo activar la llamada manual."
      );
    } finally {
      setHybridTransitionPending(false);
    }
  }

  async function handleExitHybridManualMode() {
    setHybridTransitionPending(true);
    setCallError(null);
    try {
      await exitMyHybridManualMode();
      await refreshCurrentAgentStatus();
      setSubscriber("");
      setSelectedName(null);
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "No se pudo volver al discado automático."
      );
    } finally {
      setHybridTransitionPending(false);
    }
  }

  // En un alta nueva el catálogo/estado suele cargar antes que SIP. Antes la
  // UI elegía "Disponible" localmente, pero al completarse el REGISTER no se
  // persistía nada y heartbeat() actualizaba cero filas. Este efecto cierra
  // ese orden de llegada: solo publica capacidad tras micrófono + REGISTER.
  useEffect(() => {
    if (profile.role !== "agente" || regState !== "registered") return;
    const selectedReason = statusReasons.find((reason) => reason.id === currentReasonId);
    if (!selectedReason || selectedReason.is_pause || !mediaReadyRef.current) return;
    if (readyStatusSyncedRef.current === selectedReason.id) return;

    readyStatusSyncedRef.current = selectedReason.id;
    setMyCurrentStatus(selectedReason.id).catch((err) => {
      readyStatusSyncedRef.current = null;
      setStatusError(
        err instanceof Error
          ? err.message
          : "El teléfono conectó, pero no se pudo publicar la disponibilidad."
      );
    });
  }, [profile.role, regState, statusReasons, currentReasonId]);

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
      if (disposed || forcedLogoutRef.current || reconnectTimer) return;
      // Tras varios intentos fallidos el estado deja de ser "conectando" y pasa
      // a error: antes el ejecutivo veía un spinner indefinido sin saber que
      // tenía que avisar a soporte.
      const failing = registrationAttempt >= MAX_SILENT_RECONNECT_ATTEMPTS;
      setRegState(failing ? "error" : "connecting");
      if (failing) setPhoneIssue((issue) => issue ?? "register");
      registeredRef.current = false;
      setConnectionError(
        failing
          ? "No se pudo conectar el teléfono. Avisa a tu supervisor: no recibirás llamadas."
          : "Restableciendo automáticamente la conexión con la central."
      );
      // Una falla persistente no puede convertirse en un loop infinito de
      // REGISTER + escrituras de telemetría. Tras los intentos silenciosos se
      // detiene hasta que el ejecutivo use la acción manual de reintento.
      if (failing) return;
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        2_000 * 2 ** Math.min(registrationAttempt, 3)
      );
      reconnectTimer = setTimeout(() => {
        if (!disposed) setRegistrationAttempt((attempt) => attempt + 1);
      }, delay);
    }

    async function register(sipUser: string, sipPassword: string) {
      if (forcedLogoutRef.current) return;
      setRegState("connecting");
      setPhoneIssue(null);
      setConnectionError(null);
      let phase: AgentPhoneTelemetryPhase = "microphone";
      let registeredTelemetrySent = false;
      let failureTelemetrySent = false;
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          const unsupported = new Error("Este navegador no permite acceder al micrófono.");
          unsupported.name = "MediaDevicesUnavailable";
          throw unsupported;
        }
        const mediaProbe = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        mediaProbe.getTracks().forEach((track) => track.stop());
        mediaReadyRef.current = true;

        phase = "module";
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

        phase = "wss";
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
            setPhoneIssue(null);
            registeredRef.current = true;
            // Sin esto el backoff quedaba pegado en el máximo aunque el
            // registro se hubiera recuperado.
            setRegistrationAttempt(0);
            setConnectionError(null);
            if (!registeredTelemetrySent) {
              registeredTelemetrySent = true;
              recordPhoneTelemetry({
                outcome: "registered",
                phase: "register",
                code: "REGISTERED",
              });
            }
          } else if (
            state === RegistererState.Unregistered ||
            state === RegistererState.Terminated
          ) {
            if (forcedLogoutRef.current) return;
            mediaReadyRef.current = false;
            readyStatusSyncedRef.current = null;
            if (!failureTelemetrySent) {
              failureTelemetrySent = true;
              recordPhoneTelemetry({
                outcome: "failed",
                phase: "register",
                code: "REGISTER_TERMINATED",
                message: "El registro SIP terminó antes de quedar operativo.",
              });
            }
            void markAgentUnavailable().catch((err) =>
              console.error("CTI: no se pudo sacar de disponibilidad tras perder SIP", err)
            );
            scheduleReconnect();
          }
        });

        phase = "register";
        await registerer.register();
      } catch (err) {
        console.error("CTI: fallo al registrar softphone", err);
        if (!failureTelemetrySent) {
          failureTelemetrySent = true;
          recordPhoneTelemetry({
            outcome: "failed",
            phase,
            code: telemetryCode(err, phase),
            message: telemetryMessage(err),
          });
        }
        mediaReadyRef.current = false;
        registeredRef.current = false;
        readyStatusSyncedRef.current = null;
        void markAgentUnavailable().catch((statusErr) =>
          console.error("CTI: no se pudo sacar de disponibilidad tras fallo del teléfono", statusErr)
        );
        if (!disposed) {
          const permissionDenied =
            phase === "microphone" &&
            ((err instanceof DOMException && err.name === "NotAllowedError") ||
              (err instanceof Error && err.name === "MediaDevicesUnavailable"));
          if (permissionDenied || phase === "microphone") {
            setRegState("error");
            setPhoneIssue("microphone");
            setConnectionError(
              "Autoriza el micrófono en el navegador y luego presiona Reintentar teléfono."
            );
          } else {
            setPhoneIssue(phase);
            scheduleReconnect();
          }
        }
      }
    }

    register(credential.extension, credential.sip_password);

    return () => {
      disposed = true;
      mediaReadyRef.current = false;
      registeredRef.current = false;
      readyStatusSyncedRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      activeRegisterer?.unregister().catch(() => {});
      activeUa?.stop().catch(() => {});
      if (registererRef.current === activeRegisterer) registererRef.current = null;
      if (uaRef.current === activeUa) uaRef.current = null;
    };
  }, [credential, registrationAttempt, recordPhoneTelemetry]);

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

  function openManualManagement(management: ManualCallManagement) {
    manualManagementRef.current = null;
    router.push(`/dashboard/leads/${management.leadId}`);
    router.refresh();
  }

  function openAutomaticManagement(context: IncomingDialContext | null) {
    if (!context) return;
    if (automaticManagementOpenedRef.current === context.dial_attempt_id) return;
    automaticManagementOpenedRef.current = context.dial_attempt_id;
    // El screen-pop debe ocurrir apenas el motor confirma qué ejecutivo tomó
    // la llamada. Así la ficha 360 completa queda visible durante la
    // conversación y no recién después del corte. Al colgar, esta misma URL
    // conserva la gestión destacada para completar la tipificación.
    setExpanded(false);
    router.push(`/dashboard/leads/${context.lead_id}?tipificar=1`);
    router.refresh();
  }

  async function handleOpenPendingTypification() {
    setPendingTypificationOpening(true);
    setCallError(null);
    try {
      const pending = await getMyPendingCallManagement();
      if (!pending) {
        // Ya no hay gestión abierta: la acción liberó el ACW colgado, así que
        // esto no es un error sino el desbloqueo. El estado se refresca solo
        // con el sondeo del modo de operación.
        setCallError(
          "No quedaban gestiones por tipificar. Tu estado volvió a disponible."
        );
        return;
      }
      setExpanded(false);
      router.push(`/dashboard/leads/${pending.leadId}?tipificar=1`);
      router.refresh();
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "No se pudo abrir la tipificación pendiente."
      );
    } finally {
      setPendingTypificationOpening(false);
    }
  }

  function discardUnconnectedManualManagement(management: ManualCallManagement) {
    if (manualManagementRef.current?.callId !== management.callId) return;
    manualManagementRef.current = null;
    void discardCallTechnicalError({
      callId: management.callId,
      leadId: management.leadId,
      reason: "La llamada manual no llegó a establecerse.",
    })
      .then(() => refreshCurrentAgentStatus())
      .catch((err) =>
        console.error("CTI: no se pudo descartar la gestión manual no conectada", err)
      );
  }

  function openManualRecovery() {
    const campaignId = operatingMode?.session?.campaign_id ?? "";
    setManualRecoveryCampaignId(campaignId);
    setManualRecoveryPhone(subscriber);
    setManualRecoveryName("");
    setManualRecoveryError(null);
    setManualRecoveryOpen(true);
  }

  async function handleManualRecovery() {
    const target = fullChileMobile(subscriberFromPhone(manualRecoveryPhone));
    if (!target) {
      setManualRecoveryError("Ingresa los 8 dígitos del móvil que se llamó.");
      return;
    }
    if (!manualRecoveryCampaignId) {
      setManualRecoveryError("No se pudo identificar la campaña que está en cierre.");
      return;
    }

    setManualRecoveryPending(true);
    setManualRecoveryError(null);
    try {
      const result = await beginManualCallManagement({
        campaignId: manualRecoveryCampaignId,
        phone: target,
        contactName: manualRecoveryName,
        entryMode: "after_call",
      });
      if (!result.ok) {
        setManualRecoveryError(result.error);
        return;
      }
      setManualRecoveryOpen(false);
      openManualManagement(result.data);
    } catch (err) {
      setManualRecoveryError(
        err instanceof Error ? err.message : "No se pudo registrar la llamada manual."
      );
    } finally {
      setManualRecoveryPending(false);
    }
  }

  async function loadIncomingContext(callAttempt: number) {
    for (let retry = 0; retry < 8; retry += 1) {
      if (callAttemptRef.current !== callAttempt) return;
      try {
        const context = await getMyIncomingDialContext();
        if (context) {
          incomingContextRef.current = context;
          setIncomingContext(context);
          setSelectedName(context.full_name);
          setSubscriber(subscriberFromPhone(context.phone));
          // Realtime mantiene el screen-pop como canal principal, pero esta
          // apertura directa desde el INVITE evita depender de la entrega del
          // evento: en cuanto el intento ya está asignado y la llamada abierta
          // existe, cargamos nombre, base, contactos e historial en el CRM.
          openAutomaticManagement(context);
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
    if (sessionRef.current || hybridManualMode) {
      invitation.reject?.().catch(() => {});
      return;
    }

    const callAttempt = callAttemptRef.current + 1;
    callAttemptRef.current = callAttempt;
    sessionRef.current = invitation;
    setIsIncomingCall(true);
    incomingContextRef.current = null;
    automaticManagementOpenedRef.current = null;
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
            const finishedContext = incomingContextRef.current;
            if (wasEstablished) {
              beginLegalIntercallBreak();
              // El servidor es el que manda: en el navegador solo sirve para que el
              // contador se vea al instante.
              void startLegalIntercallBreak().catch((err) =>
                console.error("CTI: no se pudo registrar la interrupción legal", err)
              );
              // Una llamada automática no puede terminar dejando al agente en
              // el teclado o en otra pantalla: siempre vuelve a su gestión.
              openAutomaticManagement(finishedContext);
            }
            detachRemoteAudio();
            setCallState("idle");
            setCallStartedAt(null);
            setIsIncomingCall(false);
            incomingContextRef.current = null;
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
      incomingContextRef.current = null;
      setIncomingContext(null);
      sessionRef.current = null;
      setCallError("La central envió una llamada, pero el teléfono no pudo contestarla.");
    }
  }

  useEffect(() => {
    incomingInviteHandlerRef.current = handleIncomingInvite;
  });

  /**
   * `preopened` llega cuando la gestión ya fue abierta por otra pantalla (hoy
   * el rescate de agenda): el destino y la campaña vienen resueltos por el
   * servidor y no hay que volver a pedir una llamada manual, que además está
   * bloqueada cuando la campaña es automática.
   */
  async function handleCall(preopened?: {
    management: ManualCallManagement;
    subscriber: string;
    contactName: string | null;
  }) {
    const target = fullChileMobile(preopened?.subscriber ?? subscriber);
    if (!target) {
      setCallError("Ingresa los 8 dígitos del móvil.");
      return;
    }
    if (!uaRef.current || regState !== "registered") {
      setCallError("El teléfono se está conectando automáticamente.");
      return;
    }

    let management: ManualCallManagement | null = preopened?.management ?? null;
    const contactName = preopened ? preopened.contactName : selectedName;
    try {
      if (profile.role === "agente" && !management) {
        const campaignId =
          manualCampaignId ||
          (operatingMode?.campaigns.filter((campaign) => campaign.manual_dial_enabled).length === 1
            ? operatingMode.campaigns.find((campaign) => campaign.manual_dial_enabled)?.id ?? ""
            : "");
        if (!campaignId) {
          setCallError("Selecciona la campaña donde se registrará la llamada.");
          return;
        }
        const result = await beginManualCallManagement({
          campaignId,
          phone: target,
          contactName,
          entryMode: "before_dial",
        });
        if (!result.ok) {
          setCallError(result.error);
          return;
        }
        management = result.data;
      }
      if (management) manualManagementRef.current = management;

      // En llamadas manuales/híbridas la ficha se abría recién al colgar.
      // La gestión ya existe aquí, así que hacemos el screen-pop antes de
      // originar para tener Agenda Reunión y notas durante la conversación.
      if (profile.role === "agente" && management) {
        setExpanded(false);
        router.push(`/dashboard/leads/${management.leadId}?tipificar=1`);
        router.refresh();
      }

      const callAttempt = callAttemptRef.current + 1;
      callAttemptRef.current = callAttempt;
      setIsIncomingCall(false);
      setIncomingContext(null);
      setCallError(null);
      setCallState("calling");
      startLocalRingback();

      // Supervisión y administración conservan el registro técnico previo.
      // Para ejecutivos, `beginManualCallManagement` ya dejó una gestión
      // tipificable y auditada antes de originar la llamada.
      if (profile.role !== "agente") {
        void registerManualCall({
          phone: target,
          leadId: contacts.find((contact) => subscriberFromPhone(contact.phone) === subscriber)?.id ?? null,
          contactName: selectedName,
        }).catch((err) => console.error("CTI: no se pudo registrar la llamada manual", err));
      }
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
            if (wasEstablished) {
              beginLegalIntercallBreak();
              // El servidor es el que manda: en el navegador solo sirve para que el
              // contador se vea al instante.
              void startLegalIntercallBreak().catch((err) =>
                console.error("CTI: no se pudo registrar la interrupción legal", err)
              );
              if (management) openManualManagement(management);
            } else if (management) {
              discardUnconnectedManualManagement(management);
            }
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
      rememberRecent(target, contactName);
    } catch (err) {
      console.error("CTI: fallo al originar llamada", err);
      stopLocalRingback();
      detachRemoteAudio();
      // Sin limpiar la referencia, el CTI creía tener una llamada viva y
      // rechazaba en silencio todas las entrantes por el resto del turno.
      sessionRef.current = null;
      setCallState("idle");
      if (management) discardUnconnectedManualManagement(management);
      setCallError("No se pudo iniciar la llamada. Reintenta en unos segundos.");
    }
  }

  /**
   * Rescate de un compromiso de la agenda. La gestión la abre el servidor —es
   * lo único que puede saltarse el bloqueo de marcado manual en campañas
   * automáticas— y aquí solo se origina y se hace screen-pop de la ficha.
   */
  async function startAgendaCallback(detail: AgentDialRequestEventDetail) {
    setExpanded(true);
    setCallError(null);

    if (callState !== "idle") {
      setCallError("Termina la llamada en curso antes de marcar otro compromiso.");
      return;
    }

    const result = await beginAgendaCallback(detail.leadId);
    if (!result.ok) {
      setCallError(result.error);
      return;
    }

    const { leadId, callId, campaignId, subscriber: target, fullName } = result.data;
    setSelectedName(fullName);
    setSubscriber(target);

    // La ficha se abre antes de que conteste, igual que en el discado
    // automático: el ejecutivo necesita el contexto durante la conversación.
    router.push(`/dashboard/leads/${leadId}`);

    await handleCall({
      management: { leadId, callId, campaignId, leadCreated: false, leadReused: true },
      subscriber: target,
      contactName: fullName,
    });
  }

  useEffect(() => {
    startAgendaCallbackRef.current = startAgendaCallback;
  });

  async function handleHangup() {
    const session = sessionRef.current;
    const wasEstablished = callState === "in_call";
    const management = manualManagementRef.current;
    const automaticContext = incomingContextRef.current;
    stopLocalRingback();
    detachRemoteAudio();
    if (!session) {
      callAttemptRef.current += 1;
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
      // Si terminar la sesión falla (carrera típica al colgar justo cuando el
      // remoto contesta), se fuerza el cierre: antes la interfaz volvía al
      // teclado y la llamada podía seguir viva con el cliente al aire.
      console.error("CTI: fallo al colgar", err);
      try {
        session.dispose?.();
      } catch {
        // La sesión ya puede estar liberada.
      }
    } finally {
      // El contador se incrementa recién acá: hacerlo antes anulaba los
      // listeners de estado y se perdía el desenlace real de la sesión.
      callAttemptRef.current += 1;
      if (wasEstablished) {
        beginLegalIntercallBreak();
        // El servidor es el que manda: en el navegador solo sirve para que el
        // contador se vea al instante.
        void startLegalIntercallBreak().catch((err) =>
          console.error("CTI: no se pudo registrar la interrupción legal", err)
        );
        if (management && manualManagementRef.current?.callId === management.callId) {
          openManualManagement(management);
        }
        if (isIncomingCall) openAutomaticManagement(automaticContext);
      } else if (management) {
        discardUnconnectedManualManagement(management);
      }
      stopLocalRingback();
      detachRemoteAudio();
      setCallState("idle");
      setCallStartedAt(null);
      setIsIncomingCall(false);
      incomingContextRef.current = null;
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

  const showStatusSelector = profile.role === "agente";
  if (!credential && !showStatusSelector) return null;

  const regTone: BadgeTone =
    regState === "registered" ? "success" : regState === "connecting" ? "warning" : "danger";
  const statusLabel =
    regState === "registered"
      ? "Teléfono conectado"
      : regState === "connecting"
        ? "Conectando..."
        : phoneIssue === "microphone"
          ? "Micrófono bloqueado"
          : "Teléfono desconectado";
  const currentReason = statusReasons.find((reason) => reason.id === currentReasonId) ?? null;
  const availableReasons = statusReasons.filter((reason) => !reason.is_pause && !reason.is_system);
  const auxReasons = statusReasons.filter(
    (reason) => reason.is_pause && !reason.is_system && reason.code !== "auxiliar"
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
    Boolean(operatingMode?.active_campaign_id) &&
    automaticSessionStatus === "available";
  const operationalStatusValue = inAutomaticWrapUp ? "__acw" : currentReasonId ?? "";
  const operationalStatusLabel = inLegalIntercallBreak
    ? `Interrupción legal · ${legalBreakRemaining}s`
    : "Cerrando gestión · falta tipificar";
  const validNumber = subscriber.length === MOBILE_SUBSCRIBER_DIGITS;
  const activeCall =
    callState === "in_call" || callState === "calling" || callState === "ringing";
  const manualCampaigns =
    operatingMode?.campaigns.filter((campaign) => campaign.manual_dial_enabled) ?? [];
  const effectiveManualCampaignId =
    manualCampaignId || (manualCampaigns.length === 1 ? manualCampaigns[0].id : "");
  const hybridQueueReady = operatingMode?.hybrid_manual_status === "ready";
  const manualDialAllowed =
    profile.role !== "agente" || (hybridManualMode ? hybridQueueReady : agentCanCall);
  const manualRecoveryCampaign = operatingMode?.campaigns.find(
    (campaign) => campaign.id === manualRecoveryCampaignId
  );
  const activeAutomaticCampaign = operatingMode?.campaigns.find(
    (campaign) => campaign.id === operatingMode.active_campaign_id
  );
  const incomingFields = incomingContext
    ? Object.entries(incomingContext.extra).filter(
        ([key, value]) =>
          key.toLowerCase() !== "source" &&
          (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      )
    : [];

  if (minimized) {
    // El <audio> tiene que seguir montado: es el destino del stream SIP y
    // desmontarlo cortaría el audio de una llamada que entre estando minimizado.
    return (
      <>
        <audio ref={audioRef} autoPlay className="hidden" />
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2">
          {showStatusSelector && (
            <>
              <Select
                fieldSize="sm"
                value={operationalStatusValue}
                onChange={(event) => handleStatusChange(event.target.value)}
                disabled={savingStatus || hybridManualMode || statusLoading || statusReasons.length === 0}
                className="w-[min(17rem,calc(100vw-6rem))] border-border bg-surface font-semibold shadow-xl"
                aria-label="Estado del agente"
                title={statusError ?? "Disponible o AUX"}
              >
                {statusReasons.length === 0 && (
                  <option value="">
                    {statusLoading ? "Cargando Disponible / AUX..." : "AUX no disponible"}
                  </option>
                )}
                {hybridManualMode && currentReason && (
                  <option value={currentReason.id}>AUX · Llamada manual</option>
                )}
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
              {statusError && !statusLoading && (
                <button
                  type="button"
                  onClick={() => void loadAgentStatus()}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-xs font-semibold shadow-xl"
                >
                  Reintentar AUX
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => toggleMinimized(false)}
            title="Abrir Teléfono Atlas"
            aria-label="Abrir Teléfono Atlas"
            className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#12333b] text-white shadow-2xl transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Phone size={20} />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface">
              <StatusDot
                tone={inAutomaticWrapUp ? "warning" : regTone}
                className="h-2.5 w-2.5"
              />
            </span>
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] border border-border bg-surface shadow-2xl">
      <audio ref={audioRef} autoPlay className="hidden" />

      <SlideOver
        open={manualRecoveryOpen}
        onClose={() => {
          if (!manualRecoveryPending) setManualRecoveryOpen(false);
        }}
        title="Registrar llamada manual"
        description={
          manualRecoveryCampaign
            ? `La gestión quedará en ${manualRecoveryCampaign.name} para que puedas tipificarla y cerrar el estado pendiente.`
            : "Registra la llamada que se realizó fuera de la base para poder tipificarla."
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setManualRecoveryOpen(false)}
              disabled={manualRecoveryPending}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleManualRecovery}
              disabled={manualRecoveryPending}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {manualRecoveryPending ? "Creando gestión…" : "Ir a tipificar"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {manualRecoveryError && (
            <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
              {manualRecoveryError}
            </p>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Número llamado</span>
            <Input
              value={manualRecoveryPhone}
              onChange={(event) => setManualRecoveryPhone(event.target.value)}
              inputMode="numeric"
              placeholder="81406609"
              data-autofocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Nombre del contacto (opcional)</span>
            <Input
              value={manualRecoveryName}
              onChange={(event) => setManualRecoveryName(event.target.value)}
              placeholder="Se puede completar después"
            />
          </label>
        </div>
      </SlideOver>

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
            // Nunca se bloquea del todo: aunque esté cerrando la gestión, el
            // ejecutivo tiene que poder irse a AUX (baño, colación).
            disabled={savingStatus || hybridManualMode || statusLoading || statusReasons.length === 0}
            className="border-0 bg-surface-muted font-semibold"
            aria-label="Estado del agente"
          >
            {statusReasons.length === 0 && (
              <option value="">
                {statusLoading ? "Cargando Disponible / AUX..." : "AUX no disponible"}
              </option>
            )}
            {hybridManualMode && currentReason && (
              <option value={currentReason.id}>AUX · Llamada manual</option>
            )}
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

          {statusError && (
            <div className="ml-auto flex items-center gap-2">
              <span role="alert" className="text-xs text-danger">
                {statusError}
              </span>
              {!statusLoading && (
                <button
                  type="button"
                  onClick={() => void loadAgentStatus()}
                  className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                >
                  Reintentar AUX
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!credential ? (
        // Antes esta barra simplemente no aparecía: el ejecutivo sin extensión
        // no tenía forma de saber por qué no tiene teléfono.
        loadingCredential ? null : (
          <div className="border-t border-border bg-surface px-5 py-3 text-xs text-muted-foreground">
            Aún no tienes una extensión telefónica asignada. Avísale a tu supervisor para poder
            recibir y hacer llamadas.
          </div>
        )
      ) : (
        <>
          <div className="relative">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-between gap-3 bg-[#12333b] py-4 pl-5 pr-14 text-left text-white"
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

            {!activeCall && (
              // Colapsar el panel no basta: la cabecera sigue cubriendo la
              // esquina donde otras pantallas dejan sus botones de guardado.
              <button
                type="button"
                onClick={() => toggleMinimized(true)}
                title="Minimizar teléfono"
                aria-label="Minimizar teléfono"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <Minus size={18} />
              </button>
            )}
          </div>

          {inAutomaticWrapUp && !expanded && (
            <div className="border-b border-warning/30 bg-warning-bg p-2.5">
              <button
                type="button"
                onClick={handleOpenPendingTypification}
                disabled={pendingTypificationOpening}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-warning px-3 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {pendingTypificationOpening ? "Abriendo gestión…" : "Completar tipificación"}
              </button>
            </div>
          )}

          {expanded && (
            <div className="bg-surface">
              {regState !== "registered" && (
                <div
                  className={cn(
                    "mx-4 mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs",
                    regState === "error"
                      ? "bg-danger-bg text-danger"
                      : "bg-warning-bg text-warning"
                  )}
                >
                  {regState === "error" ? (
                    phoneIssue === "microphone" ? (
                      <MicOff className="shrink-0" size={16} />
                    ) : (
                      <PhoneOff className="shrink-0" size={16} />
                    )
                  ) : (
                    <LoaderCircle className="shrink-0 animate-spin" size={16} />
                  )}
                  <div className="flex flex-1 items-center justify-between gap-3">
                    <span>
                      {connectionError ?? "Conectando automáticamente el teléfono con la central..."}
                    </span>
                    {regState === "error" && (
                      <button
                        type="button"
                        onClick={retryPhoneRegistration}
                        className="shrink-0 rounded-lg border border-current/30 px-2.5 py-1.5 font-semibold hover:bg-black/5"
                      >
                        Reintentar teléfono
                      </button>
                    )}
                  </div>
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
              ) : operatingMode.mode === "automatic" && !hybridManualMode ? (
                <div>
                  <div className="px-4 py-4">
                    <div className="rounded-2xl bg-[#12333b] px-4 py-4 text-white shadow-inner">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">
                            Discado automático
                          </p>
                          <p className="mt-1 text-base font-semibold">
                            {regState === "error"
                              ? statusLabel
                              : regState !== "registered"
                                ? "Conectando teléfono..."
                              : !agentCanCall
                                ? `AUX · ${currentReason?.label ?? "Pausa"}`
                                : !operatingMode.active_campaign_id
                                  ? "Elige una campaña"
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
                          : !operatingMode.active_campaign_id
                            ? "Selecciona el skill que operarás ahora para entrar solamente a esa cola."
                          : inLegalIntercallBreak
                            ? "Interrupción efectiva protegida: durante estos 10 segundos no debes realizar tipificación ni otra tarea."
                            : inAutomaticWrapUp
                              ? "Completa y guarda la tipificación. Después quedarás Disponible para la próxima llamada."
                              : automaticOperationalAvailable
                                ? "El discador asignará la próxima llamada. No necesitas marcar ni confirmar manualmente."
                                : "Validando tu disponibilidad con la cola automática."}
                      </p>

                      {manualCampaigns.length > 0 && !inAutomaticWrapUp && (
                        <div className="mt-4 rounded-xl border border-white/15 bg-white/5 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
                            Marcación manual
                          </p>
                          {manualCampaigns.length > 1 && (
                            <select
                              value={effectiveManualCampaignId}
                              onChange={(event) => setManualCampaignId(event.target.value)}
                              disabled={hybridTransitionPending}
                              className="mt-2 w-full rounded-lg border border-white/15 bg-white/10 px-2.5 py-2 text-xs font-semibold text-white outline-none disabled:opacity-60"
                              aria-label="Campaña para la llamada manual"
                            >
                              <option value="" className="text-foreground">Seleccionar campaña…</option>
                              {manualCampaigns.map((campaign) => (
                                <option key={campaign.id} value={campaign.id} className="text-foreground">
                                  {campaign.name}
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleEnterHybridManualMode()}
                            disabled={
                              hybridTransitionPending ||
                              activeCall ||
                              regState !== "registered" ||
                              !effectiveManualCampaignId
                            }
                            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#12333b] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {hybridTransitionPending ? (
                              <LoaderCircle className="animate-spin" size={15} />
                            ) : (
                              <Phone size={15} />
                            )}
                            {hybridTransitionPending ? "Saliendo de la cola…" : "Hacer llamada manual"}
                          </button>
                        </div>
                      )}

                      {automaticSessionStatus === "wrap_up" && operatingMode.session && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleOpenPendingTypification}
                            disabled={pendingTypificationOpening}
                            className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#12333b] transition hover:bg-white/90 disabled:opacity-60"
                          >
                            {pendingTypificationOpening ? "Abriendo gestión…" : "Completar tipificación"}
                          </button>
                          <button
                            type="button"
                            onClick={openManualRecovery}
                            className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                          >
                            Registrar llamada manual
                          </button>
                        </div>
                      )}

                      {operatingMode.campaigns.length > 0 && (
                        <label className="mt-4 block">
                          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">
                            Campaña activa
                          </span>
                          <select
                            value={operatingMode.active_campaign_id ?? ""}
                            onChange={(event) => void handleActiveCampaignChange(event.target.value)}
                            disabled={switchingCampaign || activeCall || inAutomaticWrapUp}
                            className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Campaña activa para recibir llamadas"
                          >
                            <option value="" className="text-foreground">Seleccionar campaña…</option>
                            {operatingMode.campaigns
                              .filter((campaign) => campaign.dial_mode !== "manual")
                              .map((campaign) => (
                                <option key={campaign.id} value={campaign.id} className="text-foreground">
                                  {campaign.name}
                                </option>
                              ))}
                          </select>
                          <span className="mt-1.5 block text-[10px] text-white/55">
                            {switchingCampaign
                              ? "Cambiando de cola…"
                              : activeAutomaticCampaign
                                ? `Recibirás llamadas de ${activeAutomaticCampaign.name}.`
                                : "No recibirás llamadas hasta elegir una campaña."}
                          </span>
                          {campaignSwitchError && (
                            <span role="alert" className="mt-1.5 block text-[10px] font-medium text-red-200">
                              {campaignSwitchError}
                            </span>
                          )}
                        </label>
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
                    {hybridManualMode && (
                      <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-foreground">Modo llamada manual</p>
                            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                              {hybridQueueReady
                                ? "La PBX confirmó que estás fuera de la cola automática."
                                : "Esperando confirmación de pausa desde Asterisk…"}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleExitHybridManualMode()}
                            disabled={hybridTransitionPending || activeCall}
                            className="shrink-0 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-foreground disabled:opacity-50"
                          >
                            {hybridTransitionPending ? "Saliendo…" : "Cancelar"}
                          </button>
                        </div>
                      </div>
                    )}
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

                    {profile.role === "agente" && (
                      <label className="mt-3 block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          Campaña de la llamada
                        </span>
                        {manualCampaigns.length ? (
                          <Select
                            value={effectiveManualCampaignId}
                            onChange={(event) => setManualCampaignId(event.target.value)}
                            aria-label="Campaña de la llamada manual"
                          >
                            <option value="">Selecciona una campaña</option>
                            {manualCampaigns.map((campaign) => (
                              <option key={campaign.id} value={campaign.id}>
                                {campaign.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <p className="rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
                            No tienes habilitado el modo híbrido en ninguna campaña activa.
                          </p>
                        )}
                      </label>
                    )}
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
                      onClick={() => void handleCall()}
                      disabled={
                        !validNumber ||
                        regState !== "registered" ||
                        !manualDialAllowed ||
                        (profile.role === "agente" && !effectiveManualCampaignId)
                      }
                      className={cn(
                        "flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40",
                        regState === "registered"
                          ? "bg-success hover:brightness-95"
                          : "bg-primary hover:bg-primary-hover"
                      )}
                    >
                      {regState === "connecting" ? (
                        <LoaderCircle className="animate-spin" size={18} />
                      ) : regState === "error" ? (
                        phoneIssue === "microphone" ? (
                          <MicOff size={18} />
                        ) : (
                          <PhoneOff size={18} />
                        )
                      ) : (
                        <Phone size={18} />
                      )}
                      {regState === "error"
                        ? statusLabel
                        : regState !== "registered"
                          ? "Preparando teléfono..."
                        : hybridManualMode && !hybridQueueReady
                          ? "Esperando pausa de Asterisk…"
                        : !manualDialAllowed
                          ? "Ponte disponible para llamar"
                          : profile.role === "agente" && !effectiveManualCampaignId
                            ? "Selecciona una campaña"
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
