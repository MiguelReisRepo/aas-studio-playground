/**
 * Browser-side client for the AAS Studio API, via the same-origin proxy.
 *
 * Every call goes to /api/proxy/<endpoint>; the proxy attaches the Bearer key
 * (sent here as the `x-aas-key` header) and forwards to the real API. Each call
 * also returns a copy-pasteable `curl` that targets the REAL public base, so
 * the console doubles as living integration docs.
 */

export const PUBLIC_API_BASE = "https://aas-studio.vercel.app/api/v1"

export interface ApiResult {
  ok: boolean
  status: number
  ms: number
  contentType: string
  json?: unknown
  text?: string
  blob?: Blob
  /** Suggested filename from content-disposition (for .aasx). */
  filename?: string
  /** A curl that reproduces the call against the real API. */
  curl: string
  error?: string
}

const KEY_STORAGE = "aas-playground-key"
export const getKey = () => (typeof window === "undefined" ? "" : localStorage.getItem(KEY_STORAGE) || "")
export const setKey = (k: string) => localStorage.setItem(KEY_STORAGE, k)

function curlFor(endpoint: string, method: string, opts: { json?: unknown; file?: boolean; form?: Record<string, string> }): string {
  const url = `${PUBLIC_API_BASE}/${endpoint}`
  const lines = [`curl -X ${method} '${url}'`, `  -H 'Authorization: Bearer YOUR_KEY'`]
  if (opts.json !== undefined) {
    lines.push(`  -H 'Content-Type: application/json'`)
    lines.push(`  -d '${JSON.stringify(opts.json)}'`)
  } else if (opts.file) {
    lines.push(`  -F 'file=@your-datasheet.pdf'`)
    if (opts.form) for (const [k, v] of Object.entries(opts.form)) lines.push(`  -F '${k}=${v}'`)
  }
  return lines.join(" \\\n")
}

async function run(
  endpoint: string,
  method: string,
  init: RequestInit,
  curl: string,
): Promise<ApiResult> {
  const key = getKey()
  const t0 = performance.now()
  const headers = new Headers(init.headers)
  headers.set("x-aas-key", key)
  let res: Response
  try {
    res = await fetch(`/api/proxy/${endpoint}`, { ...init, method, headers })
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), contentType: "", curl, error: e instanceof Error ? e.message : String(e) }
  }
  const ms = Math.round(performance.now() - t0)
  const contentType = res.headers.get("content-type") || ""
  const cd = res.headers.get("content-disposition") || ""
  const filename = /filename="?([^"]+)"?/.exec(cd)?.[1]
  const base: ApiResult = { ok: res.ok, status: res.status, ms, contentType, curl, filename }

  if (contentType.includes("application/json")) {
    base.json = await res.json().catch(() => undefined)
  } else if (contentType.includes("xml") || contentType.includes("text")) {
    base.text = await res.text().catch(() => undefined)
  } else {
    base.blob = await res.blob().catch(() => undefined)
  }
  return base
}

export function extract(file: File, opts?: { idPrefix?: string; llmKey?: string; thumbnailUrl?: string }): Promise<ApiResult> {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("idPrefix", opts?.idPrefix || "urn:extracted")
  if (opts?.llmKey) fd.append("apiKey", opts.llmKey)
  if (opts?.thumbnailUrl) fd.append("thumbnailUrl", opts.thumbnailUrl)
  const form: Record<string, string> = { idPrefix: opts?.idPrefix || "urn:extracted" }
  if (opts?.thumbnailUrl) form.thumbnailUrl = opts.thumbnailUrl
  return run("extract", "POST", { body: fd }, curlFor("extract", "POST", { file: true, form }))
}

export function searchDatasheets(query: string): Promise<ApiResult> {
  const body = { query }
  return run("search-datasheets", "POST", jsonInit(body), curlFor("search-datasheets", "POST", { json: body }))
}

export function validate(xml: string): Promise<ApiResult> {
  const body = { xml }
  return run("validate", "POST", jsonInit(body), curlFor("validate", "POST", { json: { xml: "<environment …/>" } }))
}

export function fix(xml: string): Promise<ApiResult> {
  const body = { xml }
  return run("fix", "POST", jsonInit(body), curlFor("fix", "POST", { json: { xml: "<environment …/>" } }))
}

export function exportAas(model: Record<string, unknown>, format: "xml" | "aasx"): Promise<ApiResult> {
  const body = { ...model, format }
  return run(`export${format === "aasx" ? "?format=aasx" : ""}`, "POST", jsonInit(body), curlFor("export", "POST", { json: { submodels: ["…"], format } }))
}

export function health(): Promise<ApiResult> {
  return run("health", "GET", {}, curlFor("health", "GET", {}))
}

export type MergeSource = { sourceId: string; authority: "manufacturer" | "distributor" | "third-party"; result: unknown }

/** Multi-source consensus merge of N already-extracted results. */
export function merge(sources: MergeSource[]): Promise<ApiResult> {
  const body = { sources }
  return run("merge", "POST", jsonInit(body), curlFor("merge", "POST", { json: { sources: [{ sourceId: "src-1", authority: "manufacturer", result: "{…ExtractionResult…}" }] } }))
}

export function listExtractions(): Promise<ApiResult> {
  return run("extractions", "GET", {}, curlFor("extractions", "GET", {}))
}
export function replayExtraction(id: string): Promise<ApiResult> {
  return run(`extractions/${encodeURIComponent(id)}/replay`, "POST", jsonInit({}), curlFor(`extractions/${id}/replay`, "POST", { json: {} }))
}
export function verifySource(id: string): Promise<ApiResult> {
  return run(`extractions/${encodeURIComponent(id)}/verify-source`, "GET", {}, curlFor(`extractions/${id}/verify-source`, "GET", {}))
}
export function runtimePoll(aid: unknown): Promise<ApiResult> {
  return run("runtime/poll", "POST", jsonInit({ aid }), curlFor("runtime/poll", "POST", { json: { aid: "{…AID (IDTA-02017) submodel…}" } }))
}
export function listWebhooks(): Promise<ApiResult> {
  return run("webhooks", "GET", {}, curlFor("webhooks", "GET", {}))
}
export function registerWebhook(url: string, events: string[]): Promise<ApiResult> {
  return run("webhooks", "POST", jsonInit({ url, events }), curlFor("webhooks", "POST", { json: { url, events } }))
}

/** Fetch a datasheet PDF (found via search) through the guarded fetch proxy, as
 *  a File ready to hand to extract(). Returns null on failure. */
export async function fetchDatasheet(url: string): Promise<File | null> {
  try {
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const blob = await res.blob()
    const base = (url.split("/").pop() || "datasheet").split("?")[0] || "datasheet"
    return new File([blob], base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`, { type: "application/pdf" })
  } catch {
    return null
  }
}

function jsonInit(body: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}
