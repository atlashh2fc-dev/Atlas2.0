"use client";

import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { INFO_TIPO, largoDePelo, type Raza, type Region, type TipoRegistro } from "@/lib/anatomia";

import { construirCuerpo, geometriaCola, type Parte } from "./cuerpo";
import { crearPiel, vaEnLaPiel } from "./piel";

/**
 * La mascota en 3D: su cuerpo según la raza y la edad, las zonas que se tocan
 * y los marcadores de lo que se registró en cada una.
 */

export type Marcador = { id: string; region: Region; punto: [number, number, number] | null; tipo: TipoRegistro; activo: boolean };
export type VistaAnimal = "derecha" | "izquierda" | "frente" | "arriba";

const VISTAS: Record<VistaAnimal, [number, number, number]> = {
  derecha: [0.4, 0.9, 6.2],
  izquierda: [-0.4, 0.9, -6.2],
  frente: [6, 0.8, 1.4],
  arriba: [0.2, 6.4, 0.6],
};

const esfera = new THREE.SphereGeometry(1, 48, 32);

function materialPelo(color: string, resaltado: number) {
  const base = new THREE.Color(color);
  return (
    <meshPhysicalMaterial
      color={base}
      roughness={0.86}
      sheen={1}
      sheenColor={base.clone().lerp(new THREE.Color("#ffffff"), 0.45)}
      sheenRoughness={0.45}
      emissive="#38bdf8"
      emissiveIntensity={resaltado}
    />
  );
}

const CAPAS = 16;

/**
 * Capa de pelo: la superficie desplazada hacia afuera por su normal, con hebras
 * recortadas en el shader. Las hebras son más gruesas en la raíz y se afinan
 * hacia la punta; caen un poco con la gravedad y son más oscuras abajo.
 */
