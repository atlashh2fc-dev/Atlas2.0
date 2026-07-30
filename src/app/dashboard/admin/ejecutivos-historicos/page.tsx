import { redirect } from "next/navigation";

/** Ruta histórica: los ejecutivos históricos son una pestaña de Integraciones. */
export default function EjecutivosHistoricosRedirect() {
  redirect("/dashboard/admin/integraciones/historial");
}
