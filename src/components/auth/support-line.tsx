const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";

/**
 * Salida de emergencia: si el ejecutivo no puede entrar, tiene a quién escribir
 * sin salir de la pantalla.
 */
export function SupportLine() {
  if (!SUPPORT_EMAIL) {
    return <>Acceso restringido a usuarios autorizados. Si no puedes entrar, avisa a tu supervisor.</>;
  }

  return (
    <>
      ¿Problemas para entrar?{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
        Escribe a soporte
      </a>
    </>
  );
}
