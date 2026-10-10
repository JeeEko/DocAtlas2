import { parse } from "yaml"

export type DocRole = "overview" | "architecture" | "glossary"

export type SnapshotFile = {
  path: string
  text: string
}

export type PullRequestSnapshot = {
  draft: boolean
  headInSameRepository: boolean
  baseBranch: string
  changedPaths: readonly string[]
  newCommitMessages: readonly string[]
  overrideFile: string | null
  publishedDocs: {
    overview: string | null
    architecture: string | null
    glossary: string | null
  }
  lessonsFile: string | null
  files: readonly SnapshotFile[]
}

export type SectionProposal = {
  doc: DocRole
  heading: string
  body: string
  source: string
  subsectionSources?: readonly { heading: string; source: string }[]
}

export type ModelProposal = {
  sections: readonly SectionProposal[]
}

export type RunOutcome = {
  invokeModel: boolean
  check: {
    name: "DocAtlas"
    state: "green" | "pending"
    summary: string
  }
  commit: {
    message: "docs: update for this pull request"
    files: readonly { path: string; text: string }[]
  } | null
  comment: null
}

const skipped: RunOutcome = {
  invokeModel: false,
  check: {
    name: "DocAtlas",
    state: "green",
    summary: "No doc update was required.",
  },
  commit: null,
  comment: null,
}

const woken: RunOutcome = {
  invokeModel: true,
  check: {
    name: "DocAtlas",
    state: "pending",
    summary: "",
  },
  commit: null,
  comment: null,
}

const DOC_COMMIT_MESSAGE = "docs: update for this pull request"
const OVERRIDE_PATH = ".docatlas.yml"

type Config = {
  branch: string
  publishedDocs: readonly [string, string, string]
  lessons: string
  ignore: readonly string[]
  include: readonly string[]
}

const defaults: Config = {
  branch: "main",
  publishedDocs: ["docs/overview.md", "docs/architecture.md", "docs/glossary.md"],
  lessons: "docs/lessons.md",
  ignore: [],
  include: [],
}

const DENY_GLOBS = [
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*_test.*",
  "**/*.test.*",
  "**/*.spec.*",
  ".github/**",
  ".cursor/**",
  "vendor/**",
  "**/node_modules/**",
  "dist/**",
  "build/**",
  "out/**",
]

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  "uv.lock",
  "composer.lock",
  "pdm.lock",
  "go.sum",
  "packages.lock.json",
  "Package.resolved",
  "Podfile.lock",
  "mix.lock",
  "pubspec.lock",
  "flake.lock",
  "deno.lock",
  "pixi.lock",
  "gradle.lockfile",
])

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "avif",
  "svg",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "xz",
])

export function decideRun(snapshot: PullRequestSnapshot, proposal: ModelProposal | null = null): RunOutcome {
  const config = readConfig(snapshot.overrideFile)
  const eligible =
    !snapshot.draft && snapshot.headInSameRepository && snapshot.baseBranch === config.branch
  if (!eligible) return skipped
  if (isOwnDocCommit(snapshot.newCommitMessages)) return skipped
  if (!snapshot.changedPaths.some((path) => wakes(normalizePath(path), config))) return skipped
  if (proposal === null) return woken
  return publishProposal(snapshot, proposal, config)
}

function readConfig(overrideFile: string | null): Config {
  if (overrideFile === null || overrideFile.trim() === "") return defaults
  let parsed: unknown
  try {
    parsed = parse(overrideFile)
  } catch {
    return defaults
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return defaults
  const record = parsed as Record<string, unknown>
  const [overview, architecture, glossary] = defaults.publishedDocs
  return {
    branch: stringOr(record.branch, defaults.branch),
    publishedDocs: [
      stringOr(record.overview, overview),
      stringOr(record.architecture, architecture),
      stringOr(record.glossary, glossary),
    ],
    lessons: stringOr(record.lessons, defaults.lessons),
    ignore: stringListOr(record.ignore, defaults.ignore),
    include: stringListOr(record.include, defaults.include),
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function stringListOr(value: unknown, fallback: readonly string[]): readonly string[] {
  if (typeof value === "string" && value.length > 0) return [value]
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === "string")
}

function isOwnDocCommit(messages: readonly string[]): boolean {
  return messages.length > 0 && messages.every((message) => message === DOC_COMMIT_MESSAGE)
}

function wakes(path: string, config: Config): boolean {
  if (path === OVERRIDE_PATH || path === config.lessons) return true
  if (anyPatternMatches(config.include, path)) return true
  return !isDenied(path, config)
}

function isDenied(path: string, config: Config): boolean {
  if (config.publishedDocs.includes(path)) return true
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (LOCKFILES.has(base)) return true
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : ""
  if (BINARY_EXTENSIONS.has(extension)) return true
  if (anyPatternMatches(DENY_GLOBS, path)) return true
  return anyPatternMatches(config.ignore, path)
}

function anyPatternMatches(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => pathMatches(pattern, path))
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "")
}

