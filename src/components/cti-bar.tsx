"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Delete } from "lucide-react";
import type { Profile } from "@/lib/types";

/**
 * Barra CTI del agente: softphone WebRTC embebido en el CRM, conectado a la
 * extensión SIP sobre WSS del mismo Asterisk que usa el motor de discado
 * (docs/dialer-engine-architecture.md). Permite marcar manualmente un
 * número (click-to-call) sin pasar por el motor de campañas.
 *
 * NOTA (validación / MVP): usa una única extensión SIP compartida (6002)
 * mientras no exista aprovisionamiento por agente. Con más de un agente
 * conectado a la vez esta línea se pisaría — antes de habilitarla para
 * varios ejecutivos hay que crear un endpoint PJSIP por agente (ver
 * dialer-engine-architecture.md, sección CTI).
 */

const SIP_WSS_SERVER = "wss://54.233.114.5:8089/ws";
const SIP_DOMAIN = "54.233.114.5";
const SIP_USER = "6002";
const SIP_PASSWORD = "1uBmRFaXW84MwY1BB9kW";

type RegState = "idle" | "connecting" | "registered" | "error";
type CallState = "idle" | "calling" | "ringing" | "in_call" | "ending";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CtiBar({ profile }: { profile: Profile }) {
  const [regState, setRegState] = useState<RegState>("idle");
  const [callState, setCallState] = useState<CallState>("idle");
  const [number, setNumber] = useState("");
  const [muted, setMuted] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uaRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (callState !== "in_call" || !callStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [callState, callStartedAt]);

  useEffect(() => {
    let disposed = false;

    async function register() {
      setRegState("connecting");
      try {
        const { UserAgent, Registerer } = await import("sip.js");

        const uri = UserAgent.makeURI(`sip:${SIP_USER}@${SIP_DOMAIN}`);
        if (!uri) throw new Error("URI SIP inválida");

        const ua = new UserAgent({
          uri,
          authorizationUsername: SIP_USER,
          authorizationPassword: SIP_PASSWORD,
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

    register();

    return () => {
      disposed = true;
      uaRef.current?.stop().catch(() => {});
      uaRef.current = null;
    };
  }, []);

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

  const statusColor =
    regState === "registered" ? "bg-success" : regState === "connecting" ? "bg-warning" : "bg-danger";
  const statusLabel =
    regState === "registered"
      ? "Softphone conectado"
      : regState === "connecting"
        ? "Conectando softphone..."
        : "Softphone desconectado";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 rounded-2xl border border-border bg-surface shadow-xl">
      <audio ref={audioRef} autoPlay className="hidden" />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <span className="text-sm font-medium text-foreground">Discador · {profile.full_name.split(" ")[0]}</span>
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
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white hover:opacity-90"
                  title="Colgar"
                >
                  <PhoneOff size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+56 9 XXXX XXXX"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/30"
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
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-success py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  <Phone size={16} />
                  Llamar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
