"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Check,
  Cloud,
  Database,
  Download,
  LoaderCircle,
  RefreshCw,
  Wind,
  MapPin,
} from "lucide-react"
import {
  CIUDADES,
  filtrarYOrdenar,
  Medicion,
  normalizar,
  paginas,
  seleccionarCoincidentes,
} from "@/lib/etl"
import MapaCiudades from "@/components/mapa-ciudades"

type FaseEstado = "pendiente" | "en curso" | "completada" | "con errores"
type Fase = {
  estado: FaseEstado
  entrada: number
  salida: number
  ms: number | null
}
const estadosIniciales = (): Record<string, FaseEstado> =>
  Object.fromEntries(CIUDADES.map((c) => [c.nombre, "pendiente"]))
const clave = (r: Medicion) =>
  `${r.ciudad}|${new Date(r.fecha_hora).toISOString()}`
const fechaHora = (v: string) =>
  new Date(v).toLocaleString("es-ES", { timeZone: "UTC", hour12: false }) +
  " UTC"

export default function Page() {
  const [mounted, setMounted] = useState(false)
  const [desde, setDesde] = useState("2026-09-01")
  const [hasta, setHasta] = useState("2026-09-30")
  const [selectedCities, setSelectedCities] = useState<string[]>(CIUDADES.map((ciudad) => ciudad.nombre))
  const [raw, setRaw] = useState<Record<string, unknown>>({})
  const [cityState, setCityState] =
    useState<Record<string, FaseEstado>>(estadosIniciales)
  const [cityError, setCityError] = useState<Record<string, string>>({})
  const [busyCities, setBusyCities] = useState(false)
  const [extractionMs, setExtractionMs] = useState<number | null>(null)
  const [tab, setTab] = useState("válidos")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<keyof Medicion>("fecha_hora")
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  const [filters, setFilters] = useState({
    desde: "",
    hasta: "",
    minTemp: "",
    maxTemp: "",
    minHum: "",
    maxHum: "",
    minRain: "",
    maxRain: "",
    lluvia: false,
    ciudades: [] as string[],
    usarFiltroCiudades: false,
  })
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadMs, setUploadMs] = useState<number | null>(null)
  const [batches, setBatches] = useState<
    { estado: string; filas: number; error?: string }[]
  >([])
  const [stored, setStored] = useState<Medicion[]>([])
  const [storedTotal, setStoredTotal] = useState(0)
  const [storedPage, setStoredPage] = useState(0)
  const [storedSort, setStoredSort] = useState<keyof Medicion>("fecha_hora")
  const [storedDirection, setStoredDirection] = useState<"asc" | "desc">("desc")
  const [storedCity, setStoredCity] = useState("")
  const [storedFrom, setStoredFrom] = useState("")
  const [storedTo, setStoredTo] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    setMounted(true)
  }, [])

  const extraction = async (cities: string[]) => {
    if (!cities.length || busyCities) return
    const start = new Date(`${desde}T00:00:00Z`),
      end = new Date(`${hasta}T00:00:00Z`)
    const dayCount = (end.getTime() - start.getTime()) / 86_400_000 + 1
    if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 31) {
      setNotice("El intervalo debe ser válido y no superar 31 días.")
      return
    }
    setNotice("")
    setBusyCities(true)
    const extractionStarted = performance.now()
    for (const city of cities) {
      setCityState((s) => ({ ...s, [city]: "en curso" }))
      setCityError((s) => ({ ...s, [city]: "" }))
      try {
        const response = await fetch("/api/etl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ciudad: city, desde, hasta }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Falló la extracción")
        setRaw((r) => ({ ...r, [city]: result.data }))
        setCityState((s) => ({ ...s, [city]: "completada" }))
      } catch (e) {
        const message = e instanceof Error ? e.message : "Error de conexión"
        setCityError((s) => ({ ...s, [city]: message }))
        setCityState((s) => ({ ...s, [city]: "con errores" }))
      }
    }
    setExtractionMs(performance.now() - extractionStarted)
    setBusyCities(false)
    setPage(0)
  }

  const normalized = useMemo(
    () =>
      normalizar(
        Object.entries(raw).map(([ciudad, datos]) => ({ ciudad, datos }))
      ),
    [raw]
  )
  const filterResult = useMemo(() => {
    const started = performance.now()
    const rows = filtrarYOrdenar(
      normalized.validos,
      filters,
      filters.usarFiltroCiudades ? filters.ciudades : selectedCities,
      sort,
      direction
    )
    return { rows, ms: performance.now() - started }
  }, [normalized.validos, filters, selectedCities, sort, direction])
  const filteredSorted = filterResult.rows
  const chosenInView = seleccionarCoincidentes(filteredSorted, selected)
  const selectedOutside = [...selected].filter(
    (k) => !filteredSorted.some((r) => clave(r) === k)
  ).length
  const extracted = Object.values(raw).reduce<number>(
    (n, value) =>
      n +
      ((value as { hourly?: { time?: unknown[] } })?.hourly?.time?.length ?? 0),
    0
  )
  const phases: { name: string; explanation: string; phase: Fase }[] = [
    {
      name: "Extracción",
      explanation:
        "Descarga horaria por ciudad desde Open-Meteo, con zona UTC y unidades indicadas.",
      phase: {
        estado: busyCities
          ? "en curso"
          : Object.values(cityState).includes("con errores")
            ? "con errores"
            : extracted
              ? "completada"
              : "pendiente",
        entrada: selectedCities.length,
        salida: extracted,
        ms: extractionMs,
      },
    },
    {
      name: "Transformación",
      explanation:
        "Empareja los arrays horarios y asigna nombre, fecha y mediciones a cada registro.",
      phase: {
        estado: extracted ? "completada" : "pendiente",
        entrada: extracted,
        salida: normalized.transformados.length,
        ms: normalized.transformMs,
      },
    },
    {
      name: "Limpieza",
      explanation:
        "Rechaza nulos, fechas y rangos inválidos; deduplica conservando la primera fila.",
      phase: {
        estado: extracted ? "completada" : "pendiente",
        entrada: normalized.transformados.length,
        salida: normalized.validos.length,
        ms: normalized.cleanMs,
      },
    },
    {
      name: "Filtrado y selección",
      explanation:
        "Aplica filtros, ordena y conserva la selección explícita entre páginas.",
      phase: {
        estado: extracted ? "completada" : "pendiente",
        entrada: normalized.validos.length,
        salida: filteredSorted.length,
        ms: filterResult.ms,
      },
    },
    {
      name: "Carga",
      explanation:
        "Envía lotes de hasta 500, hace upsert y comprueba las claves en el destino.",
      phase: {
        estado: uploadBusy
          ? "en curso"
          : batches.some((b) => b.estado === "Fallido")
            ? "con errores"
            : batches.length
              ? "completada"
              : "pendiente",
        entrada: chosenInView.length,
        salida: batches
          .filter((b) => b.estado === "Verificado")
          .reduce((n, b) => n + b.filas, 0),
        ms: uploadMs,
      },
    },
  ]
  const setFilter = (
    key: keyof typeof filters,
    value: string | boolean | string[]
  ) => {
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key === "ciudades" ? { usarFiltroCiudades: true } : {}),
    }))
    setPage(0)
  }

  const upload = async (retry = false) => {
    if (uploadBusy) return
    const frozen = retry ? [] : chosenInView.map((row) => ({ ...row }))
    const pending = retry
      ? batches
          .map((b, i) => (b.estado === "Fallido" ? i : -1))
          .filter((i) => i >= 0)
      : []
    const work = retry
      ? pending.map((index) => ({
          index,
          rows:
            (window as unknown as { failedBatches?: Medicion[][] })
              .failedBatches?.[index] ?? [],
        }))
      : Array.from({ length: Math.ceil(frozen.length / 500) }, (_, i) => ({
          index: i,
          rows: frozen.slice(i * 500, (i + 1) * 500),
        }))
    if (!work.some((b) => b.rows.length)) {
      setNotice(
        "No hay filas seleccionadas que coincidan con los filtros actuales."
      )
      return
    }
    setUploadBusy(true)
    setNotice("")
    const uploadStarted = performance.now()
    const run = [...batches]
    if (!retry) {
      ;(window as unknown as { failedBatches?: Medicion[][] }).failedBatches =
        work.map((b) => b.rows)
      setBatches(
        work.map((b) => ({ estado: "Pendiente", filas: b.rows.length }))
      )
    }
    for (const item of work) {
      run[item.index] = { estado: "En curso", filas: item.rows.length }
      setBatches([...run])
      try {
        const response = await fetch("/api/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: item.rows }),
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || "Error de carga")
        run[item.index] = { estado: "Verificado", filas: result.verified }
        setBatches([...run])
      } catch (e) {
        run[item.index] = {
          estado: "Fallido",
          filas: item.rows.length,
          error: e instanceof Error ? e.message : "Error de red",
        }
        setBatches([...run])
      }
    }
    setUploadMs(performance.now() - uploadStarted)
    setUploadBusy(false)
    setNotice("Proceso de carga terminado. Consulta el estado de cada lote.")
  }

  const loadStored = async (
    p = storedPage,
    sortField = storedSort,
    sortOrder = storedDirection
  ) => {
    const q = new URLSearchParams({
      page: String(p),
      sort: String(sortField),
      direction: sortOrder,
      ciudad: storedCity,
      desde: storedFrom,
      hasta: storedTo,
    })
    try {
      const res = await fetch(`/api/data?${q}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setStored(data.rows)
      setStoredTotal(data.total)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo leer Supabase")
    }
  }

  const toggle = (r: Medicion) =>
    setSelected((s) => {
      const next = new Set(s)
      const k = clave(r)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const columns: [keyof Medicion, string][] = [
    ["ciudad", "Ciudad"],
    ["fecha_hora", "Fecha y hora (UTC)"],
    ["temperatura_c", "Temperatura (°C)"],
    ["humedad_pct", "Humedad (%)"],
    ["precipitacion_mm", "Precipitación (mm)"],
  ]
  const table = (rows: Medicion[], selectable = false) => (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
          <tr>
            {selectable && (
              <th className="w-10 p-3">
                <input
                  aria-label="Seleccionar todas las filas filtradas"
                  type="checkbox"
                  checked={
                    filteredSorted.length > 0 &&
                    chosenInView.length === filteredSorted.length
                  }
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s)
                      if (e.target.checked)
                        filteredSorted.forEach((r) => n.add(clave(r)))
                      else filteredSorted.forEach((r) => n.delete(clave(r)))
                      return n
                    })
                  }
                />
              </th>
            )}
            {columns.map(([field, title]) => (
              <th key={field} className="p-3">
                <button
                  onClick={() => {
                    const nextDirection =
                      sort === field && direction === "asc" ? "desc" : "asc"
                    setDirection(nextDirection)
                    setSort(field)
                    setPage(0)
                    if (tab === "Supabase") {
                      setStoredSort(field)
                      setStoredDirection(nextDirection)
                      setStoredPage(0)
                      void loadStored(0, field, nextDirection)
                    }
                  }}
                  className="inline-flex items-center gap-1"
                >
                  {title}
                  {sort === field &&
                    (direction === "asc" ? (
                      <ArrowUpWideNarrow size={14} />
                    ) : (
                      <ArrowDownWideNarrow size={14} />
                    ))}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={clave(r)} className="hover:bg-slate-50">
              {selectable && (
                <td className="p-3">
                  <input
                    aria-label={`Seleccionar ${r.ciudad} ${r.fecha_hora}`}
                    type="checkbox"
                    checked={selected.has(clave(r))}
                    onChange={() => toggle(r)}
                  />
                </td>
              )}
              <td className="p-3 font-medium">{r.ciudad}</td>
              <td className="p-3 tabular-nums">{fechaHora(r.fecha_hora)}</td>
              <td className="p-3 tabular-nums">{r.temperatura_c}</td>
              <td className="p-3 tabular-nums">{r.humedad_pct}</td>
              <td className="p-3 tabular-nums">{r.precipitacion_mm}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={selectable ? 6 : 5}
                className="p-8 text-center text-slate-500"
              >
                No hay filas para mostrar.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  const jsonDownload = () => {
    const blob = new Blob([JSON.stringify(raw, null, 2)], {
      type: "application/json",
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "open-meteo-originales.json"
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const tabItems = [
    "original",
    "transformados",
    "válidos",
    "rechazados",
    "vista previa",
    "Supabase",
  ]

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.13),_transparent_38%),linear-gradient(180deg,#f3f8fc_0%,#f8fafc_55%,#f1f5f9_100%)] text-slate-900">
      <header className="border-b border-white/10 bg-slate-950 text-white shadow-xl shadow-slate-900/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-gradient-to-br from-cyan-300 to-sky-500 p-2.5 text-slate-950 shadow-lg shadow-cyan-500/20">
              <Cloud size={22} />
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-[.2em] text-cyan-300 uppercase">
                Aula de Big Data
              </p>
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                Laboratorio de pipeline meteorológico
              </h1>
            </div>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-slate-200 sm:flex">
            <Activity size={14} className="text-emerald-400" /> Datos reales · UTC
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-br from-white via-white to-sky-50 p-6 shadow-[0_24px_70px_-40px_rgba(2,132,199,0.35)] sm:p-8">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-cyan-200/30 blur-3xl" />
          <div className="relative max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold tracking-[.14em] text-sky-800 uppercase">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Centro de control
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Datos del tiempo, de forma clara.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Extrae observaciones horarias, revisa cada fase del proceso y carga
              en Supabase solo los registros seleccionados.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
              <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-slate-200">Open-Meteo Archive</span>
              <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-slate-200">5 ciudades</span>
              <span className="rounded-full bg-white px-3 py-1.5 shadow-sm ring-1 ring-slate-200">UTC · C · mm</span>
            </div>
          </div>
        </section>
        <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Wind className="text-sky-700" size={18} />
              <h2 className="font-semibold">1. Configuración de extracción</h2>
            </div>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
              <div>
                <p className="mb-2 text-sm text-slate-600">Ciudades</p>
                <div className="flex flex-wrap gap-2">
                  {CIUDADES.map((c) => (
                    <label
                      key={c.nombre}
                      className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-all ${selectedCities.includes(c.nombre) ? "border-sky-600 bg-sky-50 text-sky-800 shadow-sm ring-2 ring-sky-100" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50/50"}`}
                    >
                      <input
                        className="sr-only"
                        type="checkbox"
                        checked={selectedCities.includes(c.nombre)}
                        onChange={() =>
                          setSelectedCities((s) =>
                            s.includes(c.nombre)
                              ? s.filter((n) => n !== c.nombre)
                              : [...s, c.nombre]
                          )
                        }
                      />
                      {c.nombre}
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    Desde
                    <input
                      type="date"
                      className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      value={desde}
                      onChange={(e) => setDesde(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Hasta
                    <input
                      type="date"
                      className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                      value={hasta}
                      onChange={(e) => setHasta(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busyCities || !selectedCities.length}
                    onClick={() => extraction(selectedCities)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-sky-700 px-5 font-semibold text-white shadow-lg shadow-sky-900/15 transition hover:-translate-y-0.5 hover:bg-sky-800 disabled:translate-y-0 disabled:opacity-50"
                  >
                    {busyCities ? (
                      <LoaderCircle className="animate-spin" size={16} />
                    ) : (
                      <Cloud size={16} />
                    )}{" "}
                    Extraer datos
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-sky-50/70 p-5">
                <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Volumen previsto
                </p>
                <p className="mt-2 text-2xl font-bold tabular-nums">
                  {Math.max(
                    0,
                    Math.floor(
                      (new Date(`${hasta}T00:00:00Z`).getTime() -
                        new Date(`${desde}T00:00:00Z`).getTime()) /
                        86400000 +
                        1
                    )
                  ) *
                    selectedCities.length *
                    24}{" "}
                  <span className="text-sm font-normal text-slate-500">
                    registros horarios
                  </span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Máximo 31 días · 3 variables por hora · °C, %, mm · UTC
                </p>
              </div>
            </div>
            {notice && (
              <p
                role="status"
                className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
              >
                {notice}
              </p>
            )}
            {Object.keys(cityError).some((c) => cityError[c]) && (
              <div className="mt-4 space-y-2">
                {Object.entries(cityError)
                  .filter(([, e]) => e)
                  .map(([city, error]) => (
                    <div
                      key={city}
                      className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                    >
                      <span>
                        {city}: {error}
                      </span>
                      <button
                        disabled={busyCities}
                        className="font-semibold underline"
                        onClick={() => extraction([city])}
                      >
                        Reintentar ciudad
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <MapPin size={16} className="text-sky-700" />
                Mapa de ciudades
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                UbicaciÃ³n de las cinco ciudades incluidas en la extracciÃ³n.
              </p>
            </div>
            <MapaCiudades />
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">2. Estado del pipeline</h2>
            <div className="text-xs text-slate-500">
              Procesadas:{" "}
              {
                selectedCities.filter(
                  (city) =>
                    cityState[city] === "completada" ||
                    cityState[city] === "con errores"
                ).length
              }{" "}
              · Pendientes:{" "}
              {
                selectedCities.filter((city) => cityState[city] === "pendiente")
                  .length
              }
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {phases.map((p, i) => (
              <article
                key={p.name}
                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    FASE 0{i + 1}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${p.phase.estado === "completada" ? "bg-emerald-50 text-emerald-800" : p.phase.estado === "con errores" ? "bg-red-50 text-red-800" : p.phase.estado === "en curso" ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-600"}`}
                  >
                    {p.phase.estado}
                  </span>
                </div>
                <h3 className="mt-2 font-semibold">{p.name}</h3>
                <p className="mt-2 min-h-12 text-xs leading-relaxed text-slate-500">
                  {p.explanation}
                </p>
                <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-xs text-slate-600">
                  <span>
                    Entrada: <b>{p.phase.entrada}</b>
                  </span>
                  <span>
                    Salida: <b>{p.phase.salida}</b>
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Duración:{" "}
                  {!mounted || p.phase.ms === null
                    ? "medición no disponible"
                    : `${p.phase.ms.toFixed(2)} ms`}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CIUDADES.filter((c) => selectedCities.includes(c.nombre)).map(
              (c) => (
                <span
                  key={c.nombre}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  {c.nombre}: {cityState[c.nombre]}
                  {cityState[c.nombre] === "en curso" && (
                    <LoaderCircle
                      className="ml-1 inline animate-spin"
                      size={12}
                    />
                  )}
                </span>
              )
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                3. Inspección y selección de datos
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    { n: "Extraídos", v: extracted },
                    { n: "Válidos", v: normalized.validos.length },
                    { n: "Rechazados", v: normalized.rechazados.length },
                    { n: "Coinciden filtros", v: filteredSorted.length },
                    { n: "Seleccionados para cargar", v: chosenInView.length },
                  ] as const
                ).map(({ n, v }) => (
                  <div key={n} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
                    <p className="text-[11px] text-slate-500">{n}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onClick={() => {
                  setSelected(new Set())
                  setNotice("Selección vaciada.")
                }}
              >
                Vaciar selección
              </button>
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onClick={() =>
                  setFilters({
                    desde: "",
                    hasta: "",
                    minTemp: "",
                    maxTemp: "",
                    minHum: "",
                    maxHum: "",
                    minRain: "",
                    maxRain: "",
                    lluvia: false,
                    ciudades: [],
                    usarFiltroCiudades: false,
                  })
                }
              >
                Restablecer filtros
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Filtrar registros válidos
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2">
                {CIUDADES.filter((c) => selectedCities.includes(c.nombre)).map(
                  (c) => (
                    <label
                      key={c.nombre}
                      className="flex items-center gap-1 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={(filters.usarFiltroCiudades
                          ? filters.ciudades
                          : selectedCities
                        ).includes(c.nombre)}
                        onChange={(e) =>
                          setFilter(
                            "ciudades",
                            e.target.checked
                              ? [
                                  ...(filters.usarFiltroCiudades
                                    ? filters.ciudades
                                    : selectedCities),
                                  c.nombre,
                                ]
                              : (filters.usarFiltroCiudades
                                  ? filters.ciudades
                                  : selectedCities
                                ).filter((x) => x !== c.nombre)
                          )
                        }
                      />
                      {c.nombre}
                    </label>
                  )
                )}
              </div>
            </div>
            {[
              ["desde", "Desde (UTC)"],
              ["hasta", "Hasta (UTC)"],
              ["minTemp", "Temp. mín. °C"],
              ["maxTemp", "Temp. máx. °C"],
              ["minHum", "Hum. mín. %"],
              ["maxHum", "Hum. máx. %"],
              ["minRain", "Lluvia mín. mm"],
              ["maxRain", "Lluvia máx. mm"],
            ].map(([key, label]) => (
              <label key={key} className="text-xs text-slate-600">
                {label}
                <input
                  type={
                    key === "desde" || key === "hasta"
                      ? "datetime-local"
                      : "number"
                  }
                  step="any"
                  value={filters[key as keyof typeof filters] as string}
                  onChange={(e) =>
                    setFilter(key as keyof typeof filters, e.target.value)
                  }
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2"
                />
              </label>
            ))}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={filters.lluvia}
                onChange={(e) => setFilter("lluvia", e.target.checked)}
              />
              Solo registros con lluvia (precipitación &gt; 0)
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {tabItems.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setTab(t)
                    setPage(0)
                  }}
                  className={`rounded-lg px-3 py-2 text-sm capitalize ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              onClick={jsonDownload}
              disabled={!Object.keys(raw).length}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
            >
              <Download size={15} /> Descargar JSON original
            </button>
          </div>
          <div className="mt-4">
            {tab === "original" ? (
              <div className="space-y-3">
                {Object.entries(raw).map(([city, data]) => (
                  <details key={city} className="rounded-lg border p-3">
                    <summary className="cursor-pointer font-medium">
                      {city} · JSON original
                    </summary>
                    <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            ) : tab === "transformados" ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th className="p-3">Ciudad</th>
                        <th className="p-3">Fecha y hora (UTC)</th>
                        <th className="p-3">Temperatura (°C)</th>
                        <th className="p-3">Humedad (%)</th>
                        <th className="p-3">Precipitación (mm)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginas(normalized.transformados, page).map((r, i) => (
                        <tr
                          key={`${r.ciudad ?? "?"}-${r.fecha_hora ?? "?"}-${i}`}
                        >
                          <td className="p-3">{r.ciudad ?? "—"}</td>
                          <td className="p-3">
                            {r.fecha_hora ? fechaHora(r.fecha_hora) : "—"}
                          </td>
                          <td className="p-3">{r.temperatura_c ?? "null"}</td>
                          <td className="p-3">{r.humedad_pct ?? "null"}</td>
                          <td className="p-3">
                            {r.precipitacion_mm ?? "null"}
                          </td>
                        </tr>
                      ))}
                      {!normalized.transformados.length && (
                        <tr>
                          <td
                            colSpan={5}
                            className="p-8 text-center text-slate-500"
                          >
                            No hay filas transformadas.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={page}
                  total={normalized.transformados.length}
                  onPage={setPage}
                />
              </>
            ) : tab === "rechazados" ? (
              <>
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left">
                      <tr>
                        <th className="p-3">Ciudad</th>
                        <th>Fecha/hora</th>
                        <th>Registro recibido</th>
                        <th>Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {paginas(normalized.rechazados, page).map((r, i) => (
                        <tr key={i}>
                          <td className="p-3">{r.registro.ciudad ?? "—"}</td>
                          <td>{r.registro.fecha_hora ?? "—"}</td>
                          <td className="max-w-sm pr-3 font-mono text-xs break-all">
                            {JSON.stringify(r.registro)}
                          </td>
                          <td className="pr-3">{r.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!normalized.rechazados.length && (
                    <p className="p-6 text-center text-slate-500">
                      No hay registros rechazados.
                    </p>
                  )}
                </div>
                <Pager
                  page={page}
                  total={normalized.rechazados.length}
                  onPage={setPage}
                />
              </>
            ) : tab === "Supabase" ? (
              <div>
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs">
                    Ciudad
                    <select
                      value={storedCity}
                      onChange={(e) => {
                        setStoredCity(e.target.value)
                        setStoredPage(0)
                      }}
                      className="mt-1 block rounded border px-2 py-2"
                    >
                      <option value="">Todas</option>
                      {CIUDADES.map((c) => (
                        <option key={c.nombre}>{c.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs">
                    Desde
                    <input
                      type="date"
                      value={storedFrom}
                      onChange={(e) => setStoredFrom(e.target.value)}
                      className="mt-1 block rounded border px-2 py-2"
                    />
                  </label>
                  <label className="text-xs">
                    Hasta
                    <input
                      type="date"
                      value={storedTo}
                      onChange={(e) => setStoredTo(e.target.value)}
                      className="mt-1 block rounded border px-2 py-2"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setStoredPage(0)
                      loadStored(0)
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    <RefreshCw size={14} /> Actualizar destino
                  </button>
                  <span className="text-xs text-slate-500">
                    Persistidos en Supabase: {storedTotal}
                  </span>
                </div>
                {table(stored)}
                <Pager
                  page={storedPage}
                  total={storedTotal}
                  onPage={(p) => {
                    setStoredPage(p)
                    loadStored(p)
                  }}
                />
              </div>
            ) : tab === "vista previa" ? (
              <div>
                <p className="mb-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                  Se enviarán estas {chosenInView.length} filas en el orden
                  mostrado. La base de datos no conserva el orden de inserción;
                  usa ORDER BY al consultar.{" "}
                  {selectedOutside > 0 && (
                    <b>
                      {" "}
                      {selectedOutside} seleccionadas quedan fuera de los
                      filtros actuales.
                    </b>
                  )}
                </p>
                {table(paginas(chosenInView, page))}
                <Pager
                  page={page}
                  total={chosenInView.length}
                  onPage={setPage}
                />
              </div>
            ) : (
              <>
                {table(paginas(filteredSorted, page), true)}
                <Pager
                  page={page}
                  total={filteredSorted.length}
                  onPage={setPage}
                />
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Database className="text-emerald-700" size={19} />
              <div>
                <h2 className="font-semibold">
                  4. Cargar la selección en Supabase
                </h2>
                <p className="text-xs text-slate-500">
                  Los filtros actuales siempre se aplican. La selección
                  congelada no cambia durante el envío.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => upload(true)}
                disabled={
                  uploadBusy || !batches.some((b) => b.estado === "Fallido")
                }
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
              >
                Reintentar fallidos
              </button>
              <button
                onClick={() => upload()}
                disabled={uploadBusy || !chosenInView.length}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {uploadBusy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}{" "}
                Subir {chosenInView.length} registros a Supabase
              </button>
            </div>
          </div>
          {batches.length > 0 && (
            <>
              <p className="mt-4 text-sm text-slate-600" role="status">
                Procesados y verificados:{" "}
                {batches
                  .filter((b) => b.estado === "Verificado")
                  .reduce((n, b) => n + b.filas, 0)}{" "}
                · Fallidos:{" "}
                {batches
                  .filter((b) => b.estado === "Fallido")
                  .reduce((n, b) => n + b.filas, 0)}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {batches.map((b, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 text-sm ${b.estado === "Fallido" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}
                  >
                    <p className="font-semibold">
                      Lote {i + 1}: {b.estado} · {b.filas} filas
                    </p>
                    {b.error && (
                      <p className="mt-1 text-xs text-red-800">{b.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        <p className="pb-6 text-center text-xs text-slate-500">
          Flujo de desarrollo sin autenticación: protege estas rutas antes de
          publicar. Datos originales y pendientes son locales a esta sesión.
        </p>
      </div>
    </main>
  )
}

function Pager({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / 25))
  return (
    <div className="mt-3 flex items-center justify-end gap-3 text-sm">
      <span className="text-slate-500">
        Página {page + 1} de {pages} · {total} filas
      </span>
      <button
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        className="rounded border px-3 py-1.5 disabled:opacity-40"
      >
        Anterior
      </button>
      <button
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
        className="rounded border px-3 py-1.5 disabled:opacity-40"
      >
        Siguiente
      </button>
    </div>
  )
}
