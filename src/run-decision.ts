import { parse } from "yaml"

export type PullRequestSnapshot = {
  draft: boolean
  headInSameRepository: boolean
  baseBranch: string
  changedPaths: readonly string[]
  newCommitMessages: readonly string[]
  overrideFile: string | null
}

export type RunOutcome = {
  invokeModel: boolean
  check: {
    name: "DocAtlas"
    state: "green" | "pending"
    summary: string
  }
  commit: null
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

export function decideRun(snapshot: PullRequestSnapshot): RunOutcome {
  const config = readConfig(snapshot.overrideFile)
  const eligible =
    !snapshot.draft && snapshot.headInSameRepository && snapshot.baseBranch === config.branch
  if (!eligible) return skipped
  if (isOwnDocCommit(snapshot.newCommitMessages)) return skipped
  if (snapshot.changedPaths.some((path) => wakes(normalizePath(path), config))) return woken
  return skipped
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
