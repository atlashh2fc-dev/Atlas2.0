import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const PREVER_REPORT_TEMPLATE_PATH = "prever/BBDD-ENCUESTA-PREVER-modelo.xlsx";

export type PreverReportRecord = {
  sourceId: string;
  deathRecordNumber: string;
  deceasedName: string;
  deathDate: string | null;
  contactName: string;
  relationship: string;
  phoneCode: string;
  phone: string;
  originalExecutive: string;
  city: string;
  presencial: string;
  provider: string;
  managementAt: string | null;
  callStatus: string | null;
  surveyResult: string | null;
  attempts: number;
  respondentName: string | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: string | null;
  q5: string | null;
  q6: number | null;
  q7: number | null;
  q8: number | null;
  q9: number | null;
  q10: string | null;
};

const XML_FILES_TO_RENAME = [
  "xl/workbook.xml",
  "xl/worksheets/sheet1.xml",
  "xl/charts/chart1.xml",
];

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function excelSerial(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getTime() / 86_400_000 + 25_569;
}

function excelDateTimeSerial(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getTime() / 86_400_000 + 25_569;
}

function excelTimeSerial(value: string | null): number | null {
  const serial = excelDateTimeSerial(value);
  return serial === null ? null : serial - Math.floor(serial);
}

function monthLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  const label = new Intl.DateTimeFormat("es-CL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return ` ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function callConnects(status: string | null): string | null {
  if (!status) return null;
  return status === "Cliente no responde llamada" ? "NO" : "SI";
}

function surveyOutcome(status: string | null, completed: boolean): string | null {
  if (completed) return "Realizada";
  if (!status) return null;
  if (status === "Cliente no responde llamada") return "N° No responde";
  if (status === "Numero equivocado") return "N° equivocado";
  if (status === "Cliente NO desea responder") return "No desea responder";
  return "N° No responde";
}

function isSurveyCompleted(record: PreverReportRecord): boolean {
  const requiredAnswers = [
    record.q1,
    record.q2,
    record.q3,
    record.q4,
    record.q6,
    record.q7,
    record.q8,
    record.q9,
  ];
  return requiredAnswers.every((value) => value !== null)
    && (record.q4 !== "NO" || Boolean(record.q5?.trim()));
}

function setCachedNumber(xml: string, address: string, value: number): string {
  const pattern = new RegExp(`(<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?)(?:<v>[\\s\\S]*?<\\/v>|)(<\\/c>)`);
  return xml.replace(pattern, `$1<v>${Number.isFinite(value) ? value : 0}</v>$2`);
}

function setInlineText(xml: string, address: string, value: string): string {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>[\\s\\S]*?<\\/c>`);
  return xml.replace(pattern, (_cell, attributes: string) => {
    const cleaned = attributes.replace(/\\s+t="[^"]*"/g, "");
    return `<c${cleaned} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  });
}

function normalizeExecutive(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function updateReportCache(xml: string, records: PreverReportRecord[]): string {
  const outcomes = records.map((record) => {
    const completed = isSurveyCompleted(record);
    return {
      executive: normalizeExecutive(record.originalExecutive),
      connects: callConnects(record.callStatus),
      outcome: record.surveyResult ?? surveyOutcome(record.callStatus, completed),
      attempts: record.attempts,
    };
  });
  const totalBase = records.length;
  const attempts = outcomes.reduce((sum, record) => sum + record.attempts, 0);
  const contacts = outcomes.filter((record) => record.connects === "SI").length;
  const completed = outcomes.filter((record) => record.outcome === "Realizada").length;
  const rate = (numerator: number) => totalBase > 0 ? numerator / totalBase : 0;

  xml = setInlineText(xml, "B8", "PREVER · ENCUESTA JUNIO 2026");
  xml = setInlineText(xml, "C13", " Junio 2026");
  xml = setInlineText(xml, "B26", "Resultado por ejecutivo  Junio 2026");
  for (const [address, value] of Object.entries({
    D8: totalBase, E8: attempts, F8: rate(attempts), G8: contacts, H8: rate(contacts),
    I8: completed, J8: rate(completed), I9: 0, J9: 0,
    D10: totalBase, E10: attempts, F10: rate(attempts), G10: contacts, H10: rate(contacts),
    I10: completed, J10: rate(completed),
  })) xml = setCachedNumber(xml, address, value);

  const breakdown = [
    "Realizada",
    "No desea responder",
    "N° apagado",
    "N° equivocado",
    "N° no existe",
    "N° No responde",
    "Repetido",
    "Ya le realizaron encuesta",
  ];
  breakdown.forEach((label, index) => {
    const row = index + 15;
    const count = outcomes.filter((record) => record.outcome === label).length;
    xml = setCachedNumber(xml, `C${row}`, count);
    xml = setCachedNumber(xml, `D${row}`, rate(count));
  });
  xml = setCachedNumber(xml, "C23", outcomes.filter((record) => record.outcome).length);

  const executives = [
    "MARIA EUGENIA VALDEBENITO",
    "MAURICIO ZEPEDA",
    "PAMELA PARRA",
    "RICARDO CONEJERA",
    "SANDRA OLGUIN",
    "SERGIO SANHUEZA",
    "SONIA SILVA",
  ];
  breakdown.forEach((label, rowIndex) => {
    const row = rowIndex + 28;
    let rowTotal = 0;
    executives.forEach((executive, columnIndex) => {
      const count = outcomes.filter((record) => record.executive === executive && record.outcome === label).length;
      rowTotal += count;
      xml = setCachedNumber(xml, `${columnName(columnIndex + 2)}${row}`, count);
    });
    xml = setCachedNumber(xml, `J${row}`, rowTotal);
  });
  executives.forEach((executive, columnIndex) => {
    const count = outcomes.filter((record) => record.executive === executive && record.outcome).length;
    xml = setCachedNumber(xml, `${columnName(columnIndex + 2)}36`, count);
  });
  return xml;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function styleByColumn(templateRow: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const match of templateRow.matchAll(/<c\b[^>]*\br="([A-Z]+)3"[^>]*>/g)) {
    const style = match[0].match(/\bs="([0-9]+)"/)?.[1];
    if (style) styles.set(match[1], style);
  }
  return styles;
}

function cellXml(column: string, row: number, value: string | number | null, style?: string): string {
  if (value === null || value === "") return "";
  const styleAttribute = style ? ` s="${style}"` : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${column}${row}"${styleAttribute}><v>${value}</v></c>`;
  }
  const text = String(value);
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${column}${row}"${styleAttribute} t="inlineStr"><is><t${preserve}>${escapeXml(text)}</t></is></c>`;
}

