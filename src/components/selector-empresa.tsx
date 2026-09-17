"use client";

import { useTransition } from "react";
import { Building2 } from "lucide-react";

import { elegirEmpresaActiva } from "@/app/actions/organizaciones";
import { useToast } from "@/components/ui";

export type EmpresaDisponible = { id: string; name: string };

/**
 * Cambia la empresa que la persona está mirando.
 *
 * La elección se guarda en el perfil y la seguridad por fila la respeta, así que
 * con un cambio acá el CRM completo (leads, campañas, informes, WhatsApp) pasa a
 * mostrar solo esa empresa. Solo aparece para quien tiene más de una.
 */
export function SelectorEmpresa({
  empresas,
  actual,
}: {
  empresas: EmpresaDisponible[];
  actual: string | null;
}) {
  const [pendiente, startTransition] = useTransition();
  const { toast } = useToast();

  if (empresas.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <Building2 aria-hidden className="h-4 w-4" />
      <span className="sr-only">Empresa que estás mirando</span>
      <select
        className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-foreground disabled:opacity-60"
        defaultValue={actual ?? ""}
        disabled={pendiente}
        onChange={(event) => {
          const datos = new FormData();
          datos.set("empresa_id", event.target.value);
          startTransition(async () => {
            try {
              await elegirEmpresaActiva(datos);
              toast({
                tone: "success",
                message: event.target.value
                  ? `Estás viendo ${empresas.find((empresa) => empresa.id === event.target.value)?.name ?? "la empresa"}`
                  : "Estás viendo todas tus empresas",
              });
            } catch (error) {
              toast({
                tone: "danger",
                message: error instanceof Error ? error.message : "No se pudo cambiar de empresa",
              });
            }
          });
        }}
      >
        <option value="">Todas mis empresas</option>
        {empresas.map((empresa) => (
          <option key={empresa.id} value={empresa.id}>
            {empresa.name}
          </option>
        ))}
      </select>
    </label>
  );
}
