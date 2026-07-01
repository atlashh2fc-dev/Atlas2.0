import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
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