function pathMatches(pattern: string, filePath: string): boolean {
  let glob = pattern.replaceAll("\\", "/")
  if (!glob.includes("/")) glob = `**/${glob}`
  return matchSegments(glob.split("/"), filePath.split("/"), 0, 0)
}

function matchSegments(pattern: string[], path: string[], patternIndex: number, pathIndex: number): boolean {
  if (patternIndex === pattern.length) return pathIndex === path.length
  if (pattern[patternIndex] === "**") {
    for (let next = pathIndex; next <= path.length; next++) {
      if (matchSegments(pattern, path, patternIndex + 1, next)) return true
    }
    return false
  }
  if (pathIndex >= path.length) return false
  if (!segmentMatches(pattern[patternIndex], path[pathIndex])) return false
  return matchSegments(pattern, path, patternIndex + 1, pathIndex + 1)
}

function segmentMatches(pattern: string, segment: string): boolean {
  const expression = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")
  return new RegExp(`^${expression}$`).test(segment)
}

const OUTLINE: Record<Exclude<DocRole, "glossary">, readonly string[]> = {
  overview: ["What it does", "Entry points"],
  architecture: ["Parts", "Relationships", "Data"],
}

const DOC_ROLES: readonly DocRole[] = ["overview", "architecture", "glossary"]

type ChangeNote = { heading: string; source: string }

function publishProposal(snapshot: PullRequestSnapshot, proposal: ModelProposal, config: Config): RunOutcome {
  const drafted = DOC_ROLES.map((role) => renderDoc(role, snapshot, proposal))
  const notes = drafted.flatMap((doc) => doc.notes)
  if (notes.length === 0) return skipped
  const files = drafted.flatMap((doc, index) => {
    const original = snapshot.publishedDocs[doc.role]
    if (original !== null && doc.text === original) return []
    return [{ path: config.publishedDocs[index], text: doc.text }]
  })
  return {
    invokeModel: false,
    check: {
      name: "DocAtlas",
      state: "green",
      summary: notes.map((note) => `${note.heading}: ${note.source}`).join("\n"),
    },
    commit: { message: DOC_COMMIT_MESSAGE, files },
    comment: null,
  }
}

function renderDoc(
  role: DocRole,
  snapshot: PullRequestSnapshot,
  proposal: ModelProposal,
): { role: DocRole; text: string; notes: ChangeNote[] } {
  const original = snapshot.publishedDocs[role]
  let text = original ?? blankDoc(role)
  const notes: ChangeNote[] = []
  for (const update of orderedSections(role, text, proposal.sections)) {
    if (!headingAllowed(role, update.heading)) continue
    if (!sourceResolves(update.source, snapshot)) continue
    const proposed = sanitizeBody(update.body)
    const current = sectionBody(text, update.heading)
    const merged = mergeSection(current, proposed, update.subsectionSources, update.source, snapshot)
    if (merged === null || (current !== null && current.trim() === merged.body)) continue
    const next = writeSection(text, update.heading, merged.body, role)
    if (next === text) continue
    text = next
    if (current === null || proseOf(current) !== proseOf(merged.body)) {
      notes.push({ heading: update.heading, source: update.source })
    }
    notes.push(...merged.notes)
  }
  return { role, text, notes }
}

