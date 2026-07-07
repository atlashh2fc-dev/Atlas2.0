"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Delete } from "lucide-react";
import type { Profile, AgentStatusReason } from "@/lib/types";
import { getMySipCredentials } from "@/app/actions/agent-sip";
import { listActiveStatusReasons, getMyCurrentStatus, setMyCurrentStatus, heartbeat } from "@/app/actions/agent-status";
import { StatusDot, Input, Select, type BadgeTone } from "@/components/ui";

const HEARTBEAT_MS = 20_000;

/**
 * Barra CTI del agente: softphone WebRTC embebido en el CRM, conectado a la
 * extensión SIP sobre WSS del mismo Asterisk que usa el motor de discado
 * (docs/dialer-engine-architecture.md). Permite marcar manualmente un
 * número (click-to-call) sin pasar por el motor de campañas.
 *
 * Cada usuario se registra con SU PROPIA extensión (agent_sip_credentials,
 * generada desde /dashboard/admin/agentes-sip) — ya no hay una línea
 * compartida. Si el usuario no tiene extensión activa asignada, la barra
 * simplemente no se muestra.
 */

const SIP_WSS_SERVER = "wss://54.233.114.5:8089/ws";
const SIP_DOMAIN = "54.233.114.5";

type RegState = "idle" | "connecting" | "registered" | "error";
type CallState = "idle" | "calling" | "ringing" | "in_call" | "ending";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CtiBar({ profile }: { profile: Profile }) {
  const [credential, setCredential] = useState<{ extension: string; sip_password: string } | null | undefined>(
    undefined
  );
  const [regState, setRegState] = useState<RegState>("idle");
  const [callState, setCallState] = useState<CallState>("idle");
  const [number, setNumber] = useState("");
  const [muted, setMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  const [statusReasons, setStatusReasons] = useState<AgentStatusReason[]>([]);
  const [currentReasonId, setCurrentReasonId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    getMySipCredentials()
      .then(setCredential)
      .catch((err) => {
        console.error("CTI: fallo al obtener credenciales SIP propias", err);
        setCredential(null);
      });
  }, []);

  useEffect(() => {
    if (profile.role !== "agente") return;
    Promise.all([listActiveStatusReasons(), getMyCurrentStatus()])
      .then(([reasons, current]) => {
        setStatusReasons(reasons);
        setCurrentReasonId(current?.reason.id ?? reasons.find((r) => !r.is_pause)?.id ?? null);
      })
      .catch((err) => console.error("CTI: fallo al cargar estado de agente", err));
  }, [profile.role]);

  // Heartbeat mientras la pestaña sigue abierta: si el agente cierra el
  // navegador/tab sin usar "Cerrar sesión", esto simplemente deja de
  // llamarse (no hay nada que cancelar del lado del cliente) y el motor
  // detecta el vencimiento y fuerza "Desconectado" — ver tarea del fix de
  // logout. No se ejecuta si el usuario no es agente (no tiene estado que
  // reportar).
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
    if (callState !== "in_call" || !callStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [callState, callStartedAt]);

  useEffect(() => {
    if (!credential) return;
    let disposed = false;

    async function register(sipUser: string, sipPassword: string) {
      setRegState("connecting");
      try {
        const { UserAgent, Registerer } = await import("sip.js");

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
          onInvite: () => {
            // Softphone de agente: no recibe llamadas entrantes directas por
            // ahora (las llamadas del discador entran vía Queue, no Invite).
          },
        };

        await ua.start();
        if (disposed) return;

        const registerer = new Registerer(ua);
        await registerer.register();
        if (disposed) return;

        uaRef.current = ua;
        setRegState("registered");
      } catch (err) {
        console.error("CTI: fallo al registrar softphone", err);
        if (!disposed) setRegState("error");
      }
    }

    register(credential.extension, credential.sip_password);

    return () => {
      disposed = true;
      uaRef.current?.stop().catch(() => {});
      uaRef.current = null;
    };
  }, [credential]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attachRemoteAudio(session: any) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc || !audioRef.current) return;
    const remoteStream = new MediaStream();
    pc.getReceivers().forEach((receiver: RTCRtpReceiver) => {
      if (receiver.track) remoteStream.addTrack(receiver.track);
    });
    audioRef.current.srcObject = remoteStream;
    audioRef.current.play().catch(() => {});
  }

  async function handleCall() {
    const target = number.trim();
    if (!target || !uaRef.current || regState !== "registered") return;

    try {
      const { Inviter, SessionState } = await import("sip.js");
      const targetUri = (await import("sip.js")).UserAgent.makeURI(`sip:${target}@${SIP_DOMAIN}`);
      if (!targetUri) return;

      const inviter = new Inviter(uaRef.current, targetUri, {
        sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
      });

      sessionRef.current = inviter;
      setCallState("calling");

      inviter.stateChange.addListener((state: unknown) => {
        switch (state) {
          case SessionState.Establishing:
            setCallState("ringing");
            break;
          case SessionState.Established:
            setCallState("in_call");
            setCallStartedAt(Date.now());
            attachRemoteAudio(inviter);
            break;
          case SessionState.Terminated:
            setCallState("idle");
            setCallStartedAt(null);
            sessionRef.current = null;
            break;
          default:
            break;
        }
      });

      await inviter.invite();
    } catch (err) {
      console.error("CTI: fallo al originar llamada", err);
      setCallState("idle");
    }
  }

  async function handleHangup() {
    const session = sessionRef.current;
    if (!session) return;
    setCallState("ending");
    try {
      const { SessionState } = await import("sip.js");
      if (session.state === SessionState.Established) {
        await session.bye();
      } else {
        await session.cancel();
      }
    } catch (err) {
      console.error("CTI: fallo al colgar", err);
    } finally {
      setCallState("idle");
      setCallStartedAt(null);
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
      if (sender.track && sender.track.kind === "audio") sender.track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }

  const showStatusSelector = profile.role === "agente" && statusReasons.length > 0;
  if (!credential && !showStatusSelector) return null;

  const regTone: BadgeTone =
    regState === "registered" ? "success" : regState === "connecting" ? "warning" : "danger";
  const statusLabel =
    regState === "registered"
      ? "Softphone conectado"
      : regState === "connecting"
        ? "Conectando softphone..."
        : "Softphone desconectado";

  const currentReason = statusReasons.find((r) => r.id === currentReasonId) ?? null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-border bg-surface shadow-xl">
      <audio ref={audioRef} autoPlay className="hidden" />

      {showStatusSelector && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <StatusDot
            tone={currentReason && !currentReason.is_pause ? "success" : "warning"}
            className="h-2 w-2"
          />
          <Select
            fieldSize="sm"
            value={currentReasonId ?? ""}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={savingStatus}
            className="font-medium"
          >
            {statusReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {!credential ? null : (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2">
              <StatusDot tone={regTone} />
              <span className="text-sm font-medium text-foreground">
                Discador · {profile.full_name.split(" ")[0]}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{statusLabel}</span>
          </button>

          {expanded && (
        <div className="border-t border-border p-4">
          {callState === "in_call" || callState === "calling" || callState === "ringing" ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <p className="text-sm font-medium text-foreground">{number}</p>
              <p className="text-xs text-muted-foreground">
                {callState === "calling" && "Marcando..."}
                {callState === "ringing" && "Timbrando..."}
                {callState === "in_call" && (callStartedAt ? formatElapsed(now - callStartedAt) : "En llamada")}
              </p>
              <div className="flex items-center gap-3">
                {callState === "in_call" && (
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-surface-muted"
                    title={muted ? "Reactivar micrófono" : "Silenciar"}
                  >
                    {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleHangup}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-danger text-primary-foreground hover:opacity-90"
                  title="Colgar"
                >
                  <PhoneOff size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Input
                type="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+56 9 XXXX XXXX"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNumber((n) => n.slice(0, -1))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-surface-muted"
                  title="Borrar"
                >
                  <Delete size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleCall}
                  disabled={regState !== "registered" || !number.trim()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-success py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                >
                  <Phone size={16} />
                  Llamar
                </button>
              </div>
            </div>
          )}
        </div>
          )}
        </>
      )}
    </div>
  );
}
