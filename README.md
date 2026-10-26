# Pipeline meteorológico ETL

Aplicación didáctica en Next.js para extraer datos horarios históricos de Open-Meteo, transformarlos y limpiarlos, filtrar y seleccionar registros, y cargarlos en Supabase.

## Instalación y ejecución

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Configura `SUPABASE_URL` y una clave secreta `SUPABASE_SECRET_KEY` en `.env.local`. También se admite la variable antigua `SUPABASE_SERVICE_ROLE_KEY`. No uses una publishable key para escritura. La clave secreta se consume únicamente en Route Handlers del servidor. Aplica `supabase/migrations/20261026000000_mediciones_meteorologicas.sql` en Supabase antes de usar las pestañas de carga y consulta.

## Fases y reglas

1. **Extracción:** Open-Meteo Archive API por ciudad, máximo 31 días; UTC, °C y mm.
2. **Transformación:** ensambla los arrays horarios paralelos en filas normalizadas.
3. **Limpieza:** comprueba fechas y mediciones finitas, humedad de 0 a 100 %, precipitación no negativa; rechaza nulos y valores inválidos. Deduplica ciudad y hora conservando la primera aparición.
4. **Filtrado y selección:** filtros y ordenación preceden a la paginación; la selección persiste entre páginas. Una carga envía solo filas seleccionadas que aún coinciden con los filtros y congela el conjunto y el orden al comenzar.
5. **Carga:** lotes de hasta 500 filas con upsert, claves únicas y verificación posterior. Un upsert no distingue insertados de actualizados; por eso el informe cuenta filas procesadas y verificadas, no inventa esas categorías. PostgreSQL no garantiza orden de inserción: las consultas requieren `ORDER BY`.

La pestaña Supabase consulta los datos persistidos; los registros locales se guardan en memoria durante la sesión y se distinguen de los persistidos. Los originales se descargan como JSON.

## Seguridad

Este proyecto no tiene autenticación: el flujo sirve para desarrollo local. Las rutas de extracción, escritura y lectura requieren autenticación y autorización antes de publicar la aplicación. RLS se mantiene activo y no se crean políticas públicas; `anon` y `authenticated` no reciben permisos en esta tabla. No se deben registrar credenciales.

## Verificación

Con Node.js 22.6 o posterior, ejecuta `npm.cmd run test:etl`, `npm.cmd run typecheck`, `npm.cmd run lint` y `npm.cmd run build`. La prueba controlada usa fixtures separados de las extracciones reales para nulos, duplicados, arrays incoherentes, extremos, filtros, orden y selección entre páginas. La integración con Supabase requiere credenciales de servidor y la migración aplicada. Sin esas condiciones no se debe considerar verificada la persistencia.
