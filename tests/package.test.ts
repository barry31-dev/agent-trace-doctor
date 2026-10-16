import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./helpers.js";

interface PackageJson {
  name: string;
  version: string;
  description: string;
  files?: string[];
  bin?: Record<string, string>;
  private?: boolean;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
) as PackageJson;

const IMPLEMENTED_COMMANDS = [
  "validate",
  "summary",
  "timeline",
  "show",
  "tools",
  "errors",
  "diff",
  "compare",
  "explain",
  "eval-gen",
  "fix-suggest",
];

/** Every TypeScript source under src/, relative to the project root. */
function sourceFiles(directory: string): string[] {
  const entries = readdirSync(join(projectRoot, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files.sort();
}

/**
 * Package an import specifier resolves to. A scoped name keeps both of its leading
 * segments and a deep path such as `ajv/dist/2020.js` keeps only the first, so the
 * declared name is the one npm installs.
 */
function packageRoot(specifier: string): string {
  const segments = specifier.split("/");
  const leading = specifier.startsWith("@") ? 2 : 1;
  return segments.slice(0, leading).join("/");
}

/**
 * Version labels of the released entries in CHANGELOG.md, in file order. `Unreleased`
 * is not a version, so it is not one of them.
 */
function changelogVersions(): string[] {
  const text = readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8");
  const versions: string[] = [];
  for (const match of text.matchAll(/^## \[([^\]]+)\]/gm)) {
    const label = match[1];
    if (label === undefined || label === "Unreleased") {
      continue;
    }
    versions.push(label);
  }
  return versions;
}

/**
 * Bare import specifiers used by src/: neither relative (the project's own modules)
 * nor builtin (`node:`). Only statement-initial `import` / `export` keywords are
 * matched, so a comment quoting the word `from` is not read as a dependency.
 */
function runtimeImports(): string[] {
  const specifiers = new Set<string>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(join(projectRoot, file), "utf8");
    const patterns = [
      /^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gm,
      /^\s*import\s+"([^"]+)"/gm,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }
        if (!specifier.startsWith(".") && !specifier.startsWith("node:")) {
          specifiers.add(specifier);
        }
      }
    }
  }
  return [...specifiers].sort();
}

describe("package manifest", () => {
  it("declares every runtime import of src/ as a dependency, not a dev dependency", () => {
    // A consumer install skips devDependencies, so a runtime import declared there
    // is a CLI that crashes on its first schema compile after being installed.
    const imports = runtimeImports();
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      const root = packageRoot(specifier);
      expect(Object.keys(packageJson.dependencies)).toContain(root);
      expect(Object.keys(packageJson.devDependencies)).not.toContain(root);
    }
  });

  it("pins the packed surface to the compiled CLI, its entry script and the bundled schema", () => {
    expect(packageJson.files).toEqual(["dist/src", "bin/trace", "schemas", "CHANGELOG.md"]);
  });

  it("lists only packed paths that exist in the repository, apart from the build output", () => {
    for (const entry of packageJson.files ?? []) {
      if (entry.startsWith("dist")) {
        continue; // produced by `npm run build`, absent from a fresh checkout
      }
      expect(existsSync(join(projectRoot, entry))).toBe(true);
    }
  });

  it("keeps the bundled schema inside the packed surface", () => {
    // src/schema.ts walks up from the compiled module until it finds
    // schemas/trace.schema.json, so an installed copy needs that directory
    // beside dist/src/ or every command fails to build its validator.
    expect(packageJson.files).toContain("schemas");
    expect(statSync(join(projectRoot, "schemas", "trace.schema.json")).isFile()).toBe(true);
  });

  it("names every implemented command in the description, model half included", () => {
    for (const command of IMPLEMENTED_COMMANDS) {
      expect(packageJson.description).toContain(command);
    }
    expect(packageJson.description).toContain(
      "compare, explain, eval-gen and fix-suggest with an optional model",
    );
  });

  it("ships the decided command name as its bin entry", () => {
    // `trace` was the design drafts' placeholder and is not the name: it is a
    // Unix utility with a fixed meaning, and this CLI is not it. The decided name
    // is spelled out on both sides so a rename that reaches the manifest but not
    // the entry script fails here instead of shipping a command that cannot run.
    expect(packageJson.bin).toEqual({ "trace-doctor": "bin/trace" });
    expect(existsSync(join(projectRoot, "bin", "trace"))).toBe(true);
  });

  it("no longer declares itself private", () => {
    // `"private": true` is the manifest saying "not for distribution", which the
    // release decision withdrew. Leaving it in place makes `npm publish` refuse a
    // tree whose whole purpose is to be published, and it contradicts the README's
    // install instructions, which install a packed copy.
    expect(packageJson.private).toBeUndefined();
  });

  it("carries a version rather than the skeleton's placeholder", () => {
    // `0.0.0` was never a version anybody chose. It is what the skeleton shipped, and
    // `npm pack` turned it into a tarball name, so the packed artifact was named for
    // a release decision that had not been made.
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("cuts the manifest's version into the changelog as its newest released entry", () => {
    // The changelog is packed and installed with the CLI, so it is the one place a
    // reader of an installed copy can learn which version they are holding. If its
    // newest entry is not the manifest's version, the two disagree about what shipped.
    const versions = changelogVersions();
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0]).toBe(packageJson.version);
  });

  it("names the tarball `npm pack` produces in the install command", () => {
    // `npm pack` writes `<name>-<version>.tgz`, and the README's install command
    // spells that name out, so a version bump used to leave the command pointing at
    // a file the pack step no longer produces.
    // The name is spelled out on both sides here on purpose: a rename that reaches
    // the manifest but not the README fails this test instead of passing quietly.
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    const expected = `${packageJson.name}-${packageJson.version}.tgz`;
    const named = [...readme.matchAll(/agent-trace-doctor-\d+\.\d+\.\d+\.tgz/g)].map(
      (match) => match[0],
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
      expect(name).toBe(expected);
    }
  });
});
