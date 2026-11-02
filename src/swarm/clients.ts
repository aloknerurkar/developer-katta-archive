import { Bee, type BeeRequestOptions } from '@ethersphere/bee-js'

// bee-js 13.2.0 ignores `timeout` (fetch has no such option); only a per-call `signal` is honoured.
// So every call gets a fresh `AbortSignal.timeout(timeoutMs)`, joined with the caller's own signal if it passes one.
// A feed reader or writer takes its options once, so its calls share one deadline: build a new one per operation.
class TimeoutBee extends Bee {
  constructor(url: string, private readonly timeoutMs: number) {
    super(url)
  }

  protected override getRequestOptionsForCall(requestOptions?: BeeRequestOptions): BeeRequestOptions {
    const deadline = AbortSignal.timeout(this.timeoutMs)
    const signal = requestOptions?.signal ? AbortSignal.any([requestOptions.signal, deadline]) : deadline
    return { ...super.getRequestOptionsForCall(requestOptions), signal }
  }
}

export function makeBee(url: string, timeoutMs = 15_000): Bee {
  return new TimeoutBee(url, timeoutMs)
}
