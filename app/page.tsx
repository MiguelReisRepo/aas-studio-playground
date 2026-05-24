"use client"

import { useEffect, useRef, useState } from "react"
import { getKey, setKey, extract, searchDatasheets, validate, fix, exportAas, fetchDatasheet, PUBLIC_API_BASE, type ApiResult } from "@/lib/api"
import { parseIssues, groupByConstraint, type ParsedIssue } from "@/lib/validation"

const SAMPLE_SUBMODELS = JSON.stringify(
  [{ idShort: "Nameplate", id: "urn:demo:Nameplate", submodelElements: [{ idShort: "ManufacturerName", modelType: "MultiLanguageProperty", value: { en: "QA GmbH" } }] }],
  null, 2,
)

/** Turn an export ApiResult (xml text or .aasx blob) into a browser download. */
function downloadResult(res: ApiResult, name: string, format: "xml" | "aasx"): boolean {
  const blob = res.blob || (res.text ? new Blob([res.text], { type: "application/xml" }) : null)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = res.filename || `${name}.${format === "aasx" ? "aasx" : "xml"}`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
  return true
}

/** Map an /extract result's submodels to the /export request shape. */
function extractionToExportBody(rr: any): Record<string, unknown> {
  const submodels = (rr?.submodels || []).map((sm: any) => ({
    idShort: sm.idShort,
    id: sm.id || `${rr.assetId || "urn:extracted"}:${sm.idShort}`,
    semanticId: sm.semanticId,
    submodelElements: sm.elements || sm.submodelElements || [],
  }))
  return { submodels, idShort: rr?.assetIdShort, id: rr?.assetId, assetKind: rr?.assetKind, globalAssetId: rr?.assetId }
}

export default function Playground() {
  const [keyInput, setKeyInput] = useState("")
  const [savedKey, setSavedKey] = useState("")
  useEffect(() => { const k = getKey(); setSavedKey(k); setKeyInput(k) }, [])

  return (
    <div className="wrap">
      <header className="top">
        <h1>AAS Studio · API Playground</h1>
        <span className={`pill ${savedKey ? "ok" : "bad"}`}>{savedKey ? "key set" : "no key"}</span>
      </header>
      <div className="sub">
        Exercise the public API the way a real integration does. Calls go through a same-origin proxy to{" "}
        <code>{PUBLIC_API_BASE}</code>. Paste your Bearer key once.
      </div>

      <div className="card">
        <h2>API key</h2>
        <div className="hint">Stored only in your browser (localStorage), sent per-call to the proxy which forwards it as a Bearer token.</div>
        <div className="row">
          <input className="mono input" type="password" placeholder="aas_live_…" value={keyInput} onChange={e => setKeyInput(e.target.value)} style={{ maxWidth: 420 }} />
          <button onClick={() => { setKey(keyInput.trim()); setSavedKey(keyInput.trim()) }}>Save key</button>
        </div>
      </div>

      <ExtractCard />
      <FindByNameCard />
      <ValidateFixCard />
      <ExportCard />
    </div>
  )
}

