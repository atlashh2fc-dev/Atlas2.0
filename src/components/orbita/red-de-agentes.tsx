"use client";

import { useMemo, useState, type KeyboardEvent } from "react";

import {
  ANILLO_EXTERNO,
  ANILLO_INTERNO,
  CENTRO_DE_LA_RED,
  ESTADO_AGENTE_INFO,
  LIENZO,
  TIPO_CONEXION_INFO,
  TIPOS_CONEXION,
  aristasDeLaRed,
  colorDelAgente,
  haceCuanto,
  posicionesDeLaRed,
  pulsosRecientes,
  trazoEntre,
  type AgenteOrbita,
  type EventoOrbita,
  type NodoDeLaRed,
} from "@/lib/orbita";

/**
 * La red de Órbita: cada agente es una neurona y cada conexión una sinapsis
 * con dirección. Los halos laten según el estado y lo que pasó en los últimos
 * 10 minutos viaja como un pulso de un agente a otro.
 *
 * Vive sobre un escenario oscuro propio (igual en tema claro u oscuro): es la
 * pieza que se muestra en una demo. Con movimiento reducido no se anima nada y
 * los pulsos se ven como conexiones encendidas.
 */

const FONDO_NODO = "#0b1220";
const TEXTO = "#e2e8f0";
const TEXTO_SUAVE = "#94a3b8";
const CONTORNO = { stroke: "#060a14", strokeWidth: 5, strokeLinejoin: "round", paintOrder: "stroke" } as const;

type Props = {
  agentes: AgenteOrbita[];
  pulsos: EventoOrbita[];
  ahora: number;
  seleccionado: string | null;
  onSeleccionar: (codigo: string) => void;
  reducirMovimiento: boolean;
};

