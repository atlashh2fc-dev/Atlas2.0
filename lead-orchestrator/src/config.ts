import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  PORT: z.coerce.number().int().positive().default(8080),
  TICK_MS: z.coerce.number().int().min(2000).max(300000).default(5000),
});

export const config = schema.parse(process.env);

