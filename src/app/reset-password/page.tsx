import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SupportLine } from "@/components/auth/support-line";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Nueva contraseña | Atlas",
};

export default async function ResetPasswordPage() {
  // El enlace del correo pasa antes por /auth/callback, que deja la sesión de
  // recuperación abierta. Sin sesión el enlace venció o se usó dos veces.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AuthShell
      title="Crea tu nueva contraseña"
      description={user?.email ? `Para ${user.email}.` : "El enlace del correo te trajo hasta acá."}
      footer={<SupportLine />}
    >
      <ResetPasswordForm hasSession={Boolean(user)} />
    </AuthShell>
  );
}
