import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
