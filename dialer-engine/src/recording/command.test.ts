import assert from "node:assert/strict";
import test from "node:test";
import { buildRecordingUploadCommand, shellQuote } from "./command";

test("shell-quotea comillas simples sin permitir concatenar comandos", () => {
  assert.equal(shellQuote("a'b; touch /tmp/pwn"), `'a'"'"'b; touch /tmp/pwn'`);
});

test("construye el comando sin dejar argumentos sin quote", () => {
  assert.equal(
    buildRecordingUploadCommand(["/usr/local/bin/upload", "attempt-id", "token"]),
    "'/usr/local/bin/upload' 'attempt-id' 'token'"
  );
});
