"use client";

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, ContactShadows, Environment, Html, Lightformer } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  INFO_ESTADO,
  type EstadoPieza,
  type Pieza,
  type RegistroOdontograma,
  type Superficie,
} from "@/lib/odontograma";

import { crearEncia, formaDe, ubicarPiezas, type Ubicacion } from "./geometria";

/**
 * Boca en 3D: las dos arcadas con sus piezas, la encía y el estado clínico de
 * cada diente dibujado sobre él. Se gira con el mouse o el dedo, se hace zoom y
 * se elige una pieza con un clic.
 *
 * Cómo se ve cada estado:
 * - caries, fractura, obturación y sellante: una marca en cada superficie
 *   afectada (oclusal, mesial, distal, vestibular, lingual);
 * - endodoncia: el diente se vuelve translúcido y deja ver el conducto;
 * - corona: porcelana más blanca y brillante con su margen dorado;
 * - implante: el tornillo de titanio bajo la corona;
 * - prótesis: base rosada de acrílico;
 * - extracción indicada: tinte rojo y una cruz;
 * - ausente: solo un contorno fantasma, que igual se puede elegir.
 * Un anillo en el cuello resume el estado: rojo por tratar, azul tratado.
 */

export type EstadoVisible = {
  estado: EstadoPieza;
  avance: RegistroOdontograma["avance"];
  superficies: Map<Superficie, EstadoPieza>;
};

export type Vista = "frontal" | "superior" | "inferior" | "derecha" | "izquierda";

// Altura del cuello de cada arcada: la boca abierta lo justo para ver las caras.
const PLANO = { superior: 11.5, inferior: -11.5 };
const PLANO_TEMPORAL = { superior: 7.4, inferior: -7.4 };

const VISTAS: Record<Vista, [number, number, number, number, number, number]> = {
  frontal: [0, 4, 128, 0, 0, -4],
  superior: [0, -112, 14, 0, 8, -3],
  inferior: [0, 114, 14, 0, -8, -3],
  derecha: [-104, 8, 26, 0, 0, -6],
  izquierda: [104, 8, 26, 0, 0, -6],
};

