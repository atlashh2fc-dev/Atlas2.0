import { Globe, Mail, MessageCircle, PhoneCall, UserRound } from "lucide-react";

/**
 * El único visual del panel de acceso: los canales convergen, con un pulso
 * que los recorre, en una sola ficha del cliente. Es la promesa central de la
 * suite dibujada en vez de dicha: da igual por dónde escriba o llame alguien,
 * en Atlas es la misma persona con el mismo historial.
 *
 * Está pensada para el panel oscuro: líneas tenues del color del texto y el
 * pulso en el acento de la marca. Los iconos de lucide se anidan como
 * <svg x y> dentro del lienzo, así el dibujo escala como una sola pieza.
 */
const CHANNELS = [
  { icon: PhoneCall, label: "Llamadas", delay: "0s" },
  { icon: MessageCircle, label: "WhatsApp", delay: "0.65s" },
  { icon: Mail, label: "Correo", delay: "1.3s" },
  { icon: Globe, label: "Web y formularios", delay: "1.95s" },
];

const HUB = { x: 270, y: 96 };
/** Centro del icono de cada canal; la etiqueta sale a su derecha. */
const NODE_X = 24;
/** Las curvas nacen pasada la etiqueta más larga, para no cruzar texto. */
const CURVE_X = 158;
const FIRST_Y = 30;
const STEP_Y = 44;

function curve(y: number) {
  const endX = HUB.x - 38;
  return `M${CURVE_X} ${y} C ${CURVE_X + 50} ${y}, ${endX - 50} ${HUB.y}, ${endX} ${HUB.y}`;
}

export function OmnichannelFigure({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 200"
      className={`w-full text-auth-panel-foreground ${className}`}
      role="img"
      aria-label="Llamadas, WhatsApp, correo y web convergen en una sola ficha del cliente"
    >
      {/* Rutas base: siempre visibles, tenues. */}
      {CHANNELS.map(({ label }, index) => (
        <path
          key={`base-${label}`}
          d={curve(FIRST_Y + index * STEP_Y)}
          fill="none"
          className="stroke-auth-panel-foreground/20"
          strokeWidth={1}
        />
      ))}
      {/* Pulsos que viajan hacia la ficha, desfasados para que no lleguen todos a la vez. */}
      {CHANNELS.map(({ label, delay }, index) => (
        <path
          key={`flow-${label}`}
          d={curve(FIRST_Y + index * STEP_Y)}
          fill="none"
          className="atlas-omni-flow stroke-accent"
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
            <circle
              cx={NODE_X}
              cy={y}
              r={15}
              className="fill-auth-panel-foreground/10 stroke-auth-panel-foreground/25"
              strokeWidth={1}
            />
            <Icon x={NODE_X - 8} y={y - 8} size={16} strokeWidth={1.75} className="text-accent" aria-hidden />
            <text x={NODE_X + 24} y={y + 4} fontSize={12} className="fill-auth-panel-foreground/85">
              {label}
            </text>
          </g>
        );
      })}

      {/* La ficha: un solo destino, con un halo que respira. */}
      <circle cx={HUB.x} cy={HUB.y} r={34} className="atlas-omni-pulse fill-accent/20" />
      <circle cx={HUB.x} cy={HUB.y} r={34} className="fill-accent/10 stroke-accent/40" strokeWidth={1} />
      <circle cx={HUB.x} cy={HUB.y} r={25} className="fill-auth-panel stroke-accent" strokeWidth={1.5} />
      <UserRound x={HUB.x - 11} y={HUB.y - 11} size={22} strokeWidth={1.75} className="text-accent" aria-hidden />
      <text
        x={HUB.x}
        y={HUB.y + 54}
        fontSize={12}
        textAnchor="middle"
        className="fill-auth-panel-foreground font-medium"
      >
        Una sola ficha
      </text>
    </svg>
  );
}
