"use client";

import { markScreenPop } from "@/components/screen-pop-timing";
import { fetchIncomingDialContextDirect } from "@/lib/incoming-context-client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import type { Profile, AgentStatusReason } from "@/lib/types";
import {
  getMyDialerOperatingMode,
  getMyIncomingDialContext,
  getMySipCredentials,
  listMyDialerContacts,
  reportAgentPhoneTelemetry,
  setMyActiveCampaign,
  type AgentPhoneTelemetryPhase,
  type AgentDialerOperatingMode,
  type DialerContact,
  type IncomingDialContext,
} from "@/app/actions/agent-sip";
import {
  listActiveStatusReasons,
  getMyCurrentStatus,
  getMyPauseBeforeDisconnect,
  enterMyHybridManualMode,
  exitMyHybridManualMode,
  markAgentUnavailable,
  setMyCurrentStatus,
  heartbeat,
} from "@/app/actions/agent-status";
import {
  beginAgendaCallback,
  beginAssignedLeadCall,
  beginManualCallManagement,
  discardCallTechnicalError,
  getMyOpenManagement,
  getMyPendingCallManagement,
  registerManualCall,
  startLegalIntercallBreak,
  type ManualCallManagement,
  type OpenManagement,
} from "@/app/actions/calls";
import { SlideOver, StatusDot, Input, type BadgeTone } from "@/components/ui";
import {
  beginLegalIntercallBreak,
  LEGAL_INTERCALL_BREAK_SECONDS,
} from "@/lib/intercall-break";
import { cn } from "@/lib/utils";
import {
  isPendingManagementError,
  OFFLINE_CHANNEL_LABEL,
  resolveCallManagementNavigation,
  resolveManualCallManagementAction,
  type ManualCallEndState,
} from "@/lib/call-management-navigation";
import {
  AGENT_DIAL_REQUEST_EVENT,
  AGENT_FORCE_LOGOUT_EVENT,
  AGENT_HANGUP_REQUEST_EVENT,
  AGENT_MANAGEMENT_CLOSED_EVENT,
  type AgentDialRequestEventDetail,
  type AgentForceLogoutEventDetail,
} from "@/lib/agent-control";
import { leadContactPerson } from "@/lib/lead-extra";
import { AudioSettings, readAudioPreference, type AudioDevicePreference } from "@/components/phone/audio-settings";
import { CallBar, type CallQuality } from "@/components/phone/call-bar";
import { Dialer, type DialerEntry } from "@/components/phone/dialer";
import {
  formatElapsed,
  formatSubscriber,
  fullChileMobile,
  shortcutLabel,
  subscriberFromPhone,
} from "@/components/phone/format";
import { Elapsed, StatusMenu, type StatusTone } from "@/components/phone/status-menu";

const HEARTBEAT_MS = 20_000;
const SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN ?? "ws-atlas.geimser.cl";
const SIP_WSS_SERVER =
  process.env.NEXT_PUBLIC_SIP_WSS_SERVER ?? `wss://${SIP_DOMAIN}:8089/ws`;
const MAX_RECONNECT_DELAY_MS = 15_000;
/** Reintentos silenciosos antes de avisarle al ejecutivo que su teléfono no conecta. */
const MAX_SILENT_RECONNECT_ATTEMPTS = 3;
type RegState = "idle" | "connecting" | "registered" | "error";
type PhoneIssue = AgentPhoneTelemetryPhase | null;
type CallState = "idle" | "calling" | "ringing" | "in_call" | "ending";
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

