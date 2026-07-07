import pino from "pino";

// Logs estructurados (JSON) para que CloudWatch/whatever en AWS los pueda
// indexar sin parseo custom.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
