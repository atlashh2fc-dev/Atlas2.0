// "asterisk-manager" no publica tipos oficiales. Declaración mínima con lo
// que este proyecto realmente usa (conexión AMI, action() y eventos).
declare module "asterisk-manager" {
  interface AmiEvent {
    event: string;
    [key: string]: unknown;
  }

  interface AmiActionResponse {
    response?: string;
    message?: string;
    actionid?: string;
    uniqueid?: string;
    [key: string]: unknown;
  }

  class AmiClient {
    constructor(port: number, host: string, username: string, secret: string, events: boolean);
    keepConnected(): void;
    on(event: "connect" | "disconnect" | "reconnection" | "error", cb: (err?: Error) => void): void;
    on(event: "managerevent", cb: (evt: AmiEvent) => void): void;
    action(
      action: Record<string, string | number | boolean | undefined>,
      callback?: (err: Error | null, res: AmiActionResponse) => void
    ): void;
  }

  export = AmiClient;
}
