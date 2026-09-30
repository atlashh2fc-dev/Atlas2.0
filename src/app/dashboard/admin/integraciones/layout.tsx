import { requireProfile } from "@/lib/auth";

/**
 * Las integraciones son un único destino: el catálogo lista cada sistema
 * conectado y cada uno abre su propia pantalla (docs/arquitectura-navegacion.md §4.4).
 * El módulo lo exige cada integración, no el catálogo.
 */
export default async function IntegracionesLayout({ children }: { children: React.ReactNode }) {
  await requireProfile(["admin"]);
  return <>{children}</>;
}
