import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { SupportLine } from "@/components/auth/support-line";

export const metadata: Metadata = {
  title: "Recuperar contraseña | Atlas",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <AuthShell
      title="Recuperar contraseña"
      description="Te enviamos un enlace para crear una nueva."
      footer={<SupportLine />}
    >
      <ForgotPasswordForm initialEmail={email ?? ""} />
    </AuthShell>
  );
}