function orderedSections(role: DocRole, text: string, sections: readonly SectionProposal[]): readonly SectionProposal[] {
  const own = sections.filter((section) => section.doc === role)
  if (role === "glossary") {
    const existing = levelOneHeadings(text)
    const known = new Set(existing)
    const kept = existing.flatMap((heading) => own.filter((section) => section.heading === heading))
    const added = own.filter((section) => !known.has(section.heading))
    return [...kept, ...added]
  }
  return OUTLINE[role].flatMap((heading) => own.filter((section) => section.heading === heading))
}

function headingAllowed(role: DocRole, heading: string): boolean {
  if (role === "glossary") return heading.trim().length > 0
  return OUTLINE[role].includes(heading)
}

function blankDoc(role: DocRole): string {
  if (role === "glossary") return "none is shown\n"
  return OUTLINE[role].map((heading) => `# ${heading}\n\nnone is shown\n`).join("\n")
}

function sourceResolves(source: string, snapshot: PullRequestSnapshot): boolean {
  const wanted = normalizePath(source)
  if (snapshot.files.some((file) => normalizePath(file.path) === wanted)) return true
  return lessonHeadingCount(snapshot.lessonsFile, source.trim()) === 1
}

function lessonHeadingCount(lessonsFile: string | null, heading: string): number {
  if (lessonsFile === null) return 0
  let count = 0
  for (const line of lessonsFile.split("\n")) {
    if (headingLevel(line) !== null && headingText(line) === heading) count += 1
  }
  return count
}

function sanitizeBody(body: string): string {
  const withoutDocHeadings = body
    .split("\n")
    .filter((line) => headingLevel(line) !== 1)
    .join("\n")
    .trim()
  return withoutDocHeadings === "" ? "none is shown" : withoutDocHeadings
}

type Subsection = { heading: string; level: number; body: string }

function mergeSection(
  current: string | null,
  proposed: string,
  sources: readonly { heading: string; source: string }[] | undefined,
  sectionSource: string,
  snapshot: PullRequestSnapshot,
): { body: string; notes: ChangeNote[] } | null {
  const currentParts = splitBody(current ?? "")
  const proposedParts = splitBody(proposed)
  const clearing =
    proposedParts.subs.length === 0 &&
    (proposedParts.prose === "" || proposedParts.prose === "none is shown")
  if (clearing && currentParts.subs.some((sub) => !subsectionSource(sub.heading, sources, snapshot))) {
    return null
  }
  const currentByHeading = new Map(currentParts.subs.map((sub) => [sub.heading, sub]))
  const proposedByHeading = new Map(proposedParts.subs.map((sub) => [sub.heading, sub]))
  const changed = new Map<string, string>()
  const kept: Subsection[] = []

  for (const sub of currentParts.subs) {
    const next = proposedByHeading.get(sub.heading)
    if (!next) {
      const source = subsectionSource(sub.heading, sources, snapshot)
      if (source) changed.set(sub.heading, source)
      else kept.push(sub)
      continue
    }
    if (next.body === sub.body) {
      kept.push(sub)
      continue
    }
    kept.push(next)
    changed.set(sub.heading, subsectionSource(sub.heading, sources, snapshot) ?? sectionSource)
  }

  const added: Subsection[] = []
  for (const sub of proposedParts.subs) {
    if (currentByHeading.has(sub.heading)) continue
    const source = subsectionSource(sub.heading, sources, snapshot)
    if (!source) continue
    changed.set(sub.heading, source)
    added.push(sub)
  }

  const ordered = [...kept]
  for (const sub of added) {
    const proposedIndex = proposedParts.subs.findIndex((item) => item.heading === sub.heading)
    const anchor = proposedParts.subs
      .slice(proposedIndex + 1)
      .find((item) => ordered.some((keptSub) => keptSub.heading === item.heading))
    if (!anchor) {
      ordered.push(sub)
      continue
    }
    ordered.splice(
      ordered.findIndex((keptSub) => keptSub.heading === anchor.heading),
      0,
      sub,
    )
  }

  const notes: ChangeNote[] = []
  const emitted = new Set<string>()
  for (const citation of sources ?? []) {
    const source = changed.get(citation.heading)
    if (!source || emitted.has(citation.heading)) continue
    notes.push({ heading: citation.heading, source })
    emitted.add(citation.heading)
  }
  for (const sub of [...currentParts.subs, ...proposedParts.subs]) {
    if (emitted.has(sub.heading)) continue
    const source = changed.get(sub.heading)
    if (!source) continue
    notes.push({ heading: sub.heading, source })
    emitted.add(sub.heading)
  }
  return { body: joinBody(proposedParts.prose, ordered), notes }
}

