"use client";

import { useEffect, useState } from "react";

type Probe = "ok" | "down" | "unknown";

interface StatusPayload {
  auth: Probe;
  dialer: Probe;
}

/**
 * Estado del servicio en la pantalla de acceso. Sirve para que el ejecutivo que
 * no puede entrar sepa si el problema es su contraseña o el sistema, en vez de
 * llamar a soporte para averiguarlo.
 */
export function ServiceStatus() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/status", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("status"))))
      .then((payload: StatusPayload) => setStatus(payload))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) {
    return <Line tone="down" label="No pudimos verificar el estado del servicio" />;
  }

  if (!status) {
    return <Line tone="pending" label="Verificando el estado del servicio…" />;
  }

  if (status.auth === "down") {
    return <Line tone="down" label="El servicio de acceso está caído" />;
  }

  if (status.dialer === "down") {
    return <Line tone="warn" label="Acceso operativo · central telefónica caída" />;
  }

  // El motor solo se reporta si hay una URL de salud configurada; sin ella no
  // afirmamos nada sobre la central.
  return (
    <Line
      tone="ok"
      label={status.dialer === "ok" ? "Sistema y central telefónica operativos" : "Sistema operativo"}
    />
  );
}

const DOT: Record<string, string> = {
  ok: "bg-accent",
  warn: "bg-warning",
  down: "bg-danger",
  pending: "bg-auth-panel-foreground/40",
};

function Line({ tone, label }: { tone: keyof typeof DOT; label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-auth-panel-foreground/85" aria-live="polite">
      <span className={`size-1.5 flex-shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      {label}
    </p>
  );
}
