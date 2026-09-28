/** 75_000 → "1:15"; 3_725_000 → "1:02:05". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** A pausable stopwatch as plain data, so it's trivially testable. */
export interface Stopwatch {
  /** Accumulated ms from completed running spans. */
  banked: number
  /** When the current running span started, or null if paused. */
  since: number | null
}

export const stopwatch = {
  started(now: number): Stopwatch {
    return { banked: 0, since: now }
  },
  elapsed(sw: Stopwatch, now: number): number {
    return sw.banked + (sw.since === null ? 0 : now - sw.since)
  },
  pause(sw: Stopwatch, now: number): Stopwatch {
    return sw.since === null ? sw : { banked: sw.banked + now - sw.since, since: null }
  },
  resume(sw: Stopwatch, now: number): Stopwatch {
    return sw.since === null ? { ...sw, since: now } : sw
  },
  reset(sw: Stopwatch, now: number): Stopwatch {
    return { banked: 0, since: sw.since === null ? null : now }
  },
}
