/** Parse a single-range `Range: bytes=…` header against a body of `size` bytes. */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a = "", b = ""] = m
  if (a === "" && b === "") return null
  let start: number
  let end: number
  if (a === "") {
    const suffix = Number(b)
    if (suffix === 0) return "unsatisfiable"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(a)
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (start >= size || start > end) return "unsatisfiable"
  return { start, end }
}