const DTMF_TONE = /^[0-9*#]$/;
const DTMF_DURATION_MS = 160;
const DTMF_INTER_TONE_GAP_MS = 70;
/** Frecuencias (baja, alta) de cada tecla, para que el ejecutivo oiga lo que marca. */
const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

export function CtiBar({ profile }: { profile: Profile }) {
  const router = useRouter();
  const pathname = usePathname();
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
  const [inCallKeypadOpen, setInCallKeypadOpen] = useState(false);
  const [dtmfSent, setDtmfSent] = useState("");
  const dtmfFeedbackRef = useRef<AudioContext | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [dialerOpen, setDialerOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [holdPending, setHoldPending] = useState(false);
  const [callQuality, setCallQuality] = useState<CallQuality>(null);
  /** Ficha de la llamada en curso, para ofrecer volver a ella. */
  const [callLeadId, setCallLeadId] = useState<string | null>(null);
  const [callCampaignName, setCallCampaignName] = useState<string | null>(null);
  const [audioPreference, setAudioPreference] = useState<AudioDevicePreference>({ micId: "", speakerId: "" });
  const audioPreferenceRef = useRef(audioPreference);
  /** Dónde se dibujan el estado (barra superior) y la llamada (sobre el contenido). */
  const [slots, setSlots] = useState<{ status: HTMLElement | null; call: HTMLElement | null }>({
    status: null,
    call: null,
  });
  const [contacts, setContacts] = useState<DialerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [recents, setRecents] = useState<DialerRecent[]>([]);
  const [incomingContext, setIncomingContext] = useState<IncomingDialContext | null>(null);
  // El listener SIP conserva el cierre con el estado del render en que llegó
  // el INVITE. El contexto, en cambio, se resuelve de forma asíncrona; este
  // ref evita perder el lead al colgar por usar un closure anterior.
  const incomingContextRef = useRef<IncomingDialContext | null>(null);
  const automaticManagementOpenedRef = useRef<string | null>(null);
  /** Cuándo llegó la última llamada automática (medición del screen-pop). */
  const inviteAtRef = useRef<number | null>(null);
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
          assignment: null,
          session: null,
        }
  );
  const [switchingCampaign, setSwitchingCampaign] = useState(false);
  const [campaignSwitchError, setCampaignSwitchError] = useState<string | null>(null);
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
  /** Gestión abierta (llamada o sin llamada) que bloquea marcar otra. */
  const [openManagement, setOpenManagement] = useState<OpenManagement | null>(null);

  const [statusReasons, setStatusReasons] = useState<AgentStatusReason[]>([]);
  const [currentReasonId, setCurrentReasonId] = useState<string | null>(null);
  // Desde cuándo está en el estado actual (Disponible o AUX): el cronómetro
  // que ve el ejecutivo es el mismo tiempo que ve su supervisor en el monitor.
  const [statusSince, setStatusSince] = useState<string | null>(null);
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

  /**
   * Micrófono elegido por el ejecutivo. `ideal` y no `exact`: si desconecta el
   * audífono, la llamada sale igual con el micrófono del sistema.
   */
  function microphoneConstraint(): MediaTrackConstraints | boolean {
    const micId = audioPreferenceRef.current.micId;
    return micId ? { deviceId: { ideal: micId } } : true;
  }

  /** Limpia lo que la barra de llamada muestra de la llamada que terminó. */
  function resetCallDisplay() {
    setHeld(false);
    setHoldPending(false);
    setCallQuality(null);
    setCallLeadId(null);
    setCallCampaignName(null);
  }

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

  // Igual que la marcación: colgar depende de la sesión viva, así que se toma
  // por ref y el listener se suscribe una sola vez.
  const handleHangupRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const onHangupRequest = () => {
      void handleHangupRef.current().catch((err) =>
        console.error("CTI: no se pudo colgar a pedido de la ficha", err)
      );
    };

    window.addEventListener(AGENT_HANGUP_REQUEST_EVENT, onHangupRequest);
    return () => window.removeEventListener(AGENT_HANGUP_REQUEST_EVENT, onHangupRequest);
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

    void refreshOperatingMode();
    const modeTimer = setInterval(refreshOperatingMode, 2_000);
    return () => {
      disposed = true;
      clearInterval(modeTimer);
    };
  }, [profile.role]);

  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setSlots({
        status: document.getElementById("cti-status-slot"),
        call: document.getElementById("cti-callbar-slot"),
      });
      const preference = readAudioPreference();
      audioPreferenceRef.current = preference;
      setAudioPreference(preference);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const changeAudioPreference = useCallback((next: AudioDevicePreference) => {
    audioPreferenceRef.current = next;
    setAudioPreference(next);
  }, []);

  // El audífono elegido se aplica a la salida de la llamada.
  useEffect(() => {
    const audio = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!audio?.setSinkId) return;
    void audio.setSinkId(audioPreference.speakerId).catch((err) =>
      console.error("CTI: no se pudo usar el audífono elegido", err)
    );
  }, [audioPreference.speakerId]);

  // La ficha oculta su propio cronómetro mientras la barra de llamada muestra uno.
  useEffect(() => {
    const root = document.documentElement;
    if (callState === "idle") delete root.dataset.ctiInCall;
    else root.dataset.ctiInCall = "1";
    return () => {
      delete root.dataset.ctiInCall;
    };
  }, [callState]);

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
          // Volver de 'desconectado' (SIP caído, heartbeat vencido, recarga)
          // no puede sacar a nadie de su AUX: se restaura la pausa que tenía.
          const pauseToRestore =
            !currentIsSelectable && current?.reason.code === "desconectado"
              ? await getMyPauseBeforeDisconnect()
                  .then((reason) =>
                    reason && reasons.some((option) => option.id === reason.id) ? reason : null
                  )
                  .catch(() => null)
              : null;
          // Si esto falla sigue 'desconectado' en la base: tampoco recibe llamadas.
          if (pauseToRestore) await setMyCurrentStatus(pauseToRestore.id).catch(() => {});
          const selected = currentIsSelectable
            ? current?.reason ?? null
            : pauseToRestore ?? available;
          setStatusReasons(
            currentIsHybrid && current
              ? [...reasons.filter((reason) => reason.id !== current.reason.id), current.reason]
              : reasons
          );
          setCurrentReasonId(selected?.id ?? null);
          setStatusSince(
            currentIsSelectable ? current?.since ?? null : pauseToRestore ? new Date().toISOString() : null
          );
          setHybridManualMode(currentIsHybrid);

          // Solo se declara Disponible cuando el teléfono está realmente
          // registrado: marcarlo antes hacía que el discador entregara llamadas
          // a una extensión muerta y el cliente contestaba en el vacío.
          if (!currentIsSelectable && !pauseToRestore && available && registeredRef.current) {
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
    setStatusSince(current.since);
    setHybridManualMode(current.reason.code === "llamada_manual");
  }, [profile.role]);

  const refreshOpenManagement = useCallback(async () => {
    if (profile.role !== "agente") return null;
    try {
      const management = await getMyOpenManagement();
      setOpenManagement(management);
      return management;
    } catch (err) {
      console.error("CTI: no se pudo leer la gestión abierta", err);
      return null;
    }
  }, [profile.role]);

  // Cualquier gestión abierta bloquea marcar otra, no solo el ACW del
  // discador. Sin este sondeo una llamada manual o una gestión sin llamada
  // abierta dejaba al ejecutivo en un loop: "tienes una gestión pendiente"
  // sin decir cuál, y el teléfono sin nada que abrir.
  useEffect(() => {
    if (profile.role !== "agente") return;
    queueMicrotask(() => void refreshOpenManagement());
    const timer = setInterval(() => void refreshOpenManagement(), 5_000);
    const onClosed = () => void refreshOpenManagement();
    window.addEventListener(AGENT_MANAGEMENT_CLOSED_EVENT, onClosed);
    return () => {
      clearInterval(timer);
      window.removeEventListener(AGENT_MANAGEMENT_CLOSED_EVENT, onClosed);
    };
  }, [profile.role, refreshOpenManagement]);

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

    // El permiso de notificaciones se pide dentro de un clic (lo exige el
    // navegador) y cuando el ejecutivo se pone a recibir llamadas.
    if (requestedReason && !requestedReason.is_pause && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }

    const previous = currentReasonId;
    const previousSince = statusSince;
    setCurrentReasonId(reasonId);
    // Elegir el mismo estado no reinicia el tiempo (igual que en la base).
    if (reasonId !== previous) setStatusSince(new Date().toISOString());
    setSavingStatus(true);
    setStatusError(null);
    try {
      await setMyCurrentStatus(reasonId);
      readyStatusSyncedRef.current = requestedReason?.is_pause ? null : reasonId;
    } catch (err) {
      // Sin esto la barra mostraba el estado nuevo mientras la base seguía con
      // el anterior, y el discador actuaba según la base.
      setCurrentReasonId(previous);
      setStatusSince(previousSince);
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
      setDialerOpen(true);
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

    let lastLost = 0;
    let lastReceived = 0;
    const statsTimer = setInterval(() => {
      void pc
        .getStats()
        .then((stats) => {
          const audioStats: Record<string, unknown>[] = [];
          // Pérdida y jitter del audio que llega en los últimos 5 s: lo que
          // el ejecutivo oye entrecortado.
          stats.forEach((report) => {
            if (report.type !== "inbound-rtp" || (report.kind ?? report.mediaType) !== "audio") return;
            const lost = Number(report.packetsLost ?? 0);
            const received = Number(report.packetsReceived ?? 0);
            const lostDelta = Math.max(0, lost - lastLost);
            const total = lostDelta + Math.max(0, received - lastReceived);
            lastLost = lost;
            lastReceived = received;
            const lossRate = total > 0 ? lostDelta / total : 0;
            const jitterMs = Number(report.jitter ?? 0) * 1000;
            setCallQuality(
              lossRate > 0.05 || jitterMs > 60 ? "poor" : lossRate > 0.02 || jitterMs > 30 ? "fair" : "good"
            );
          });
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

  /**
   * Además del sonido: el título de la pestaña parpadea y, si el ejecutivo
   * está mirando otra pestaña u otra ventana, aparece una notificación del
   * sistema con el nombre del cliente.
   */
  function alertIncomingCall(name: string | null) {
    const originalTitle = document.title.startsWith("📞") ? "Atlas" : document.title;
    let ticks = 0;
    const blink = window.setInterval(() => {
      ticks += 1;
      document.title = ticks % 2 === 1 ? "📞 LLAMADA ENTRANTE" : originalTitle;
      if (ticks >= 12) {
        window.clearInterval(blink);
        document.title = originalTitle;
      }
    }, 700);
    try {
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        const notification = new Notification("📞 Llamada entrante", {
          body: name ? `${name} ya está en línea.` : "Tienes un cliente en línea.",
          requireInteraction: false,
          tag: "atlas-incoming-call",
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    } catch (err) {
      console.error("CTI: no se pudo mostrar la notificación de llamada", err);
    }
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
        // Aviso notorio: el teléfono contesta solo y el ejecutivo tiene que
        // darse cuenta de inmediato de que ya hay un cliente en línea. Antes
        // eran dos notas cortas casi inaudibles. Tres notas, dos veces.
        [659, 880, 1175, 659, 880, 1175].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + index * 0.16 + (index >= 3 ? 0.25 : 0);
          oscillator.type = "triangle";
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.28, start + 0.015);
          gain.gain.linearRampToValueAtTime(0, start + 0.14);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.15);
        });
        setTimeout(() => void context.close().catch(() => {}), 1600);
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

  function openManualManagement(management: ManualCallManagement) {
    manualManagementRef.current = null;
    openManagementScreen(management.leadId);
  }

  function openManagementScreen(leadId: string) {
    setDialerOpen(false);
    const navigation = resolveCallManagementNavigation(window.location.pathname, leadId);
    if (navigation.kind === "refresh") {
      router.refresh();
      // Ya estaba en la ficha, quizá abajo en el historial: el refresco no
      // mueve la página y "Completar tipificación" parecía no hacer nada.
      // Se lleva al formulario en cuanto aparece.
      for (const delay of [0, 400, 1200]) {
        setTimeout(() => {
          document.getElementById("gestion-en-curso")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, delay);
      }
      return;
    }
    router.push(navigation.href);
  }

  function openAutomaticManagement(context: IncomingDialContext | null) {
    if (!context) return;
    if (automaticManagementOpenedRef.current === context.dial_attempt_id) return;
    automaticManagementOpenedRef.current = context.dial_attempt_id;
    // El screen-pop debe ocurrir apenas el motor confirma qué ejecutivo tomó
    // la llamada. Así la ficha 360 completa queda visible durante la
    // conversación y no recién después del corte. Al colgar, esta misma URL
    // conserva la gestión destacada para completar la tipificación.
    openManagementScreen(context.lead_id);
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
      openManagementScreen(pending.leadId);
    } catch (err) {
      setCallError(
        err instanceof Error ? err.message : "No se pudo abrir la tipificación pendiente."
      );
    } finally {
      setPendingTypificationOpening(false);
    }
  }

  /**
   * La base rechazó la llamada porque hay otra gestión abierta: en vez de solo
   * repetir el error, se lleva al ejecutivo a esa gestión y se le dice cuál es.
   */
  async function redirectToOpenManagement(message: string): Promise<boolean> {
    if (!isPendingManagementError(message)) return false;
    const management = await refreshOpenManagement();
    if (!management) {
      setCallError(message);
      return true;
    }
    setCallError(
      `Primero cierra la gestión de ${management.leadName ?? "otro registro"}. Te llevamos a ella.`
    );
    openManagementScreen(management.leadId);
    return true;
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

  function finishManualManagement(
    management: ManualCallManagement,
    endState: ManualCallEndState
  ) {
    if (manualManagementRef.current?.callId !== management.callId) return;
    if (resolveManualCallManagementAction(endState) === "discard") {
      discardUnconnectedManualManagement(management);
      return;
    }
    openManualManagement(management);
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
    const inviteAt = inviteAtRef.current;
    // En el pool el intento queda a nombre del ejecutivo recién cuando el
    // motor procesa la conexión (AgentConnect) y la escribe en la base. Con
    // solo 8 reintentos de 300 ms (~2,4 s) a algunos ejecutivos no les llegaba
    // nunca la ficha: ahora se insiste rápido al principio y luego cada
    // segundo, hasta ~13 s o hasta que la llamada termine.
    for (let retry = 0; retry < 20; retry += 1) {
      if (callAttemptRef.current !== callAttempt) return;
      try {
        // Directo a la base (~0,2 s); la vía del servidor (~1 s) queda de
        // respaldo si la política no dejó leer el lead o hubo error.
        const direct = await fetchIncomingDialContextDirect(profile.id).catch(() => undefined);
        const context = direct === undefined ? await getMyIncomingDialContext() : direct;
        if (context) {
          // Medición del screen-pop: la cierra la ficha al dibujarse.
          markScreenPop({
            leadId: context.lead_id,
            dialAttemptId: context.dial_attempt_id,
            inviteAt,
            contextAt: Date.now(),
            polls: retry + 1,
            source: direct === undefined ? "servidor" : "directo",
          });
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
      // Los primeros segundos se pregunta cada 150 ms: la conexión suele
      // quedar registrada casi de inmediato y cada vuelta cuenta.
      await new Promise((resolve) => setTimeout(resolve, retry < 12 ? 150 : 1000));
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
    inviteAtRef.current = Date.now();
    sessionRef.current = invitation;
    setIsIncomingCall(true);
    incomingContextRef.current = null;
    automaticManagementOpenedRef.current = null;
    setIncomingContext(null);
    setSelectedName(null);
    setSubscriber("");
    setMuted(false);
    resetInCallKeypad();
    setCallError(null);
    setCallState("ringing");
    setDialerOpen(false);
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
            alertIncomingCall(incomingContextRef.current?.full_name ?? null);
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
              if (finishedContext) {
                openAutomaticManagement(finishedContext);
              } else {
                // El contexto no alcanzó a llegar durante la llamada: se abre
                // la gestión que quedó pendiente para que pueda tipificar.
                void getMyPendingCallManagement()
                  .then((pending) => {
                    if (pending) openManagementScreen(pending.leadId);
                  })
                  .catch((err) => console.error("CTI: no se pudo abrir la gestión pendiente", err));
              }
            }
            detachRemoteAudio();
            setCallState("idle");
            setCallStartedAt(null);
            setIsIncomingCall(false);
            incomingContextRef.current = null;
            setIncomingContext(null);
            sessionRef.current = null;
            resetCallDisplay();
            break;
          default:
            break;
        }
      });

      await invitation.accept({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: microphoneConstraint(), video: false },
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
      resetCallDisplay();
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
    /** Número completo validado por el servidor (móvil o fijo de la ficha). */
    dialDigits?: string | null;
    contactName: string | null;
  }) {
    const target = preopened?.dialDigits && /^56[2-9]\d{8}$/.test(preopened.dialDigits)
      ? preopened.dialDigits
      : fullChileMobile(preopened?.subscriber ?? subscriber);
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
          if (!(await redirectToOpenManagement(result.error))) setCallError(result.error);
          return;
        }
        management = result.data;
      }
      if (management) {
        manualManagementRef.current = management;
        setCallLeadId(management.leadId);
        setCallCampaignName(
          operatingMode?.campaigns.find((campaign) => campaign.id === management?.campaignId)?.name ?? null
        );
      }
      setDialerOpen(false);

      // En llamadas manuales/híbridas la ficha se abría recién al colgar.
      // La gestión ya existe aquí, así que hacemos el screen-pop antes de
      // originar para tener Agenda Reunión y notas durante la conversación.
      if (profile.role === "agente" && management) {
        openManagementScreen(management.leadId);
      }

      const callAttempt = callAttemptRef.current + 1;
      callAttemptRef.current = callAttempt;
      setIsIncomingCall(false);
      setIncomingContext(null);
      setCallError(null);
      setMuted(false);
      resetInCallKeypad();
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
          constraints: { audio: microphoneConstraint(), video: false },
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
            }
            if (management) {
              finishManualManagement(
                management,
                wasEstablished ? "answered" : "not_answered"
              );
            }
            stopLocalRingback();
            detachRemoteAudio();
            setCallState("idle");
            setCallStartedAt(null);
            sessionRef.current = null;
            resetCallDisplay();
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
      resetCallDisplay();
      setCallState("idle");
      if (management) finishManualManagement(management, "origination_failed");
      setCallError("No se pudo iniciar la llamada. Reintenta en unos segundos.");
    }
  }

  /**
   * Rescate de un compromiso de la agenda. La gestión la abre el servidor —es
   * lo único que puede saltarse el bloqueo de marcado manual en campañas
   * automáticas— y aquí solo se origina y se hace screen-pop de la ficha.
   */
  async function startAgendaCallback(detail: AgentDialRequestEventDetail) {
    setCallError(null);

    if (callState !== "idle") {
      setCallError("Termina la llamada en curso antes de marcar otro compromiso.");
      return;
    }

    const result = detail.source === "assigned_lead"
      ? await beginAssignedLeadCall(detail.leadId, detail.phone)
      : await beginAgendaCallback(detail.leadId, detail.phone);
    if (!result.ok) {
      if (!(await redirectToOpenManagement(result.error))) setCallError(result.error);
      return;
    }

    const { leadId, callId, campaignId, subscriber: target, dialDigits, fullName } = result.data;
    setSelectedName(fullName);
    setSubscriber(target);

    await handleCall({
      management: { leadId, callId, campaignId, leadCreated: false, leadReused: true },
      subscriber: target,
      dialDigits,
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
        if (isIncomingCall) openAutomaticManagement(automaticContext);
      }
      if (management) {
        finishManualManagement(
          management,
          wasEstablished ? "answered" : "not_answered"
        );
      }
      stopLocalRingback();
      detachRemoteAudio();
      setCallState("idle");
      setCallStartedAt(null);
      setIsIncomingCall(false);
      incomingContextRef.current = null;
      setIncomingContext(null);
      sessionRef.current = null;
      resetCallDisplay();
    }
  }

  useEffect(() => {
    handleHangupRef.current = handleHangup;
  });

  function toggleMute() {
    const session = sessionRef.current;
    const pc = session?.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const senders = pc.getSenders() as RTCRtpSender[];
    const nextMuted = !muted;
    senders.forEach((sender) => {
      if (sender.track && sender.track.kind === "audio") {
        sender.track.enabled = !nextMuted && !held;
      }
    });
    setMuted(nextMuted);
  }

  /**
   * Espera: re-INVITE con el audio en una sola dirección; Asterisk pone música
   * al cliente. Si la central lo rechaza, la llamada sigue como estaba.
   */
  async function toggleHold() {
    const session = sessionRef.current;
    if (!session || callState !== "in_call" || holdPending || typeof session.invite !== "function") return;
    const nextHeld = !held;
    const pc = session.sessionDescriptionHandler?.peerConnection as RTCPeerConnection | undefined;
    const applyTracks = (onHold: boolean) => {
      pc?.getSenders().forEach((sender) => {
        if (sender.track?.kind === "audio") sender.track.enabled = !onHold && !muted;
      });
      pc?.getReceivers().forEach((receiver) => {
        if (receiver.track?.kind === "audio") receiver.track.enabled = !onHold;
      });
    };
    setHoldPending(true);
    try {
      session.sessionDescriptionHandlerOptionsReInvite = {
        ...(session.sessionDescriptionHandlerOptionsReInvite ?? {}),
        hold: nextHeld,
      };
      await session.invite({
        requestDelegate: {
          onAccept: () => {
            applyTracks(nextHeld);
            setHeld(nextHeld);
            setHoldPending(false);
          },
          onReject: () => {
            setCallError(nextHeld ? "La central no aceptó poner la llamada en espera." : "La central no aceptó retomar la llamada.");
            setHoldPending(false);
          },
        },
      });
    } catch (err) {
      console.error("CTI: no se pudo cambiar la espera", err);
      setCallError("No se pudo cambiar la espera. La llamada sigue activa.");
      setHoldPending(false);
    }
  }

  function resetInCallKeypad() {
    setInCallKeypadOpen(false);
    setDtmfSent("");
  }

  function playDtmfFeedback(tone: string) {
    const frequencies = DTMF_FREQUENCIES[tone];
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!frequencies || !AudioContextConstructor) return;
    try {
      const context = dtmfFeedbackRef.current ?? new AudioContextConstructor();
      dtmfFeedbackRef.current = context;
      void context.resume().catch(() => undefined);
      const start = context.currentTime;
      const stop = start + DTMF_DURATION_MS / 1000;
      const gain = context.createGain();
      gain.gain.value = 0.08;
      gain.connect(context.destination);
      frequencies.forEach((frequency) => {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(start);
        oscillator.stop(stop);
      });
    } catch {
      // El tono local es solo una ayuda; el DTMF ya salió por la llamada.
    }
  }

  function sendDtmf(tone: string) {
    if (!DTMF_TONE.test(tone) || callState !== "in_call") return;
    const session = sessionRef.current;
    if (!session) return;

    // Primero por RTP (RFC 4733). Si el navegador o la negociación no lo
    // permiten, SIP INFO: Asterisk también lo entiende y lo reenvía igual.
    let sent = false;
    try {
      sent = Boolean(
        session.sessionDescriptionHandler?.sendDtmf?.(tone, {
          duration: DTMF_DURATION_MS,
          interToneGap: DTMF_INTER_TONE_GAP_MS,
        })
      );
    } catch (err) {
      console.error("CTI: no se pudo enviar el tono por RTP", err);
    }
    if (!sent && typeof session.info === "function") {
      sent = true;
      void session
        .info({
          requestOptions: {
            body: {
              contentDisposition: "render",
              contentType: "application/dtmf-relay",
              content: `Signal=${tone}\r\nDuration=${DTMF_DURATION_MS}`,
            },
          },
        })
        .catch((err: unknown) => console.error("CTI: no se pudo enviar el tono por SIP INFO", err));
    }
    if (!sent) return;
    playDtmfFeedback(tone);
    setDtmfSent((current) => (current + tone).slice(-24));
  }

  const sendDtmfRef = useRef(sendDtmf);
  useEffect(() => {
    sendDtmfRef.current = sendDtmf;
  });

  // Con el teclado abierto, el ejecutivo también puede marcar desde su
  // teclado físico, salvo que esté escribiendo en un campo de la gestión.
  const inCallKeypadVisible = callState === "in_call" && inCallKeypadOpen;
  useEffect(() => {
    if (!inCallKeypadVisible) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (!DTMF_TONE.test(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      sendDtmfRef.current(event.key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inCallKeypadVisible]);

  useEffect(
    () => () => {
      void dtmfFeedbackRef.current?.close().catch(() => undefined);
      dtmfFeedbackRef.current = null;
    },
    []
  );

  const showStatusSelector = profile.role === "agente";
  const currentReason = statusReasons.find((reason) => reason.id === currentReasonId) ?? null;
  const availableReasons = statusReasons.filter((reason) => !reason.is_pause && !reason.is_system);
  const auxReasons = statusReasons.filter(
    (reason) => reason.is_pause && !reason.is_system && reason.code !== "auxiliar"
  );
  const agentCanCall = profile.role !== "agente" || currentReason === null || !currentReason.is_pause;
  const automaticMode = profile.role === "agente" && operatingMode?.mode === "automatic";
  const automaticSessionStatus = automaticMode ? operatingMode?.session?.status ?? "offline" : null;
  const automaticWrapUpElapsedSeconds =
    automaticSessionStatus === "wrap_up" && operatingMode?.session?.since
      ? Math.max(0, Math.floor((now - new Date(operatingMode.session.since).getTime()) / 1000))
      : 0;
  const inAutomaticWrapUp = automaticSessionStatus === "wrap_up" && agentCanCall;
  const inLegalIntercallBreak =
    inAutomaticWrapUp && automaticWrapUpElapsedSeconds < LEGAL_INTERCALL_BREAK_SECONDS;
  const legalBreakRemaining = Math.max(0, LEGAL_INTERCALL_BREAK_SECONDS - automaticWrapUpElapsedSeconds);
  const automaticOperationalAvailable =
    regState === "registered" &&
    agentCanCall &&
    Boolean(operatingMode?.active_campaign_id) &&
    automaticSessionStatus === "available";
  const manualCampaigns =
    operatingMode?.campaigns.filter((campaign) => campaign.manual_dial_enabled) ?? [];
  const effectiveManualCampaignId =
    manualCampaignId || (manualCampaigns.length === 1 ? manualCampaigns[0].id : "");
  const effectiveManualCampaign = manualCampaigns.find((campaign) => campaign.id === effectiveManualCampaignId);
  const hybridQueueReady = operatingMode?.hybrid_manual_status === "ready";
  const manualDialAllowed =
    profile.role !== "agente" || (hybridManualMode ? hybridQueueReady : agentCanCall);
  const manualRecoveryCampaign = operatingMode?.campaigns.find(
    (campaign) => campaign.id === manualRecoveryCampaignId
  );
  const campaignLocked = operatingMode?.assignment?.locked === true;
  const automaticCampaigns = automaticMode
    ? (operatingMode?.campaigns ?? []).filter((campaign) => campaign.dial_mode !== "manual")
    : [];
  const activeAutomaticCampaign = operatingMode?.campaigns.find(
    (campaign) => campaign.id === operatingMode.active_campaign_id
  );
  const activeCall = callState !== "idle";
  // En la ficha de esa misma gestión el formulario ya está a la vista.
  const pendingElsewhere =
    openManagement !== null &&
    !activeCall &&
    pathname !== `/dashboard/leads/${openManagement.leadId}`;
  // En modo automático marcar exige salir de la cola; sin campañas manuales no hay cómo.
  const canOpenDialer =
    Boolean(credential) &&
    (profile.role !== "agente" || !automaticMode || hybridManualMode || manualCampaigns.length > 0);

  const dialerEntries = useMemo<DialerEntry[]>(
    () => [
      ...recents.map((recent) => ({
        key: `r-${recent.phone}-${recent.calledAt}`,
        name: recent.name,
        phone: recent.phone,
        source: "Reciente" as const,
      })),
      ...contacts.map((contact) => ({
        key: `c-${contact.id}`,
        name: contact.name,
        phone: contact.phone,
        rut: contact.rut,
        source: "Contacto" as const,
      })),
    ],
    [recents, contacts]
  );

  // Atajos: Alt D abre el marcador; en llamada Alt M silencia, Alt E pone en
  // espera, Alt T abre el teclado y Alt X cuelga. No actúan mientras se
  // escribe en un campo (en Mac, Opción + letra también escribe acentos).
  const shortcutsRef = useRef({ toggleMute, toggleHold, canOpenDialer, callState });
  useEffect(() => {
    shortcutsRef.current = { toggleMute, toggleHold, canOpenDialer, callState };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const current = shortcutsRef.current;
      if (event.code === "KeyD" && current.callState === "idle" && current.canOpenDialer) {
        event.preventDefault();
        setDialerOpen((open) => !open);
        return;
      }
      if (current.callState !== "in_call" && event.code !== "KeyX") return;
      if (event.code === "KeyM") {
        event.preventDefault();
        current.toggleMute();
      } else if (event.code === "KeyE") {
        event.preventDefault();
        void current.toggleHold();
      } else if (event.code === "KeyT") {
        event.preventDefault();
        setInCallKeypadOpen((open) => !open);
      } else if (event.code === "KeyX" && current.callState !== "idle") {
        event.preventDefault();
        void handleHangupRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!credential && !showStatusSelector) return null;

  const regTone: BadgeTone =
    regState === "registered" ? "success" : regState === "connecting" ? "warning" : "danger";
  const statusLabel =
    regState === "registered"
      ? "Teléfono conectado"
      : regState === "connecting"
        ? "Conectando teléfono…"
        : phoneIssue === "microphone"
          ? "Micrófono bloqueado"
          : "Teléfono desconectado";

  const statusTone: StatusTone = hybridManualMode
    ? "manual"
    : inAutomaticWrapUp
      ? "acw"
      : !currentReason
        ? "neutral"
        : currentReason.is_pause
          ? "pause"
          : "available";
  const statusText =
    statusReasons.length === 0
      ? statusLoading ? "Cargando estado…" : "Sin estados"
      : hybridManualMode
        ? "Llamada manual"
        : inLegalIntercallBreak
          ? "Interrupción legal"
          : inAutomaticWrapUp
            ? "Tipificando"
            : currentReason
              ? currentReason.is_pause ? `AUX · ${currentReason.label}` : currentReason.label
              : "Sin estado";
  const statusCountdown = inLegalIntercallBreak
    ? `${legalBreakRemaining} s`
    : inAutomaticWrapUp
      ? formatElapsed(automaticWrapUpElapsedSeconds * 1000)
      : null;
  // Tope de la pausa actual: el menú muestra lo que queda y avisa al pasarse,
  // sin sacarla de la pausa. En llamada manual o tipificando no corre.
  const pauseCapSeconds =
    !hybridManualMode && !inAutomaticWrapUp && currentReason?.is_pause ? currentReason.max_seconds : null;
  const campaignNote = switchingCampaign
    ? "Cambiando de cola…"
    : campaignLocked && activeAutomaticCampaign
      ? `${operatingMode?.assignment?.assigned_by_name ?? "Tu supervisor"} te asignó a ${activeAutomaticCampaign.name}. Solo quien la asignó puede cambiarla.`
      : activeAutomaticCampaign
        ? operatingMode?.assignment?.source === "prioridad"
          ? "Es la prioridad que definió tu supervisor."
          : null
        : "No recibirás llamadas hasta elegir una cola.";

  const dialerBlockedReason =
    regState !== "registered"
      ? "El teléfono no está conectado."
      : profile.role === "agente" && automaticMode && !hybridManualMode
        ? "Primero sal de la cola automática."
        : hybridManualMode && !hybridQueueReady
          ? "Esperando que la central confirme la pausa…"
          : !manualDialAllowed
            ? "Ponte Disponible para llamar."
            : profile.role === "agente" && !effectiveManualCampaignId
              ? manualCampaigns.length
                ? "Elige la campaña de la llamada."
                : "No tienes campañas con marcación manual."
              : openManagement
                ? `Primero tipifica la gestión de ${openManagement.leadName ?? "otro registro"}.`
                : null;

  const dialerNotice: ReactNode =
    profile.role === "agente" && automaticMode && !hybridManualMode ? (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Para marcar sales de la cola automática. No recibirás llamadas del discador hasta volver.
        </p>
        {manualCampaigns.length > 1 && (
          <select
            value={effectiveManualCampaignId}
            onChange={(event) => setManualCampaignId(event.target.value)}
            disabled={hybridTransitionPending}
            aria-label="Campaña de la llamada manual"
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs font-medium"
          >
            <option value="">Campaña…</option>
            {manualCampaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void handleEnterHybridManualMode()}
          disabled={hybridTransitionPending || regState !== "registered" || !effectiveManualCampaignId}
          className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {hybridTransitionPending ? "Saliendo de la cola…" : "Salir de la cola y marcar"}
        </button>
      </div>
    ) : hybridManualMode ? (
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Llamada manual{effectiveManualCampaign ? ` en ${effectiveManualCampaign.name}` : ""}.
          {!hybridQueueReady && " Esperando la pausa de la central…"}
        </p>
        <button
          type="button"
          onClick={() => void handleExitHybridManualMode()}
          disabled={hybridTransitionPending}
          className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {hybridTransitionPending ? "Volviendo…" : "Volver a la cola"}
        </button>
      </div>
    ) : null;

  const statusControls = (
    <>
      {showStatusSelector && (
        <StatusMenu
          label={statusText}
          tone={statusTone}
          since={inAutomaticWrapUp ? null : statusSince}
          countdown={statusCountdown}
          pauseCapSeconds={pauseCapSeconds}
          open={statusMenuOpen}
          onOpenChange={setStatusMenuOpen}
          available={availableReasons.map((reason) => ({ id: reason.id, label: reason.label }))}
          aux={auxReasons.map((reason) => ({ id: reason.id, label: reason.label }))}
          currentId={currentReasonId}
          disabled={savingStatus || hybridManualMode || statusLoading || statusReasons.length === 0}
          disabledNote={hybridManualMode ? "Estás en llamada manual. Vuelve a la cola desde el marcador." : null}
          onSelect={(id) => void handleStatusChange(id)}
          error={statusError}
          onRetry={() => void loadAgentStatus()}
          campaigns={automaticCampaigns.map((campaign) => ({ id: campaign.id, name: campaign.name }))}
          activeCampaignId={operatingMode?.active_campaign_id ?? null}
          campaignDisabled={switchingCampaign || activeCall || inAutomaticWrapUp || campaignLocked}
          campaignLocked={campaignLocked}
          campaignNote={campaignNote}
          campaignError={campaignSwitchError}
          onCampaignChange={(id) => void handleActiveCampaignChange(id)}
          audio={<AudioSettings value={audioPreference} onChange={changeAudioPreference} disabled={activeCall} />}
        />
      )}
      {credential && (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
          title={connectionError ?? statusLabel}
        >
          <StatusDot tone={regTone} className="size-2" />
          {regState === "registered" ? "Teléfono" : statusLabel}
        </span>
      )}
      {credential && regState === "error" && (
        <button
          type="button"
          onClick={retryPhoneRegistration}
          className="shrink-0 rounded-md border border-danger/40 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-bg"
        >
          Reintentar teléfono
        </button>
      )}
      {canOpenDialer && !activeCall && (
        <button
          type="button"
          onClick={() => setDialerOpen((open) => !open)}
          aria-expanded={dialerOpen}
          title={`Marcar (${shortcutLabel("D")})`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          <Phone size={14} aria-hidden />
          Marcar
        </button>
      )}
    </>
  );

  const callBar = callState !== "idle" ? (
    <CallBar
      phase={callState}
      name={selectedName}
      contactPerson={
        incomingContext ? leadContactPerson(incomingContext.extra, incomingContext.full_name) : null
      }
      phoneLabel={subscriber ? `+56 9 ${formatSubscriber(subscriber)}` : null}
      campaignName={incomingContext?.campaign_name ?? callCampaignName}
      automatic={isIncomingCall}
      elapsed={callState === "in_call" && callStartedAt ? formatElapsed(now - callStartedAt) : null}
      quality={callQuality}
      muted={muted}
      held={held}
      holdPending={holdPending}
      keypadOpen={inCallKeypadOpen}
      dtmfSent={dtmfSent}
      leadHref={(() => {
        const leadId = incomingContext?.lead_id ?? callLeadId;
        return leadId && pathname !== `/dashboard/leads/${leadId}` ? `/dashboard/leads/${leadId}` : null;
      })()}
      onToggleMute={toggleMute}
      onToggleHold={() => void toggleHold()}
      onToggleKeypad={() => setInCallKeypadOpen((open) => !open)}
      onDtmf={sendDtmf}
      onHangup={() => void handleHangup()}
    />
  ) : null;

  const dock = activeCall ? null : !credential ? (
    loadingCredential ? null : (
      <DockPill tone="neutral" title="Avísale a tu supervisor para poder recibir y hacer llamadas.">
        Sin extensión telefónica
      </DockPill>
    )
  ) : regState !== "registered" ? (
    <DockPill tone={regState === "connecting" ? "acw" : "pause"} title={connectionError ?? undefined}>
      {statusLabel}
      {regState === "error" && (
        <DockAction onClick={retryPhoneRegistration}>Reintentar</DockAction>
      )}
    </DockPill>
  ) : pendingElsewhere && openManagement ? (
    <DockPill tone="acw" title="Ciérrala para poder llamar o recibir llamadas">
      <span className="max-w-56 truncate">
        Gestión pendiente · {openManagement.leadName ?? "registro"}
        {openManagement.channel ? ` (${OFFLINE_CHANNEL_LABEL[openManagement.channel] ?? "otro canal"})` : ""}
      </span>
      <DockAction onClick={() => openManagementScreen(openManagement.leadId)}>Tipificar</DockAction>
    </DockPill>
  ) : operatingMode === undefined ? null : automaticMode && !hybridManualMode ? (
    !agentCanCall ? null : !operatingMode.active_campaign_id ? (
      <DockPill tone="acw">
        Elige una cola para recibir llamadas
        <DockAction onClick={() => setStatusMenuOpen(true)}>Elegir</DockAction>
      </DockPill>
    ) : inAutomaticWrapUp ? (
      <DockPill tone="acw">
        {inLegalIntercallBreak ? (
          <>Interrupción legal · <span className="font-mono tabular-nums">{legalBreakRemaining} s</span></>
        ) : (
          <>Tipificación pendiente · <span className="font-mono tabular-nums">{statusCountdown}</span></>
        )}
        {!(openManagement && !pendingElsewhere) && (
          <DockAction onClick={() => void handleOpenPendingTypification()} disabled={pendingTypificationOpening}>
            {pendingTypificationOpening ? "Abriendo…" : "Completar"}
          </DockAction>
        )}
        <DockAction onClick={openManualRecovery} subtle>
          Registrar llamada manual
        </DockAction>
      </DockPill>
    ) : automaticOperationalAvailable ? (
      <DockPill tone="available">
        <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
        En espera · {activeAutomaticCampaign?.name ?? "cola"}
        <Elapsed since={operatingMode.session?.since ?? null} className="opacity-70" />
        {manualCampaigns.length > 0 && (
          <DockAction onClick={() => setDialerOpen(true)} subtle>
            Llamada manual
          </DockAction>
        )}
      </DockPill>
    ) : (
      <DockPill tone="neutral">Conectando con el discador…</DockPill>
    )
  ) : hybridManualMode ? (
    <DockPill tone="manual">
      Llamada manual{effectiveManualCampaign ? ` · ${effectiveManualCampaign.name}` : ""}
      <DockAction onClick={() => setDialerOpen(true)}>Marcar</DockAction>
      <DockAction onClick={() => void handleExitHybridManualMode()} disabled={hybridTransitionPending} subtle>
        Volver a la cola
      </DockAction>
    </DockPill>
  ) : !dialerOpen && canOpenDialer ? (
    <DockPill tone="neutral">
      <DockAction onClick={() => setDialerOpen(true)}>
        <Phone size={13} aria-hidden /> Marcar
      </DockAction>
    </DockPill>
  ) : null;

  return (
    <>
      {/* El <audio> siempre montado: es el destino del stream SIP. */}
      <audio ref={audioRef} autoPlay className="hidden" />

      {slots.status ? (
        createPortal(statusControls, slots.status)
      ) : (
        <div className="fixed left-4 top-2 z-50 flex items-center gap-2">{statusControls}</div>
      )}

      {callBar &&
        (slots.call ? (
          createPortal(callBar, slots.call)
        ) : (
          <div className="fixed inset-x-0 top-0 z-50">{callBar}</div>
        ))}

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 [&>*]:pointer-events-auto">
        {callError && !dialerOpen && !activeCall && (
          <div
            role="alert"
            className="flex max-w-sm items-start gap-2 rounded-xl border border-danger/30 bg-surface px-3 py-2 text-xs text-danger shadow-xl"
          >
            <span className="flex-1">{callError}</span>
            <button type="button" onClick={() => setCallError(null)} className="font-semibold">
              Cerrar
            </button>
          </div>
        )}
        {dialerOpen && !activeCall && (
          <Dialer
            subscriber={subscriber}
            selectedName={selectedName}
            onTarget={(next, name) => {
              setSubscriber(next);
              setSelectedName(name);
              setCallError(null);
            }}
            entries={dialerEntries}
            loading={contactsLoading}
            campaigns={profile.role === "agente" ? manualCampaigns : []}
            campaignId={effectiveManualCampaignId}
            onCampaignChange={setManualCampaignId}
            onCall={() => void handleCall()}
            callBlockedReason={dialerBlockedReason}
            error={callError}
            notice={dialerNotice}
            onClose={() => setDialerOpen(false)}
          />
        )}
        {dock}
      </div>

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
    </>
  );
}

const DOCK_TONES = {
  available: "border-success/30 bg-surface text-foreground",
  pause: "border-danger/40 bg-danger-bg text-danger",
  acw: "border-warning/40 bg-warning-bg text-warning",
  manual: "border-primary/40 bg-surface text-foreground",
  neutral: "border-border bg-surface text-muted-foreground",
} as const;

/** La píldora de abajo a la derecha: una línea con el estado de la cola. */
function DockPill({
  tone,
  title,
  children,
}: {
  tone: keyof typeof DOCK_TONES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      title={title}
      className={cn(
        "flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border py-1.5 pl-3.5 pr-1.5 text-sm font-semibold shadow-xl",
        DOCK_TONES[tone]
      )}
    >
      {children}
    </div>
  );
}

function DockAction({
  onClick,
  disabled,
  subtle,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  subtle?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50",
        subtle
          ? "text-current underline-offset-2 hover:underline"
          : "bg-foreground text-background hover:opacity-90"
      )}
    >
      {children}
    </button>
  );
}
