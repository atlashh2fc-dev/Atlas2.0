"use client";

import { PantallaDeError } from "@/components/errores/pantalla-de-error";

export default function PlataformaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PantallaDeError error={error} reset={reset} volver="/plataforma" volverLabel="Volver a empresas" />;
}
