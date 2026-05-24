import { NextRequest } from "next/server"

/**
 * Guarded URL fetcher: pulls a datasheet PDF found via /search-datasheets so the
 * console can hand it to /extract. The browser can't fetch a third-party CDN
 * directly (CORS), so this proxies it.
 *
 * Because this app is meant to be shared/deployed, the fetch is guarded against
 * the obvious SSRF / open-proxy abuse: http(s) only, no loopback/private hosts,
 * and a size cap. It is NOT a general-purpose proxy.
 */

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_BYTES = 30 * 1024 * 1024 // 30 MB

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  return (
    h === "localhost" || h === "0.0.0.0" || h === "::1" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local") || h.endsWith(".internal")
  )
}

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("url") || ""
  let u: URL
  try { u = new URL(raw) } catch { return Response.json({ error: "invalid_url" }, { status: 400 }) }
  if (u.protocol !== "http:" && u.protocol !== "https:") return Response.json({ error: "protocol_not_allowed" }, { status: 400 })
  if (isBlockedHost(u.hostname)) return Response.json({ error: "host_blocked" }, { status: 403 })

  let upstream: Response
  try {
    upstream = await fetch(u.toString(), { redirect: "follow", headers: { "user-agent": "aas-studio-playground" } })
  } catch (e) {
    return Response.json({ error: "fetch_failed", message: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
  if (!upstream.ok) return Response.json({ error: "upstream_status", status: upstream.status }, { status: 502 })

  const len = Number(upstream.headers.get("content-length") || "0")
  if (len && len > MAX_BYTES) return Response.json({ error: "too_large", bytes: len }, { status: 413 })

  const buf = await upstream.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: "too_large", bytes: buf.byteLength }, { status: 413 })

  return new Response(buf, {
    status: 200,
    headers: { "content-type": upstream.headers.get("content-type") || "application/pdf" },
  })
}
