import { redirect } from "next/navigation";

import { requireProfile } from "@/lib/auth";
import { contextoDeMiEmpresa } from "@/lib/modules.server";

/**
 * Las empresas ya no se administran desde el CRM de una empresa. El dueño de la
 * plataforma tiene su consola en /plataforma; un admin de empresa administra a
 * su gente en Usuarios. Esta dirección queda para los enlaces viejos.
 */
export default async function EmpresasAdminPage() {
  await requireProfile(["admin"]);
  const { duenio } = await contextoDeMiEmpresa();
  redirect(duenio ? "/plataforma" : "/dashboard/admin/usuarios");
}
