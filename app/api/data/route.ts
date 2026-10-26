import { CIUDADES } from "@/lib/etl"

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function config() {
  const url = process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error(
      "Configura SUPABASE_URL y SUPABASE_SECRET_KEY en el servidor."
    )
  return { url: url.replace(/\/$/, ""), key }
}

export async function GET(request: Request) {
  try {
    const { url, key } = config()
    const incoming = new URL(request.url).searchParams
    const page = Number(incoming.get("page") ?? 0)
    const sort = incoming.get("sort") || "fecha_hora"
    const direction = incoming.get("direction") === "desc" ? "desc" : "asc"
    if (
      !Number.isInteger(page) ||
      page < 0 ||
      page > 100_000 ||
      ![
        "ciudad",
        "fecha_hora",
        "temperatura_c",
        "humedad_pct",
        "precipitacion_mm",
      ].includes(sort)
    ) {
      return Response.json(
        { error: "Parámetros de página u ordenación no válidos." },
        { status: 400 }
      )
    }
    const params = new URLSearchParams({
      select:
        "id,ciudad,fecha_hora,temperatura_c,humedad_pct,precipitacion_mm,importado_en",
      order: `${sort}.${direction}`,
      offset: String(page * 25),
      limit: "25",
    })
    const city = incoming.get("ciudad")
    const from = incoming.get("desde")
    const to = incoming.get("hasta")
    if (city && !CIUDADES.some((c) => c.nombre === city))
      return Response.json({ error: "Ciudad no válida." }, { status: 400 })
    if (from && !validDate(from))
      return Response.json(
        { error: "Fecha inicial no válida." },
        { status: 400 }
      )
    if (to && !validDate(to))
      return Response.json({ error: "Fecha final no válida." }, { status: 400 })
    if (from && to && from > to)
      return Response.json(
        { error: "La fecha inicial no puede ser posterior a la final." },
        { status: 400 }
      )
    if (city) params.set("ciudad", `eq.${city}`)
    if (from && to)
      params.set(
        "and",
        `(fecha_hora.gte.${from}T00:00:00Z,fecha_hora.lte.${to}T23:59:59Z)`
      )
    else if (from) params.set("fecha_hora", `gte.${from}T00:00:00Z`)
    else if (to) params.set("fecha_hora", `lte.${to}T23:59:59Z`)
    const response = await fetch(
      `${url}/rest/v1/mediciones_meteorologicas?${params}`,
      {
        cache: "no-store",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "count=exact",
        },
      }
    )
    if (!response.ok)
      return Response.json(
        {
          error: `Supabase respondió ${response.status}: ${await response.text()}`,
        },
        { status: 502 }
      )
    const range = response.headers.get("content-range") ?? "*/0"
    return Response.json({
      rows: await response.json(),
      total: Number(range.split("/").at(-1) || 0),
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron leer los datos.",
      },
      { status: 500 }
    )
  }
}