function reportValues(record: PreverReportRecord): Array<string | number | null> {
  const completed = isSurveyCompleted(record);
  return [
    record.sourceId,
    record.deathRecordNumber,
    record.deceasedName,
    excelSerial(record.deathDate),
    record.contactName,
    record.relationship,
    null,
    record.phoneCode,
    record.phone,
    record.originalExecutive,
    record.city,
    record.presencial,
    record.provider,
    monthLabel(record.deathDate),
    monthLabel(record.managementAt?.slice(0, 10) ?? null),
    excelDateTimeSerial(record.managementAt),
    excelTimeSerial(record.managementAt),
    "PREVER · Encuesta Junio 2026",
    callConnects(record.callStatus),
    record.callStatus,
    record.surveyResult ?? surveyOutcome(record.callStatus, completed),
    record.attempts || null,
    record.respondentName,
    record.q1,
    record.q2,
    record.q3,
    record.q4,
    record.q5,
    record.q6,
    record.q7,
    record.q8,
    record.q9,
    record.q10,
  ];
}

export function buildPreverReportWorkbook(
  template: Uint8Array,
  records: PreverReportRecord[]
): Uint8Array {
  const archive = unzipSync(template);
  const sheetPath = "xl/worksheets/sheet2.xml";
  const sheet = strFromU8(archive[sheetPath]);
  const sheetData = sheet.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1];
  if (!sheetData) throw new Error("La plantilla PREVER no contiene la hoja base esperada.");

  const helperRow = sheetData.match(/<row\b[^>]*\br="1"[\s\S]*?<\/row>/)?.[0];
  const headerRow = sheetData.match(/<row\b[^>]*\br="2"[\s\S]*?<\/row>/)?.[0];
  const templateRow = sheetData.match(/<row\b[^>]*\br="3"[\s\S]*?<\/row>/)?.[0];
  if (!helperRow || !headerRow || !templateRow) {
    throw new Error("La estructura contractual de la plantilla PREVER cambió.");
  }

  const styles = styleByColumn(templateRow);
  const rows = records.map((record, index) => {
    const rowNumber = index + 3;
    const cells = reportValues(record)
      .map((value, columnIndex) => {
        const column = columnName(columnIndex);
        return cellXml(column, rowNumber, value, styles.get(column));
      })
      .join("");
    return `<row r="${rowNumber}">${cells}</row>`;
  });
  const lastRow = Math.max(3, records.length + 2);
  let updatedSheet = sheet.replace(
    /<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${helperRow}${headerRow}${rows.join("")}</sheetData>`
  );
  updatedSheet = updatedSheet.replace(/(<autoFilter\b[^>]*\bref=")A2:CG[0-9]+(")/, `$1A2:CG${lastRow}$2`);
  archive[sheetPath] = strToU8(updatedSheet);

  for (const path of XML_FILES_TO_RENAME) {
    const current = strFromU8(archive[path]);
    let updated = current.replaceAll("ABRIL2026", "JUNIO2026");
    updated = updated.replaceAll("$53", `$${lastRow}`);
    if (path === "xl/workbook.xml") {
      updated = updated.replace(/<calcPr\b[^>]*\/>/, '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>');
    }
    if (path === "xl/worksheets/sheet1.xml") updated = updateReportCache(updated, records);
    archive[path] = strToU8(updated);
  }

  return zipSync(archive, { level: 6 });
}
