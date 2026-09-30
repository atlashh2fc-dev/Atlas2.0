import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { LogoDeIntegracion } from "@/components/logo-integracion";
import { Badge, PageHeader, type BadgeTone } from "@/components/ui";
import {
  CATEGORIAS,
  integracionesDeLaEmpresa,
  type EstadoIntegracion,
  type Integracion,
} from "@/lib/integraciones.server";
import { modulosActivos } from "@/lib/modules.server";
import { cn } from "@/lib/utils";

const PUNTO: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-primary",
  neutral: "bg-muted-foreground",
};

function Punto({ tone }: { tone: BadgeTone }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", PUNTO[tone])} aria-hidden="true" />;
}

const ESTADO: Record<EstadoIntegracion, { label: string; resumen: string; tone: BadgeTone }> = {
  conectado: { label: "Conectado", resumen: "conectadas", tone: "success" },
  revisar: { label: "Revisar", resumen: "por revisar", tone: "warning" },
  prueba: { label: "Modo prueba", resumen: "en prueba", tone: "info" },
  sin_conectar: { label: "Sin conectar", resumen: "sin conectar", tone: "neutral" },
};

export default async function IntegracionesPage() {
  const integraciones = await integracionesDeLaEmpresa(await modulosActivos());
  const cuenta = (estado: EstadoIntegracion) => integraciones.filter((i) => i.estado === estado).length;
  const resumen = (["conectado", "revisar", "prueba", "sin_conectar"] as const)
    .map((estado) => ({ estado, n: cuenta(estado) }))
    .filter(({ n }) => n > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        description="Los sistemas con los que Atlas habla y si cada conexión está funcionando."
        actions={
          resumen.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {resumen.map(({ estado, n }) => (
                <span key={estado} className="inline-flex items-center gap-1.5">
                  <Punto tone={ESTADO[estado].tone} />
                  <span className="font-semibold text-foreground">{n}</span> {n === 1 && estado === "conectado" ? "conectada" : ESTADO[estado].resumen}
                </span>
              ))}
            </div>
          )
        }
      />

      {integraciones.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Esta empresa no tiene aplicaciones que se conecten con sistemas externos.
        </p>
      ) : (
        CATEGORIAS.map((categoria) => {
          const grupo = integraciones.filter((i) => i.categoria === categoria);
          if (grupo.length === 0) return null;
          return (
            <section key={categoria} className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{categoria}</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {grupo.map((integracion) => (
                  <TarjetaDeIntegracion key={integracion.id} integracion={integracion} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Solo es enlace lo que tiene pantalla propia: una tarjeta sin destino no simula ser clicable. */
function TarjetaDeIntegracion({ integracion }: { integracion: Integracion }) {
  const estado = ESTADO[integracion.estado];
  const contenido = (
    <>
      <div className="flex items-start gap-3">
        <LogoDeIntegracion logo={integracion.logo} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold text-foreground">{integracion.nombre}</p>
            <Badge tone={estado.tone} className="shrink-0 gap-1.5">
              <Punto tone={estado.tone} />
              {estado.label}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{integracion.proveedor}</p>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{integracion.descripcion}</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs">
        <span
          className={cn("min-w-0 truncate", integracion.estado === "revisar" ? "text-warning" : "text-muted-foreground")}
          title={integracion.detalle}
        >
          {integracion.detalle}
        </span>
        {integracion.href && (
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary">
            {integracion.estado === "sin_conectar" ? "Conectar" : "Configurar"}
            <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  );

  const base = "flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm";
  return integracion.href ? (
    <Link
      href={integracion.href}
      className={cn(
        base,
        "group transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      )}
    >
      {contenido}
    </Link>
  ) : (
    <div className={base}>{contenido}</div>
  );
}
