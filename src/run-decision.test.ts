import assert from "node:assert/strict"
import { test } from "node:test"
import { decideRun, type PullRequestSnapshot } from "./run-decision.ts"

function snapshot(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
  return {
    draft: false,
    headInSameRepository: true,
    baseBranch: "main",
    changedPaths: ["src/app.ts"],
    newCommitMessages: ["add feature"],
    overrideFile: null,
    ...overrides,
  }
}

const skipped = {
  invokeModel: false,
  check: {
    name: "DocAtlas",
    state: "green",
    summary: "No doc update was required.",
  },
  commit: null,
  comment: null,
}

const woken = {
  invokeModel: true,
  check: {
    name: "DocAtlas",
    state: "pending",
    summary: "",
  },
  commit: null,
  comment: null,
}

test("a draft pull request does not invoke the model and stays green", () => {
  assert.deepEqual(decideRun(snapshot({ draft: true })), skipped)
})

test("a pull request from a fork does not invoke the model and stays green", () => {
  assert.deepEqual(decideRun(snapshot({ headInSameRepository: false })), skipped)
})

test("a pull request aimed at another branch does not invoke the model and stays green", () => {
  assert.deepEqual(decideRun(snapshot({ baseBranch: "develop" })), skipped)
})

test("a ready pull request that changes source asks the host to invoke the model", () => {
  assert.deepEqual(decideRun(snapshot()), woken)
})

test("a lockfile-only change skips the model and stays green", () => {
  for (const changedPath of [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "Gemfile.lock",
    "poetry.lock",
    "Pipfile.lock",
    "uv.lock",
    "composer.lock",
    "pdm.lock",
    "go.sum",
    "packages/web/Cargo.lock",
    "ios/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  ]) {
    assert.deepEqual(decideRun(snapshot({ changedPaths: [changedPath] })), skipped, changedPath)
  }
})

test("a test-only change skips the model and stays green", () => {
  for (const changedPath of [
    "src/test/app.ts",
    "src/tests/app.ts",
    "src/__tests__/app.ts",
    "src/app_test.py",
    "src/app.test.ts",
    "src/app.spec.tsx",
  ]) {
    assert.deepEqual(decideRun(snapshot({ changedPaths: [changedPath] })), skipped, changedPath)
  }
})

test("a GitHub or Cursor metadata change skips the model and stays green", () => {
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: [".github/workflows/ci.yml", ".cursor/rules/docs.mdc"] })),
    skipped,
  )
})

test("vendored code, dependency trees, and build output skip the model and stay green", () => {
  for (const changedPath of [
    "vendor/lib.js",
    "packages/web/node_modules/leftpad/index.js",
    "dist/app.js",
    "build/app.js",
    "out/app.js",
  ]) {
    assert.deepEqual(decideRun(snapshot({ changedPaths: [changedPath] })), skipped, changedPath)
  }
})

test("an image, font, or archive-only change skips the model and stays green", () => {
  for (const changedPath of [
    "assets/screenshot.png",
    "assets/logo.jpg",
    "assets/logo.jpeg",
    "assets/anim.gif",
    "assets/icon.webp",
    "assets/mark.svg",
    "fonts/inter.ttf",
    "fonts/inter.otf",
    "fonts/inter.woff",
    "fonts/inter.woff2",
    "assets/bundle.zip",
    "assets/src.tar.gz",
    "assets/src.tgz",
    "assets/src.7z",
  ]) {
    assert.deepEqual(decideRun(snapshot({ changedPaths: [changedPath] })), skipped, changedPath)
  }
})

test("an edit that only touches the published docs skips the model and stays green", () => {
  assert.deepEqual(
    decideRun(
      snapshot({
        changedPaths: ["docs/overview.md", "docs/architecture.md", "docs/glossary.md"],
      }),
    ),
    skipped,
  )
})

test("a source path inside a directory named like build output still wakes a run", () => {
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/build/notes.ts"] })), woken)
})

test("one source path among denylisted paths still wakes a run", () => {
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["package-lock.json", "src/app.ts"] })),
    woken,
  )
})

test("a change to the lessons file asks the host to invoke the model", () => {
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/lessons.md"] })), woken)
})