function Diente({
  pieza,
  ubicacion,
  visible,
  seleccionada,
  onSelect,
  onHover,
  resaltada,
  rayosX,
}: {
  rayosX: boolean;
  pieza: Pieza;
  ubicacion: Ubicacion;
  visible: EstadoVisible | undefined;
  seleccionada: boolean;
  resaltada: boolean;
  onSelect: (numero: number) => void;
  onHover: (numero: number | null) => void;
}) {
  const forma = useMemo(() => formaDe(pieza), [pieza]);
  const { a, b, corona, raiz } = forma.medidas;
  const estado = visible?.estado ?? "sano";
  const info = INFO_ESTADO[estado];
  const ausente = estado === "ausente";
  const implante = estado === "implante";
  const translucido = estado === "endodoncia" || rayosX;

  const color = useMemo(() => {
    if (estado === "corona") return new THREE.Color("#fdfcf8");
    if (estado === "extraccion_indicada") return new THREE.Color("#f3c9c4");
    if (estado === "protesis") return new THREE.Color("#fbf3ee");
    return new THREE.Color("#ffffff");
  }, [estado]);

  const brillo = seleccionada ? 0.28 : resaltada ? 0.14 : 0;

  // Marcas por superficie, calculadas sobre la propia forma del diente.
  const marcas = useMemo(() => {
    if (!visible || ausente || implante) return [];
    const vRaiz = raiz / (raiz + corona);
    const enCorona = (t: number) => vRaiz + (1 - vRaiz) * t;
    const lugar: Record<Superficie, [number, number]> = {
      V: [0.25, enCorona(0.52)],
      L: [0.75, enCorona(0.52)],
      M: [ubicacion.mesial === 1 ? 0 : 0.5, enCorona(0.5)],
      D: [ubicacion.mesial === 1 ? 0.5 : 0, enCorona(0.5)],
      O: [0.25, enCorona(0.97)],
    };
    return [...visible.superficies.entries()].map(([superficie, estadoSuperficie]) => {
      const [u, v] = lugar[superficie];
      const punto = forma.punto(u, v);
      const normal = superficie === "O"
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(punto.x, 0, punto.z).normalize();
      const tam = superficie === "O" ? Math.min(a, b) * 0.34 : Math.min(a, b) * 0.36;
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      return {
        clave: superficie,
        posicion: punto.addScaledVector(normal, superficie === "O" ? -0.12 : -0.22),
        quaternion,
        tam,
        color: INFO_ESTADO[estadoSuperficie].color,
      };
    });
  }, [visible, ausente, implante, forma, raiz, corona, ubicacion.mesial, a, b]);

  const anillo = visible && visible.estado !== "sano" && info.grupo !== "ausente" ? info.color : null;

  return (
    <group
      position={ubicacion.posicion}
      rotation={[0, ubicacion.giro, 0]}
      scale={[1, pieza.superior ? -1 : 1, 1]}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onSelect(pieza.numero);
      }}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(pieza.numero);
      }}
      onPointerOut={() => onHover(null)}
    >
      {/* Corona y raíz. */}
      {!ausente && (
        <mesh geometry={implante ? forma.soloCorona : forma.geometria} castShadow receiveShadow>
          <meshPhysicalMaterial
            vertexColors
            color={color}
            roughness={estado === "corona" ? 0.12 : 0.3}
            metalness={0}
            clearcoat={estado === "corona" ? 1 : 0.75}
            clearcoatRoughness={estado === "corona" ? 0.05 : 0.22}
            sheen={0.35}
            sheenColor="#fff7ea"
            sheenRoughness={0.6}
            specularIntensity={0.7}
            transparent={translucido}
            opacity={translucido ? (rayosX ? 0.5 : 0.42) : 1}
            depthWrite={!translucido}
            emissive={seleccionada ? "#7dd3fc" : "#ffffff"}
            emissiveIntensity={brillo}
          />
        </mesh>
      )}

      {/* Ausente: un contorno fantasma para que igual se pueda elegir. */}
      {ausente && (
        <mesh geometry={forma.geometria}>
          <meshBasicMaterial color={seleccionada ? "#7dd3fc" : "#94a3b8"} wireframe transparent opacity={seleccionada ? 0.35 : resaltada ? 0.22 : 0.08} />
        </mesh>
      )}

      {/* Endodoncia: el conducto relleno se ve a través del diente. */}
      {estado === "endodoncia" && (
        <mesh position={[0, (corona * 0.45 - raiz * 0.92) / 2, 0]}>
          <cylinderGeometry args={[0.35, 0.12, corona * 0.45 + raiz * 0.92, 16]} />
          <meshStandardMaterial color="#c084fc" emissive="#9333ea" emissiveIntensity={0.6} roughness={0.4} />
        </mesh>
      )}

      {/* Implante: tornillo de titanio con sus espiras. */}
      {implante && (
        <group position={[0, -raiz * 0.5, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[Math.min(a, b) * 0.42, Math.min(a, b) * 0.3, raiz * 0.95, 32]} />
            <meshStandardMaterial color="#aab4c0" metalness={1} roughness={0.28} />
          </mesh>
          {Array.from({ length: 9 }, (_, indice) => (
            <mesh key={indice} position={[0, raiz * 0.4 - indice * raiz * 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[Math.min(a, b) * (0.44 - indice * 0.012), 0.16, 10, 36]} />
              <meshStandardMaterial color="#c7cfd8" metalness={1} roughness={0.22} />
            </mesh>
          ))}
        </group>
      )}

      {/* Marcas por superficie (caries, obturaciones, sellantes, fracturas). */}
      {marcas.map((marca) => (
        <mesh key={marca.clave} position={marca.posicion} quaternion={marca.quaternion} scale={[marca.tam, marca.tam, marca.tam * 0.22]}>
          <sphereGeometry args={[1, 28, 18]} />
          <meshPhysicalMaterial color={marca.color} roughness={0.35} clearcoat={0.6} emissive={marca.color} emissiveIntensity={0.18} />
        </mesh>
      ))}

      {/* Anillo en el cuello con el color del estado. */}
      {anillo && (
        <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[a * 0.86, b * 0.95, 1]}>
          <torusGeometry args={[1, 0.06, 12, 48]} />
          <meshStandardMaterial color={anillo} emissive={anillo} emissiveIntensity={0.55} roughness={0.35} />
        </mesh>
      )}

      {/* Extracción indicada: una cruz sobre la cara vestibular. */}
      {estado === "extraccion_indicada" && (
        <group position={[0, corona * 0.5, b + 0.4]}>
          {[Math.PI / 4, -Math.PI / 4].map((giro) => (
            <mesh key={giro} rotation={[0, 0, giro]}>
              <boxGeometry args={[0.55, corona * 0.95, 0.3]} />
              <meshStandardMaterial color="#dc2626" emissive="#b91c1c" emissiveIntensity={0.5} />
            </mesh>
          ))}
        </group>
      )}

      {/* Prótesis: base de acrílico rosado. */}
      {estado === "protesis" && (
        <mesh position={[0, -0.6, 0]} scale={[a * 1.15, 1.6, b * 1.15]}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshPhysicalMaterial color="#ec8fa6" roughness={0.3} clearcoat={0.8} />
        </mesh>
      )}

      <Html
        // Sobre la encía vestibular, del lado de la raíz: no tapa las coronas.
        position={[0, -4.2, b + 2.4]}
        center
        distanceFactor={70}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <span
          className={`select-none rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors ${
            seleccionada
              ? "bg-sky-400 text-slate-950"
              : visible && visible.estado !== "sano"
                ? "text-white"
                : "text-slate-300/80"
          }`}
          style={visible && visible.estado !== "sano" && !seleccionada ? { background: info.color } : undefined}
        >
          {pieza.numero}
        </span>
      </Html>
    </group>
  );
}

