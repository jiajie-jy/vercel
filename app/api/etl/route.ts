import { CIUDADES } from "@/lib/etl"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { ciudad, desde, hasta } = body as {
      ciudad: string
      desde: string
      hasta: string
    }
    const city = CIUDADES.find((c) => c.nombre === ciudad)
    const start = new Date(`${desde}T00:00:00Z`)
    const end = new Date(`${hasta}T00:00:00Z`)
    const days = (end.getTime() - start.getTime()) / 86_400_000 + 1
    if (
      !city ||
      !/^\d{4}-\d{2}-\d{2}$/.test(desde) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(hasta) ||
      start.toISOString().slice(0, 10) !== desde ||
      end.toISOString().slice(0, 10) !== hasta ||
      !Number.isFinite(days) ||
      days < 1 ||
      days > 31
    ) {
      return Response.json(
        {
          error: "Selecciona una ciudad y un intervalo válido de 1 a 31 días.",
        },
        { status: 400 }
      )
    }
    const query = new URLSearchParams({
      latitude: String(city.lat),
      longitude: String(city.lon),
      start_date: desde,
      end_date: hasta,
      hourly: "temperature_2m,relative_humidity_2m,precipitation",
      temperature_unit: "celsius",
      precipitation_unit: "mm",
      timezone: "UTC",
      timeformat: "iso8601",
    })
    const response = await fetch(
      `https://archive-api.open-meteo.com/v1/archive?${query}`,
      { cache: "no-store", signal: AbortSignal.timeout(45_000) }
    )
    const data = await response.json()
    if (!response.ok)
      return Response.json(
        { error: data.reason ?? `Open-Meteo respondió ${response.status}` },
        { status: 502 }
      )
    return Response.json({ ciudad, data })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo extraer la ciudad.",
      },
      { status: 502 }
    )
  }
}
