"use client";

import { useState, type KeyboardEvent } from "react";
import { AlertCircle, ArrowBigUp, Eye, EyeOff } from "lucide-react";
import type { AuthFailure } from "@/lib/auth-errors";

const INPUT =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Campo de contraseña con mostrar/ocultar y aviso de Bloq Mayús. El aviso evita
 * el caso más común de "credenciales inválidas" en un teclado de call center.
 */
export function PasswordField({
  id,
  label,
  aside,
  value,
  onChange,
  autoComplete,
  placeholder = "••••••••",
  hint,
}: {
  id: string;
  label: string;
  /** Enlace opcional a la derecha de la etiqueta (recuperar contraseña). */
  aside?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  function trackCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyUp={trackCapsLock}
          onKeyDown={trackCapsLock}
          onBlur={() => setCapsLock(false)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={`${INPUT} pr-10`}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute inset-y-0 right-2 flex w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {capsLock ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning" aria-live="polite">
          <ArrowBigUp size={14} aria-hidden />
          Bloq Mayús está activado
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function EmailField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
        Correo
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="email"
        // Pantalla de un solo propósito: el ejecutivo entra dos veces al día y
        // siempre empieza en este campo.
        autoFocus={autoFocus}
        placeholder="nombre@empresa.cl"
        className={INPUT}
      />
    </div>
  );
}

/**
 * El error se anuncia con role="alert" para que un lector de pantalla lo lea sin
 * que el ejecutivo tenga que ir a buscarlo.
 */
export function AuthAlert({ failure, children }: { failure: AuthFailure; children?: React.ReactNode }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2.5 text-sm text-danger"
    >
      <AlertCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden />
      <span>
        <span className="font-medium">{failure.title}</span>
        {failure.detail ? <span className="mt-0.5 block text-xs opacity-90">{failure.detail}</span> : null}
        {children}
      </span>
    </div>
  );
}