/* ─────────────── Validation results (the centerpiece) ─────────────── */
function ValidationResults({ valid, issues, gate }: { valid: boolean; issues: ParsedIssue[]; gate?: string }) {
  const [q, setQ] = useState("")
  const filtered = q ? issues.filter(i => (i.message + (i.constraint || "") + (i.path || "")).toLowerCase().includes(q.toLowerCase())) : issues
  const groups = groupByConstraint(filtered)
  return (
    <div>
      <div className={`verdict ${valid ? "ok" : "bad"}`}>
        {valid ? "✓ Valid" : `✗ ${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        {gate && <span style={{ fontWeight: 400, fontSize: 12, opacity: .8 }}>· {gate}</span>}
      </div>
      {issues.length > 0 && (
        <>
          {issues.length > 4 && (
            <div className="filter">
              <input type="text" placeholder="filter issues…" value={q} onChange={e => setQ(e.target.value)} />
              <span className="path">{filtered.length}/{issues.length}</span>
            </div>
          )}
          {groups.map(g => (
            <div key={g.key}>
              <div className="group-h">{g.key} · {g.items.length}</div>
              {g.items.map((i, idx) => (
                <div key={idx} className={`issue ${i.severity === "warning" ? "warn" : ""}`} title={i.raw}>
                  <div className="dot" />
                  <div>
                    <div className="msg">{i.message}</div>
                    <div className="meta">
                      {i.constraint && <span className={`badge ${i.constraint === "XSD" ? "xsd" : ""}`}>{i.constraint}</span>}
                      {i.path && <span className="path mono">{i.path}</span>}
                      {i.line != null && <span className="path mono">line {i.line}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Inspector({ r }: { r: ApiResult | null }) {
  if (!r) return null
  const body = r.json !== undefined ? JSON.stringify(r.json, null, 2) : (r.text ?? (r.blob ? `«binary ${r.blob.size} bytes»` : ""))
  return (
    <details>
      <summary>request / response · {r.status || "ERR"} · {r.ms}ms</summary>
      <div className="kv">
        <span>status <b className={r.ok ? "" : "mono"} style={{ color: r.ok ? "var(--ok)" : "var(--bad)" }}>{r.status}</b></span>
        <span>time <b>{r.ms}ms</b></span>
        {r.error && <span style={{ color: "var(--bad)" }}>{r.error}</span>}
      </div>
      <div className="group-h">curl (against the real API)</div>
      <pre className="code">{r.curl}</pre>
      {body && (<><div className="group-h">response</div><pre className="code">{body.slice(0, 20000)}</pre></>)}
    </details>
  )
}

/* ─────────────── Extract (drag-drop) ─────────────── */
function ExtractCard() {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<ApiResult | null>(null)
  const [thumbUrl, setThumbUrl] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  async function go(file: File) {
    setBusy(true); setR(null)
    setR(await extract(file, { thumbnailUrl: thumbUrl.trim() || undefined }))
    setBusy(false)
  }

  const [exp, setExp] = useState<"" | "xml" | "aasx">("")
  const [expErr, setExpErr] = useState<ApiResult | null>(null)
  const result = r?.json as any
  const compliance = result?.compliance
  const issues = compliance ? parseIssues(compliance.errors) : []

  async function downloadAs(format: "xml" | "aasx") {
    if (!result?.result) return
    setExp(format); setExpErr(null)
    const res = await exportAas(extractionToExportBody(result.result), format)
    setExp("")
    if (res.status >= 400 || (!res.blob && !res.text)) { setExpErr(res); return }
    downloadResult(res, result.result.assetIdShort || "aas", format)
  }

  return (
    <div className="card">
      <h2>1 · Extract from a datasheet {busy && <span className="spin" />}</h2>
      <div className="hint">POST /extract — drag-drop a product PDF, get a draft AAS + a compliance verdict.</div>
      <div
        className={`drop ${over ? "over" : ""}`}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) go(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <strong>Drop a PDF here</strong> or click to choose
        <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) go(f) }} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Thumbnail URL (optional) — embedded into the AAS</label>
        <input type="text" placeholder="https://…/product.jpg" value={thumbUrl} onChange={e => setThumbUrl(e.target.value)} />
      </div>

      {result?.result && (
        <>
          <div className="kv" style={{ marginTop: 14 }}>
            <span>asset <b className="mono">{result.result.assetIdShort || "—"}</b></span>
            <span>submodels <b>{(result.result.submodels || []).map((s: any) => s.idShort).join(", ") || "—"}</b></span>
            {result.domain && <span>domain <b>{result.domain}</b></span>}
          </div>
          {/* knowledge layers that fired — proof the API runs the full pipeline */}
          <div className="kv">
            {result.domain && <span className="pill ok">knowledge pack</span>}
            {result.vendorTemplateId && <span className="pill ok">vendor: {result.vendorTemplateId}</span>}
            {typeof result.derivedFieldsCount === "number" && result.derivedFieldsCount > 0 && <span className="pill ok">derived ×{result.derivedFieldsCount}</span>}
            {typeof result.epdFieldsFilled === "number" && result.epdFieldsFilled > 0 && <span className="pill ok">EPD ×{result.epdFieldsFilled}</span>}
            {typeof result.visionMarkersFilled === "number" && result.visionMarkersFilled > 0 && <span className="pill ok">vision ×{result.visionMarkersFilled}</span>}
          </div>
          {result.thumbnailDataUrl && (
            <div style={{ marginTop: 10 }}>
              <div className="group-h">embedded thumbnail</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.thumbnailDataUrl} alt="thumbnail" style={{ maxHeight: 120, borderRadius: 8, border: "1px solid var(--line)" }} />
            </div>
          )}
          {!result.thumbnailDataUrl && result.thumbnailFetchReason && (
            <div className="path" style={{ marginTop: 8 }}>thumbnail not embedded: {result.thumbnailFetchReason}</div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={() => downloadAs("aasx")} disabled={!!exp}>{exp === "aasx" ? "Packaging…" : "↓ Download .aasx"}</button>
            <button className="ghost" onClick={() => downloadAs("xml")} disabled={!!exp}>{exp === "xml" ? "Serializing…" : "↓ Download XML"}</button>
            {exp && <span className="spin" />}
          </div>
          {expErr && <ErrorNote r={expErr} />}
        </>
      )}
      {compliance && <ValidationResults valid={!!compliance.valid} issues={issues} gate={compliance.validation} />}
      {r && !compliance && r.status !== 200 && <ErrorNote r={r} />}
      <Inspector r={r} />
    </div>
  )
}

/* ─────────────── Find by name ─────────────── */
function FindByNameCard() {
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<ApiResult | null>(null)
  const [chain, setChain] = useState<{ i: number; step: string } | null>(null)
  const [chainErr, setChainErr] = useState<string | null>(null)
  async function go() { if (!q.trim()) return; setBusy(true); setR(await searchDatasheets(q.trim())); setBusy(false) }
  const hits = (r?.json as any)?.results || (r?.json as any)?.hits || []

  // hit URL → fetch PDF (guarded proxy) → /extract → /export .aasx → download.
  // The public API has no URL→AAS path, so the console chains it.
  async function toAasx(url: string, i: number) {
    setChainErr(null); setChain({ i, step: "fetching PDF…" })
    const file = await fetchDatasheet(url)
    if (!file) { setChain(null); setChainErr("Couldn't fetch that PDF (blocked host, CORS, or too large)."); return }
    setChain({ i, step: "extracting…" })
    const ex = await extract(file)
    const rr = (ex.json as any)?.result
    if (!rr) { setChain(null); setChainErr((ex.json as any)?.message || (ex.json as any)?.error || `Extraction failed (HTTP ${ex.status})`); return }
    setChain({ i, step: "packaging .aasx…" })
    const res = await exportAas(extractionToExportBody(rr), "aasx")
    setChain(null)
    if (res.status >= 400 || (!res.blob && !res.text)) { setChainErr("Export failed."); return }
    downloadResult(res, rr.assetIdShort || "aas", "aasx")
  }
  return (
    <div className="card">
      <h2>2 · Find by name {busy && <span className="spin" />}</h2>
      <div className="hint">POST /search-datasheets — web search for datasheet URLs. Use a real product name with spaces (e.g. "LG OLED65G5"), not a compacted idShort like "LGOLEDevoG54KTV" — a mangled query returns low-relevance results.</div>
      <div className="row">
        <input type="text" placeholder='e.g. "LG OLED65G54LW"' value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} style={{ maxWidth: 420 }} />
        <button onClick={go} disabled={busy}>Search</button>
      </div>
      {Array.isArray(hits) && hits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {hits.slice(0, 8).map((h: any, i: number) => {
            const url = h.url || h.link
            return (
              <div className="hit" key={i}>
                <div><b>{h.title || h.name || h.authority || "result"}</b> {h.authority && <span className="path">· {h.authority}</span>}</div>
                {url && <a href={url} target="_blank" rel="noreferrer">{url}</a>}
                {url && (
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} disabled={!!chain} onClick={() => toAasx(url, i)}>
                      {chain?.i === i ? chain.step : "Extract → .aasx"}
                    </button>
                    {chain?.i === i && <span className="spin" />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {chainErr && <div className="verdict bad" style={{ marginTop: 10 }}>✗ {chainErr}</div>}
      {r && r.status !== 200 && <ErrorNote r={r} />}
      <Inspector r={r} />
    </div>
  )
}

/* ─────────────── Validate / Fix ─────────────── */
function ValidateFixCard() {
  const [xml, setXml] = useState("")
  const [busy, setBusy] = useState<"" | "validate" | "fix">("")
  const [r, setR] = useState<ApiResult | null>(null)
  const [fixed, setFixed] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [loadNote, setLoadNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function doValidate() { if (!xml.trim()) return; setBusy("validate"); setFixed(null); setR(await validate(xml)); setBusy("") }
  async function doFix() { if (!xml.trim()) return; setBusy("fix"); const res = await fix(xml); setR(res); const fx = (res.json as any)?.xml; if (fx) setFixed(fx); setBusy("") }

  // Load a dropped/picked .xml | .json | .aasx into the editor. .aasx is a ZIP,
  // so we unzip it client-side and pull out the AAS XML part.
  async function loadFile(file: File) {
    setLoadNote(null); setR(null); setFixed(null)
    const name = file.name.toLowerCase()
    try {
      if (name.endsWith(".aasx")) {
        const JSZip = (await import("jszip")).default
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const xmlEntry = Object.keys(zip.files).find(n => n.toLowerCase().endsWith(".xml") && !n.toLowerCase().includes("_rels") && !n.toLowerCase().includes("content_types"))
        if (!xmlEntry) { setLoadNote("No AAS XML part found inside the .aasx package."); return }
        setXml(await zip.files[xmlEntry].async("string"))
        setLoadNote(`Loaded ${xmlEntry} from the .aasx package.`)
      } else {
        const text = await file.text()
        setXml(text)
        if (name.endsWith(".json")) setLoadNote("Loaded JSON. Note: the /validate gate is XSD (XML) — convert/export to XML first, or expect an XML-parse error.")
        else setLoadNote(`Loaded ${file.name}.`)
      }
    } catch (e) {
      setLoadNote(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const v = r?.json as any
  const isValidate = v && typeof v.valid === "boolean"
  const issues = isValidate ? parseIssues(v.errors) : []

  return (
    <div className="card">
      <h2>3 · Validate / Fix {busy && <span className="spin" />}</h2>
      <div className="hint">POST /validate (XSD 3.1 + AASd-* gate) and POST /fix (deterministic XML repair). Drop a file or paste AAS XML.</div>
      <div
        className={`drop ${over ? "over" : ""}`}
        style={{ padding: 18, marginBottom: 12 }}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) loadFile(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <strong>Drop a .aasx / .xml / .json</strong> or click to choose
        <input ref={fileRef} type="file" accept=".aasx,.xml,.json,application/xml,text/xml,application/json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f) }} />
      </div>
      {loadNote && <div className="path" style={{ marginBottom: 8 }}>{loadNote}</div>}
      <label>AAS XML</label>
      <textarea className="mono" placeholder="<environment xmlns=&quot;https://admin-shell.io/aas/3/1&quot;> …" value={xml} onChange={e => setXml(e.target.value)} />
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={doValidate} disabled={!!busy || !xml.trim()}>Validate</button>
        <button className="ghost" onClick={doFix} disabled={!!busy || !xml.trim()}>Auto-fix</button>
      </div>
      {isValidate && <ValidationResults valid={!!v.valid} issues={issues} gate={v.validation} />}
      {fixed && (
        <div style={{ marginTop: 12 }}>
          <div className="group-h">fixed XML <button className="ghost" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => { setXml(fixed); setFixed(null) }}>use it ↑</button></div>
          <pre className="code">{fixed.slice(0, 20000)}</pre>
        </div>
      )}
      {r && r.status >= 400 && <ErrorNote r={r} />}
      <Inspector r={r} />
    </div>
  )
}

/* ─────────────── Export ─────────────── */
function ExportCard() {
  const [submodels, setSubmodels] = useState(SAMPLE_SUBMODELS)
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<ApiResult | null>(null)

  async function go(format: "xml" | "aasx") {
    let parsed: unknown
    try { parsed = JSON.parse(submodels) } catch { alert("submodels must be valid JSON"); return }
    setBusy(true)
    const res = await exportAas({ submodels: parsed as Record<string, unknown>[], idShort: "Demo", id: "urn:demo", assetKind: "Instance" }, format)
    setR(res); setBusy(false)
    if (res.blob || (res.text && format === "xml")) {
      const blob = res.blob || new Blob([res.text!], { type: "application/xml" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a")
      a.href = url; a.download = res.filename || `Demo.${format === "aasx" ? "aasx" : "xml"}`; a.click(); URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="card">
      <h2>4 · Export {busy && <span className="spin" />}</h2>
      <div className="hint">POST /export — serialize a submodels array to AAS 3.1 XML or a .aasx package (downloads).</div>
      <label>submodels (JSON)</label>
      <textarea className="mono" value={submodels} onChange={e => setSubmodels(e.target.value)} />
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => go("xml")} disabled={busy}>Export XML</button>
        <button className="ghost" onClick={() => go("aasx")} disabled={busy}>Export .aasx</button>
      </div>
      {r?.text && <pre className="code">{r.text.slice(0, 20000)}</pre>}
      {r && r.status >= 400 && <ErrorNote r={r} />}
      <Inspector r={r} />
    </div>
  )
}

function ErrorNote({ r }: { r: ApiResult }) {
  const j = r.json as any
  const msg = j?.message || j?.error || r.error || `HTTP ${r.status}`
  const hint = r.status === 401 ? " — check your API key above" : r.status === 0 ? " — proxy/network unreachable" : ""
  return <div className="verdict bad" style={{ marginTop: 12 }}>✗ {String(msg)}{hint}</div>
}
