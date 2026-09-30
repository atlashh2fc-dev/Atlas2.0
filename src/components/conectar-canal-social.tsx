"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { conectarCanalSocial, paginasParaConectar } from "@/app/actions/mensajeria-social";
import type { PaginaDeMeta } from "@/lib/meta-mensajeria";
import { NOMBRE_DEL_CANAL, type CanalSocial } from "@/lib/mensajeria-social";
import { buttonClasses } from "@/components/ui";

type FBLogin = {
  init: (opciones: Record<string, unknown>) => void;
  login: (callback: (respuesta: { authResponse?: { accessToken?: string } | null }) => void, opciones: Record<string, unknown>) => void;
};

type Estado =
  | { paso: "listo" }
  | { paso: "en_meta" }
  | { paso: "cargando" }
  | { paso: "elegir"; paginas: PaginaDeMeta[] }
  | { paso: "conectando" }
  | { paso: "conectado"; cuenta: string; avisos: string[] }
  | { paso: "error"; mensaje: string };

/**
 * Conecta la página de Facebook (Messenger) o su Instagram profesional sin
 * salir de Atlas: la persona entra con su Facebook, autoriza la página y, si
 * autorizó más de una, elige cuál. El token de usuario solo viaja al servidor,
 * que saca de ahí el de la página y lo guarda en la bóveda.
 */
export function ConectarCanalSocial({
  canal,
  appId,
  configId,
  version,
  reconectar = false,
}: {
  canal: CanalSocial;
  appId: string;
  configId: string;
  version: string;
  reconectar?: boolean;
}) {
  const [sdkListo, setSdkListo] = useState(false);
  const [estado, setEstado] = useState<Estado>({ paso: "listo" });
  const [token, setToken] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const nombre = NOMBRE_DEL_CANAL[canal];

  useEffect(() => {
    const fb = (window as unknown as { FB?: FBLogin }).FB;
    if (fb) {
      queueMicrotask(() => setSdkListo(true));
      return;
    }
    (window as unknown as { fbAsyncInit?: () => void }).fbAsyncInit = () => {
      (window as unknown as { FB?: FBLogin }).FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      setSdkListo(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/es_LA/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      document.body.appendChild(script);
    }
  }, [appId, version]);

  const conectar = (tokenDeUsuario: string, pageId: string) => {
    setEstado({ paso: "conectando" });
    startTransition(async () => {
      const resultado = await conectarCanalSocial({ tokenDeUsuario, pageId, canal });
      setEstado(resultado.ok ? { paso: "conectado", cuenta: resultado.cuenta, avisos: resultado.avisos } : { paso: "error", mensaje: resultado.error });
    });
  };

  const abrirMeta = () => {
    const fb = (window as unknown as { FB?: FBLogin }).FB;
    if (!fb) return;
    setEstado({ paso: "en_meta" });
    fb.login(
      (respuesta) => {
        const accessToken = respuesta.authResponse?.accessToken;
        if (!accessToken) {
          setEstado({ paso: "error", mensaje: "Se cerró la ventana de Facebook antes de terminar." });
          return;
        }
        setToken(accessToken);
        setEstado({ paso: "cargando" });
        startTransition(async () => {
          const resultado = await paginasParaConectar(accessToken);
          if (!resultado.ok) {
            setEstado({ paso: "error", mensaje: resultado.error });
            return;
          }
          // En Instagram solo sirven las páginas con una cuenta profesional vinculada.
          const utiles = canal === "instagram" ? resultado.paginas.filter((p) => p.instagram) : resultado.paginas;
          if (utiles.length === 0) {
            setEstado({ paso: "error", mensaje: "Ninguna de las páginas que autorizaste tiene una cuenta profesional de Instagram vinculada." });
          } else if (utiles.length === 1) {
            conectar(accessToken, utiles[0].id);
          } else {
            setEstado({ paso: "elegir", paginas: utiles });
          }
        });
      },
      { config_id: configId },
    );
  };

  if (estado.paso === "conectado") {
    return (
      <div className="space-y-2" role="status">
        <p className="flex items-center gap-2 text-sm font-medium text-success">
          <CheckCircle2 size={16} aria-hidden="true" /> {nombre} conectado: {estado.cuenta}
        </p>
        {estado.avisos.map((aviso) => (
          <p key={aviso} className="text-sm text-warning">{aviso}</p>
        ))}
      </div>
    );
  }

  if (estado.paso === "elegir") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          {canal === "instagram" ? "¿Qué cuenta de Instagram conectas?" : "¿Qué página conectas?"}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {estado.paginas.map((pagina) => (
            <button
              key={pagina.id}
              type="button"
              onClick={() => token && conectar(token, pagina.id)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="block text-sm font-medium text-foreground">
                {canal === "instagram" && pagina.instagram?.usuario ? `@${pagina.instagram.usuario}` : pagina.nombre}
              </span>
              <span className="block text-xs text-muted-foreground">
                {canal === "instagram" ? `Página ${pagina.nombre}` : pagina.instagram?.usuario ? `Instagram @${pagina.instagram.usuario}` : "Página de Facebook"}
              </span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setEstado({ paso: "listo" })} className="text-sm text-muted-foreground hover:text-foreground">
          Cancelar
        </button>
      </div>
    );
  }

  const ocupado = estado.paso === "en_meta" || estado.paso === "cargando" || estado.paso === "conectando";
  const etiqueta = {
    en_meta: "Sigue en la ventana de Facebook…",
    cargando: "Leyendo tus páginas…",
    conectando: `Conectando ${nombre}…`,
  }[estado.paso as "en_meta" | "cargando" | "conectando"];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={abrirMeta}
        disabled={!sdkListo || ocupado}
        className={buttonClasses({ variant: reconectar ? "secondary" : "primary" })}
      >
        {ocupado ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
        {ocupado ? etiqueta : reconectar ? "Volver a conectar con Facebook" : "Conectar con Facebook"}
      </button>
      {estado.paso === "error" && (
        <p className="flex items-start gap-2 text-sm text-danger" role="alert">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {estado.mensaje}
        </p>
      )}
    </div>
  );
}
