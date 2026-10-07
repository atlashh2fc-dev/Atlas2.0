import Link from "next/link";
import { ArrowLeft, FileUp } from "lucide-react";

import { PageHeader, buttonClasses } from "@/components/ui";
import { PACIENTES_POR_EDICION, clinicaDe } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";

import { Importador } from "./importador";

/**
 * Cargar las fichas que la clínica ya tenía en Excel. No duplica: cada fila
 * se busca por celular, RUT o correo antes de crear una ficha nueva.
 */
export default async function ImportarPage() {
  const { edicion } = await contextoDeMiEmpresa();
  const tipo = clinicaDe(edicion);
  const voc = PACIENTES_POR_EDICION[tipo];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title={`Importar ${voc.titulo.toLowerCase()}`}
        icon={FileUp}
        description="Sube la planilla que ya tienes. Si alguien ya existe (mismo celular, RUT o correo), se completa su ficha en vez de duplicarla."
        actions={<Link href="/dashboard/pacientes" className={buttonClasses({ variant: "ghost" })}><ArrowLeft size={16} aria-hidden="true" /> {voc.titulo}</Link>}
      />
      <Importador esVet={tipo === "vet"} plural={voc.titulo} />
    </div>
  );
}
