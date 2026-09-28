// `pnpm release vX.Y.Z`: bump package.json and the Homebrew cask, commit "Release X.Y.Z", and
// tag it. Pushing the tag is left to you; it's what starts the release build.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const CASK = "Casks/webdeck.rb"
const PACKAGE = "package.json"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

// Rewrite the first line matching `pattern` in place, keeping the file's formatting.
function bump(file, pattern, replacement) {
  const text = readFileSync(file, "utf8")
  if (!pattern.test(text)) fail(`no version line found in ${file}`)
  writeFileSync(file, text.replace(pattern, replacement))
}

const tag = process.argv[2]
// Same check as the release workflow.
if (!tag || !/^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
  fail("usage: pnpm release vX.Y.Z")
}
const version = tag.slice(1)

const branch = git("rev-parse", "--abbrev-ref", "HEAD")
if (branch !== "main") fail(`on branch '${branch}', not main`)
if (git("status", "--porcelain")) fail("working tree is dirty")
if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`)

bump(PACKAGE, /^(  "version": )"[^"]*"/m, `$1"${version}"`)
bump(CASK, /^(\s*version )"[^"]*"$/m, `$1"${version}"`)

git("add", PACKAGE, CASK)
git("commit", "--allow-empty", "-m", `Release ${version}`)
git("tag", "-a", tag, "-m", `Webdeck ${tag}`)

console.log(`Committed and tagged ${tag}. To publish:\n\n  git push --atomic origin main ${tag}\n`)
