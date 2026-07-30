import Image from "next/image";
import type { ReactNode } from "react";
import { Headset, ShieldCheck, PhoneCall } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ServiceStatus } from "./service-status";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
const ENVIRONMENT = process.env.NEXT_PUBLIC_APP_ENV ?? "";

const HIGHLIGHTS = [
  { icon: PhoneCall, text: "Discador, agenda y ficha del cliente en una sola pantalla." },
  { icon: Headset, text: "Cada llamada queda tipificada y trazada." },
  { icon: ShieldCheck, text: "Acceso por rol: ves solo lo que te corresponde." },
];

/**
 * Marco compartido por las tres pantallas de acceso (entrar, recuperar y
 * cambiar contraseña): panel de marca a la izquierda y el formulario a la
 * derecha. En móvil el panel se reduce a una cabecera.
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
      <aside className="flex flex-col justify-between gap-10 bg-auth-panel px-6 py-8 text-auth-panel-foreground lg:w-[400px] lg:shrink-0 lg:px-10 lg:py-12">
        <div>
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

          {/* La barra azul es lo que ancla la marca: el panel es oscuro por
              contraste, pero el color corporativo sigue presente. */}
          <div className="mt-8 border-l-2 border-primary pl-4 lg:mt-12">
            <p className="text-lg leading-snug lg:text-2xl">La consola de tu contact center</p>
          </div>

          <ul className="mt-6 hidden space-y-3 lg:block">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-sm text-auth-panel-foreground/80">
                <Icon size={16} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden />
                <span>{text}</span>
              </li>
            ))}
          </ul>
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
