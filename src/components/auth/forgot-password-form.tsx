"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { mapAuthError, type AuthFailure } from "@/lib/auth-errors";
import { AuthAlert, EmailField } from "./auth-fields";
import { buttonClasses } from "@/components/ui";

export function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<AuthFailure | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setFailure(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    setLoading(false);

    // Solo mostramos el error cuando es de límite de intentos o de red. Si el
    // correo no existe respondemos igual que si existiera: decir "ese correo no
    // está registrado" permitiría a cualquiera averiguar quién trabaja acá.
    if (error && (error.status === 429 || !error.status)) {
      setFailure(mapAuthError(error));
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-3 text-sm text-foreground" role="status">
          <MailCheck size={16} className="mt-0.5 flex-shrink-0 text-primary" aria-hidden />
          <span>
            <span className="font-medium">Si ese correo está registrado, te llegará un enlace</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Revisa también la carpeta de no deseados. El enlace dura una hora y se usa una sola vez.
            </span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => setSent(false)}
          className={buttonClasses({ variant: "secondary", className: "w-full" })}
        >
          Enviar a otro correo
        </button>

        <BackToLogin />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {failure ? <AuthAlert failure={failure} /> : null}

      <EmailField value={email} onChange={setEmail} autoFocus />

      <button
        type="submit"
        disabled={loading}
        className={buttonClasses({ className: "w-full" })}
      >
        {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
        {loading ? "Enviando…" : "Enviarme el enlace"}
      </button>

      <BackToLogin />
    </form>
  );
}

function BackToLogin() {
  return (
    <Link
      href="/login"
      className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} aria-hidden />
      Volver a iniciar sesión
    </Link>
  );
}
