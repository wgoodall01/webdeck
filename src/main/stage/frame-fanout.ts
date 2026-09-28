/**
 * Fans one stream of GPU frames out to many sinks (audience window, presenter
 * preview) without copying.
 *
 * Each frame is ref-counted: the fanout takes one reference per sink that
 * will receive it and drops the underlying texture once every sink is done.
 * A sink that's still busy with an earlier frame doesn't queue — it holds at
 * most one pending frame, replaced by newer ones, so a slow window drops
 * frames instead of exhausting Chromium's small OSR texture pool, and always
 * ends on the latest image.
 */

export interface Frame {
  /** Drop this holder's reference to the underlying texture. */
  release(): void
}

export interface FrameSink<F extends Frame> {
  readonly id: number
  /** Transfer the frame; resolves once the sink has its own reference. */
  deliver(frame: F): Promise<void>
}

class Shared<F extends Frame> {
  private refs = 0
  constructor(readonly frame: F) {}
  retain(): this {
    this.refs++
    return this
  }
  release(): void {
    if (--this.refs === 0) this.frame.release()
  }
}

interface SinkSlot<F extends Frame> {
  sink: FrameSink<F>
  busy: boolean
  pending: Shared<F> | null
}

export class FrameFanout<F extends Frame> {
  private slots = new Map<number, SinkSlot<F>>()
  private onError: (sinkId: number, err: unknown) => void

  constructor(opts: { onError?: (sinkId: number, err: unknown) => void } = {}) {
    this.onError = opts.onError ?? (() => {})
  }

  get sinkCount(): number {
    return this.slots.size
  }

  add(sink: FrameSink<F>): void {
    this.remove(sink.id)
    this.slots.set(sink.id, { sink, busy: false, pending: null })
  }

  remove(sinkId: number): void {
    const slot = this.slots.get(sinkId)
    if (!slot) return
    this.slots.delete(sinkId)
    slot.pending?.release()
    slot.pending = null
  }

  /** Publish a frame. Ownership of `frame` passes to the fanout. */
  push(frame: F): void {
    const shared = new Shared(frame).retain() // held for the duration of push()
    for (const slot of this.slots.values()) {
      shared.retain()
      if (slot.busy) {
        slot.pending?.release()
        slot.pending = shared
      } else {
        this.send(slot, shared)
      }
    }
    shared.release()
  }

  clear(): void {
    for (const id of this.slots.keys()) this.remove(id)
  }

  private send(slot: SinkSlot<F>, shared: Shared<F>): void {
    slot.busy = true
    slot.sink
      .deliver(shared.frame)
      .catch((err: unknown) => this.onError(slot.sink.id, err))
      .finally(() => {
        shared.release()
        slot.busy = false
        // The slot may have been removed while in flight.
        if (this.slots.get(slot.sink.id) !== slot) return
        const next = slot.pending
        slot.pending = null
        if (next) this.send(slot, next)
      })
  }
}
