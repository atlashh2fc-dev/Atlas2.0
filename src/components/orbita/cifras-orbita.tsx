import { Activity, BadgeCheck, BrainCircuit, HeartPulse, LifeBuoy } from "lucide-react";

import { KpiStrip, KpiStripItem, type KpiTone } from "@/components/report-kit";
import { ESTADO_AGENTE_INFO, type EstadoAgente, type ResumenOrbita } from "@/lib/orbita";

/** Las cinco cifras de Órbita: salud, ritmo, calidad, autonomía y dirección. */
export function CifrasOrbita({ resumen }: { resumen: ResumenOrbita }) {
  const problemas = (["error", "atrasado", "inactivo"] as EstadoAgente[])
    .filter((estado) => resumen.porEstado[estado] > 0)
    .map((estado) => `${resumen.porEstado[estado]} ${ESTADO_AGENTE_INFO[estado].label.toLowerCase()}`);
  const tonoSalud: KpiTone =
    resumen.total === 0 ? "default" : resumen.porEstado.error > 0 ? "danger" : resumen.sanos === resumen.total ? "good" : "warn";
  const tonoExito: KpiTone =
    resumen.tasaExito7 === null ? "default" : resumen.tasaExito7 >= 95 ? "good" : resumen.tasaExito7 >= 80 ? "warn" : "danger";

  return (
    <KpiStrip columns={5} title="Cómo va la red" meta="Turnos de los agentes de marketing (sin los chequeos del Guardián)">
      <KpiStripItem
        label="Agentes sanos"
        value={`${resumen.sanos}/${resumen.total}`}
        icon={HeartPulse}
        tone={tonoSalud}
        progress={resumen.total ? (resumen.sanos / resumen.total) * 100 : 0}
        definition={{ text: "Agentes cuyo último estado es «Sano» o «Trabajando»." }}
        detail={problemas.length ? problemas.join(" · ") : "Todos operando"}
      />
      <KpiStripItem
        label="Ejecuciones 24 h"
        value={resumen.ejecuciones24.toLocaleString("es-CL")}
        icon={Activity}
        tone={resumen.fallidas24 > 0 ? "warn" : "default"}
        definition={{ text: "Turnos de los agentes de marketing que terminaron en las últimas 24 horas, bien o con error. No incluye los chequeos horarios del Guardián." }}
        detail={resumen.fallidas24 > 0 ? `${resumen.fallidas24} con error` : resumen.ejecuciones24 > 0 ? "Sin errores" : "Ningún turno terminado"}
      />
      <KpiStripItem
        label="Éxito 7 d"
        value={resumen.tasaExito7 === null ? "—" : `${resumen.tasaExito7.toLocaleString("es-CL")} %`}
        icon={BadgeCheck}
        tone={tonoExito}
        progress={resumen.tasaExito7 ?? undefined}
        definition={{
          text: "De los turnos de los agentes de marketing terminados en 7 días, los que terminaron bien (sin los chequeos del Guardián).",
          formula: "fines sin error ÷ (fines + errores)",
        }}
        detail={resumen.ejecuciones7 === 1 ? "1 turno terminado" : `${resumen.ejecuciones7.toLocaleString("es-CL")} turnos terminados`}
      />
      <KpiStripItem
        label="Recuperaciones 7 d"
        value={resumen.recuperaciones7.toLocaleString("es-CL")}
        icon={LifeBuoy}
        tone={resumen.recuperaciones7 > 0 ? "good" : "default"}
        definition={{ text: "Agentes caídos que el sistema volvió a levantar solo, sin intervención." }}
        detail="Automáticas, sin intervención"
      />
      <KpiStripItem
        label="Decisiones CEO 7 d"
        value={resumen.decisionesCeo7.toLocaleString("es-CL")}
        icon={BrainCircuit}
        definition={{ text: "Aprobaciones, rechazos y órdenes del CEO de marketing (agente 0) en 7 días." }}
        detail="Aprobar, rechazar, ordenar"
      />
    </KpiStrip>
  );
}
