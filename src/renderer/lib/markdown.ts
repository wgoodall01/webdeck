/** First non-empty line of Markdown notes as plain text, for one-line previews. */
export function notePreview(md: string): string {
  const line = md.split("\n").find((l) => l.trim()) ?? ""
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, "") // list, heading, quote markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images → their text
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2") // emphasis, strikethrough, code
    .trim()
}
