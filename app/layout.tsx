import "./globals.css"
import type { ReactNode } from "react"

export const metadata = {
  title: "AAS Studio — API Playground",
  description: "Test the AAS Studio public API end to end: drag-drop a PDF, find by name, validate, fix, export.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
