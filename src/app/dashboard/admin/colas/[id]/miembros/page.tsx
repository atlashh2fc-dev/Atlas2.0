import { MiembrosDeCola } from "@/components/miembros-de-cola";
import { requireProfile } from "@/lib/auth";

export default async function QueueMembersPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  return <MiembrosDeCola queueId={id} rol="admin" />;
}
