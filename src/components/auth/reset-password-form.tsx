"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LINK_EXPIRED, mapAuthError, type AuthFailure } from "@/lib/auth-errors";
import { AuthAlert, PasswordField } from "./auth-fields";

const MIN_LENGTH = 8;

export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <AuthAlert failure={LINK_EXPIRED} />
        <Link
          href="/forgot-password"
          className="flex w-full items-center justify-center rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  }

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit = password.length >= MIN_LENGTH && password === confirmation && !loading;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setFailure(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setFailure(mapAuthError(error));
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {failure ? <AuthAlert failure={failure} /> : null}

      <PasswordField
        id="new-password"
        label="Nueva contraseña"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={tooShort ? `Usa al menos ${MIN_LENGTH} caracteres.` : `Mínimo ${MIN_LENGTH} caracteres.`}
      />

      <PasswordField
        id="confirm-password"
        label="Repite la contraseña"
        value={confirmation}
        onChange={setConfirmation}
        autoComplete="new-password"
        hint={mismatch ? "Las dos contraseñas no coinciden." : undefined}
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
        {loading ? "Guardando…" : "Guardar y entrar"}
      </button>
    </form>
  );
}
