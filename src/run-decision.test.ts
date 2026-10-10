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
    publishedDocs: { overview: null, architecture: null, glossary: null },
    lessonsFile: null,
    files: [],
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

test("a usable proposal commits the changed published section and names its source", () => {
  const overview = "# What it does\n\nSends mail.\n\n# Entry points\n\nnode src/main.ts\n"
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview,
        architecture: "# Parts\n\nnone is shown\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n",
        glossary: "# Mailer\n\nSends mail.\n",
      },
      files: [{ path: "src/billing.ts", text: "export function bill() { return 1 }" }],
    }),
    {
      sections: [
        {
          doc: "overview",
          heading: "What it does",
          body: "Bills the account when an invoice is issued.",
          source: "src/billing.ts",
        },
      ],
    },
  )

  assert.equal(outcome.invokeModel, false)
  assert.equal(outcome.comment, null)
  assert.deepEqual(outcome.check, {
    name: "DocAtlas",
    state: "green",
    summary: "What it does: src/billing.ts",
  })
  assert.deepEqual(outcome.commit, {
    message: "docs: update for this pull request",
    files: [
      {
        path: "docs/overview.md",
        text: "# What it does\n\nBills the account when an invoice is issued.\n\n# Entry points\n\nnode src/main.ts\n",
      },
    ],
  })
})

test("missing published docs are created with the full outline and lessons and the override are not created", () => {
  const outcome = decideRun(
    snapshot({
      publishedDocs: { overview: null, architecture: null, glossary: null },
      lessonsFile: null,
      overrideFile: null,
      files: [{ path: "src/main.ts", text: "console.log('up')" }],
    }),
    {
      sections: [
        {
          doc: "overview",
          heading: "Entry points",
          body: "node src/main.ts",
          source: "src/main.ts",
        },
      ],
    },
  )

  assert.equal(outcome.comment, null)
  assert.equal(outcome.check.state, "green")
  assert.deepEqual(outcome.commit, {
    message: "docs: update for this pull request",
    files: [
      {
        path: "docs/overview.md",
        text: "# What it does\n\nnone is shown\n\n# Entry points\n\nnode src/main.ts\n",
      },
      {
        path: "docs/architecture.md",
        text: "# Parts\n\nnone is shown\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n",
      },
      {
        path: "docs/glossary.md",
        text: "none is shown\n",
      },
    ],
  })
})

test("subsections under Parts are added and removed only when each cites a resolved source", () => {
  const architecture = [
    "# Parts",
    "",
    "The system parts.",
    "",
    "## api",
    "",
    "The API package.",
    "",
    "# Relationships",
    "",
    "none is shown",
    "",
    "# Data",
    "",
    "none is shown",
    "",
  ].join("\n")
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture,
        glossary: "none is shown\n",
      },
      lessonsFile: "# Name the billing package\n\nThe folder is the billing package.\n",
      files: [
        { path: "src/workspace.ts", text: "export const packages = ['web', 'billing']" },
        { path: "packages/web/package.json", text: '{ "name": "web" }' },
        { path: "packages/api/package.json", text: "" },
      ],
    }),
    {
      sections: [
        {
          doc: "architecture",
          heading: "Parts",
          body: [
            "The system parts.",
            "",
            "## web",
            "",
            "The web package.",
            "",
            "## billing",
            "",
            "The billing package.",
            "",
            "## ghost",
            "",
            "Not a package.",
          ].join("\n"),
          source: "src/workspace.ts",
          subsectionSources: [
            { heading: "web", source: "packages/web/package.json" },
            { heading: "billing", source: "Name the billing package" },
            { heading: "api", source: "packages/api/package.json" },
          ],
        },
      ],
    },
  )

  assert.equal(outcome.comment, null)
  assert.deepEqual(outcome.check, {
    name: "DocAtlas",
    state: "green",
    summary: [
      "web: packages/web/package.json",
      "billing: Name the billing package",
      "api: packages/api/package.json",
    ].join("\n"),
  })
  assert.deepEqual(outcome.commit, {
    message: "docs: update for this pull request",
    files: [
      {
        path: "docs/architecture.md",
        text: [
          "# Parts",
          "",
          "The system parts.",
          "",
          "## web",
          "",
          "The web package.",
          "",
          "## billing",
          "",
          "The billing package.",
          "",
          "# Relationships",
          "",
          "none is shown",
          "",
          "# Data",
          "",
          "none is shown",
          "",
        ].join("\n"),
      },
    ],
  })
})

