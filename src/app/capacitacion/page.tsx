import type { Metadata } from "next";

import { IrAAprende } from "@/components/ir-a-aprende";
import { requireProfile } from "@/lib/auth";
import { APRENDE_URL, aprendeSsoConfigurado, firmarPaseAprende } from "@/lib/aprende-sso";
import { requireModule } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Capacitación | Atlas" };
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Puerta de Atlas a Atlas Aprende. Vive fuera de /dashboard a propósito: se
 * abre en otra pestaña y el panel cargaría de nuevo el discador y el teléfono.
 *
 * El curso de destino es el que pide el enlace (?curso=) o, si no, el de la
 * campaña activa del ejecutivo (campaigns.curso_aprende).
 */
export default async function CapacitacionPage({ searchParams }: { searchParams: Promise<{ curso?: string }> }) {
  await requireModule("aprende");
  const profile = await requireProfile();
  const { curso: cursoPedido } = await searchParams;

  if (!aprendeSsoConfigurado()) {
    return (
      <Pantalla>
        <p className="text-base font-semibold">Atlas Aprende no está conectado todavía</p>
        <p className="mt-1 text-sm text-muted-foreground">Avísale al administrador: falta la llave de acceso entre Atlas y Aprende.</p>
      </Pantalla>
    );
  }

  const supabase = await createClient();
  const orgId = profile.viewing_organization_id ?? profile.organization_id ?? null;
  const [{ data: org }, { data: membresias }] = await Promise.all([
    orgId
      ? supabase.from("organizations").select("slug").eq("id", orgId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("campaign_agents")
      .select("campaigns!inner(curso_aprende, is_active)")
      .eq("profile_id", profile.id)
      .eq("campaigns.is_active", true)
      .not("campaigns.curso_aprende", "is", null),
  ]);

  const cursoDeCampana = (membresias ?? [])
    .map((fila) => {
      const campana = fila.campaigns as { curso_aprende?: string | null } | { curso_aprende?: string | null }[] | null;
      return (Array.isArray(campana) ? campana[0] : campana)?.curso_aprende ?? null;
    })
    .find(Boolean);
  const curso = cursoPedido && SLUG.test(cursoPedido) ? cursoPedido : (cursoDeCampana ?? null);

  const slugEmpresa = (org as { slug?: string } | null)?.slug;
  if (!slugEmpresa || !profile.email) {
    return (
      <Pantalla>
        <p className="text-base font-semibold">No pudimos abrir Atlas Aprende</p>
        <p className="mt-1 text-sm text-muted-foreground">Tu usuario no tiene empresa o correo asociado. Avísale al administrador.</p>
      </Pantalla>
    );
  }

  const pase = firmarPaseAprende({
    sub: profile.id,
    email: profile.email.trim().toLowerCase(),
    nombre: profile.full_name,
    org: slugEmpresa,
    rol: profile.role,
    curso,
  });

  return (
    <Pantalla>
      <IrAAprende accion={`${APRENDE_URL}/api/sso/atlas`} pase={pase} />
    </Pantalla>
  );
}

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">{children}</div>
    </main>
  );
}
