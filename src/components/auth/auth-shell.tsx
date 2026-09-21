import Image from "next/image";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { OmnichannelFigure } from "./omnichannel-figure";
import { ServiceStatus } from "./service-status";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const ENVIRONMENT = process.env.NEXT_PUBLIC_APP_ENV ?? "";

/**
 * Marco compartido por las tres pantallas de acceso (entrar, recuperar y
 * cambiar contraseña): panel de marca a la izquierda y el formulario a la
 * derecha. En móvil el panel se reduce a una cabecera.
 *
 * El panel dice una sola cosa. Quien llega acá ya es cliente: el catálogo de
 * módulos se vende en la web, no en el login. Lo que sí vale la pena mostrar
 * es la promesa que distingue a Atlas, omnicanal sobre una sola ficha, y se
 * muestra dibujada en vez de enumerada.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen w-full flex-col lg:flex-row">
      <aside className="flex flex-col gap-10 bg-auth-panel px-6 py-8 text-auth-panel-foreground lg:w-[400px] lg:shrink-0 lg:px-10 lg:py-12">
        <div className="flex items-center gap-3">
          <Image
            src="/atlas-logo.png"
            alt=""
            width={40}
            height={40}
            priority
            className="size-10 rounded-lg bg-white object-contain p-1"
          />
          <span className="text-xl font-semibold tracking-tight">Atlas</span>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-10">
          {/* La barra azul es lo que ancla la marca: el panel es oscuro por
              contraste, pero el color corporativo sigue presente. */}
          <div className="border-l-2 border-primary pl-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Omnicanal</p>
            <p className="mt-2 text-xl leading-snug lg:text-[26px] lg:leading-tight">
              Llamadas, WhatsApp, correo y web. Una sola ficha del cliente.
            </p>
          </div>

          <OmnichannelFigure className="hidden lg:block" />
        </div>

        <div className="border-t border-auth-panel-foreground/20 pt-4">
          <ServiceStatus />
          <p className="mt-1.5 text-xs text-auth-panel-foreground/60">
            {[ENVIRONMENT, VERSION && `v${VERSION}`].filter(Boolean).join(" · ") || "Atlas CRM"}
          </p>
        </div>
      </aside>

      <div className="relative flex flex-1 items-center justify-center bg-background px-4 py-10">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>

          <div className="mt-6">{children}</div>

          {footer ? <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}
