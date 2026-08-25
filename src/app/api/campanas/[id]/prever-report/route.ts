import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  buildPreverReportWorkbook,
  PREVER_REPORT_TEMPLATE_PATH,
  type PreverReportRecord,
} from "@/lib/prever-report-workbook";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeadRow = {
  id: string;
  phone: string | null;
  full_name: string;
  extra: Record<string, unknown>;
};

type AttemptRow = {
  id: string;
  lead_id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
};

type ResultRow = {
  dial_attempt_id: string;
  lead_id: string;
  call_status: string | null;
  respondent_name: string | null;
  q1_service_general: number | null;
  q2_information: number | null;
  q3_commitments: number | null;
  q4_benefits_advice: string | null;
  q5_no_advice_reason: string | null;
  q6_funeral_service: number | null;
  q7_service_times: number | null;
  q8_overall_satisfaction: number | null;
  q9_recommendation: number | null;
  q10_comments: string | null;
  ended_at: string | null;
};

function text(extra: Record<string, unknown>, key: string): string {
  const value = extra[key];
  return value == null ? "" : String(value).trim();
}

function fallbackStatus(attempt: AttemptRow | undefined): string | null {
  if (!attempt) return null;
  if (["no_answer", "voicemail"].includes(attempt.status)) return "Cliente no responde llamada";
  if (["failed", "busy"].includes(attempt.status)) return "Otros";
  return null;
}

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile) return responseError("Debes iniciar sesión.", 401);
  if (!profile.active || profile.role !== "admin") {
    return responseError("No tienes permiso para descargar este informe.", 403);
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return responseError("Campaña inválida.", 400);

  const supabase = await createClient();
  const { data: config, error: configError } = await supabase
    .from("ai_voice_campaign_configs")
    .select("campaign_id,survey_schema,campaigns(name)")
    .eq("campaign_id", id)
    .maybeSingle();
  if (configError) return responseError("No se pudo validar la campaña.", 500);
  if (!config || config.survey_schema !== "prever_v1") {
    return responseError("Esta campaña no usa el reporte PREVER.", 404);
  }

  const admin = createAdminClient();
  const [leadsResult, attemptsResult, resultsResult, templateResult] = await Promise.all([
    admin.from("leads").select("id,phone,full_name,extra").eq("campaign_id", id).order("created_at"),
    admin.from("dial_attempts").select("id,lead_id,status,created_at,ended_at").eq("campaign_id", id).eq("attempt_kind", "ai_voice").order("created_at"),
    admin.from("prever_survey_results").select("dial_attempt_id,lead_id,call_status,respondent_name,q1_service_general,q2_information,q3_commitments,q4_benefits_advice,q5_no_advice_reason,q6_funeral_service,q7_service_times,q8_overall_satisfaction,q9_recommendation,q10_comments,ended_at").eq("campaign_id", id).order("ended_at"),
    admin.storage.from("campaign-report-templates").download(PREVER_REPORT_TEMPLATE_PATH),
  ]);

  const error = leadsResult.error ?? attemptsResult.error ?? resultsResult.error ?? templateResult.error;
  if (error || !templateResult.data) return responseError("No se pudo preparar el informe PREVER.", 500);

  const attemptsByLead = new Map<string, AttemptRow[]>();
  for (const attempt of (attemptsResult.data ?? []) as AttemptRow[]) {
    attemptsByLead.set(attempt.lead_id, [...(attemptsByLead.get(attempt.lead_id) ?? []), attempt]);
  }
  const resultByLead = new Map<string, ResultRow>();
  for (const result of (resultsResult.data ?? []) as ResultRow[]) resultByLead.set(result.lead_id, result);

  const records: PreverReportRecord[] = ((leadsResult.data ?? []) as LeadRow[])
    .sort((a, b) => Number(text(a.extra, "prever_row_id")) - Number(text(b.extra, "prever_row_id")))
    .map((lead) => {
      const attempts = attemptsByLead.get(lead.id) ?? [];
      const latestAttempt = attempts.at(-1);
      const result = resultByLead.get(lead.id);
      return {
        sourceId: text(lead.extra, "prever_row_id"),
        deathRecordNumber: text(lead.extra, "numero_deceso"),
        deceasedName: text(lead.extra, "fallecido"),
        deathDate: text(lead.extra, "fecha_deceso") || null,
        contactName: lead.full_name,
        relationship: text(lead.extra, "parentesco"),
        phoneCode: text(lead.extra, "codigo_celular") || "9",
        phone: text(lead.extra, "telefono_celular") || (lead.phone ?? "").replace(/^\+56/, ""),
        originalExecutive: text(lead.extra, "ejecutivo_origen"),
        city: text(lead.extra, "ciudad"),
        presencial: text(lead.extra, "presencial"),
        provider: text(lead.extra, "proveedor"),
        managementAt: result?.ended_at ?? latestAttempt?.ended_at ?? latestAttempt?.created_at ?? null,
        callStatus: result?.call_status ?? fallbackStatus(latestAttempt),
        surveyResult: null,
        attempts: attempts.length,
        respondentName: result?.respondent_name ?? null,
        q1: result?.q1_service_general ?? null,
        q2: result?.q2_information ?? null,
        q3: result?.q3_commitments ?? null,
        q4: result?.q4_benefits_advice ?? null,
        q5: result?.q5_no_advice_reason ?? null,
        q6: result?.q6_funeral_service ?? null,
        q7: result?.q7_service_times ?? null,
        q8: result?.q8_overall_satisfaction ?? null,
        q9: result?.q9_recommendation ?? null,
        q10: result?.q10_comments ?? null,
      };
    });

  try {
    const template = new Uint8Array(await templateResult.data.arrayBuffer());
    const workbook = buildPreverReportWorkbook(template, records);
    const filename = "BBDD ENCUESTA PREVER JUNIO 2026.xlsx";
    return new NextResponse(Buffer.from(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return responseError("La plantilla contractual PREVER no pudo ser completada.", 500);
  }
}
