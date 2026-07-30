import { redirect } from "next/navigation";

/** Ruta histórica: la importación Vocalcom vive en Integraciones. */
export default function VocalcomRedirect() {
  redirect("/dashboard/admin/integraciones");
}
