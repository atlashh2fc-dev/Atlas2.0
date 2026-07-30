import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// La versión se inyecta desde package.json para que la pantalla de acceso pueda
// mostrarla: cuando un ejecutivo reporta un problema, soporte necesita saber qué
// versión estaba usando sin tener que preguntárselo.
const { version } = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
  version: string;
};

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_ENV:
      process.env.NEXT_PUBLIC_APP_ENV ??
      (process.env.NODE_ENV === "production" ? "Producción" : "Desarrollo"),
  },
  experimental: {
    serverActions: {
      // Permite subir archivos de carga masiva de leads (CSV/XLSX) de varias
      // decenas de miles de filas; el límite por defecto de Next (1MB) se queda
      // corto para esos volúmenes.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
