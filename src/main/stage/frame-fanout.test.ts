import { describe, expect, it } from "vitest"

import { FrameFanout, type Frame, type FrameSink } from "./frame-fanout"

class TestFrame implements Frame {
  released = 0
  constructor(readonly n: number) {}
  release() {
    this.released++
  }
}

/** A sink whose deliveries resolve only when the test says so. */
function manualSink(id: number) {
  const pending: { frame: TestFrame; done: () => void }[] = []
  const received: number[] = []
  const sink: FrameSink<TestFrame> = {
    id,
    deliver: (frame) =>
      new Promise<void>((resolve) => {
        received.push(frame.n)
        pending.push({ frame, done: resolve })
      }),
  }
  const flush = async () => {
    const p = pending.shift()
    p?.done()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { sink, received, flush, pending }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("FrameFanout", () => {
  it("releases a frame immediately when there are no sinks", () => {
    const fan = new FrameFanout<TestFrame>()
    const f = new TestFrame(1)
    fan.push(f)
    expect(f.released).toBe(1)
  })

  it("releases a frame exactly once, after every sink is done", async () => {
    const fan = new FrameFanout<TestFrame>()
    const a = manualSink(1)
    const b = manualSink(2)
    fan.add(a.sink)
    fan.add(b.sink)
    const f = new TestFrame(1)
    fan.push(f)
    expect(a.received).toEqual([1])
    expect(b.received).toEqual([1])
    await a.flush()
    expect(f.released).toBe(0)
    await b.flush()
    expect(f.released).toBe(1)
  })

  it("drops intermediate frames for a busy sink, keeping only the latest", async () => {
    const fan = new FrameFanout<TestFrame>()
    const s = manualSink(1)
    fan.add(s.sink)
    const frames = [1, 2, 3, 4].map((n) => new TestFrame(n))
    for (const f of frames) fan.push(f)
    // 1 is in flight; 2 and 3 were superseded by 4 and released unsent.
    expect(s.received).toEqual([1])
    expect(frames[1]!.released).toBe(1)
    expect(frames[2]!.released).toBe(1)
    await s.flush()
    expect(frames[0]!.released).toBe(1)
    expect(s.received).toEqual([1, 4])
    await s.flush()
    expect(frames.every((f) => f.released === 1)).toBe(true)
  })

  it("a slow sink doesn't hold back a fast one", async () => {
    const fan = new FrameFanout<TestFrame>()
    const slow = manualSink(1)
    const fast = manualSink(2)
    fan.add(slow.sink)
    fan.add(fast.sink)
    fan.push(new TestFrame(1))
    await fast.flush()
    fan.push(new TestFrame(2))
    expect(fast.received).toEqual([1, 2])
    expect(slow.received).toEqual([1])
  })

  it("releases pending frames when a sink is removed", async () => {
    const fan = new FrameFanout<TestFrame>()
    const s = manualSink(1)
    fan.add(s.sink)
    const f1 = new TestFrame(1)
    const f2 = new TestFrame(2)
    fan.push(f1)
    fan.push(f2)
    fan.remove(1)
    expect(f2.released).toBe(1)
    await s.flush() // the in-flight delivery completes after removal
    expect(f1.released).toBe(1)
    expect(s.received).toEqual([1])
  })

  it("survives a failing sink and reports it", async () => {
    const errors: number[] = []
    const fan = new FrameFanout<TestFrame>({ onError: (id) => errors.push(id) })
    fan.add({ id: 7, deliver: () => Promise.reject(new Error("gone")) })
    const f = new TestFrame(1)
    fan.push(f)
    await tick()
    await tick()
    expect(errors).toEqual([7])
    expect(f.released).toBe(1)
  })
})
