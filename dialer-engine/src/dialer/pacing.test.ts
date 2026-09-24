import assert from "node:assert/strict";
import test from "node:test";
import { computeDialCapacity, computeEffectiveRatio, contactDemandRatio, resetEffectiveRatioForTests } from "./pacing";

test("la demanda de líneas sale de la tasa de contacto y respeta piso y techo", () => {
  assert.equal(contactDemandRatio({ measuredContactRate: 0.5, floor: 1, ceiling: 4 }), 2);
  assert.equal(contactDemandRatio({ measuredContactRate: 0.12, floor: 1, ceiling: 4 }), 4);
  assert.equal(contactDemandRatio({ measuredContactRate: 0.9, floor: 1, ceiling: 4 }), 1.1111111111111112);
  assert.equal(contactDemandRatio({ measuredContactRate: 0.9, floor: 1.5, ceiling: 4 }), 1.5);
  assert.equal(contactDemandRatio({ measuredContactRate: null, floor: 1, ceiling: 4 }), 1.1);
  assert.equal(contactDemandRatio({ measuredContactRate: 0, floor: 1, ceiling: 4 }), 4);
});

test("fuera de predictivo el ratio es el configurado, sin memoria", () => {
  resetEffectiveRatioForTests();
  assert.equal(
    computeEffectiveRatio({ campaignId: "c", dialMode: "progressive", baseRatio: 1.2, targetAbandonmentRate: 3, measuredAbandonmentRate: 50, measuredContactRate: 0.1 }),
    1.2
  );
});

test("predictivo sube hacia la demanda mientras el abandono tenga margen y se frena en el techo", () => {
  resetEffectiveRatioForTests();
  const base = { campaignId: "eq", dialMode: "predictive", baseRatio: 4, targetAbandonmentRate: 3 };
  const first = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0.5, measuredContactRate: 0.12 });
  assert.ok(first > 1.1 && first <= 1.1 * 1.15 + 1e-9, `arranca conservador y sube de a poco: ${first}`);
  let ratio = first;
  for (let i = 0; i < 20; i += 1) {
    ratio = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0.5, measuredContactRate: 0.12 });
  }
  assert.equal(ratio, 4, "con 12 % de contacto la demanda es 8,3 pero el techo del admin manda");
});

test("predictivo baja rápido apenas el abandono supera el objetivo", () => {
  resetEffectiveRatioForTests();
  const base = { campaignId: "ab", dialMode: "predictive", baseRatio: 4, targetAbandonmentRate: 3, measuredContactRate: 0.12 };
  let ratio = 0;
  for (let i = 0; i < 20; i += 1) ratio = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0.5 });
  assert.equal(ratio, 4);
  const shrunk = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 5 });
  assert.equal(shrunk, 3.4);
  const shrunkAgain = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 5 });
  assert.ok(shrunkAgain < shrunk);
});

test("predictivo se queda quieto en la zona de equilibrio y vuelve a bajar si la demanda cae", () => {
  resetEffectiveRatioForTests();
  const base = { campaignId: "eq2", dialMode: "predictive", baseRatio: 4, targetAbandonmentRate: 3 };
  let ratio = 0;
  for (let i = 0; i < 20; i += 1) ratio = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0.5, measuredContactRate: 0.3 });
  assert.ok(Math.abs(ratio - 1 / 0.3) < 1e-9, `se detiene en la demanda: ${ratio}`);
  const held = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 2.5, measuredContactRate: 0.3 });
  assert.equal(held, ratio, "entre el 70 % y el 100 % del objetivo no se mueve");
  const lowered = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0.5, measuredContactRate: 0.5 });
  assert.ok(lowered < held && lowered >= 2, `si el contacto mejora sobran líneas: ${lowered}`);
});

test("sin abandono medido avanza igual hacia la demanda, pero más lento", () => {
  resetEffectiveRatioForTests();
  const base = { campaignId: "ns", dialMode: "predictive", baseRatio: 4, targetAbandonmentRate: 3, measuredContactRate: 0.2 };
  const first = computeEffectiveRatio({ ...base, measuredAbandonmentRate: null });
  assert.ok(Math.abs(first - 1.1 * 1.1) < 1e-9, `${first}`);
  const withMargin = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 0 });
  assert.ok(Math.abs(withMargin - first * 1.15) < 1e-9, `${withMargin}`);
});

test("nunca por debajo de 1,0 aunque el abandono se dispare", () => {
  resetEffectiveRatioForTests();
  const base = { campaignId: "fl", dialMode: "predictive", baseRatio: 4, targetAbandonmentRate: 3, measuredContactRate: 0.12 };
  let ratio = 0;
  for (let i = 0; i < 30; i += 1) ratio = computeEffectiveRatio({ ...base, measuredAbandonmentRate: 50 });
  assert.equal(ratio, 1);
});

test("la capacidad descuenta lo que ya está en vuelo y respeta el lote máximo", () => {
  assert.equal(computeDialCapacity({ availableAgents: 12, ratio: 4, inFlight: 30, maxBatchPerTick: 20 }), 18);
  assert.equal(computeDialCapacity({ availableAgents: 12, ratio: 4, inFlight: 10, maxBatchPerTick: 20 }), 20);
  assert.equal(computeDialCapacity({ availableAgents: 0, ratio: 4, inFlight: 0, maxBatchPerTick: 20 }), 0);
  assert.equal(computeDialCapacity({ availableAgents: 2, ratio: 1, inFlight: 5, maxBatchPerTick: 20 }), 0);
});