function Encia({
  piezas,
  ubicaciones,
  superior,
  rayosX,
  plano,
}: {
  piezas: Pieza[];
  ubicaciones: Map<number, Ubicacion>;
  superior: boolean;
  rayosX: boolean;
  plano: typeof PLANO;
}) {
  const temporal = piezas[0]?.temporal ?? false;
  const geometria = useMemo(() => crearEncia(piezas, ubicaciones, superior, temporal ? 12.5 : 17), [piezas, ubicaciones, superior, temporal]);
  useEffect(() => () => geometria.dispose(), [geometria]);
  return (
    <mesh geometry={geometria} position={[0, superior ? plano.superior : plano.inferior, 0]} receiveShadow>
      <meshPhysicalMaterial
        color="#d9727d"
        roughness={0.42}
        clearcoat={0.55}
        clearcoatRoughness={0.3}
        sheen={1}
        sheenColor="#ffb4ba"
        sheenRoughness={0.5}
        side={THREE.DoubleSide}
        transparent={rayosX}
        opacity={rayosX ? 0.16 : 1}
        depthWrite={!rayosX}
      />
    </mesh>
  );
}

export function Boca3D({
  piezas,
  estados,
  seleccionada,
  onSelect,
  vista,
  rayosX = false,
}: {
  rayosX?: boolean;
  piezas: Pieza[];
  estados: Map<number, EstadoVisible>;
  seleccionada: number | null;
  onSelect: (numero: number) => void;
  /** Cambia de vista cada vez que cambia la clave, aunque se repita el nombre. */
  vista: { nombre: Vista; clave: number };
}) {
  const controles = useRef<CameraControls>(null);
  const [resaltada, setResaltada] = useState<number | null>(null);
  const plano = piezas[0]?.temporal ? PLANO_TEMPORAL : PLANO;
  const ubicaciones = useMemo(() => ubicarPiezas(piezas, plano), [piezas, plano]);
  // Las vistas oclusales muestran una sola arcada: la otra taparía las caras.
  const arcadas = vista.nombre === "superior" ? "superior" : vista.nombre === "inferior" ? "inferior" : "ambas";
  const visibles = arcadas === "ambas" ? piezas : piezas.filter((pieza) => pieza.superior === (arcadas === "superior"));

  // Una boca de niño es más chica: la cámara se acerca en la misma proporción.
  const temporal = piezas[0]?.temporal ?? false;
  useEffect(() => {
    const [px, py, pz, tx, ty, tz] = VISTAS[vista.nombre];
    const cerca = temporal ? 0.74 : 1;
    void controles.current?.setLookAt(px * cerca, py * cerca, pz * cerca, tx * cerca, ty * cerca, tz * cerca, vista.clave > 0);
  }, [vista, temporal]);

  // Al elegir una pieza la cámara se acerca un poco hacia ella, sin perder el conjunto.
  useEffect(() => {
    if (seleccionada === null) return;
    const ubicacion = ubicaciones.get(seleccionada);
    if (!ubicacion) return;
    const destino = ubicacion.posicion.clone().multiplyScalar(0.45);
    void controles.current?.setTarget(destino.x, destino.y * 0.6, destino.z - 4, true);
  }, [seleccionada, ubicaciones]);

  useEffect(() => {
    document.body.style.cursor = resaltada !== null ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [resaltada]);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 4, 128], fov: 34, near: 1, far: 600 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      onPointerMissed={() => setResaltada(null)}
    >
      <ambientLight intensity={0.25} />
      <hemisphereLight args={["#f8fbff", "#3b1d24", 0.45]} />
      <directionalLight
        position={[30, 60, 70]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <directionalLight position={[-50, -20, 40]} intensity={0.45} color="#cfe3ff" />

      {/* Estudio de luz propio: reflejos del esmalte sin descargar nada. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} position={[0, 40, 60]} scale={[80, 30, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[-70, 10, 20]} rotation-y={Math.PI / 2} scale={[60, 40, 1]} color="#dbeafe" />
        <Lightformer form="rect" intensity={1.4} position={[70, 10, 20]} rotation-y={-Math.PI / 2} scale={[60, 40, 1]} color="#fef3c7" />
        <Lightformer form="ring" intensity={2} position={[0, -40, 50]} scale={30} color="#ffffff" />
      </Environment>

      <group>
        {arcadas !== "inferior" && <Encia piezas={piezas} ubicaciones={ubicaciones} superior rayosX={rayosX} plano={plano} />}
        {arcadas !== "superior" && <Encia piezas={piezas} ubicaciones={ubicaciones} superior={false} rayosX={rayosX} plano={plano} />}
        {visibles.map((pieza) => {
          const ubicacion = ubicaciones.get(pieza.numero);
          if (!ubicacion) return null;
          return (
            <Diente
              key={pieza.numero}
              pieza={pieza}
              ubicacion={ubicacion}
              visible={estados.get(pieza.numero)}
              seleccionada={seleccionada === pieza.numero}
              resaltada={resaltada === pieza.numero}
              onSelect={onSelect}
              onHover={setResaltada}
              rayosX={rayosX}
            />
          );
        })}
      </group>

      <ContactShadows position={[0, -32, 0]} opacity={0.35} scale={140} blur={2.6} far={40} />

      <CameraControls
        ref={controles}
        makeDefault
        minDistance={temporal ? 46 : 62}
        maxDistance={190}
        dollySpeed={0.6}
        smoothTime={0.35}
      />
    </Canvas>
  );
}
