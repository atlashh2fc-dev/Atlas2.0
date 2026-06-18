import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BulkUploadForm } from "@/components/bulk-upload-form";

export default async function BulkUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  await requireProfile(["supervisor", "admin"]);
  const { campaign_id } = await searchParams;
  const supabase = await createClient();

  const { data: teams } = await supabase.from("teams").select("id, name").order("name");
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cargar leads</h1>
        <p className="text-sm text-muted-foreground">
          Sube un archivo CSV o Excel para crear leads en lote. Si la carga es para una campaña, el
          flujo productivo de esa campaña queda asignado automáticamente.
        </p>
      </div>

      <BulkUploadForm
        teams={teams ?? []}
        workflows={workflows ?? []}
        campaigns={campaigns ?? []}
        defaultCampaignId={campaign_id ?? ""}
      />
    </div>
  );
}
