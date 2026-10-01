import { connection } from "next/server";
import { PawPrint } from "lucide-react";

import { ModelosMascota } from "@/components/plataforma/modelos-mascota";
import { PageHeader } from "@/components/ui";
import { listarModelos } from "@/lib/mascota-modelos.server";
import { requirePlataforma } from "@/lib/plataforma.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Modelos realistas de las razas de Atlas Vet: se generan con IA, se comparan
 * en el visor de la ficha y el elegido de cada raza reemplaza al dibujado en
 * todas las fichas.
 */
export default async function MascotasPlataformaPage() {
  await connection();
  await requirePlataforma();
  const modelos = await listarModelos(createAdminClient());

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mascotas 3D"
        icon={PawPrint}
        description="Modelos realistas de cada raza para la ficha de Vet. Genera una prueba, compárala girándola y tocando sus zonas, y elige la que quedará en todas las fichas de esa raza."
      />
      <ModelosMascota iniciales={modelos} />
    </div>
  );
}
