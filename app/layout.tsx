import { Geist_Mono, Inter } from "next/font/google"
import type { Metadata } from "next"

import "@maptiler/sdk/dist/maptiler-sdk.css"
import "./globals.css"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: "Laboratorio ETL meteorológico",
  description: "Práctica didáctica de Big Data con Open-Meteo y Supabase",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>{children}</body>
    </html>
  )
}
