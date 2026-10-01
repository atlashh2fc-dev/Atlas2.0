import { PageSkeleton } from "@/components/ui";

/** Esqueleto con la forma de la página (ver PageSkeleton): sin caja de espera. */
export default function Loading() {
  return <PageSkeleton variant="table" label="Cargando usuarios" header={false} />;
}
