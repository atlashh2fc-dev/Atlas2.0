import type { MetadataRoute } from "next";

/**
 * Atlas instalable: en el celular o el computador se agrega a la pantalla
 * de inicio y abre como app, sin barra del navegador. Entra directo al
 * panel (y a «Mi día» si quien la abre atiende pacientes o clientes).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atlas",
    short_name: "Atlas",
    description: "Agenda, pacientes, caja y mensajes de tu clínica o barbería.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f7f9",
    theme_color: "#2563eb",
    lang: "es-CL",
    icons: [
      { src: "/iconos/atlas-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/iconos/atlas-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/iconos/atlas-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Agenda", url: "/dashboard/citas" },
      { name: "Mi día", url: "/dashboard/mi-dia" },
      { name: "Caja", url: "/dashboard/caja" },
    ],
  };
}
