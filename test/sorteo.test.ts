import { test } from "node:test";
import assert from "node:assert/strict";
import { sortear, actualizarHistorial, SorteoImposibleError, type Asignacion, type Persona } from "../src/sorteo.ts";
import { generarEmail } from "../src/email.ts";

const personas: Persona[] = ["Ana", "Beto", "Carla", "Dani", "Eva", "Fran", "Gema", "Hugo"].map((n) => ({
  nombre: n,
  email: `${n.toLowerCase()}@ejemplo.com`,
}));
const emails = personas.map((p) => p.email);

function esPermutacionValida(a: Asignacion) {
  const dadores = Object.keys(a).sort();
  const receptores = Object.values(a).sort();
  assert.deepEqual(dadores, [...emails].sort());
  assert.deepEqual(receptores, [...emails].sort()); // cada uno recibe exactamente uno
  for (const [d, r] of Object.entries(a)) assert.notEqual(d, r); // nadie se toca a sí mismo
}

test("sorteo básico: permutación válida sin autoasignación", () => {
  for (let i = 0; i < 200; i++) esPermutacionValida(sortear(personas));
});

test("no repite parejas de los 2 años anteriores (200 sorteos encadenados)", () => {
  let historial: Asignacion[] = [];
  for (let i = 0; i < 200; i++) {
    const nuevo = sortear(personas, { historial });
    esPermutacionValida(nuevo);
    for (const anio of historial) {
      for (const [d, r] of Object.entries(nuevo)) assert.notEqual(anio[d], r);
    }
    historial = actualizarHistorial(historial, nuevo);
    assert.ok(historial.length <= 2);
  }
});

test("respeta parejas prohibidas en ambas direcciones", () => {
  const noPueden: [string, string][] = [
    ["ana@ejemplo.com", "beto@ejemplo.com"],
    ["carla@ejemplo.com", "dani@ejemplo.com"],
  ];
  for (let i = 0; i < 200; i++) {
    const a = sortear(personas, { noPueden });
    assert.notEqual(a["ana@ejemplo.com"], "beto@ejemplo.com");
    assert.notEqual(a["beto@ejemplo.com"], "ana@ejemplo.com");
    assert.notEqual(a["carla@ejemplo.com"], "dani@ejemplo.com");
    assert.notEqual(a["dani@ejemplo.com"], "carla@ejemplo.com");
  }
});

test("avisa cuando es imposible en vez de quedarse en bucle", () => {
  const tres = personas.slice(0, 3);
  const [a, b, c] = tres.map((p) => p.email);
  // Con 3 personas y estos dos sorteos previos no queda ninguna asignación posible.
  const historial: Asignacion[] = [
    { [a]: b, [b]: c, [c]: a },
    { [a]: c, [b]: a, [c]: b },
  ];
  assert.throws(() => sortear(tres, { historial, maxIntentos: 2000 }), SorteoImposibleError);
});

test("rechaza emails repetidos y listas demasiado cortas", () => {
  assert.throws(() => sortear([personas[0], { ...personas[1], email: personas[0].email }]));
  assert.throws(() => sortear([personas[0]]));
});

test("el historial guarda solo los 2 sorteos más recientes", () => {
  const h = actualizarHistorial(actualizarHistorial(actualizarHistorial([], { a: "b" }), { a: "c" }), { a: "d" });
  assert.deepEqual(h, [{ a: "d" }, { a: "c" }]);
});

test("el email escapa HTML y trae versión de texto", () => {
  const e = generarEmail({ nombreDador: "Ana", nombreReceptor: "<b>Beto & Co</b>", presupuesto: "20 €" });
  assert.ok(!e.html.includes("<b>Beto"));
  assert.ok(e.html.includes("&lt;b&gt;Beto &amp; Co&lt;/b&gt;"));
  assert.ok(e.texto.includes("Presupuesto: 20 €"));
});
