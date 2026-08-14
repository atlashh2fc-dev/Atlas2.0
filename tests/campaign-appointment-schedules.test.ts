import assert from "node:assert/strict";
import test from "node:test";
import {
  getCampaignAppointmentScheduleUrl,
  LEGAL_APPOINTMENT_SCHEDULE_URL,
} from "../src/lib/campaign-appointment-schedules.ts";

test("entrega la agenda solamente a la campaña Abogado Legal", () => {
  assert.equal(getCampaignAppointmentScheduleUrl("Abogado Legal"), LEGAL_APPOINTMENT_SCHEDULE_URL);
  assert.equal(getCampaignAppointmentScheduleUrl("  ABOGADO   LEGAL "), LEGAL_APPOINTMENT_SCHEDULE_URL);
  assert.equal(getCampaignAppointmentScheduleUrl("Equifax"), null);
  assert.equal(getCampaignAppointmentScheduleUrl(null), null);
});
