import { redirect } from "next/navigation";

/** Integraciones hoy es solo WhatsApp: la importación Vocalcom se retiró. */
export default function IntegracionesPage() {
  redirect("/dashboard/admin/integraciones/whatsapp");
}
