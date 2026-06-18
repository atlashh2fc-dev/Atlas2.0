import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseAndInsertLeads } from "@/lib/leads-bulk-core";

// Route Handler (no Server Action) a propósito: así el navegador puede subir
// el archivo con XMLHttpRequest y reportar progreso real de subida (algo que
// las Server Actions no exponen), y además este endpoint no hereda el límite
// de tamaño de body de las Server Actions.
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const teamId = (formData.get("team_id") as string) || null;
    const campaignId = (formData.get("campaign_id") as string) || null;
    const workflowId = (formData.get("workflow_id") as string) || null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "Selecciona un archivo CSV o Excel." }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }

    const result = await parseAndInsertLeads({
      file,
      teamId,
      campaignId,
      workflowId,
      userId: user.id,
      supabase,
    });

    revalidatePath("/dashboard/leads");
    if (campaignId) revalidatePath(`/dashboard/admin/campanas/${campaignId}`);

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error inesperado al procesar el archivo.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
