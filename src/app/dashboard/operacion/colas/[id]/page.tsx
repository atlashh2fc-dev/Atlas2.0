import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";

import { MiembrosDeCola } from "@/components/miembros-de-cola";
import { PageHeader } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Supervisión mueve ejecutivos entre colas desde Operación, sin entrar a la
 * configuración: el enrutamiento y las fuentes siguen siendo de administración.
 */
export default async function MoverEjecutivosPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  const supabase = await createClient();
  const { data: cola } = await supabase.from("contact_center_queues").select("id, name").eq("id", id).maybeSingle();
  if (!cola) notFound();

  return (
    <div className="space-y-5">
      <Link href="/dashboard/operacion" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
        <ArrowLeft size={13} aria-hidden="true" /> Centro de operaciones
      </Link>
      <PageHeader icon={Layers} title={`Cola ${cola.name}`} description="Quién atiende esta cola. Los cambios rigen desde el próximo correo o WhatsApp que llegue." />
      <MiembrosDeCola queueId={id} rol={profile.role} />
    </div>
  );
}
