import { redirect } from "next/navigation";

/** Ruta histórica: los reportes se unificaron en un solo destino con pestañas. */
export default function ReportesDiscadorRedirect() {
  redirect("/dashboard/reportes/discador");
}
