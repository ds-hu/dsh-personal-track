/**
 * The task registry's one order.
 *
 * Both the board's task tile and the daily report sort with `byDeadline`, so
 * what is asserted here is what both surfaces read. Pure: a task carries the
 * deadline and the title, nothing else is consulted.
 *
 * Every case names its locale. The alphabetical tie-break is a *collation*, and
 * collation is language-dependent by design (a Chinese shell reads Han titles in
 * pinyin and leads with them; an English one does neither), so a case that
 * leaned on the runtime default would assert the machine, not the rule.
 *
 * Runs on Node's native type stripping: `node tests/task-order.test.ts`
 */
import { strict as assert } from 'node:assert'
import { byDeadline, compareTitles } from '../src/client/board/task-order.ts'
import type { TaskEntry } from '../src/client/types.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/** Just enough of a task for the comparator: a title, a deadline, a state. */
function task(title: string, due?: string, state: TaskEntry['state'] = 'todo'): TaskEntry {
  return {
    id: title,
    title,
    ...(due === undefined ? {} : { due }),
    progress: { current: 0 },
    checkpoints: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    materials: [],
    focusSessions: [],
    focusSeconds: 0,
    state,
    overdue: false,
  }
}

/** The titles of a list in the registry's order, for one locale. */
const sorted = (locale: string, ...tasks: readonly TaskEntry[]): readonly string[] =>
  [...tasks].sort((a, b) => byDeadline(a, b, locale)).map(entry => entry.title)

console.log('task order (deadline, then alphabetically among equals)')

check('the earliest deadline wins', () => {
  assert.deepEqual(
    sorted('zh', task('c', '2026-11-12'), task('a', '2026-11-09'), task('b', '2026-11-10')),
    ['a', 'b', 'c'],
  )
})

check('a task with no deadline comes after every dated one', () => {
  assert.deepEqual(
    sorted('zh', task('无截止', undefined), task('有截止', '2026-12-01')),
    ['有截止', '无截止'],
  )
})

check('finished tasks sink below every unfinished one, deadlines or not', () => {
  assert.deepEqual(
    sorted('zh', task('A 完成', '2026-11-09', 'done'), task('B 未完成', undefined)),
    ['B 未完成', 'A 完成'],
  )
})

check('one deadline: Chinese titles read in pinyin order', () => {
  // 购(gòu) leads 取(qǔ); code-unit order would put 取 first.
  assert.deepEqual(
    sorted('zh', task('取快递', '2026-11-09'), task('购买挂钩 换活页纸', '2026-11-09')),
    ['购买挂钩 换活页纸', '取快递'],
  )
})

check('one deadline: digits compare as numbers, so L7.2 leads L7.10', () => {
  assert.deepEqual(
    sorted('zh', task('L7.10 幂级数', '2026-11-09'), task('L7.2 矩阵的秩', '2026-11-09')),
    ['L7.2 矩阵的秩', 'L7.10 幂级数'],
  )
})

check('the undated group is alphabetical too, not "newest first"', () => {
  // 购(gòu) < 取(qǔ) < 宿(sù) — typed in an order that is neither.
  assert.deepEqual(
    sorted('zh', task('宿舍打扫'), task('取快递'), task('购买挂钩 换活页纸')),
    ['购买挂钩 换活页纸', '取快递', '宿舍打扫'],
  )
})

check('the tie-break follows the locale it is given', () => {
  // The same two titles swap places between shells: that is the whole reason
  // the locale is a parameter rather than a constant in the comparator.
  assert.ok(compareTitles('宿舍打扫', 'HMW2 大气成分的辐射作用', 'zh') < 0)
  assert.ok(compareTitles('宿舍打扫', 'HMW2 大气成分的辐射作用', 'en') > 0)
})

console.log(`\n${passed} passed`)
process.exitCode = 0
