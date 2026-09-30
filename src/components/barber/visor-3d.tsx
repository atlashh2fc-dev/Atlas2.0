"use client";

import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense } from "react";
import * as THREE from "three";

/**
 * El modelo 3D del cliente con su look, tal como lo reconstruyó la IA a
 * partir de las vistas simuladas. Luz de estudio suave, giro lento y el
 * modelo siempre encuadrado.
 */
function Modelo({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  scene.traverse((objeto) => {
    if ((objeto as THREE.Mesh).isMesh) {
      const malla = objeto as THREE.Mesh;
      malla.castShadow = true;
      malla.receiveShadow = true;
    }
  });
  return <primitive object={scene} />;
}

export function Visor3D({ url, fondo = "oscuro" }: { url: string; fondo?: "oscuro" | "claro" }) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 0.1, 3], fov: 30, near: 0.01, far: 100 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1 }}
    >
      <color attach="background" args={[fondo === "oscuro" ? "#15120f" : "#efe9e2"]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[2.5, 3, 3]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-3, 1.5, -1]} intensity={0.6} color="#ffe4c2" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={1.6} position={[0, 3, 4]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={0.7} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color="#ffe9cc" />
        <Lightformer form="rect" intensity={0.9} position={[4, 1, -3]} rotation-y={-Math.PI / 2.5} scale={[4, 3, 1]} color="#e8f0ff" />
      </Environment>
      <Suspense fallback={null}>
        <Bounds fit clip observe margin={1.15}>
          <Modelo url={url} />
        </Bounds>
      </Suspense>
      <ContactShadows position={[0, -1.1, 0]} opacity={0.4} scale={6} blur={2.8} far={3} />
      <OrbitControls makeDefault autoRotate autoRotateSpeed={0.8} enablePan={false} minDistance={0.6} maxDistance={8} />
    </Canvas>
  );
}
