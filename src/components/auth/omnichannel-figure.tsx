import { Globe, Mail, MessageCircle, PhoneCall, UserRound } from "lucide-react";

/**
 * Figura omnicanal de la pantalla de acceso: los canales de la izquierda
 * convergen, con un pulso animado, en una sola ficha del cliente. Es la
 * promesa central de la suite dibujada, no dicha: da igual por dónde escriba
 * o llame alguien, en Atlas es la misma persona con el mismo historial.
 *
 * Los iconos de lucide se anidan como <svg x y> dentro del lienzo; así el
 * dibujo escala como una sola pieza y respeta el color del tema.
 */
const CHANNELS = [
  { icon: PhoneCall, label: "Llamadas", delay: "0s" },
  { icon: MessageCircle, label: "WhatsApp", delay: "0.65s" },
  { icon: Mail, label: "Correo", delay: "1.3s" },
  { icon: Globe, label: "Web y formularios", delay: "1.95s" },
];

const HUB = { x: 272, y: 76 };
/** Donde va el icono del canal; la etiqueta sale a su derecha. */
const START_X = 38;
/** Las curvas nacen pasada la etiqueta más larga, para no cruzar texto. */
const CURVE_X = 148;
const FIRST_Y = 22;
const STEP_Y = 36;

function curve(y: number) {
  const endX = HUB.x - 34;
  return `M${CURVE_X} ${y} C ${CURVE_X + 55} ${y}, ${endX - 55} ${HUB.y}, ${endX} ${HUB.y}`;
}

export function OmnichannelFigure({ className = "" }: { className?: string }) {
  return (
    <figure className={className}>
      <figcaption className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Omnicanal de verdad</p>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          Llame, escriba por WhatsApp, responda un correo o deje un formulario: en Atlas es la misma
          persona, con un solo historial.
        </p>
      </figcaption>

      <svg viewBox="0 0 320 152" className="w-full text-muted-foreground" role="img" aria-label="Llamadas, WhatsApp, correo y web convergen en una sola ficha del cliente">
        {/* Rutas base: siempre visibles, tenues. */}
        {CHANNELS.map(({ label }, index) => (
          <path key={`base-${label}`} d={curve(FIRST_Y + index * STEP_Y)} fill="none" className="stroke-foreground/15" strokeWidth={1} />
        ))}
        {/* Pulsos que viajan hacia la ficha, desfasados para que no lleguen todos a la vez. */}
        {CHANNELS.map(({ label, delay }, index) => (
          <path
            key={`flow-${label}`}
            d={curve(FIRST_Y + index * STEP_Y)}
            fill="none"
            className="atlas-omni-flow stroke-primary"
            strokeWidth={1.5}
            strokeLinecap="round"
            style={{ animationDelay: delay }}
          />
        ))}

        {/* Canales. */}
        {CHANNELS.map(({ icon: Icon, label }, index) => {
          const y = FIRST_Y + index * STEP_Y;
          return (
            <g key={label}>
              <circle cx={START_X - 16} cy={y} r={13} className="fill-surface stroke-border" strokeWidth={1} />
              <Icon x={START_X - 23} y={y - 7} size={14} strokeWidth={1.75} className="text-primary" aria-hidden />
              <text x={START_X + 6} y={y + 4} fontSize={11} className="fill-current">
                {label}
              </text>
            </g>
          );
        })}

        {/* La ficha: un solo destino, con un halo que respira. */}
        <circle cx={HUB.x} cy={HUB.y} r={30} className="atlas-omni-pulse fill-primary/15" />
        <circle cx={HUB.x} cy={HUB.y} r={30} className="fill-primary/10 stroke-primary/40" strokeWidth={1} />
        <circle cx={HUB.x} cy={HUB.y} r={22} className="fill-surface stroke-primary" strokeWidth={1.5} />
        <UserRound x={HUB.x - 10} y={HUB.y - 10} size={20} strokeWidth={1.75} className="text-primary" aria-hidden />
        <text x={HUB.x} y={HUB.y + 46} fontSize={11} textAnchor="middle" className="fill-foreground font-medium">
          Una sola ficha
        </text>
      </svg>
    </figure>
  );
}