test("a resolved section source replaces an existing subsection body as a whole", () => {
  const architecture = [
    "# Parts",
    "",
    "The system parts.",
    "",
    "## api",
    "",
    "First sentence. Second sentence.",
    "",
    "# Relationships",
    "",
    "none is shown",
    "",
    "# Data",
    "",
    "none is shown",
    "",
  ].join("\n")
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture,
        glossary: "none is shown\n",
      },
      files: [{ path: "src/api.ts", text: "export function api() {}" }],
    }),
    {
      sections: [
        {
          doc: "architecture",
          heading: "Parts",
          body: ["Bills through the API.", "", "## api", "", "The API package."].join("\n"),
          source: "src/api.ts",
        },
      ],
    },
  )

  assert.deepEqual(outcome.check, {
    name: "DocAtlas",
    state: "green",
    summary: ["Parts: src/api.ts", "api: src/api.ts"].join("\n"),
  })
  assert.equal(outcome.comment, null)
  assert.equal(
    outcome.commit?.files[0].text,
    [
      "# Parts",
      "",
      "Bills through the API.",
      "",
      "## api",
      "",
      "The API package.",
      "",
      "# Relationships",
      "",
      "none is shown",
      "",
      "# Data",
      "",
      "none is shown",
      "",
    ].join("\n"),
  )
})

test("clearing a section that still has an unsourced subsection leaves that section untouched", () => {
  const architecture = [
    "# Parts",
    "",
    "The system parts.",
    "",
    "## api",
    "",
    "The API package.",
    "",
    "# Relationships",
    "",
    "none is shown",
    "",
    "# Data",
    "",
    "none is shown",
    "",
  ].join("\n")
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture,
        glossary: "none is shown\n",
      },
      files: [{ path: "src/api.ts", text: "export function api() {}" }],
    }),
    {
      sections: [
        {
          doc: "architecture",
          heading: "Parts",
          body: "",
          source: "src/api.ts",
        },
      ],
    },
  )

  assert.deepEqual(outcome, skipped)
})

test("a subsection left without a source stays in place", () => {
  const architecture = [
    "# Parts",
    "",
    "The system parts.",
    "",
    "## api",
    "",
    "The API package.",
    "",
    "## web",
    "",
    "The web package.",
    "",
    "# Relationships",
    "",
    "none is shown",
    "",
    "# Data",
    "",
    "none is shown",
    "",
  ].join("\n")
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture,
        glossary: "none is shown\n",
      },
      files: [
        { path: "src/workspace.ts", text: "export const packages = ['api', 'web', 'billing']" },
        { path: "packages/billing/package.json", text: '{ "name": "billing" }' },
      ],
    }),
    {
      sections: [
        {
          doc: "architecture",
          heading: "Parts",
          body: [
            "The system parts.",
            "",
            "## web",
            "",
            "The web package.",
            "",
            "## billing",
            "",
            "The billing package.",
          ].join("\n"),
          source: "src/workspace.ts",
          subsectionSources: [{ heading: "billing", source: "packages/billing/package.json" }],
        },
      ],
    },
  )

  assert.deepEqual(outcome.check, {
    name: "DocAtlas",
    state: "green",
    summary: "billing: packages/billing/package.json",
  })
  assert.equal(
    outcome.commit?.files[0].text,
    [
      "# Parts",
      "",
      "The system parts.",
      "",
      "## api",
      "",
      "The API package.",
      "",
      "## web",
      "",
      "The web package.",
      "",
      "## billing",
      "",
      "The billing package.",
      "",
      "# Relationships",
      "",
      "none is shown",
      "",
      "# Data",
      "",
      "none is shown",
      "",
    ].join("\n"),
  )
})

test("each glossary term is its own heading", () => {
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture: "# Parts\n\nnone is shown\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n",
        glossary: null,
      },
      lessonsFile: "# Call the ledger an account\n\nSay account, not customer segment.\n",
      files: [{ path: "src/invoice.ts", text: "export class Invoice {}" }],
    }),
    {
      sections: [
        {
          doc: "glossary",
          heading: "Invoice",
          body: "A bill for an account.",
          source: "src/invoice.ts",
        },
        {
          doc: "glossary",
          heading: "Account",
          body: "The ledger name for a customer. A lesson also calls this customer an account.",
          source: "Call the ledger an account",
        },
      ],
    },
  )

  assert.deepEqual(outcome.commit?.files, [
    {
      path: "docs/glossary.md",
      text: [
        "# Invoice",
        "",
        "A bill for an account.",
        "",
        "# Account",
        "",
        "The ledger name for a customer. A lesson also calls this customer an account.",
        "",
      ].join("\n"),
    },
  ])
})

