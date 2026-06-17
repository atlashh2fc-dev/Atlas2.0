import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BulkUploadForm } from "@/components/bulk-upload-form";

export default async function BulkUploadPage() {
  await requireProfile(["supervisor", "admin"]);
  const supabase = await createClient();

  const { data: teams } = await supabase.from("teams").select("id, name").order("name");
  const { data: workflows } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cargar leads</h1>
        <p className="text-sm text-muted-foreground">
          Sube un archivo CSV o Excel para crear leads en lote.
        </p>
      </div>

      <BulkUploadForm teams={teams ?? []} workflows={workflows ?? []} />
    </div>
  );
}
