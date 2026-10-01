import { PageSkeleton } from "@/components/ui";

/** Esqueleto con la forma de la página (ver PageSkeleton): sin caja de espera. */
export default function Loading() {
  return <PageSkeleton variant="dashboard" label="Cargando correo" />;
}