test("top-level headings stay when a proposal renames one and leaves another out", () => {
  const overview = "# What it does\n\nSends mail.\n\n# Entry points\n\nnode src/main.ts\n"
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview,
        architecture: "# Parts\n\nnone is shown\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n",
        glossary: "none is shown\n",
      },
      files: [{ path: "src/billing.ts", text: "export function bill() {}" }],
    }),
    {
      sections: [
        {
          doc: "overview",
          heading: "Purpose",
          body: "A renamed section.",
          source: "src/billing.ts",
        },
        {
          doc: "overview",
          heading: "What it does",
          body: "Bills the account when an invoice is issued.",
          source: "src/billing.ts",
        },
      ],
    },
  )

  assert.equal(
    outcome.commit?.files[0].text,
    "# What it does\n\nBills the account when an invoice is issued.\n\n# Entry points\n\nnode src/main.ts\n",
  )
})

test("a top-level section with nothing to say states that none is shown", () => {
  const architecture = [
    "# Parts",
    "",
    "The system parts.",
    "",
    "# Relationships",
    "",
    "The services call each other.",
    "",
    "# Data",
    "",
    "The store is a ledger.",
    "",
  ].join("\n")
  const outcome = decideRun(
    snapshot({
      publishedDocs: {
        overview: "# What it does\n\nnone is shown\n\n# Entry points\n\nnone is shown\n",
        architecture,
        glossary: "none is shown\n",
      },
      files: [{ path: "src/billing.ts", text: "export function bill() {}" }],
    }),
    {
      sections: [
        {
          doc: "architecture",
          heading: "Relationships",
          body: "   ",
          source: "src/billing.ts",
        },
      ],
    },
  )

  assert.equal(
    outcome.commit?.files[0].text,
    [
      "# Parts",
      "",
      "The system parts.",
      "",
      "# Relationships",
      "",
      "none is shown",
      "",
      "# Data",
      "",
      "The store is a ledger.",
      "",
    ].join("\n"),
  )
})

test("a refactor proposal that changes no section stays green and commits nothing", () => {
  const publishedDocs = {
    overview: "# What it does\n\nSends mail.\n\n# Entry points\n\nnode src/main.ts\n",
    architecture: "# Parts\n\nnone is shown\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n",
    glossary: "# Mailer\n\nSends mail.\n",
  }
  const repeated = decideRun(snapshot({ publishedDocs, files: [{ path: "src/app.ts", text: "export {}" }] }), {
    sections: [
      {
        doc: "overview",
        heading: "What it does",
        body: "Sends mail.",
        source: "src/app.ts",
      },
    ],
  })
  const empty = decideRun(snapshot({ publishedDocs }), { sections: [] })

  assert.deepEqual(repeated, skipped)
  assert.deepEqual(empty, skipped)
})

test("a draft pull request with a usable proposal does not commit", () => {
  const outcome = decideRun(
    snapshot({
      draft: true,
      publishedDocs: {
        overview: "# What it does\n\nSends mail.\n\n# Entry points\n\nnone is shown\n",
        architecture: null,
        glossary: null,
      },
      files: [{ path: "src/billing.ts", text: "export function bill() {}" }],
    }),
    {
      sections: [
        {
          doc: "overview",
          heading: "What it does",
          body: "Bills the account.",
          source: "src/billing.ts",
        },
      ],
    },
  )

  assert.deepEqual(outcome, skipped)
})

test("the commit writes published docs at the override paths and leaves an unchanged doc out", () => {
  const architecture = "# Parts\n\nThe system parts.\n\n# Relationships\n\nnone is shown\n\n# Data\n\nnone is shown\n"
  const outcome = decideRun(
    snapshot({
      overrideFile: ["overview: README.md", "architecture: design/architecture.md", "glossary: design/glossary.md"].join(
        "\n",
      ),
      publishedDocs: { overview: null, architecture, glossary: null },
      files: [{ path: "src/main.ts", text: "console.log('up')" }],
    }),
    {
      sections: [
        {
          doc: "overview",
          heading: "Entry points",
          body: "node src/main.ts",
          source: "src/main.ts",
        },
      ],
    },
  )

  assert.deepEqual(
    outcome.commit?.files.map((file) => file.path),
    ["README.md", "design/glossary.md"],
  )
  assert.equal(
    outcome.commit?.files[0].text,
    "# What it does\n\nnone is shown\n\n# Entry points\n\nnode src/main.ts\n",
  )
  assert.equal(outcome.commit?.files[1].text, "none is shown\n")
})

test("an override-file change still wakes when ignore would skip that path", () => {
  const overrideFile = "ignore:\n  - .docatlas.yml\n  - \"**\"\n"
  assert.deepEqual(decideRun(snapshot({ changedPaths: [".docatlas.yml"], overrideFile })), woken)
  assert.deepEqual(decideRun(snapshot({ changedPaths: ["src/app.ts"], overrideFile })), skipped)
})
