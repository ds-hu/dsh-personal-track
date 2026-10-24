/**
 * The habit inventory: the one statement of which habits exist.
 *
 * Seven **习惯** own the eight **格** the completion bar is built from. Every
 * other statement of "which habits are there" derives from this module or is
 * asserted against it: the bar's cells (`derive.ts`), the statistics heat grid
 * and its streaks (`stats.ts`), the wire enums a check or a meal is addressed
 * by (`routes.ts`), and the labels the statistics panel shows.
 *
 * Before this module existed the same inventory was spelled three ways — eight
 * cell ids in `derive.ts`, seven habit ids plus their own `met` predicates in
 * `stats.ts`, and two more enums inline in the routes. `wash1`/`wash2` on the
 * bar therefore could not be joined to the `wash` row of the heat grid, and
 * adding or renaming a habit was a four-file edit that no compiler checked.
 *
 * Two rules keep it from drifting again:
 *
 * - A **habit** owns 1..n **格**, and "当日达标" is **derived** — every cell of
 *   the habit is full ({@link habitMet}). The bar and **连续** are then the same
 *   rule, not two opinions (docs/adr/0002-derived-state-not-stored.md).
 * - The wire-facing subsets ({@link CHECK_HABITS}, {@link MEAL_SLOTS}) are
 *   literal tuples, because `z.enum` needs one — and `tests/habits.test.ts`
 *   asserts they are exactly the inventory rows of their form. Adding a habit
 *   without them fails a test rather than drifting.
 *
 * Pure data: no zod, no store, no React. Both the domain rules and the wire
 * shapes can import it without dragging anything in.
 */

/** The five **习惯形态** of CONTEXT.md, narrowed to the ones with daily cells. */
export type HabitForm = 'check' | 'slot' | 'session'

/** The atomic units of the completion bar. */
export type CellId =
  | 'wash1' | 'wash2' | 'shower'
  | 'breakfast' | 'lunch' | 'dinner'
  | 'vocab' | 'duolingo'

/** One habit's identifier — what a **格** row and a heat-grid row are named by. */
export type HabitId =
  | 'wash' | 'shower'
  | 'breakfast' | 'lunch' | 'dinner'
  | 'vocab' | 'duolingo'

/** One **格**: an id, and the label the bar shows for it. */
export interface HabitCell {
  readonly id: CellId
  readonly label: string
}

/** One **习惯**: its id, its label, its form, and the **格** it owns. */
export interface Habit {
  readonly id: HabitId
  readonly label: string
  readonly form: HabitForm
  /**
   * How many times a **打卡** may be recorded in one **习惯日**; absent for every
   * other form (a slot is at most once by its stored shape, a session is
   * unlimited). The store enforces this inside its atomic write — not the route.
   */
  readonly maxPerDay?: number
  readonly cells: readonly HabitCell[]
}

/**
 * The inventory, in the order the completion bar lists its cells.
 *
 * 洗漱 owns two cells and counts as one habit: that is why the heat grid has
 * seven rows while the bar has eight cells, and why the two can be joined by
 * habit id.
 */
export const HABITS: readonly Habit[] = [
  {
    id: 'wash',
    label: '洗漱',
    form: 'check',
    maxPerDay: 2,
    cells: [
      { id: 'wash1', label: '洗漱 1' },
      { id: 'wash2', label: '洗漱 2' },
    ],
  },
  {
    id: 'shower',
    label: '洗澡',
    form: 'check',
    maxPerDay: 1,
    cells: [{ id: 'shower', label: '洗澡' }],
  },
  { id: 'breakfast', label: '早饭', form: 'slot', cells: [{ id: 'breakfast', label: '早饭' }] },
  { id: 'lunch', label: '午饭', form: 'slot', cells: [{ id: 'lunch', label: '午饭' }] },
  { id: 'dinner', label: '晚饭', form: 'slot', cells: [{ id: 'dinner', label: '晚饭' }] },
  { id: 'vocab', label: '背单词', form: 'session', cells: [{ id: 'vocab', label: '背单词' }] },
  { id: 'duolingo', label: '多邻国', form: 'session', cells: [{ id: 'duolingo', label: '多邻国' }] },
]

/** Every **格**, flattened in bar order. */
export const CELL_IDS: readonly CellId[] = HABITS.flatMap(habit => habit.cells.map(cell => cell.id))

/** How many habit cells a day holds, before the tasks due that day are added. */
export const CELL_TOTAL = CELL_IDS.length

/** The habits a **打卡** addresses, as the wire enum needs them. */
export const CHECK_HABITS = ['wash', 'shower'] as const

/** A habit a **打卡** can be recorded against. */
export type CheckHabit = typeof CHECK_HABITS[number]

/** The three meal **槽位**, in the order the board lists them. */
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const

/** One meal slot. */
export type MealSlot = typeof MEAL_SLOTS[number]

/** The inventory row for an id. */
export function habitOf(id: HabitId): Habit {
  const found = HABITS.find(habit => habit.id === id)
  if (found === undefined) throw new Error(`unknown habit: ${id}`)
  return found
}

/**
 * Whether a habit is met on a day, from the day's **格** fractions alone.
 *
 * This is the whole definition of "达标" — and because it reads the bar's own
 * values, a habit cannot be met by one rule and its cells filled by another.
 *
 * @param habit - the inventory row.
 * @param valueOf - the cell's fraction, as `derive.dayCells` computed it.
 * @returns true when every cell the habit owns reads 1.
 */
export function habitMet(habit: Habit, valueOf: (id: CellId) => number): boolean {
  return habit.cells.every(cell => (valueOf(cell.id) ?? 0) >= 1)
}
