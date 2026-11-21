/**
 * The time ledger: one document per habit day holding the **closed** intervals
 * that belong to it.
 *
 * A day of raw presence folds into the same rows a deleted entry's focus
 * sessions become, which is the whole point: "time someone spent" has one
 * durable shape, whoever recorded it. The writers differ, the unit does not —
 * `time.filter(kind === 'focus')` is what the column reads, `talk` is what the
 * conversation band reads, and neither knows how the row got there.
 *
 * Ids are the identity. A retried delete and a compaction interrupted between
 * its two writes both have to be harmless, and the per-record backend offers no
 * transaction to lean on — de-duplicating by id is what it does offer.
 */
import type { DayKey } from '../shared/habit-day.ts'
import type { HabitDomain, TimeDay, TimeItem } from './domain.ts'
import { timeDay } from './domain.ts'

/** The one surface the writers and readers of durable time share. */
export interface Ledger {
  /** The day's items, in the order they were written; empty when it has none. */
  read(day: DayKey): readonly TimeItem[]
  /**
   * Add items to a day, skipping ids the day already holds.
   *
   * The document is created by the first write and never by a read: a day with
   * no durable time stays absent, the same way a habit day with nothing
   * recorded has no document.
   */
  write(day: DayKey, items: readonly TimeItem[]): Promise<void>
  /** Every day document, for a reader that needs one subject across days. */
  days(): IterableIterator<[DayKey, TimeDay]>
}

/**
 * The write chain of each domain's ledger.
 *
 * Two writers of the same day have to be ordered against **each other**, not
 * just against the table: `update` makes a read-modify-write atomic, but the
 * first write to a day also has to *create* it, and a create followed by a
 * merge is two steps the table cannot fuse. Serializing the whole write per
 * domain is what makes creation safe — the same rule `presence.ts` uses for its
 * own chain, for the same reason.
 */
const chains = new WeakMap<HabitDomain, Promise<unknown>>()

/** Run `work` after every ledger write already queued on this domain. */
function serialize<T>(domain: HabitDomain, work: () => Promise<T>): Promise<T> {
  const tail = chains.get(domain) ?? Promise.resolve()
  const next = tail.then(work, work)
  chains.set(domain, next.then(() => undefined, () => undefined))
  return next
}

/** Build the ledger over an opened domain. */
export function createLedger(domain: HabitDomain): Ledger {
  const table = domain.table('time')

  /** Append the items whose ids the day does not hold yet. */
  const append = (day: DayKey, items: readonly TimeItem[]) => (current: TimeDay): TimeDay => {
    const known = new Set(current.items.map(item => item.id))
    const added = items.filter(item => !known.has(item.id))
    return added.length === 0
      ? current
      : timeDay.parse({ date: day, items: [...current.items, ...added] })
  }

  return {
    read: day => table.get(day)?.items ?? [],

    write: (day, items) => {
      if (items.length === 0) return Promise.resolve()
      return serialize(domain, async () => {
        const apply = append(day, items)
        // `update` is the atomic read-modify-write: its read happens inside the
        // domain's write chain, so a merge never puts a stale document back over
        // a newer one. `get` + `put` cannot promise that — a `put` is durable
        // before the record becomes readable, so the second writer reads the day
        // as it was before the first one landed. That is a lost focus session,
        // not a stale pixel: the entry those rows came from is already deleted.
        //
        // Creation is the one case `update` refuses (`missing-key`), and it is
        // why the whole write is serialized above. An empty document is the one
        // value two creators could race over harmlessly; the rows themselves
        // always land through `update`.
        for (let tries = 0; ; tries += 1) {
          if (table.get(day) === undefined) await table.put(day, { date: day, items: [] })
          try {
            await table.update(day, apply)
            return
          } catch (error) {
            // The document can vanish under a `replace` import pruning the
            // table. Recreating it once is enough; a second refusal is real.
            if (tries > 0 || (error as { code?: string }).code !== 'missing-key') throw error
          }
        }
      })
    },

    days: () => table.entries(),
  }
}
