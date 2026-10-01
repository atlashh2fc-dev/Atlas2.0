"use client";

/**
 * Último recurso: falló el armazón raíz. No puede usar el tema ni los
 * componentes de la app, así que va con estilos mínimos en línea.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f6f7f9", color: "#0f172a" }}>
        <div style={{ maxWidth: 420, textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Atlas no pudo cargar</h1>
          <p style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.5 }}>
            Puede ser un corte momentáneo de conexión. Lo que ya guardaste no se perdió.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, height: 36, padding: "0 14px", borderRadius: 8, border: 0, background: "#049dd9", color: "#fff", fontWeight: 500, cursor: "pointer" }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
