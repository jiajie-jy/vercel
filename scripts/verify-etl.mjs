import assert from "node:assert/strict"
import test from "node:test"
import {
  filtrarYOrdenar,
  normalizar,
  paginas,
  seleccionarCoincidentes,
} from "../lib/etl.ts"

const oneDay = () =>
  Array.from(
    { length: 24 },
    (_, hour) => `2026-09-01T${String(hour).padStart(2, "0")}:00`
  )
const response = (
  times,
  temps,
  humidity = times.map(() => 50),
  rain = times.map(() => 0)
) => ({
  hourly: {
    time: times,
    temperature_2m: temps,
    relative_humidity_2m: humidity,
    precipitation: rain,
  },
})
const filters = {
  desde: "",
  hasta: "",
  minTemp: "",
  maxTemp: "",
  minHum: "",
  maxHum: "",
  minRain: "",
  maxRain: "",
  lluvia: false,
}

test("extrae y transforma 24 horas con fechas UTC explícitas", () => {
  const times = oneDay()
  const result = normalizar([
    {
      ciudad: "Madrid",
      datos: response(
        times,
        times.map((_, i) => i)
      ),
    },
  ])
  assert.equal(result.validos.length, 24)
  assert.equal(result.validos[0].fecha_hora, "2026-09-01T00:00:00Z")
  assert.equal(result.validos[23].temperatura_c, 23)
})

test("rechaza null sin convertirlo en cero y registra el motivo", () => {
  const result = normalizar([
    { ciudad: "Madrid", datos: response(["2026-09-01T00:00"], [null]) },
  ])
  assert.equal(result.validos.length, 0)
  assert.match(result.rechazados[0].motivo, /nula/)
})

test("detecta duplicados por ciudad y fecha y conserva la primera aparición", () => {
  const time = "2026-09-01T00:00"
  const result = normalizar([
    { ciudad: "Madrid", datos: response([time, time], [12, 99]) },
  ])
  assert.equal(result.validos.length, 1)
  assert.equal(result.validos[0].temperatura_c, 12)
  assert.match(result.rechazados[0].motivo, /Duplicado/)
})

test("permite temperaturas extremas y rechaza longitudes incoherentes", () => {
  const extreme = normalizar([
    { ciudad: "Madrid", datos: response(["2026-09-01T00:00"], [1000]) },
  ])
  assert.equal(extreme.validos.length, 1)
  const mismatch = normalizar([
    {
      ciudad: "Madrid",
      datos: response(["2026-09-01T00:00", "2026-09-01T01:00"], [1]),
    },
  ])
  assert.match(mismatch.rechazados[0].motivo, /longitudes/)
})

test("filtra y ordena antes de paginar; selección abarca distintas páginas", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    ciudad: "Madrid",
    fecha_hora: new Date(Date.UTC(2026, 8, 1, i)).toISOString(),
    temperatura_c: i,
    humedad_pct: 50,
    precipitacion_mm: i % 2,
  }))
  const matched = filtrarYOrdenar(
    rows,
    { ...filters, minTemp: "10", lluvia: true },
    ["Madrid"],
    "temperatura_c",
    "desc"
  )
  assert.equal(matched.length, 10)
  assert.equal(matched[0].temperatura_c, 29)
  assert.equal(paginas(matched, 0, 5)[0].temperatura_c, 29)
  const selected = new Set([
    `${matched[0].ciudad}|${matched[0].fecha_hora}`,
    `${matched[6].ciudad}|${matched[6].fecha_hora}`,
  ])
  const preview = seleccionarCoincidentes(matched, selected)
  assert.deepEqual(preview, [matched[0], matched[6]])
  assert.equal(
    paginas(matched, 1, 5).some((r) =>
      selected.has(`${r.ciudad}|${r.fecha_hora}`)
    ),
    true
  )
})
