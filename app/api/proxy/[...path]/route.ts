import { NextRequest } from "next/server"

/**
 * Thin pass-through proxy to the AAS Studio public API.
 *
 * The browser console calls THIS origin (/api/proxy/<endpoint>), and we forward
 * to the real API with the user's Bearer key attached. This sidesteps CORS
 * entirely (same-origin from the browser's POV) and keeps the integration
 * contract identical to what a real client would call directly.
 *
 * The key travels console -> proxy via the `x-aas-key` header; it is only ever
 * attached server-side here, never exposed cross-origin.
 *
 * Configure the upstream with AAS_API_BASE (defaults to production).
 */

export const runtime = "nodejs"
// Extraction (with the knowledge pack + vision pass) can take up to ~3 min
// upstream; the proxy must outlast it, or a deployed playground 504s while
// the real API is still working. (No effect on `next dev`, which is unbounded.)
export const maxDuration = 300

const API_BASE = (process.env.AAS_API_BASE || "https://aas-studio.vercel.app/api/v1").replace(/\/$/, "")

async function forward(req: NextRequest, ctx: { params: { path?: string[] } }) {
  const { path } = ctx.params
  const key = req.headers.get("x-aas-key") || ""
  const search = new URL(req.url).search
  const target = `${API_BASE}/${(path || []).join("/")}${search}`

  const headers: Record<string, string> = {}
  if (key) headers["authorization"] = `Bearer ${key}`
  const ct = req.headers.get("content-type")
  if (ct) headers["content-type"] = ct

  const init: RequestInit = { method: req.method, headers }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(target, init)
  } catch (e) {
    return Response.json(
      { error: "proxy_unreachable", message: `Could not reach ${target}: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // Pass the body + status straight back. Carry content-type +
  // content-disposition (so .aasx downloads keep their filename).
  const buf = await upstream.arrayBuffer()
  const out = new Headers()
  out.set("content-type", upstream.headers.get("content-type") || "application/json")
  const cd = upstream.headers.get("content-disposition")
  if (cd) out.set("content-disposition", cd)
  return new Response(buf, { status: upstream.status, headers: out })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
