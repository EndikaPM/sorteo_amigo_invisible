import { test } from "node:test";
import assert from "node:assert/strict";
import { sortear, type Persona } from "../src/sorteo.ts";

test("el reparto es uniforme: con 4 personas salen los 9 sorteos posibles por igual", () => {
  const ps: Persona[] = ["a", "b", "c", "d"].map((n) => ({ nombre: n, email: `${n}@x.com` }));
  const cuentas = new Map<string, number>();
  const VECES = 9000;
  for (let i = 0; i < VECES; i++) {
    const r = sortear(ps);
    const clave = ps.map((p) => r[p.email]).join("|");
    cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
  }
  assert.equal(cuentas.size, 9, "los 9 desórdenes posibles de 4 elementos");
  // Esperado: 1000 cada uno, con desviación típica ≈ 30. Se permiten ±5 desviaciones (≈ 850..1150).
  for (const [clave, n] of cuentas) assert.ok(n > 850 && n < 1150, `el sorteo ${clave} salió ${n} veces (esperado ≈ 1000)`);
});

test("con 3 personas y sin historial salen las 2 rotaciones al 50 %", () => {
  const ps: Persona[] = ["a", "b", "c"].map((n) => ({ nombre: n, email: `${n}@x.com` }));
  let primera = 0;
  const VECES = 4000;
  for (let i = 0; i < VECES; i++) if (sortear(ps)["a@x.com"] === "b@x.com") primera++;
  assert.ok(primera > 1840 && primera < 2160, `salió ${primera} de ${VECES} (esperado ≈ 2000)`);
});
