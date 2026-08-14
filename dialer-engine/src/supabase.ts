import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { z } from "zod";

const supabaseEnv = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "Falta SUPABASE_SERVICE_ROLE_KEY"),
}).parse(process.env);

/** Cliente server-only compartido por dialer-engine y recording-worker. */
export const supabase = createClient(
  supabaseEnv.SUPABASE_URL,
  supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as never },
  }
);
