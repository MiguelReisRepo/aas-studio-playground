/**
 * Parse the API's validation error strings into structured, displayable issues.
 *
 * The /v1/validate endpoint returns `errors: string[]` in a few shapes:
 *   - AASd constraint:  "AASd-119 at submodel[Nameplate]/SerialNumber: qualifier ..."
 *   - XSD schema:       "input.xml:40: Schemas validity error : Element '...': ..."
 *   - structural/other: a plain message
 * /extract returns compliance.errors[] in the same AASd shape. The console
 * turns these back into {constraint, path, line, message} so the UI can render
 * each as an explicit card instead of dumping a raw string.
 */

export type Severity = "error" | "warning"

export interface ParsedIssue {
  severity: Severity
  /** e.g. "AASd-119" when recognised. */
  constraint?: string
  /** model path, e.g. "submodel[Nameplate]/SerialNumber". */
  path?: string
  /** XSD line number, when present. */
  line?: number
  /** Human-readable message. */
  message: string
  /** The original string, for "copy raw". */
  raw: string
}

const CONSTRAINT_RE = /^(AAS[a-z]-\d+)\s+at\s+(.+?):\s*([\s\S]+)$/
const XSD_RE = /^input\.xml:(\d+):\s*(.+)$/

export function parseIssue(raw: string): ParsedIssue {
  const s = String(raw ?? "").trim()

  const c = s.match(CONSTRAINT_RE)
  if (c) {
    return { severity: "error", constraint: c[1], path: c[2], message: c[3].trim(), raw: s }
  }

  const x = s.match(XSD_RE)
  if (x) {
    // Strip the noisy "Schemas validity error :" prefix for the headline.
    const msg = x[2].replace(/^Schemas validity error\s*:\s*/i, "").trim()
    return { severity: "error", constraint: "XSD", line: Number(x[1]), message: msg, raw: s }
  }

  return { severity: "error", message: s, raw: s }
}

export function parseIssues(errors: unknown): ParsedIssue[] {
  if (!Array.isArray(errors)) return []
  return errors.map(e => parseIssue(typeof e === "string" ? e : JSON.stringify(e)))
}

/** Group issues by constraint code for a tidy, scannable list. */
export function groupByConstraint(issues: ParsedIssue[]): { key: string; items: ParsedIssue[] }[] {
  const map = new Map<string, ParsedIssue[]>()
  for (const i of issues) {
    const key = i.constraint || "Other"
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(i)
  }
  return Array.from(map.entries())
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.items.length - a.items.length)
}
