"use client";

import { PantallaDeError } from "@/components/errores/pantalla-de-error";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PantallaDeError error={error} reset={reset} volver="/dashboard" volverLabel="Ir al inicio" />;
}
