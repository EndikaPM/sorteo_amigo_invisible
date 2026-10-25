import { test } from "node:test";
import assert from "node:assert/strict";
import { proximosReyes, formatoFecha, aISO, desdeISO } from "../src/fechas.ts";

test("en octubre, los próximos Reyes son el 6 de enero del año siguiente", () => {
  const r = proximosReyes(new Date(2026, 9, 18));
  assert.deepEqual([r.getFullYear(), r.getMonth(), r.getDate()], [2027, 0, 6]);
});

test("el propio 6 de enero cuenta como Reyes de ese año", () => {
  const r = proximosReyes(new Date(2027, 0, 6, 23, 30));
  assert.deepEqual([r.getFullYear(), r.getMonth(), r.getDate()], [2027, 0, 6]);
});

test("el 7 de enero ya salta al año siguiente", () => {
  const r = proximosReyes(new Date(2027, 0, 7));
  assert.deepEqual([r.getFullYear(), r.getMonth(), r.getDate()], [2028, 0, 6]);
});

test("formatoFecha da la fecha en español", () => {
  assert.equal(formatoFecha(new Date(2027, 0, 6)), "miércoles, 6 de enero");
});

test("aISO genera YYYY-MM-DD en hora local", () => {
  assert.equal(aISO(new Date(2027, 0, 6)), "2027-01-06");
  assert.equal(aISO(new Date(2026, 11, 31)), "2026-12-31");
});

test("desdeISO parsea en hora local (sin desfase UTC)", () => {
  const d = desdeISO("2027-01-06");
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2027, 0, 6]);
  assert.equal(formatoFecha(d), "miércoles, 6 de enero");
});

test("aISO y desdeISO se van y vuelven sin cambios", () => {
  for (const iso of ["2027-01-06", "2026-12-31", "2028-02-29"]) {
    assert.equal(aISO(desdeISO(iso)), iso);
  }
});
