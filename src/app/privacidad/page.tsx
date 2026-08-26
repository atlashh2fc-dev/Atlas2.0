import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Privacidad | Atlas CRM",
  description: "Información sobre el tratamiento de datos en Atlas CRM y su canal de WhatsApp.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground sm:px-8">
      <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-10">
        <header className="flex items-center gap-4 border-b border-border pb-6">
          <Image src="/atlas-logo.png" alt="Atlas CRM" width={52} height={52} className="rounded-xl" />
          <div>
            <p className="text-sm font-medium text-primary">Geimser</p>
            <h1 className="text-2xl font-semibold tracking-tight">Privacidad y eliminación de datos</h1>
          </div>
        </header>

        <div className="mt-7 space-y-7 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="text-base font-semibold text-foreground">Quién gestiona la información</h2>
            <p className="mt-2">
              Geimser opera Atlas CRM para centralizar la atención comercial y de servicio. Puedes contactarnos
              en <a className="font-medium text-primary underline-offset-4 hover:underline" href="mailto:contacto@geimser.cl">contacto@geimser.cl</a>
              {" "}o en Merced 838, Santiago Centro, Chile.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">Qué datos tratamos</h2>
            <p className="mt-2">
              Cuando una persona conversa con Geimser por WhatsApp podemos registrar su número, nombre informado,
              mensajes, fechas, estados de entrega y la referencia de la campaña o anuncio que originó el contacto.
              Atlas también conserva la asignación y las acciones necesarias para dar continuidad a la atención.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">Para qué los usamos</h2>
            <p className="mt-2">
              Usamos estos datos para recibir consultas, responderlas, mantener el historial de atención, evitar
              gestiones duplicadas, medir la calidad del servicio y proteger la operación. No vendemos datos
              personales.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-foreground">Proveedores y conservación</h2>
            <p className="mt-2">
              La operación puede requerir servicios de Meta y WhatsApp, además de proveedores de infraestructura y
              seguridad que actúan únicamente para prestar el servicio. Conservamos la información durante el tiempo
              necesario para atender la relación y cumplir obligaciones aplicables.
            </p>
          </section>

          <section id="eliminacion">
            <h2 className="text-base font-semibold text-foreground">Acceso, corrección o eliminación</h2>
            <p className="mt-2">
              Para solicitar acceso, corrección o eliminación de tus datos, escribe a{" "}
              <a className="font-medium text-primary underline-offset-4 hover:underline" href="mailto:contacto@geimser.cl?subject=Solicitud%20de%20datos%20Atlas%20CRM">
                contacto@geimser.cl
              </a>
              {" "}con el asunto “Solicitud de datos Atlas CRM” e indica el número de WhatsApp asociado. Verificaremos
              la identidad antes de procesar la solicitud y confirmaremos su resultado por el mismo canal de contacto.
            </p>
          </section>
        </div>

        <footer className="mt-8 border-t border-border pt-5 text-xs text-muted-foreground">
          Última actualización: 26 de agosto de 2026.
        </footer>
      </article>
    </main>
  );
}
