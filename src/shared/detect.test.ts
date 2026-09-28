import { describe, expect, it } from "vitest"

import { findDeckCandidates, looksLikeDeck, titleFromPath } from "./detect"

const DECK = `<x-dc><x-import component-from-global-scope="deck-stage" from="./deck-stage.js">`

describe("findDeckCandidates", () => {
  it("finds the deck in a Claude Design export, ignoring support files", () => {
    const got = findDeckCandidates([
      { path: "Quarterly Review.dc.html", head: DECK },
      { path: "_ds/system/preview.html", head: DECK },
      { path: "uploads/page.html", head: "<html>" },
      { path: "deck-stage.js" },
      { path: "assets/logo.svg" },
    ])
    expect(got).toEqual([
      {
        id: "Quarterly Review.dc.html",
        path: "Quarterly Review.dc.html",
        title: "Quarterly Review",
        kind: "html",
      },
    ])
  })

  it("prefers deck-looking HTML over other pages", () => {
    const got = findDeckCandidates([
      { path: "b.html", head: "<deck-stage>" },
      { path: "notes.html", head: "<p>hi</p>" },
      { path: "a.dc.html", head: DECK },
    ])
    expect(got.map((c) => c.path)).toEqual(["a.dc.html", "b.html"])
  })

  it("falls back to any HTML when nothing sniffs as a deck", () => {
    const got = findDeckCandidates([{ path: "index.html", head: "<p>" }])
    expect(got.map((c) => c.path)).toEqual(["index.html"])
  })

  it("includes PDFs", () => {
    const got = findDeckCandidates([{ path: "talk.pdf" }])
    expect(got).toEqual([{ id: "talk.pdf", path: "talk.pdf", title: "talk", kind: "pdf" }])
  })

  it("skips dotfiles and macOS resource forks", () => {
    const got = findDeckCandidates([
      { path: "__MACOSX/._deck.html", head: DECK },
      { path: ".hidden/deck.html", head: DECK },
    ])
    expect(got).toEqual([])
  })
})

describe("sniffing", () => {
  it("recognizes deck markers", () => {
    expect(looksLikeDeck(DECK)).toBe(true)
    expect(looksLikeDeck("<deck-stage width=1920>")).toBe(true)
    expect(looksLikeDeck("<html><body>hi")).toBe(false)
  })

  it("titles from paths", () => {
    expect(titleFromPath("dir/My Deck.dc.html")).toBe("My Deck")
    expect(titleFromPath("slides.html")).toBe("slides")
    expect(titleFromPath("beamer.pdf")).toBe("beamer")
  })
})