function materialCapa(capa: number, largo: number, densidad: number) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCapa = { value: capa };
    shader.uniforms.uLargo = { value: largo };
    shader.uniforms.uDensidad = { value: densidad };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uCapa;\nuniform float uLargo;\nattribute float largo;\nvarying vec3 vPelo;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vPelo = position;
        float estePelo = uLargo * largo;
        transformed += normalize(objectNormal) * uCapa * estePelo;
        transformed.y -= uCapa * uCapa * estePelo * 0.4;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uCapa;\nuniform float uDensidad;\nvarying vec3 vPelo;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 celda = floor(vPelo * uDensidad);
        vec3 dentro = fract(vPelo * uDensidad) - 0.5;
        float azar = fract(sin(dot(celda, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float grosor = (1.0 - uCapa) * 0.55 + 0.06;
        if (azar < uCapa * 0.9 || length(dentro) > grosor) discard;
        diffuseColor.rgb *= mix(0.55, 1.1, uCapa) * (0.9 + 0.2 * azar);`,
      );
  };
  material.customProgramCacheKey = () => `pelo-${capa.toFixed(3)}`;
  return material;
}

function Pelaje({ geometria, largo, densidad }: { geometria: THREE.BufferGeometry; largo: number; densidad: number }) {
  const materiales = useMemo(
    () => Array.from({ length: CAPAS }, (_, indice) => materialCapa((indice + 1) / CAPAS, largo, densidad)),
    [largo, densidad],
  );
  useEffect(() => () => materiales.forEach((material) => material.dispose()), [materiales]);
  return (
    <>
      {materiales.map((material, indice) => (
        <mesh key={indice} geometry={geometria} material={material} raycast={() => null} renderOrder={indice + 1} />
      ))}
    </>
  );
}

function ParteMesh({ parte, resaltado, onPointer }: { parte: Parte; resaltado: number; onPointer: Record<string, unknown> }) {
  const geometriaCapsula = useMemo(() => {
    if (parte.forma !== "capsula") return null;
    const desde = new THREE.Vector3(...parte.desde);
    const hasta = new THREE.Vector3(...parte.hasta);
    return new THREE.CapsuleGeometry(parte.radio, Math.max(0.001, desde.distanceTo(hasta)), 12, 32);
  }, [parte]);
  const cola = useMemo(() => (parte.forma === "cola" ? geometriaCola(parte.puntos, parte.radio) : null), [parte]);
  useEffect(() => () => {
    geometriaCapsula?.dispose();
    cola?.dispose();
  }, [geometriaCapsula, cola]);

  if (parte.forma === "elipsoide") {
    const material = parte.material ?? "pelo";
    return (
      <mesh geometry={esfera} position={parte.centro} scale={parte.escala} rotation={parte.rotacion ?? [0, 0, 0]} castShadow receiveShadow {...onPointer}>
        {material === "pelo" ? (
          materialPelo(parte.color, resaltado)
        ) : (
          <meshPhysicalMaterial
            color={parte.color}
            roughness={material === "nariz" ? 0.45 : 0.08}
            clearcoat={material === "nariz" ? 0.4 : 1}
            clearcoatRoughness={0.04}
            emissive="#38bdf8"
            emissiveIntensity={resaltado * 0.5}
          />
        )}
      </mesh>
    );
  }
  if (parte.forma === "capsula" && geometriaCapsula) {
    const desde = new THREE.Vector3(...parte.desde);
    const hasta = new THREE.Vector3(...parte.hasta);
    const medio = desde.clone().add(hasta).multiplyScalar(0.5);
    const giro = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hasta.clone().sub(desde).normalize());
    return (
      <mesh geometry={geometriaCapsula} position={medio} quaternion={giro} castShadow receiveShadow {...onPointer}>
        {materialPelo(parte.color, resaltado)}
      </mesh>
    );
  }
  if (parte.forma === "cono") {
    return (
      <group position={parte.centro} rotation={parte.rotacion}>
        <mesh scale={[parte.aplanado ?? 1, 1, 1]} castShadow {...onPointer}>
          <coneGeometry args={[parte.radio, parte.alto, 40, 1]} />
          {parte.material === "interior" ? (
            <meshPhysicalMaterial color={parte.color} roughness={0.55} sheen={0.4} sheenColor="#ffd6d4" emissive="#38bdf8" emissiveIntensity={resaltado * 0.6} />
          ) : (
            materialPelo(parte.color, resaltado)
          )}
        </mesh>
      </group>
    );
  }
  if (parte.forma === "bigote") {
    const desde = new THREE.Vector3(...parte.desde);
    const hasta = new THREE.Vector3(...parte.hasta);
    const medio = desde.clone().add(hasta).multiplyScalar(0.5);
    const giro = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hasta.clone().sub(desde).normalize());
    return (
      <mesh position={medio} quaternion={giro} raycast={() => null}>
        <cylinderGeometry args={[0.0012, 0.0028, desde.distanceTo(hasta), 6]} />
        <meshStandardMaterial color={parte.color} roughness={0.4} />
      </mesh>
    );
  }
  if (parte.forma === "cola" && cola) {
    const punta = parte.puntos[parte.puntos.length - 1];
    return (
      <group>
        <mesh geometry={cola} castShadow {...onPointer}>
          {materialPelo(parte.color, resaltado)}
        </mesh>
        <mesh geometry={esfera} position={punta} scale={parte.radio * 0.4} {...onPointer}>
          {materialPelo(parte.color, resaltado)}
        </mesh>
      </group>
    );
  }
  return null;
}

/**
 * Pone la cámara en la vista pedida, alejándola en un visor angosto (celular)
 * para que el animal entre completo.
 */
function Encuadre({ controles, vista }: { controles: React.RefObject<CameraControls | null>; vista: { nombre: VistaAnimal; clave: number } }) {
  const ancho = useThree((estado) => estado.size.width);
  const alto = useThree((estado) => estado.size.height);
  const lejos = Math.max(1, 1.45 / Math.max(0.35, ancho / Math.max(1, alto)));
  useEffect(() => {
    const [x, y, z] = VISTAS[vista.nombre];
    void controles.current?.setLookAt(x * lejos, y * lejos, z * lejos, 0, 0.1, 0, vista.clave > 0);
  }, [controles, vista, lejos]);
  return null;
}

export function Animal3D({
  raza,
  etapa,
  marcadores,
  seleccionada,
  onSelect,
  onHover,
  vista,
}: {
  raza: Raza;
  etapa: "cachorro" | "adulto" | "senior";
  marcadores: Marcador[];
  seleccionada: Region | null;
  onSelect: (region: Region, punto: [number, number, number]) => void;
  onHover: (region: Region | null) => void;
  vista: { nombre: VistaAnimal; clave: number };
}) {
  const cuerpo = useMemo(() => construirCuerpo(raza, etapa), [raza, etapa]);
  // El cuerpo es una sola piel; ojos, nariz, orejas y cola van aparte.
  const piel = useMemo(() => crearPiel(cuerpo.partes, cuerpo.manto), [cuerpo]);
  // Ojos y pupilas se asientan sobre la piel ya fundida (si no, el pelo los tapa).
  const sueltas = useMemo(() => {
    const lista = cuerpo.partes.filter((parte) => !vaEnLaPiel(parte));
    const resultado: Parte[] = [];
    let corrimiento: [number, number, number] = [0, 0, 0];
    for (const parte of lista) {
      if (parte.forma === "elipsoide" && parte.material === "ojo") {
        const nuevo = piel.asomar(parte.centro, parte.escala[0]);
        corrimiento = [nuevo[0] - parte.centro[0], nuevo[1] - parte.centro[1], nuevo[2] - parte.centro[2]];
        resultado.push({ ...parte, centro: nuevo });
      } else if (parte.forma === "elipsoide" && parte.material === "pupila") {
        const [dx, dy, dz] = corrimiento;
        resultado.push({ ...parte, centro: [parte.centro[0] + dx, parte.centro[1] + dy, parte.centro[2] + dz] });
      } else {
        resultado.push(parte);
      }
    }
    return resultado;
  }, [cuerpo, piel]);
  useEffect(() => () => piel.dispose(), [piel]);
  // La zona elegida se tiñe en la piel y se copia la superficie para dibujarla con su pelo.
  const superficie = useMemo(() => {
    piel.pintar(seleccionada);
    return piel.instantanea();
  }, [piel, seleccionada]);
  useEffect(() => () => superficie.dispose(), [superficie]);
  const escalaPiel = piel.malla.scale.x;
  const largoPelo = largoDePelo(raza) / escalaPiel;
  const densidadPelo = escalaPiel / 0.0055;
  const materialPiel = useMemo(
    () => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color("#9a9a9a"), sheenRoughness: 0.6 }),
    [],
  );
  useEffect(() => () => materialPiel.dispose(), [materialPiel]);
  const raiz = useRef<THREE.Group>(null);
  const controles = useRef<CameraControls>(null);
  const [resaltada, setResaltada] = useState<Region | null>(null);

  // Todas las razas se ven a un tamaño cómodo; las chicas, algo más chicas.
  // Se encuadra por la dimensión mayor: un bulldog es corto pero alto.
  const escala = (2.4 / Math.max(cuerpo.largo, cuerpo.alto * 1.15)) * (0.84 + 0.16 * Math.min(1.2, raza.tamano));
  const centroY = (cuerpo.alto * escala) / 2;


  useEffect(() => {
    document.body.style.cursor = resaltada ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [resaltada]);

  const eventos = (region: Region) => ({
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const local = raiz.current ? raiz.current.worldToLocal(event.point.clone()) : event.point;
      onSelect(region, [Number(local.x.toFixed(4)), Number(local.y.toFixed(4)), Number(local.z.toFixed(4))]);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      setResaltada(region);
      onHover(region);
    },
    onPointerOut: () => {
      setResaltada(null);
      onHover(null);
    },
  });

  // Registros de la misma zona sin punto: se apilan un poco para que no se tapen.
  const apilados = new Map<Region, number>();

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: VISTAS.derecha, fov: 34, near: 0.1, far: 100 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
    >
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#fdfbf7", "#3a2f28", 0.5]} />
      <directionalLight position={[3, 6, 5]} intensity={2.1} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#dbeafe" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 5]} scale={[8, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 1, 1]} rotation-y={Math.PI / 2} scale={[6, 4, 1]} color="#e0ecff" />
        <Lightformer form="rect" intensity={1.2} position={[6, 1, 1]} rotation-y={-Math.PI / 2} scale={[6, 4, 1]} color="#fff1dc" />
      </Environment>

      <group ref={raiz} scale={escala} position={[-0.1, -centroY, 0]}>
        <group position={piel.malla.position} scale={escalaPiel}>
          <Pelaje geometria={superficie} largo={largoPelo} densidad={densidadPelo} />
        </group>
        <mesh
          geometry={superficie}
          material={materialPiel}
          position={piel.malla.position}
          scale={escalaPiel}
          castShadow
          receiveShadow
          onClick={(event: ThreeEvent<MouseEvent>) => {
            event.stopPropagation();
            const local = raiz.current ? raiz.current.worldToLocal(event.point.clone()) : event.point.clone();
            const region = piel.regionEn(local);
            if (region) onSelect(region, [Number(local.x.toFixed(4)), Number(local.y.toFixed(4)), Number(local.z.toFixed(4))]);
          }}
          onPointerMove={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            const local = raiz.current ? raiz.current.worldToLocal(event.point.clone()) : event.point.clone();
            const region = piel.regionEn(local);
            if (region !== resaltada) {
              setResaltada(region);
              onHover(region);
            }
          }}
          onPointerOut={() => {
            setResaltada(null);
            onHover(null);
          }}
        />
        {sueltas.map((parte, indice) => {
          const brillo = seleccionada === parte.region ? 0.3 : resaltada === parte.region ? 0.14 : 0;
          return <ParteMesh key={`${raza.nombre}-${indice}`} parte={parte} resaltado={brillo} onPointer={eventos(parte.region)} />;
        })}

        {marcadores.map((marcador) => {
          const orden = apilados.get(marcador.region) ?? 0;
          apilados.set(marcador.region, orden + 1);
          const [cx, cy, cz] = cuerpo.centros[marcador.region];
          const posicion: [number, number, number] = marcador.punto ?? [cx, cy + orden * 0.07, cz + orden * 0.02];
          const color = INFO_TIPO[marcador.tipo].color;
          return (
            <group key={marcador.id} position={posicion}>
              <mesh>
                <sphereGeometry args={[marcador.activo ? 0.045 : 0.032, 24, 16]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={marcador.activo ? 0.9 : 0.35} roughness={0.3} />
              </mesh>
              {marcador.activo && (
                <mesh>
                  <sphereGeometry args={[0.085, 24, 16]} />
                  <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
                </mesh>
              )}
            </group>
          );
        })}
      </group>

      <ContactShadows position={[0, -centroY + 0.002, 0]} opacity={0.5} scale={8} blur={2.4} far={3} />

      <Encuadre controles={controles} vista={vista} />
      <CameraControls ref={controles} makeDefault minDistance={2.6} maxDistance={24} smoothTime={0.35} maxPolarAngle={Math.PI * 0.62} />
    </Canvas>
  );
}
