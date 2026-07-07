import AmiClient from "asterisk-manager";
import { config } from "../config";
import { logger } from "../logger";

/**
 * Conexión persistente a AMI. Esto es exactamente lo que Vercel/Next.js no
 * puede sostener (socket TCP de larga duración) — por eso el motor vive
 * fuera del CRM, en un proceso propio.
 */
export function connectAmi(): AmiClient {
  const ami = new AmiClient(config.ami.port, config.ami.host, config.ami.username, config.ami.secret, true);
  ami.keepConnected();

  ami.on("connect", () => logger.info("AMI conectado"));
  ami.on("disconnect", () => logger.warn("AMI desconectado, reintentando..."));
  ami.on("reconnection", () => logger.info("AMI reconectando"));
  ami.on("error", (err) => logger.error({ err }, "Error de AMI"));

  return ami;
}
