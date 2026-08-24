import {
  requestAiVoiceTestCall,
  upsertAiVoiceCampaignConfig,
} from "@/app/actions/ai-voice-campaigns";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AiVoiceCampaignConfig } from "@/lib/types";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Callout,
  Field,
  Input,
  SectionCard,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";

const TEST_AGENT_ID = "agent_5001m0trhg8cfhs98qhw1bpayagf";

const STATUS_LABELS: Record<string, string> = {
  queued: "En cola",
  claiming: "Preparando",
  originating: "Originando",
  ringing: "Timbrando",
  answered: "Conversando",
  bridged: "Conversando",
  no_answer: "No contesta",
  busy: "Ocupado",
  failed: "Fallida",
  voicemail: "Buzón",
  completed: "Finalizada",
};

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (["queued", "claiming", "originating", "ringing", "answered", "bridged"].includes(status)) return "warning";
  if (["failed", "busy", "no_answer", "voicemail"].includes(status)) return "danger";
  return "neutral";
}

function providerErrorDetail(result: Record<string, unknown>): { code: number | null; reason: string | null } {
  const providerError = result.provider_error;
  if (!providerError || typeof providerError !== "object" || Array.isArray(providerError)) {
    return { code: null, reason: null };
  }
  const record = providerError as Record<string, unknown>;
  return {
    code: typeof record.code === "number" ? record.code : null,
    reason: typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : null,
  };
}

function testCallResultText(testCall: {
  status: string;
  provider_result: unknown;
  hangup_cause: string | null;
  provider_conversation_id: string | null;
}): string {
  const result = (testCall.provider_result ?? {}) as Record<string, unknown>;
  const summary = typeof result.summary === "string" && result.summary.trim() ? result.summary.trim() : null;
  if (summary) return summary;

  if (testCall.status === "busy") return "Número ocupado o llamada rechazada temporalmente (SIP 486).";

  const providerError = providerErrorDetail(result);
  if (providerError.code === 4300 || /daily call limit/i.test(providerError.reason ?? "")) {
    return "Límite diario de 5 llamadas de ElevenLabs alcanzado.";
  }
  if (providerError.reason) return providerError.reason;
  if (testCall.hangup_cause) return testCall.hangup_cause;

  if (["queued", "claiming", "originating", "ringing", "answered"].includes(testCall.status)) {
    return testCall.provider_conversation_id ?? "Procesando…";
  }
  return "ElevenLabs no informó el motivo.";
}

