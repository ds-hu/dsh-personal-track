/**
 * One at a time: the queue focus mode sends its writes through.
 *
 * Every registry write in the overlay carries an **absolute** value — a dragged
 * progress bar says "20", not "+3" — so the order the host applies them in is
 * the whole meaning of the result. Two things go wrong without a queue, and
 * both were real:
 *
 * - the browser may open a second connection, so the host can apply `20` before
 *   the `17` sent in front of it and keep the older value;
 * - the answers can arrive in a different order than the writes, so "adopt the
 *   last answer" is not "adopt the last write".
 *
 * Either way the overlay ends up showing a value the host no longer holds, and
 * the next `+1` is then computed from it. Sending one write at a time makes
 * issue order, apply order and answer order the same order.
 *
 * `settled()` is the other half. Leaving the mode has to wait until the writes
 * it just issued have landed, or the board's re-read races the last one and
 * shows the value from before it — which is exactly what "退出专注后进度条还停在
 * 17" was.
 */

/** Writes performed strictly in issue order. */
export interface WriteQueue {
  /** Run one write after every write issued before it has settled. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** Resolve once every write issued so far has settled. Never rejects. */
  settled(): Promise<void>
}

/** Create an empty queue. */
export function createWriteQueue(): WriteQueue {
  /** The tail of the chain: settles when everything queued before it has. */
  let tail: Promise<void> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const answer = tail.then(task)
      // The chain itself is kept non-rejecting: one refused write must not wedge
      // the writes behind it, and a later `settled()` must not inherit somebody
      // else's failure — every caller already has its own answer to look at.
      tail = answer.then(() => {}, () => {})
      return answer
    },
    settled: () => tail,
  }
}
