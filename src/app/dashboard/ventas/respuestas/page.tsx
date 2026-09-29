import { redirect } from "next/navigation";

/** Las respuestas del agente ahora son una vista de Por contactar. Se conserva la ruta por los enlaces guardados. */
export default function RespuestasDelAgentePage() {
  redirect("/dashboard/ventas/prospeccion?vista=respuestas");
}
