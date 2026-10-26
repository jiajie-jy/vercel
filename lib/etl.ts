export const CIUDADES = [
  { nombre: "Barcelona", lat: 41.3874, lon: 2.1686 },
  { nombre: "Madrid", lat: 40.4168, lon: -3.7038 },
  { nombre: "Sevilla", lat: 37.3891, lon: -5.9845 },
  { nombre: "Bilbao", lat: 43.263, lon: -2.935 },
  { nombre: "Valencia", lat: 39.4699, lon: -0.3763 },
] as const

export type Medicion = {
  ciudad: string
  fecha_hora: string
  temperatura_c: number
  humedad_pct: number
  precipitacion_mm: number
}
export type Rechazo = { registro: Partial<Medicion>; motivo: string }
export type FilaCruda = { ciudad: string; datos: unknown }
export type FiltrosMedicion = {
  desde: string
  hasta: string
  minTemp: string
  maxTemp: string
  minHum: string
  maxHum: string
  minRain: string
  maxRain: string
  lluvia: boolean
}

export function normalizar(respuestas: FilaCruda[]) {
  const transformados: Partial<Medicion>[] = []
  const rechazados: Rechazo[] = []
  const duplicados: Rechazo[] = []
  const transformStart = performance.now()
  for (const respuesta of respuestas) {
    const raw = respuesta.datos as { hourly?: Record<string, unknown> }
    const hourly = raw?.hourly
    const times = hourly?.time
    const temperaturas = hourly?.temperature_2m
    const humedades = hourly?.relative_humidity_2m
    const precipitaciones = hourly?.precipitation
    if (
      ![times, temperaturas, humedades, precipitaciones].every(Array.isArray)
    ) {
      rechazados.push({
        registro: { ciudad: respuesta.ciudad },
        motivo: "Faltan arrays horarios requeridos",
      })
      continue
    }
    const arrays = [
      times,
      temperaturas,
      humedades,
      precipitaciones,
    ] as unknown[][]
    if (!arrays.every((array) => array.length === arrays[0].length)) {
      rechazados.push({
        registro: { ciudad: respuesta.ciudad },
        motivo: "Los arrays horarios tienen longitudes distintas",
      })
      continue
    }
    for (let i = 0; i < arrays[0].length; i++) {
      const rawTime = arrays[0][i]
      const fecha_hora =
        typeof rawTime === "string" &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(rawTime)
          ? `${rawTime}:00Z`
          : typeof rawTime === "string"
            ? rawTime
            : ""
      const row: Partial<Medicion> = {
        ciudad: respuesta.ciudad,
        fecha_hora,
        temperatura_c: arrays[1][i] as number,
        humedad_pct: arrays[2][i] as number,
        precipitacion_mm: arrays[3][i] as number,
      }
      transformados.push(row)
    }
  }
  const transformMs = performance.now() - transformStart
  const cleanStart = performance.now()
  const vistos = new Set<string>()
  const validos: Medicion[] = []
  for (const row of transformados) {
    const fecha_hora = row.fecha_hora ?? ""
    const reason = !row.ciudad
      ? "Ciudad ausente"
      : !fecha_hora || !Number.isFinite(Date.parse(fecha_hora))
        ? "Fecha/hora UTC inválida"
        : ![row.temperatura_c, row.humedad_pct, row.precipitacion_mm].every(
              (n) => typeof n === "number" && Number.isFinite(n)
            )
          ? "Medición nula, ausente o no numérica"
          : row.humedad_pct! < 0 || row.humedad_pct! > 100
            ? "Humedad fuera del rango 0–100 %"
            : row.precipitacion_mm! < 0
              ? "Precipitación negativa"
              : ""
    if (reason) {
      rechazados.push({ registro: row, motivo: reason })
      continue
    }
    const key = `${row.ciudad}|${new Date(fecha_hora).toISOString()}`
    if (vistos.has(key)) {
      duplicados.push({
        registro: row,
        motivo: "Duplicado; se conserva la primera fila",
      })
      continue
    }
    vistos.add(key)
    validos.push(row as Medicion)
  }
  const duplicadosN = duplicados.length
  return {
    transformados,
    validos,
    rechazados: [...rechazados, ...duplicados],
    rechazadosCalidad: rechazados.length,
    duplicadosN,
    transformMs,
    cleanMs: performance.now() - cleanStart,
  }
}

export const esNumero = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)
export function validaMedicion(row: unknown): row is Medicion {
  if (!row || typeof row !== "object") return false
  const r = row as Medicion
  return (
    CIUDADES.some((c) => c.nombre === r.ciudad) &&
    typeof r.fecha_hora === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.fecha_hora) &&
    Number.isFinite(Date.parse(r.fecha_hora)) &&
    new Date(r.fecha_hora).toISOString().replace(".000Z", "Z") ===
      r.fecha_hora &&
    [r.temperatura_c, r.humedad_pct, r.precipitacion_mm].every(esNumero) &&
    r.humedad_pct >= 0 &&
    r.humedad_pct <= 100 &&
    r.precipitacion_mm >= 0
  )
}

export function paginas<T>(rows: T[], page: number, size = 25) {
  return rows.slice(Math.max(0, page) * size, (Math.max(0, page) + 1) * size)
}

export function filtrarYOrdenar(
  rows: Medicion[],
  filters: FiltrosMedicion,
  cities: string[],
  sort: keyof Medicion,
  direction: "asc" | "desc"
) {
  return rows
    .filter((r) => {
      const time = new Date(r.fecha_hora).getTime()
      return (
        cities.includes(r.ciudad) &&
        (!filters.desde ||
          time >= new Date(`${filters.desde}T00:00:00Z`).getTime()) &&
        (!filters.hasta ||
          time <= new Date(`${filters.hasta}T23:59:59Z`).getTime()) &&
        (!filters.minTemp || r.temperatura_c >= Number(filters.minTemp)) &&
        (!filters.maxTemp || r.temperatura_c <= Number(filters.maxTemp)) &&
        (!filters.minHum || r.humedad_pct >= Number(filters.minHum)) &&
        (!filters.maxHum || r.humedad_pct <= Number(filters.maxHum)) &&
        (!filters.minRain || r.precipitacion_mm >= Number(filters.minRain)) &&
        (!filters.maxRain || r.precipitacion_mm <= Number(filters.maxRain)) &&
        (!filters.lluvia || r.precipitacion_mm > 0)
      )
    })
    .sort((a, b) => {
      const av = a[sort],
        bv = b[sort]
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv))
      return direction === "asc" ? cmp : -cmp
    })
}

export function seleccionarCoincidentes(
  rows: Medicion[],
  selectedKeys: Set<string>
) {
  return rows.filter((r) =>
    selectedKeys.has(`${r.ciudad}|${new Date(r.fecha_hora).toISOString()}`)
  )
}
