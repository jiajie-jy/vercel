"use client"

import { useEffect, useRef, useState } from "react"

const CIUDADES = [
  { nombre: "Barcelona", lat: 41.3874, lon: 2.1686 },
  { nombre: "Madrid", lat: 40.4168, lon: -3.7038 },
  { nombre: "Sevilla", lat: 37.3891, lon: -5.9845 },
  { nombre: "Bilbao", lat: 43.263, lon: -2.935 },
  { nombre: "Valencia", lat: 39.4699, lon: -0.3763 },
]

export default function MapaCiudades() {
  const contenedor = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(() =>
    process.env.NEXT_PUBLIC_MAPTILER_KEY
      ? ""
      : "Configura NEXT_PUBLIC_MAPTILER_KEY para mostrar el mapa."
  )

  useEffect(() => {
    let cancelado = false
    let mapa: { remove: () => void } | undefined
    const apiKey = process.env.NEXT_PUBLIC_MAPTILER_KEY

    if (!apiKey) return

    void import("@maptiler/sdk")
      .then((sdk) => {
        if (cancelado || !contenedor.current) return

        mapa = new sdk.Map({
          container: contenedor.current,
          apiKey,
          style: "streets-v4",
          center: [-3.7, 40.2],
          zoom: 4.8,
          navigationControl: "top-right",
        })

        CIUDADES.forEach((ciudad) => {
          new sdk.Marker({ color: "#0369a1" })
            .setLngLat([ciudad.lon, ciudad.lat])
            .setPopup(new sdk.Popup().setText(ciudad.nombre))
            .addTo(mapa as InstanceType<typeof sdk.Map>)
        })
      })
      .catch(() => {
        if (!cancelado) setError("No se pudo cargar el mapa de MapTiler.")
      })

    return () => {
      cancelado = true
      mapa?.remove()
    }
  }, [])

  return (
    <div className="relative">
      <div
        ref={contenedor}
        aria-label="Mapa de España con las ciudades meteorológicas"
        className="h-[420px] w-full overflow-hidden rounded-xl"
      />
      {error && (
        <p role="status" className="p-4 text-sm text-amber-800">
          {error}
        </p>
      )}
    </div>
  )
}
