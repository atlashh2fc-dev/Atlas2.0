"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { normalizeChilePhone } from "@/lib/chile-phone";
import { parseDateTimeInput } from "@/lib/report-range";
import { formatRut } from "@/lib/rut";
import { createClient } from "@/lib/supabase/server";

type ManualRecordInput = {
  fullName: string;
  rut?: string;
  phone?: string;
  phoneAlt?: string;
  email?: string;
  teamId?: string;
  campaignId?: string;
  assignedTo?: string;
  notes?: string;
  contactName?: string;
  comuna?: string;
  region?: string;
  direccion?: string;
  rubro?: string;
  product?: string;
  /** "bigdata" cuando algún campo se propuso desde Bigdata. */
  completadoCon?: string;
  /** `datetime-local` en hora Chile. Vacío = ahora. Solo con ejecutivo. */
  agendaAt?: string;
};

type ManualRecordResult = {
  ok: boolean;
  message?: string;
  leadId?: string;
  duplicate?: boolean;
  agendaAt?: string;
};

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function phoneOrNull(value: string | undefined, label: string): string | null {
  const phone = blankToNull(value);
  if (!phone) return null;
  try {
    return normalizeChilePhone(phone);
  } catch {
    throw new Error(`${label}: ingresa un número chileno válido, por ejemplo +56 9 1234 5678.`);
  }
}

/**
 * Ingreso fuera de base (Atlas 1: "Nuevo contacto"). El supervisor crea en la
 * campaña un cliente que no venía en la carga; si el RUT ya está en esa
 * campaña, se abre el registro existente en vez de duplicarlo.
 */
export async function createManualLeadRecord(input: ManualRecordInput): Promise<ManualRecordResult> {
  try {
    await requireProfile(["supervisor", "admin"]);
    const fullName = blankToNull(input.fullName);
    const rutInput = blankToNull(input.rut);
    const campaignId = blankToNull(input.campaignId);

    if (!fullName) return { ok: false, message: "Indica el nombre o razón social." };
    if (!rutInput) return { ok: false, message: "Indica el RUT." };
    if (!campaignId) return { ok: false, message: "Elige la campaña a la que entra el registro." };

    const rut = formatRut(rutInput);
    const phone = phoneOrNull(input.phone, "Teléfono");
    const phoneAlt = phoneOrNull(input.phoneAlt, "Teléfono adicional");
    const assignedTo = blankToNull(input.assignedTo);
    const agendaInput = assignedTo ? blankToNull(input.agendaAt) : null;
    const agendaAt = agendaInput ? parseDateTimeInput(agendaInput) : null;
    if (agendaInput && !agendaAt) return { ok: false, message: "La fecha de la agenda no es válida." };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ingresar_lead_fuera_de_base", {
      p_campaign_id: campaignId,
      p_full_name: fullName,
      p_rut: rut,
      p_phone: phone,
      p_phone_alt: phoneAlt,
      p_email: blankToNull(input.email),
      p_team_id: blankToNull(input.teamId),
      p_assigned_to: assignedTo,
      // Con ejecutivo, el registro queda en su agenda personal (ahora si va vacío).
      p_agenda_at: agendaAt?.toISOString() ?? null,
      p_notes: blankToNull(input.notes),
      p_detalle: {
        nombre_contacto: blankToNull(input.contactName),
        comuna: blankToNull(input.comuna),
        region: blankToNull(input.region),
        direccion: blankToNull(input.direccion),
        rubro: blankToNull(input.rubro),
        producto: blankToNull(input.product),
        completado_con: input.completadoCon === "bigdata" ? "bigdata" : null,
      },
    });

    if (error) return { ok: false, message: error.message };

    const leadId =
      data && typeof data === "object" && "lead_id" in data && typeof data.lead_id === "string"
        ? data.lead_id
        : undefined;
    const duplicate =
      data && typeof data === "object" && "duplicate" in data && data.duplicate === true;
    const agendaAtResult =
      data && typeof data === "object" && "agenda_at" in data && typeof data.agenda_at === "string"
        ? data.agenda_at
        : undefined;

    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/team");
    if (leadId) revalidatePath(`/dashboard/leads/${leadId}`);

    revalidatePath("/dashboard/agenda");

    return { ok: true, leadId, duplicate, agendaAt: agendaAtResult };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo crear el registro.",
    };
  }
}