test("a change to the override file asks the host to invoke the model", () => {
  assert.deepEqual(decideRun(snapshot({ changedPaths: [".docatlas.yml"] })), woken)
})

test("DocAtlas's own doc commit does not invoke the model again", () => {
  assert.deepEqual(
    decideRun(
      snapshot({
        changedPaths: ["src/app.ts", "docs/overview.md"],
        newCommitMessages: ["docs: update for this pull request"],
      }),
    ),
    skipped,
  )
})

test("a code commit beside a doc commit still wakes a run", () => {
  assert.deepEqual(
    decideRun(
      snapshot({
        changedPaths: ["src/app.ts"],
        newCommitMessages: ["docs: update for this pull request", "rename the entry point"],
      }),
    ),
    woken,
  )
})

test("with no override file the watched branch stays main", () => {
  assert.deepEqual(decideRun(snapshot({ baseBranch: "main" })), woken)
  assert.deepEqual(decideRun(snapshot({ baseBranch: "develop" })), skipped)
})

test("the override file can change the watched branch", () => {
  const overrideFile = 'branch: "develop"\n'
  assert.deepEqual(decideRun(snapshot({ baseBranch: "develop", overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ baseBranch: "main", overrideFile })), skipped)
})

test("the override file can move the published docs and the lessons file", () => {
  const overrideFile = [
    "overview: README.md",
    "architecture: design/architecture.md",
    "glossary: design/glossary.md",
    "lessons: notes/lessons.md",
    "ignore:",
    "  - docs/**",
    "  - notes/**",
    "  - README.md",
  ].join("\n")

  assert.deepEqual(decideRun(snapshot({ changedPaths: ["README.md"], overrideFile })), skipped)
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["design/architecture.md"], overrideFile })),
    skipped,
  )
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["design/glossary.md"], overrideFile })),
    skipped,
  )
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/overview.md"], overrideFile })), skipped)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["notes/lessons.md"], overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/lessons.md"], overrideFile })), skipped)
})

test("an omitted override key keeps its default", () => {
  const overrideFile = "branch: develop\n"
  assert.deepEqual(
    decideRun(snapshot({ baseBranch: "develop", changedPaths: ["docs/overview.md"], overrideFile })),
    skipped,
  )
  assert.deepEqual(
    decideRun(snapshot({ baseBranch: "develop", changedPaths: ["docs/lessons.md"], overrideFile })),
    woken,
  )
})

test("an unrecognized override key leaves the defaults alone", () => {
  const overrideFile = "theme: dark\n"
  assert.deepEqual(decideRun(snapshot({ overrideFile })), woken)
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["docs/overview.md"], overrideFile })),
    skipped,
  )
})

test("a single ignore or include pattern is applied", () => {
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["tools/generate.ts"], overrideFile: "ignore: tools/**\n" })),
    skipped,
  )
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["src/app.test.ts"], overrideFile: "include: src/app.test.ts\n" })),
    woken,
  )
})

test("ignore adds denylist patterns", () => {
  const overrideFile = "ignore:\n  - tools/**\n"
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["tools/generate.ts"], overrideFile })), skipped)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/app.ts"], overrideFile })), woken)
})

test("include wakes a denylisted path", () => {
  const overrideFile = "include:\n  - src/app.test.ts\n  - vendor/public/**\n  - docs/overview.md\n"
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/app.test.ts"], overrideFile })), woken)
  assert.deepEqual(
    decideRun(snapshot({ changedPaths: ["vendor/public/api.ts"], overrideFile })),
    woken,
  )
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/overview.md"], overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/other.test.ts"], overrideFile })), skipped)
})

test("a lessons change still wakes when ignore would skip that path", () => {
  const overrideFile = "ignore:\n  - docs/**\n"
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/lessons.md"], overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["docs/notes.md"], overrideFile })), skipped)
})

test("an override-file change still wakes when ignore would skip that path", () => {
  const overrideFile = "ignore:\n  - .docatlas.yml\n  - \"**\"\n"
  assert.deepEqual(decideRun(snapshot({ changedPaths: [".docatlas.yml"], overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/app.ts"], overrideFile })), skipped)
})
