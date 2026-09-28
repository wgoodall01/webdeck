// `pnpm release vX.Y.Z`: bump the Homebrew cask, commit "Release X.Y.Z", and
// tag it. Pushing the tag is left to you; it's what starts the release build.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"

const CASK = "Casks/webdeck.rb"

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
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

const cask = readFileSync(CASK, "utf8")
const bumped = cask.replace(/^(\s*version )"[^"]*"$/m, `$1"${version}"`)
if (bumped === cask && !cask.includes(`version "${version}"`)) {
  fail(`no version line found in ${CASK}`)
}
writeFileSync(CASK, bumped)

git("add", CASK)
git("commit", "--allow-empty", "-m", `Release ${version}`)
git("tag", "-a", tag, "-m", `Webdeck ${tag}`)

console.log(`Committed and tagged ${tag}. To publish:\n\n  git push --atomic origin main ${tag}\n`)
