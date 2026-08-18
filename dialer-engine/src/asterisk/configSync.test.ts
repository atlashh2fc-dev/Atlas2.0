import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type AmiClient from "asterisk-manager";
import {
  ensureAgentEndpoints,
  ensureQueue,
  parseConfigSnapshot,
  syncQueueMembers,
  updateAgentSipPassword,
} from "./configSync";

type AmiAction = Record<string, string | number | boolean | undefined>;

function managedEndpointSnapshot(password: string): Record<string, unknown> {
  return {
    "Category-000000": "atlas-agent-endpoint-template(!)",
    "Line-000000-000000": "type=endpoint",
    "Category-000001": "atlas-agent-aor-template(!)",
    "Line-000001-000000": "type=aor",
    "Category-000002": "6015-auth",
    "Line-000002-000000": "type=auth",
    "Line-000002-000001": "auth_type=userpass",
    "Line-000002-000002": "username=6015",
    "Line-000002-000003": `password=${password}`,
    "Category-000003": "6015(atlas-agent-endpoint-template)",
    "Line-000003-000000": "aors=6015",
    "Line-000003-000001": "auth=6015-auth",
    // Endpoint y AOR comparten nombre y llegan como categorías distintas.
    "Category-000004": "6015(atlas-agent-aor-template)",
  };
}

function fakeAmi(
  snapshot: Record<string, unknown>,
  updateError?: Error
): { ami: AmiClient; actions: AmiAction[] } {
  const actions: AmiAction[] = [];
  const ami = {
    action(action: AmiAction, callback: (error: unknown, response?: unknown) => void) {
      actions.push(action);
      if (action.Action === "GetConfig") callback(null, snapshot);
      else if (updateError) callback(updateError);
      else callback(null, { Response: "Success" });
    },
  } as unknown as AmiClient;
  return { ami, actions };
}

test("parsea variables de categorías GetConfig repetidas sin perder el endpoint", () => {
  const snapshot = parseConfigSnapshot(managedEndpointSnapshot("clave-actual"));

  assert(snapshot.categories.has("6015"));
  assert(snapshot.categories.has("6015-auth"));
  assert.equal(snapshot.variablesByCategory.get("6015-auth")?.get("password"), "clave-actual");
  assert.equal(snapshot.variablesByCategory.get("6015")?.get("aors"), "6015");
  assert.equal(snapshot.variablesByCategory.get("6015")?.get("auth"), "6015-auth");
});

test("no recarga PJSIP cuando la contraseña existente ya coincide con Supabase", async () => {
  const { ami, actions } = fakeAmi(managedEndpointSnapshot("clave-vigente"));

  await ensureAgentEndpoints(ami, [{ extension: "6015", sipPassword: "clave-vigente" }]);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].Action, "GetConfig");
});

test("reconcilia una contraseña divergente mediante UpdateConfig y reload", async () => {
  const { ami, actions } = fakeAmi(managedEndpointSnapshot("clave-antigua"));

  await ensureAgentEndpoints(ami, [{ extension: "6015", sipPassword: "clave-nueva" }]);

  assert.equal(actions.length, 2);
  const update = actions[1];
  assert.equal(update.Action, "UpdateConfig");
  assert.equal(update.Reload, "yes");
  assert.equal(update["Action-000000"], "Update");
  assert.equal(update["Cat-000000"], "6015-auth");
  assert.equal(update["Var-000000"], "password");
  assert.equal(update["Value-000000"], "clave-nueva");
  assert.equal(update["Action-000001"], undefined);
});

test("repara la categoría auth faltante de un endpoint existente", async () => {
  const partial = managedEndpointSnapshot("ignorada");
  for (const key of Object.keys(partial)) {
    if (key === "Category-000002" || key.startsWith("Line-000002-")) delete partial[key];
  }
  const { ami, actions } = fakeAmi(partial);

  await ensureAgentEndpoints(ami, [{ extension: "6015", sipPassword: "clave-db" }]);

  const update = actions[1];
  assert.equal(update["Action-000000"], "NewCat");
  assert.equal(update["Cat-000000"], "6015-auth");
  assert.equal(update["Var-000004"], "password");
  assert.equal(update["Value-000004"], "clave-db");
});

test("un error AMI de actualización no propaga la contraseña a los logs", async () => {
  const secret = "secreto-que-no-debe-loggearse";
  const { ami } = fakeAmi({}, new Error(`rechazado action password=${secret}`));

  await assert.rejects(
    updateAgentSipPassword(ami, "6015", secret),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, "AMI rechazó la actualización de configuración PJSIP del agente");
      assert(!error.message.includes(secret));
      return true;
    }
  );
});

test("agrega ringinuse=no a una cola existente sin esa protección", async () => {
  const { ami, actions } = fakeAmi({
    "Category-000000": "secretaria_virtual",
    "Line-000000-000000": "strategy=leastrecent",
    "Line-000000-000001": "wrapuptime=10",
  });

  await ensureQueue(ami, "secretaria_virtual", 10);

  const update = actions[1];
  assert.equal(update.Action, "UpdateConfig");
  assert.equal(update["Action-000002"], "Append");
  assert.equal(update["Var-000002"], "ringinuse");
  assert.equal(update["Value-000002"], "no");
});

test("un miembro nuevo entra pausado hasta reconciliar su estado CRM", async () => {
  const events = new EventEmitter();
  const actions: AmiAction[] = [];
  const ami = Object.assign(events, {
    action(action: AmiAction, callback: (error: unknown, response?: unknown) => void) {
      actions.push(action);
      callback(null, { Response: "Success" });
      if (action.Action === "QueueStatus") {
        queueMicrotask(() => {
          events.emit("managerevent", {
            event: "QueueStatusComplete",
            actionid: action.actionid,
          });
        });
      }
    },
  }) as unknown as AmiClient;

  const changed = await syncQueueMembers(ami, "secretaria_virtual", ["6015"]);

  assert.equal(changed, true);
  const queueAdd = actions.find((action) => action.Action === "QueueAdd");
  assert.equal(queueAdd?.Interface, "PJSIP/6015");
  assert.equal(queueAdd?.Paused, "true");
});
