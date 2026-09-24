import { NavTabs, PageHeader } from "@/components/ui";

/** Encabezado compartido de la cola y del buscador de ventas validadas. */
export function ValidacionVentasHeader() {
  return (
    <>
      <PageHeader
        title="Validación de ventas"
        description="Aprueba las ventas que tipifican los ejecutivos para que avancen en el CRM, o recházalas con motivo."
        className="border-b-0 pb-0"
      />
      <NavTabs
        tabs={[
          { label: "Por validar", href: "/dashboard/validacion-ventas" },
          { label: "Ventas validadas", href: "/dashboard/validacion-ventas/validadas" },
        ]}
      />
    </>
  );
}
