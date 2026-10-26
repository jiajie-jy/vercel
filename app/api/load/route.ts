import { validaMedicion } from "@/lib/etl"

const TABLE = "mediciones_meteorologicas"
function config() {
  const url = process.env.SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new Error("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en el servidor.")
  return { url: url.replace(/\/$/, ""), key }
}

export async function POST(request: Request) {
  try {
    const body = await request.text()
    if (new TextEncoder().encode(body).byteLength > 1_000_000)
      return Response.json({ error: "El lote supera 1 MB." }, { status: 413 })
    const { records } = JSON.parse(body)
    if (
      !Array.isArray(records) ||
      records.length < 1 ||
      records.length > 500 ||
      !records.every(validaMedicion)
    )
      return Response.json(
        { error: "Lote inválido: admite de 1 a 500 mediciones validadas." },
        { status: 400 }
      )
    const { url, key } = config()
    const target = `${url}/rest/v1/${TABLE}?on_conflict=ciudad,fecha_hora`
    const response = await fetch(target, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(records),
    })
    if (!response.ok)
      return Response.json(
        {
          error: `Supabase rechazó el lote (${response.status}). ${await response.text()}`,
        },
        { status: 502 }
      )
    const verified = new Set<string>()
    for (let i = 0; i < records.length; i += 100) {
      const part = records.slice(i, i + 100)
      const city = [...new Set(part.map((r) => r.ciudad))]
      const from = part.map((r) => r.fecha_hora).sort()[0]
      const to = part
        .map((r) => r.fecha_hora)
        .sort()
        .at(-1)!
      const params = new URLSearchParams({
        select: "ciudad,fecha_hora",
        ciudad: `in.(${city.map((n) => `\"${n}\"`).join(",")})`,
        and: `(fecha_hora.gte.${from},fecha_hora.lte.${to})`,
        order: "fecha_hora.asc",
        limit: "10000",
      })
      const check = await fetch(`${url}/rest/v1/${TABLE}?${params}`, {
        cache: "no-store",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      })
      if (!check.ok)
        return Response.json(
          {
            error: `El lote se guardó, pero falló la verificación (${check.status}). Reintenta para confirmar.`,
          },
          { status: 502 }
        )
      const rows = (await check.json()) as {
        ciudad: string
        fecha_hora: string
      }[]
      rows.forEach((r) =>
        verified.add(`${r.ciudad}|${new Date(r.fecha_hora).toISOString()}`)
      )
    }
    const missing = records.filter(
      (r) =>
        !verified.has(`${r.ciudad}|${new Date(r.fecha_hora).toISOString()}`)
    ).length
    if (missing)
      return Response.json(
        { error: `${missing} claves enviadas no aparecen en la verificación.` },
        { status: 502 }
      )
    return Response.json({
      processed: records.length,
      verified: records.length,
    })
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Error al cargar el lote.",
      },
      { status: 500 }
    )
  }
}
