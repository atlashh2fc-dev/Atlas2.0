import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { SupportLine } from "@/components/auth/support-line";

export const metadata: Metadata = {
  title: "Entrar | Atlas",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      title="Inicia sesión"
      description="Usa el correo con el que te dieron de alta en Atlas."
      footer={<SupportLine />}
    >
      <LoginForm linkExpired={error === "enlace_invalido"} />
    </AuthShell>
  );
}