export default async function AiVoiceCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile(["admin"]);
  const { id } = await params;
  const supabase = await createClient();

  const [configResult, campaignResult, leadCountResult, memberCountResult, attemptsResult, testCallsResult] = await Promise.all([
    supabase.from("ai_voice_campaign_configs").select("*").eq("campaign_id", id).maybeSingle(),
    supabase.from("campaigns").select("is_active").eq("id", id).single(),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase.from("campaign_agents").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    supabase
      .from("dial_attempts")
      .select("id,phone,status,provider_conversation_id,provider_result,created_at,ended_at,leads(full_name)")
      .eq("campaign_id", id)
      .eq("attempt_kind", "ai_voice")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("ai_voice_test_calls")
      .select("id,contact_name,phone,status,provider_conversation_id,provider_result,hangup_cause,created_at,ended_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  if (configResult.error) throw new Error(configResult.error.message);
  if (testCallsResult.error) throw new Error(testCallsResult.error.message);
  const config = configResult.data as AiVoiceCampaignConfig | null;
  const leadCount = leadCountResult.count ?? 0;
  const memberCount = memberCountResult.count ?? 0;
  const attempts = attemptsResult.data ?? [];
  const testCalls = testCallsResult.data ?? [];
  const readyForActivation = Boolean(
    campaignResult.data?.is_active &&
      leadCount > 0 &&
      memberCount === 0 &&
      config?.phone_number_id
  );

  return (
    <div className="space-y-5">
      <Callout tone="info">
        <strong className="font-medium">Campaña aislada, sin ejecutivos.</strong> Atlas controla exclusivamente
        esta base y sus intentos; ElevenLabs mantiene la conversación y Asterisk/Siptel aporta la salida telefónica.
      </Callout>

      {memberCount > 0 && (
        <Callout tone="danger">Esta campaña tiene {memberCount} ejecutivo(s). Debe quedar en cero antes de configurarla como IA.</Callout>
      )}

      <SectionCard
        title="Agente de voz"
        description="La clave de ElevenLabs no se guarda aquí. Solo se registran los identificadores no secretos del agente y del troncal SIP."
        actions={
          <Badge tone={config?.is_active ? "success" : "danger"}>
            {config?.is_active ? "IA en ejecución" : "IA detenida"}
          </Badge>
        }
      >
        <ActionForm
          action={upsertAiVoiceCampaignConfig}
          success="Configuración IA guardada"
          className="grid gap-4 p-4 sm:grid-cols-2"
        >
          <input type="hidden" name="campaign_id" value={id} />

          <Field label="Agente ElevenLabs">
            <Input name="agent_id" required defaultValue={config?.agent_id ?? TEST_AGENT_ID} />
          </Field>

          <Field label="Número / troncal SIP importado">
            <Input
              name="phone_number_id"
              placeholder="Se completa al conectar Asterisk"
              defaultValue={config?.phone_number_id ?? ""}
            />
          </Field>

          <Field label="Llamadas simultáneas">
            <Input
              type="number"
              name="max_concurrent_calls"
              min="1"
              max="10"
              defaultValue={config?.max_concurrent_calls ?? 1}
            />
          </Field>

          <Field label="Máximo de intentos por contacto">
            <Input
              type="number"
              name="max_attempts_per_contact"
              min="1"
              max="5"
              defaultValue={config?.max_attempts_per_contact ?? 1}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              name="is_active"
              value="true"
              defaultChecked={config?.is_active ?? false}
              disabled={!readyForActivation && !config?.is_active}
              className="accent-primary"
            />
            Iniciar llamadas automáticas de esta campaña IA
          </label>

          {!readyForActivation && !config?.is_active && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Para iniciar: campaña general habilitada, base cargada, cero ejecutivos y troncal SIP importado.
            </p>
          )}

          <div className="sm:col-span-2">
            <ActionSubmit pendingLabel="Guardando…">Guardar configuración</ActionSubmit>
          </div>
        </ActionForm>
      </SectionCard>

      <SectionCard
        title="Llamada manual de prueba"
        description="Ingresa un número y Paula llamará apenas el motor tome la solicitud. Esto no enciende la campaña automática ni modifica su base."
        actions={<Badge tone={config?.phone_number_id ? "success" : "danger"}>{config?.phone_number_id ? "Lista para probar" : "Falta troncal"}</Badge>}
      >
        <ActionForm
          action={requestAiVoiceTestCall}
          success="Prueba encolada: el bot llamará en unos segundos"
          className="grid gap-4 border-b border-border p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <input type="hidden" name="campaign_id" value={id} />

          <Field label="Nombre (opcional)">
            <Input name="contact_name" placeholder="Matías" maxLength={120} />
          </Field>

          <Field label="Teléfono de prueba">
            <Input
              name="phone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="+56 9 1234 5678"
            />
          </Field>

          <ActionSubmit disabled={!config?.phone_number_id} pendingLabel="Encolando…">
            Llamar ahora
          </ActionSubmit>
        </ActionForm>

        <Table>
          <Thead>
            <Th>Contacto</Th>
            <Th>Teléfono</Th>
            <Th>Estado</Th>
            <Th>Resultado</Th>
            <Th>Solicitud</Th>
          </Thead>
          <Tbody>
            {testCalls.length === 0 && (
              <TableEmpty colSpan={5}>Aún no hay pruebas manuales.</TableEmpty>
            )}
            {testCalls.map((testCall) => {
              const resultText = testCallResultText(testCall);
              return (
                <Tr key={testCall.id}>
                  <Td strong>{testCall.contact_name}</Td>
                  <Td muted>{testCall.phone}</Td>
                  <Td>
                    <Badge tone={statusTone(testCall.status)}>
                      {STATUS_LABELS[testCall.status] ?? testCall.status}
                    </Badge>
                  </Td>
                  <Td muted>{resultText}</Td>
                  <Td muted>{new Date(testCall.created_at).toLocaleString("es-CL")}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </SectionCard>

      <SectionCard
        title="Historial de la base automática"
        description={`${leadCount.toLocaleString("es-CL")} contacto(s) en la base · concurrencia ${config?.max_concurrent_calls ?? 1} · sin agentes humanos`}
      >
        <Table>
          <Thead>
            <Th>Contacto</Th>
            <Th>Teléfono</Th>
            <Th>Estado</Th>
            <Th>Conversación</Th>
            <Th>Inicio</Th>
          </Thead>
          <Tbody>
            {attempts.length === 0 && (
              <TableEmpty colSpan={5}>Todavía no hay llamadas. La campaña permanece detenida.</TableEmpty>
            )}
            {attempts.map((attempt) => {
              const related = attempt.leads as unknown;
              const lead = Array.isArray(related)
                ? (related[0] as { full_name: string } | undefined) ?? null
                : (related as { full_name: string } | null);
              return (
                <Tr key={attempt.id}>
                  <Td strong>{lead?.full_name ?? "Contacto"}</Td>
                  <Td muted>{attempt.phone}</Td>
                  <Td>
                    <Badge tone={statusTone(attempt.status)}>{STATUS_LABELS[attempt.status] ?? attempt.status}</Badge>
                  </Td>
                  <Td muted>{attempt.provider_conversation_id ?? "—"}</Td>
                  <Td muted>{new Date(attempt.created_at).toLocaleString("es-CL")}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
