import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { sesionActual } from "@/lib/sesion.server";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { SupportLine } from "@/components/auth/support-line";

export const metadata: Metadata = {
  title: "Entrar | Atlas",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>;
}) {
  const { error, reason } = await searchParams;
  const forcedLogout = reason === "forced_logout";

  // Quien ya tiene sesión abierta no ve esta pantalla. La decisión se toma acá
  // y no en el proxy: el proxy solo mira el token, y un token válido de una
  // sesión cerrada a distancia lo mandaría al panel y de vuelta, en un bucle.
  if ((await sesionActual()).estado === "activa") redirect("/dashboard");

  return (
    <AuthShell
      title="Inicia sesión"
      description={
        forcedLogout
          ? "Un administrador cerró tu sesión anterior. Puedes volver a entrar normalmente."
          : "Usa el correo con el que te dieron de alta en Atlas."
      }
      footer={<SupportLine />}
    >
      <LoginForm linkExpired={error === "enlace_invalido"} />
    </AuthShell>
  );
}
