import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PawPrint } from "lucide-react";

import { ModelosDeLaClinica } from "@/components/modelos-de-la-clinica";
import { PageHeader } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { razasDeLaClinica } from "@/lib/mascota-modelos.server";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Mascotas 3D de la clínica: las razas de sus propias mascotas y, para cada
 * una, si la ficha la muestra con el modelo realista o todavía dibujada. Desde
 * aquí se pide el modelo de las que faltan.
 */
export default async function MascotasDeLaClinicaPage() {
  await connection();
  await requireProfile(["admin"]);
  if ((await contextoDeMiEmpresa()).edicion !== "vet") notFound();
  const razas = await razasDeLaClinica(await createClient(), createAdminClient());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mascotas 3D"
        icon={PawPrint}
        description="Las razas de tus mascotas y cómo se ven en la ficha. Pide el modelo realista de las que todavía se muestran dibujadas."
      />
      <ModelosDeLaClinica iniciales={razas} />
    </div>
  );
}
