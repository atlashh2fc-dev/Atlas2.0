"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Loader2, MessageCircle } from "lucide-react";

import { conectarWhatsAppDesdeMeta } from "@/app/actions/whatsapp";
import { buttonClasses } from "@/components/ui";

type FB = {
  init: (opciones: Record<string, unknown>) => void;
  login: (callback: (respuesta: { authResponse?: { code?: string } | null }) => void, opciones: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

type Sesion = { wabaId: string; phoneNumberId: string; coexistencia: boolean };
type Estado =
  | { paso: "listo" }
  | { paso: "en_meta" }
  | { paso: "conectando" }
  | { paso: "conectado"; numero: string; coexistencia: boolean; avisos: string[] }
  | { paso: "error"; mensaje: string };

/**
 * Conectar el WhatsApp Business de la empresa sin salir de Atlas. Abre el
 * registro insertado de Meta en la variante «conectar la app WhatsApp Business
 * existente»: el número sigue funcionando en el teléfono y Atlas lo ve.
 *
 * Meta devuelve dos cosas por caminos distintos: el código, en la respuesta de
 * FB.login, y el número elegido, en un mensaje de la ventana. Se conecta cuando
 * llegaron las dos; si el mensaje no llega, basta el código y el servidor saca
 * la cuenta y el número del token.
 */
const ESPERA_DEL_AVISO_MS = 4_000;

export function ConectarWhatsAppMeta({ appId, configId, version }: { appId: string; configId: string; version: string }) {
  const [sdkListo, setSdkListo] = useState(false);
  const [estado, setEstado] = useState<Estado>({ paso: "listo" });
  const [, startTransition] = useTransition();
  const codigo = useRef<string | null>(null);
  const sesion = useRef<Sesion | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intento = useRef(0);

  useEffect(() => {
    if (window.FB) {
      // Ya cargado en otra visita a esta página: se avisa fuera del render del efecto.
      queueMicrotask(() => setSdkListo(true));
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version });
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

  const olvidarIntento = useCallback(() => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    codigo.current = null;
    sesion.current = null;
  }, []);

  const intentarConectar = useCallback((sinAviso = false) => {
    const code = codigo.current;
    const datos = sesion.current;
    if (!code || (!datos && !sinAviso)) return;
    const esteIntento = intento.current;
    olvidarIntento();
    setEstado({ paso: "conectando" });
    startTransition(async () => {
      const resultado = await conectarWhatsAppDesdeMeta({ codigo: code, ...(datos ?? {}) });
      if (esteIntento !== intento.current) return;
      setEstado(resultado.ok
        ? { paso: "conectado", numero: resultado.numero, coexistencia: resultado.coexistencia, avisos: resultado.avisos }
        : { paso: "error", mensaje: resultado.error });
    });
  }, [olvidarIntento]);

  useEffect(() => olvidarIntento, [olvidarIntento]);

  useEffect(() => {
    const alMensaje = (evento: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*facebook\.com$/.test(evento.origin)) return;
      let datos: { type?: string; event?: string; data?: Record<string, string> };
      try {
        datos = typeof evento.data === "string" ? JSON.parse(evento.data) : evento.data;
      } catch {
        return;
      }
      if (datos?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (datos.event === "CANCEL" || datos.event === "ERROR") {
        intento.current += 1;
        olvidarIntento();
        setEstado({ paso: "error", mensaje: datos.data?.error_message ?? "Se cerró la ventana de Meta antes de terminar." });
        return;
      }
      if (datos.event?.startsWith("FINISH") && datos.data?.waba_id && datos.data?.phone_number_id) {
        sesion.current = {
          wabaId: datos.data.waba_id,
          phoneNumberId: datos.data.phone_number_id,
          coexistencia: datos.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        };
        intentarConectar();
      }
    };
    window.addEventListener("message", alMensaje);
    return () => window.removeEventListener("message", alMensaje);
  }, [intentarConectar, olvidarIntento]);

  const cancelar = () => {
    intento.current += 1;
    olvidarIntento();
    setEstado({ paso: "listo" });
  };

  const abrirMeta = () => {
    if (!window.FB) return;
    intento.current += 1;
    const esteIntento = intento.current;
    olvidarIntento();
    setEstado({ paso: "en_meta" });
    window.FB.login(
      (respuesta) => {
        if (esteIntento !== intento.current) return;
        const code = respuesta.authResponse?.code;
        if (!code) {
          setEstado((actual) => (actual.paso === "en_meta"
            ? { paso: "error", mensaje: "La ventana de Meta se cerró sin terminar. Si no llegó a abrirse, permite las ventanas emergentes de este sitio y vuelve a intentarlo." }
            : actual));
          return;
        }
        codigo.current = code;
        if (sesion.current) {
          intentarConectar();
          return;
        }
        // El aviso con el número suele llegar antes; si no llega, se sigue sin él.
        setEstado({ paso: "conectando" });
        espera.current = setTimeout(() => intentarConectar(true), ESPERA_DEL_AVISO_MS);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  };

  if (estado.paso === "conectado") {
    return (
      <div className="space-y-2 rounded-lg border border-success/30 bg-success-bg p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <CheckCircle2 size={16} className="text-success" aria-hidden="true" /> {estado.numero} quedó conectado a Atlas
        </p>
        <p className="text-muted-foreground">
          {estado.coexistencia
            ? "Sigue funcionando en tu teléfono. Lo que envíes desde la app a alguien de Por contactar se anota solo."
            : "Los mensajes de este número ahora entran a Atlas."}
        </p>
        {estado.avisos.length > 0 && (
          <p className="text-xs text-warning">Meta no confirmó toda la sincronización ({estado.avisos.join("; ")}). Los mensajes nuevos igual llegan.</p>
        )}
      </div>
    );
  }

  const ocupado = estado.paso === "en_meta" || estado.paso === "conectando" || !sdkListo;
  return (
    <div className="space-y-3">
      <button type="button" onClick={abrirMeta} disabled={ocupado} className={buttonClasses()}>
        {ocupado ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <MessageCircle size={16} aria-hidden="true" />}
        {estado.paso === "conectando" ? "Conectando tu número…" : estado.paso === "en_meta" ? "Sigue en la ventana de Meta…" : !sdkListo ? "Preparando…" : "Conectar mi WhatsApp Business"}
      </button>
      {estado.paso === "en_meta" && (
        <p className="text-sm text-muted-foreground">
          Termina los pasos en la ventana de Meta. ¿No la ves? Puede estar detrás de esta o bloqueada por el navegador.{" "}
          <button type="button" onClick={cancelar} className="font-medium text-foreground underline underline-offset-2">
            Cancelar
          </button>
        </p>
      )}
      {estado.paso === "error" && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert size={15} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> {estado.mensaje}
        </p>
      )}
    </div>
  );
}