export function RedDeAgentes({ agentes, pulsos, ahora, seleccionado, onSeleccionar, reducirMovimiento }: Props) {
  const [sobre, setSobre] = useState<string | null>(null);
  const nodos = useMemo(() => posicionesDeLaRed(agentes.map((agente) => agente.codigo)), [agentes]);
  const aristas = useMemo(() => aristasDeLaRed(agentes), [agentes]);
  const porCodigo = useMemo(() => new Map(agentes.map((agente) => [agente.codigo, agente])), [agentes]);
  const activos = useMemo(() => pulsosRecientes(pulsos, ahora), [pulsos, ahora]);

  // Conexiones con algo que pasó hace poco: se encienden aunque no haya foco.
  const encendidas = useMemo(() => new Set(activos.map((evento) => `${evento.agente_codigo}>${evento.relacionado_con}`)), [activos]);

  const foco = sobre ?? seleccionado;
  const vecinos = useMemo(() => {
    if (!foco) return null;
    const conjunto = new Set([foco]);
    for (const arista of aristas) {
      if (arista.de === foco) conjunto.add(arista.a);
      if (arista.a === foco) conjunto.add(arista.de);
    }
    return conjunto;
  }, [foco, aristas]);

  const guardian = agentes.find((agente) => agente.conexiones.some((conexion) => conexion.a === "*" && conexion.tipo === "vigila"));

  const alTeclear = (codigo: string) => (evento: KeyboardEvent<SVGGElement>) => {
    if (evento.key === "Enter" || evento.key === " ") {
      evento.preventDefault();
      onSeleccionar(codigo);
    }
  };

  return (
    <svg
      viewBox={`0 0 ${LIENZO.ancho} ${LIENZO.alto}`}
      className="block h-auto w-full select-none"
      style={{ fontFamily: "inherit" }}
      role="group"
      aria-label="Red de agentes de Órbita. Cada agente es un botón que abre su detalle."
    >
      <defs>
        <radialGradient id="orbita-nucleo" cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#1b2740" />
          <stop offset="100%" stopColor={FONDO_NODO} />
        </radialGradient>
        <filter id="orbita-brillo" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="orbita-brillo-pulso" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {TIPOS_CONEXION.map((tipo) => (
          <marker key={tipo} id={`orbita-flecha-${tipo}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1.2 L8.5,5 L0,8.8 Z" fill={TIPO_CONEXION_INFO[tipo].color} />
          </marker>
        ))}
      </defs>

      {/* Los anillos: el interno es de los que publican, el externo es la órbita. */}
      <ellipse cx={CENTRO_DE_LA_RED.x} cy={CENTRO_DE_LA_RED.y} rx={ANILLO_INTERNO.rx} ry={ANILLO_INTERNO.ry} fill="none" stroke="#1e293b" strokeWidth="1" />
      <ellipse
        cx={CENTRO_DE_LA_RED.x}
        cy={CENTRO_DE_LA_RED.y}
        rx={ANILLO_EXTERNO.rx}
        ry={ANILLO_EXTERNO.ry}
        fill="none"
        stroke={guardian ? colorDelAgente(guardian) : "#334155"}
        strokeOpacity={foco && guardian && foco === guardian.codigo ? 0.6 : 0.22}
        strokeWidth="1.2"
        strokeDasharray="2 7"
        strokeLinecap="round"
      >
        {guardian && <title>{`${guardian.nombre} vigila toda la órbita`}</title>}
      </ellipse>

      {/* Conexiones */}
      <g aria-hidden="true">
        {aristas.map((arista) => {
          const de = nodos.get(arista.de);
          const a = nodos.get(arista.a);
          if (!de || !a) return null;
          const { d } = trazoEntre(de, a);
          const info = TIPO_CONEXION_INFO[arista.tipo];
          const tocaFoco = Boolean(foco && (arista.de === foco || arista.a === foco));
          const encendida = encendidas.has(`${arista.de}>${arista.a}`);
          // "Vigila a todos" se dibuja como la órbita; las líneas solo con foco.
          const esVigilancia = arista.tipo === "vigila";
          let opacidad = esVigilancia ? 0 : encendida ? 0.75 : 0.26;
          if (foco) opacidad = tocaFoco ? 0.95 : esVigilancia ? 0 : 0.06;
          return (
            <path
              key={arista.id}
              d={d}
              fill="none"
              stroke={info.color}
              strokeOpacity={opacidad}
              strokeWidth={tocaFoco || encendida ? 1.8 : 1.2}
              strokeDasharray={esVigilancia ? "3 6" : undefined}
              markerEnd={opacidad > 0 ? `url(#orbita-flecha-${arista.tipo})` : undefined}
              className={encendida && !reducirMovimiento && !esVigilancia ? "orbita-flujo" : undefined}
              style={{ transition: "stroke-opacity 180ms ease" }}
            />
          );
        })}
      </g>

      {/* Pulsos: lo que pasó en los últimos 10 minutos, viajando por la red. */}
      <g aria-hidden="true">
        {activos.map((evento, i) => {
          const de = nodos.get(evento.agente_codigo);
          const a = evento.relacionado_con ? nodos.get(evento.relacionado_con) : undefined;
          if (!de || !a) return null;
          const { d } = trazoEntre(de, a);
          const origen = porCodigo.get(evento.agente_codigo);
          const color = origen ? colorDelAgente(origen) : "#38bdf8";
          const declarada = aristas.some((arista) => arista.de === evento.agente_codigo && arista.a === evento.relacionado_con && arista.tipo !== "vigila");
          if (reducirMovimiento) {
            return declarada ? null : <path key={evento.id} d={d} fill="none" stroke={color} strokeOpacity={0.7} strokeWidth={1.6} />;
          }
          const duracion = 2.4;
          const inicio = `${((i * 0.43) % duracion).toFixed(2)}s`;
          return (
            <g key={evento.id}>
              {/* Un evento hacia un agente sin conexión declarada igual se ve. */}
              {!declarada && <path d={d} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="4 6" />}
              <circle r={7} fill={color} opacity={0.55} filter="url(#orbita-brillo-pulso)">
                <animateMotion dur={`${duracion}s`} begin={inicio} repeatCount="indefinite" path={d} />
              </circle>
              <circle r={3.2} fill="#f8fafc">
                <animateMotion dur={`${duracion}s`} begin={inicio} repeatCount="indefinite" path={d} />
              </circle>
            </g>
          );
        })}
      </g>

      {/* Agentes */}
      {agentes.map((agente) => {
        const nodo = nodos.get(agente.codigo);
        if (!nodo) return null;
        return (
          <Neurona
            key={agente.codigo}
            agente={agente}
            nodo={nodo}
            ahora={ahora}
            atenuada={Boolean(vecinos && !vecinos.has(agente.codigo))}
            seleccionada={seleccionado === agente.codigo}
            reducirMovimiento={reducirMovimiento}
            onClick={() => onSeleccionar(agente.codigo)}
            onKeyDown={alTeclear(agente.codigo)}
            onEntrar={() => setSobre(agente.codigo)}
            onSalir={() => setSobre((actual) => (actual === agente.codigo ? null : actual))}
          />
        );
      })}
    </svg>
  );
}

function Neurona({
  agente,
  nodo,
  ahora,
  atenuada,
  seleccionada,
  reducirMovimiento,
  onClick,
  onKeyDown,
  onEntrar,
  onSalir,
}: {
  agente: AgenteOrbita;
  nodo: NodoDeLaRed;
  ahora: number;
  atenuada: boolean;
  seleccionada: boolean;
  reducirMovimiento: boolean;
  onClick: () => void;
  onKeyDown: (evento: KeyboardEvent<SVGGElement>) => void;
  onEntrar: () => void;
  onSalir: () => void;
}) {
  const estado = ESTADO_AGENTE_INFO[agente.ultimo_estado] ?? ESTADO_AGENTE_INFO.inactivo;
  const color = colorDelAgente(agente);
  const hace = haceCuanto(agente.ultimo_evento_at, ahora);
  const esCentro = nodo.anillo === 0;
  const nombre = agente.nombre.length > 22 ? `${agente.nombre.slice(0, 21).trimEnd()}…` : agente.nombre;

  return (
    <g
      transform={`translate(${nodo.x.toFixed(1)} ${nodo.y.toFixed(1)})`}
      className="orbita-nodo"
      role="button"
      tabIndex={0}
      aria-pressed={seleccionada}
      aria-label={`${agente.codigo} · ${agente.nombre}. ${estado.label}, última actividad ${hace}.`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerEnter={onEntrar}
      onPointerLeave={onSalir}
      onFocus={onEntrar}
      onBlur={onSalir}
      style={{ opacity: atenuada ? 0.32 : 1, transition: "opacity 180ms ease" }}
    >
      {/* Área táctil más grande que el dibujo. */}
      <circle r={nodo.r + 18} fill="transparent" />
      <circle
        r={nodo.r + 12}
        fill={estado.color}
        opacity={agente.ultimo_estado === "inactivo" ? 0.18 : 0.5}
        filter="url(#orbita-brillo)"
        className={reducirMovimiento ? undefined : "orbita-halo"}
        data-estado={agente.ultimo_estado}
      />
      {agente.ultimo_estado === "corriendo" && !reducirMovimiento && (
        <>
          <circle r={nodo.r + 2} fill="none" stroke={estado.color} strokeWidth={1.5} className="orbita-onda" />
          <circle r={nodo.r + 2} fill="none" stroke={estado.color} strokeWidth={1.5} className="orbita-onda" style={{ animationDelay: "1.1s" }} />
        </>
      )}
      <circle className="orbita-foco" r={nodo.r + 7} fill="none" stroke="#f8fafc" strokeWidth={1.5} strokeDasharray="3 4" />
      <circle r={nodo.r} fill="url(#orbita-nucleo)" stroke={color} strokeWidth={esCentro ? 2.6 : 2} />
      <circle r={nodo.r - 6} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={1} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={esCentro ? 28 : 22}
        fontWeight={700}
        style={{ letterSpacing: "-0.02em" }}
      >
        {agente.codigo}
      </text>
      {/* Punto de estado: el color no va solo, abajo va la palabra. */}
      <circle cx={nodo.r * 0.72} cy={-nodo.r * 0.72} r={esCentro ? 7 : 6} fill={estado.color} stroke={FONDO_NODO} strokeWidth={2.5} />
      {/* El contorno del color del escenario separa el texto de las líneas que pasan detrás. */}
      <text y={nodo.r + 22} textAnchor="middle" fill={TEXTO} fontSize={esCentro ? 18 : 16} fontWeight={600} {...CONTORNO}>
        {nombre}
      </text>
      <text y={nodo.r + 41} textAnchor="middle" fill={TEXTO_SUAVE} fontSize={13.5} {...CONTORNO}>
        <tspan fill={estado.color}>{estado.label}</tspan>
        {` · ${hace}`}
      </text>
      <title>{[`${agente.codigo} · ${agente.nombre}`, agente.rol, agente.horario].filter(Boolean).join("\n")}</title>
    </g>
  );
}