function subsectionSource(
  heading: string,
  sources: readonly { heading: string; source: string }[] | undefined,
  snapshot: PullRequestSnapshot,
): string | null {
  const cited = sources?.find((item) => item.heading === heading)
  if (!cited || !sourceResolves(cited.source, snapshot)) return null
  return cited.source
}

function splitBody(body: string): { prose: string; subs: Subsection[] } {
  const lines = body.split("\n")
  let level: number | null = null
  for (const line of lines) {
    const found = headingLevel(line)
    if (found !== null && found > 1 && (level === null || found < level)) level = found
  }
  if (level === null) return { prose: body.trim(), subs: [] }
  const subs: Subsection[] = []
  const proseLines: string[] = []
  let current: { heading: string; level: number; lines: string[] } | null = null
  for (const line of lines) {
    if (headingLevel(line) === level) {
      if (current) subs.push(finishSubsection(current))
      current = { heading: headingText(line), level, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else proseLines.push(line)
  }
  if (current) subs.push(finishSubsection(current))
  return { prose: proseLines.join("\n").trim(), subs }
}

function finishSubsection(current: { heading: string; level: number; lines: string[] }): Subsection {
  return { heading: current.heading, level: current.level, body: current.lines.join("\n").trim() }
}

function joinBody(prose: string, subs: readonly Subsection[]): string {
  const blocks = subs.map((sub) => `${"#".repeat(sub.level)} ${sub.heading}\n\n${sub.body}`)
  const lead = prose === "none is shown" && subs.length > 0 ? "" : prose
  const parts = lead === "" ? blocks : [lead, ...blocks]
  const text = parts.join("\n\n").trim()
  return text === "" ? "none is shown" : text
}

function proseOf(body: string): string {
  return splitBody(body).prose
}

function writeSection(markdown: string, heading: string, body: string, role: DocRole): string {
  if (role === "glossary" && isEmptyGlossary(markdown)) return `# ${heading}\n\n${body}\n`
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => headingLevel(line) === 1 && headingText(line) === heading)
  const middle = [`# ${heading}`, "", ...body.split("\n")]
  if (start === -1) return appendSection(markdown, middle)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingLevel(lines[index]) === 1) {
      end = index
      break
    }
  }
  const before = lines.slice(0, start)
  const after = lines.slice(end)
  const combined = [...before, ...middle]
  if (after.length > 0 && after[0] !== "" && combined.at(-1) !== "") combined.push("")
  combined.push(...after)
  return ensureTrailingNewline(combined.join("\n"))
}

function isEmptyGlossary(markdown: string): boolean {
  const trimmed = markdown.trim()
  return trimmed === "" || trimmed === "none is shown"
}

function appendSection(markdown: string, middle: string[]): string {
  if (markdown.trim() === "") return ensureTrailingNewline(middle.join("\n"))
  const base = markdown.endsWith("\n") ? markdown.slice(0, -1) : markdown
  return ensureTrailingNewline([...base.split("\n"), "", ...middle].join("\n"))
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`
}

function sectionBody(markdown: string, heading: string): string | null {
  const lines = markdown.split("\n")
  const start = lines.findIndex((line) => headingLevel(line) === 1 && headingText(line) === heading)
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingLevel(lines[index]) === 1) {
      end = index
      break
    }
  }
  let body = lines.slice(start + 1, end)
  if (body.at(-1) === "") body = body.slice(0, -1)
  return body.join("\n").trim()
}

function levelOneHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => headingLevel(line) === 1)
    .map((line) => headingText(line))
}

function headingLevel(line: string): number | null {
  const match = /^(#{1,6})[ \t]+(.*)$/.exec(line)
  return match ? match[1].length : null
}

function headingText(line: string): string {
  const match = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line)
  return match ? match[2] : ""
}
