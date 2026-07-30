"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ACCOUNT_INACTIVE,
  ACCOUNT_NOT_PROVISIONED,
  LINK_EXPIRED,
  mapAuthError,
  type AuthFailure,
} from "@/lib/auth-errors";
import { AuthAlert, EmailField, PasswordField } from "./auth-fields";

const REMEMBER_KEY = "atlas.login.email";

/**
 * Correo recordado. Se lee con useSyncExternalStore (y no en un efecto) para no
 * escribir estado durante el montaje: localStorage no existe en el servidor y
 * un setState en efecto rompe la regla react-hooks/set-state-in-effect.
 */
let cachedEmail: string | null = null;

function subscribeRemembered(): () => void {
  return () => {};
}

function readRemembered(): string {
  if (cachedEmail === null) {
    try {
      cachedEmail = window.localStorage.getItem(REMEMBER_KEY) ?? "";
    } catch {
      cachedEmail = "";
    }
  }
  return cachedEmail;
}

function readRememberedOnServer(): string {
  return "";
}

function persistRemembered(email: string, remember: boolean) {
  try {
    if (remember) window.localStorage.setItem(REMEMBER_KEY, email);
    else window.localStorage.removeItem(REMEMBER_KEY);
    cachedEmail = remember ? email : "";
  } catch {
    // Modo privado o almacenamiento bloqueado: no es motivo para fallar el login.
  }
}

export function LoginForm({ linkExpired }: { linkExpired?: boolean }) {
  const router = useRouter();
  const remembered = useSyncExternalStore(subscribeRemembered, readRemembered, readRememberedOnServer);

  const [email, setEmail] = useState(remembered);
  const [remember, setRemember] = useState(remembered !== "");
  const [seenRemembered, setSeenRemembered] = useState(remembered);
  // El correo recordado llega recién tras la hidratación; ajustar el estado
  // durante el render es el patrón que React documenta para este caso.
  if (seenRemembered !== remembered) {
    setSeenRemembered(remembered);
    setEmail(remembered);
    setRemember(remembered !== "");
  }

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(linkExpired ? LINK_EXPIRED : null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setFailure(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      setFailure(mapAuthError(error));
      setLoading(false);
      return;
    }

    // Una cuenta desactivada autentica igual: sin esta comprobación el ejecutivo
    // entraba y el dashboard lo devolvía al login sin decirle por qué.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profileError) {
      if (!profile) {
        await supabase.auth.signOut();
        setFailure(ACCOUNT_NOT_PROVISIONED);
        setLoading(false);
        return;
      }
      if (profile.active === false) {
        await supabase.auth.signOut();
        setFailure(ACCOUNT_INACTIVE);
        setLoading(false);
        return;
      }
    }

    persistRemembered(email.trim(), remember);
    router.push("/dashboard");
    router.refresh();
    // No apagamos `loading`: el botón queda en "Entrando…" mientras navega.
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {failure ? (
        <AuthAlert failure={failure}>
          {failure.offerRecovery ? (
            <Link
              href={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
              className="mt-1 inline-block text-xs font-medium underline underline-offset-2"
            >
              Recuperar mi contraseña
            </Link>
          ) : null}
        </AuthAlert>
      ) : null}

      <EmailField value={email} onChange={setEmail} autoFocus />

      <PasswordField
        id="password"
        label="Contraseña"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        aside={
          <Link
            href={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`}
            className="text-xs text-primary hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        }
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="accent-primary"
        />
        Recordar mi correo en este equipo
      </label>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
