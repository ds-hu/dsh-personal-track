/**
 * The panel's words, both languages, in one table.
 *
 * **Why one table and not two dictionaries.** The shell's locale service takes
 * one dictionary per language and a namespace's texts have a single owner; two
 * hand-written dictionaries drift the moment one key is added on one side only.
 * Here a key exists because a row exists, and both dictionaries are projected
 * from the same rows ({@link ZH}, {@link EN}), so "the two key sets are equal"
 * is a property of the shape rather than something a test has to police. The
 * test that does check it (`tests/copy.test.ts`) is there to catch a dictionary
 * built by hand slipping back in.
 *
 * **Names, not sentences.** A row is the smallest string a reader sees, so a
 * sentence assembled from figures stays in the component and only its words are
 * here (`{used}/{total}`). Placeholders use the shell's `{name}` syntax — the
 * service interpolates them, this module never does.
 *
 * **English is a translation, not a transcription.** Chinese text here is the
 * product's own voice; English says the same thing in the same register. Where
 * the two disagree about brevity the shorter one wins: these strings sit in a
 * dense board, not in a manual.
 */

/** One row: the same message in both languages the shell offers. */
export interface CopyRow {
  readonly zh: string
  readonly en: string
}

/**
 * Every key the panel can say. Order follows the surface: the panel frame, the
 * board's groups, the habit inventory, then the views that read them.
 */
export const COPY = {
  // ---- the panel frame -------------------------------------------------
  'panel.title': { zh: '习惯看板', en: 'Habit board' },
  'panel.view.board': { zh: '打卡', en: 'Check-in' },
  'panel.view.stats': { zh: '统计', en: 'Stats' },

  // ---- the board's groups ---------------------------------------------
  'group.daily': { zh: '日常', en: 'Daily' },
  'group.diet': { zh: '饮食', en: 'Meals' },
  'group.study': { zh: '学习', en: 'Study' },
  'group.training': { zh: '健身', en: 'Training' },
  'group.records': { zh: '记录', en: 'Records' },
  'board.loading': { zh: '加载中…', en: 'Loading…' },
  'board.showStats': { zh: '切到统计视图', en: 'Switch to the stats view' },
  'board.empty.title': { zh: '这一天还没有记录', en: 'Nothing recorded for this day' },
  'board.empty.hint': { zh: '从上面任意一项开始打卡即可', en: 'Check in on any habit above' },
  'board.copied': { zh: '已复制 ✓', en: 'Copied ✓' },
  'board.copyReport': { zh: '复制纯文本报告', en: 'Copy as plain text' },

  // ---- the habit inventory (host sends ids, these name them) -----------
  'habit.wash': { zh: '洗漱', en: 'Wash up' },
  'habit.shower': { zh: '洗澡', en: 'Shower' },
  'habit.breakfast': { zh: '早饭', en: 'Breakfast' },
  'habit.lunch': { zh: '午饭', en: 'Lunch' },
  'habit.dinner': { zh: '晚饭', en: 'Dinner' },
  'habit.vocab': { zh: '背单词', en: 'Vocabulary' },
  'habit.duolingo': { zh: '多邻国', en: 'Duolingo' },
  'habit.sport': { zh: '健身', en: 'Training' },

  // ---- the nine cells the completion bar is built from -----------------
  'cell.wash1': { zh: '洗漱 1', en: 'Wash up 1' },
  'cell.wash2': { zh: '洗漱 2', en: 'Wash up 2' },

  // ---- meals -----------------------------------------------------------
  'meal.total': { zh: '三餐', en: 'Meals' },
  'meal.short.breakfast': { zh: '早', en: 'B' },
  'meal.short.lunch': { zh: '午', en: 'L' },
  'meal.short.dinner': { zh: '晚', en: 'D' },
  'meal.spend': { zh: '共 {amount}', en: '{amount} total' },

  // ---- the date navigator ---------------------------------------------
  'date.today': { zh: '今日', en: 'Today' },
  'date.previous': { zh: '前一天', en: 'Previous day' },
  'date.next': { zh: '后一天', en: 'Next day' },
  'date.night': { zh: '{weekday}夜', en: '{weekday} night' },
  'date.nightTag': { zh: '凌晨时段', en: 'small hours' },
  'date.back': { zh: '回到当前习惯日', en: 'Back to the current habit day' },
  'date.todayButton': { zh: '今天', en: 'Today' },
  'date.jump': { zh: '跳转到某一天补卡', en: 'Jump to a day to backfill' },
  'date.current': { zh: '当前习惯日', en: 'current habit day' },
  'date.backfilling': { zh: '补卡中', en: 'backfilling' },

  // ---- the shared tile controls ---------------------------------------
  'tile.add': { zh: '添加', en: 'Add' },
  'tile.edit': { zh: '编辑', en: 'Edit' },
  'tile.remove': { zh: '删除', en: 'Delete' },
  'tile.focus': { zh: '专注', en: 'Focus' },
  'tile.newEntry': { zh: '新建', en: 'New' },
  'tile.entries': { zh: '{count} 条', en: '{count} entries' },
  'tile.complete': { zh: '完成 {label}', en: 'Done {label}' },
  'tile.editTime': { zh: '修改时间', en: 'Change the time' },
  'tile.undoEntry': { zh: '撤销这一条', en: 'Remove this entry' },

  // ---- the completion bar ---------------------------------------------
  'chip.missing': { zh: '未完成', en: 'Not started' },
  'chip.done': { zh: '已完成', en: 'Done' },
  'chip.progress': { zh: '进行中 {percent}%', en: '{percent}% in progress' },
  'chip.cell': { zh: '{label}：{state}', en: '{label}: {state}' },

  // ---- forms -----------------------------------------------------------
  'form.save': { zh: '保存', en: 'Save' },
  'form.cancel': { zh: '取消', en: 'Cancel' },
  'form.optional': { zh: '可留空', en: 'optional' },
  'field.time': { zh: '时间', en: 'Time' },
  'field.price': { zh: '价格', en: 'Price' },
  'field.required': { zh: '{label}不能为空', en: '{label} is required' },
  'field.number': { zh: '{label}必须是数字', en: '{label} must be a number' },
  'field.min': { zh: '{label}不能小于 {min}', en: '{label} must be at least {min}' },
  'field.max': { zh: '{label}不能大于 {max}', en: '{label} must be at most {max}' },
  'list.empty': { zh: '无记录', en: 'Nothing recorded' },

  // ---- the laundry counter (a stock gauge, not one of the habits) ------
  'laundry.title': { zh: '洗衣', en: 'Laundry' },
  'laundry.pending': { zh: '待洗 {count}', en: '{count} to wash' },
  'laundry.add': { zh: '加一件脏衣服', en: 'Add one dirty item' },
  'laundry.remove': { zh: '减一件（修正）', en: 'Remove one (correction)' },
  'laundry.unit': { zh: '件待洗', en: 'to wash' },
  'laundry.wash': { zh: '洗完', en: 'Washed' },
  'laundry.fix': { zh: '修正', en: 'Fix' },
  'laundry.pieces': { zh: '洗了几件', en: 'Pieces washed' },
  'laundry.commit': { zh: '记下这次洗涤', en: 'Record this wash' },
  'laundry.setPending': { zh: '待洗改为', en: 'Set the count to' },

  // ---- meals -----------------------------------------------------------
  'meal.title': { zh: '三餐', en: 'Meals' },
  'meal.record': { zh: '记录{meal}', en: 'Record {meal}' },
  'meal.edit': { zh: '修改时间与价格', en: 'Change the time and price' },
  'meal.clear': { zh: '清除这一餐', en: 'Clear this meal' },

  // ---- a counted check (washing up twice, showering once) --------------
  'check.mark': { zh: '{label}打卡', en: 'Check {label}' },

  // ---- media, the reading/film registry --------------------------------
  'media.status.active': { zh: '在列', en: 'Listed' },
  'media.status.done': { zh: '完成', en: 'Done' },
  'media.status.dropped': { zh: '弃', en: 'Dropped' },
  'material.empty': { zh: '（空文本块）', en: '(empty text block)' },

  // ---- checkpoints -----------------------------------------------------
  'checkpoint.problem': {
    zh: '检查点第 {line} 行要形如「第一章@10」',
    en: 'Checkpoint line {line} must read like "Chapter 1@10"',
  },

  // ---- the report (it follows the shell's language: it is pasted into a chat)
  'report.title': { zh: '习惯日报 {date}', en: 'Habit report {date}' },
  'report.completion': { zh: '完成 {done}/{total}（{percent}%）', en: 'Done {done}/{total} ({percent}%)' },
  'report.tasks': { zh: '任务：', en: 'Tasks:' },
  'report.overdue': { zh: '逾期', en: 'overdue' },
  'report.meal.missing': { zh: '{meal} —', en: '{meal} —' },
  'report.daily.wash': { zh: '洗漱 {times}/2', en: 'Wash up {times}/2' },
  'report.daily.shower.done': { zh: '洗澡 ✓', en: 'Shower ✓' },
  'report.daily.shower.missing': { zh: '洗澡 —', en: 'Shower —' },
  'report.daily.laundry': { zh: '待洗 {count} 件', en: '{count} to wash' },
  'report.study.vocab': { zh: '背单词 {percent}%（{detail}）', en: 'Vocabulary {percent}% ({detail})' },
  'report.study.new': { zh: '新 {done}/{target}', en: 'new {done}/{target}' },
  'report.study.review': { zh: '复 {done}/{target}', en: 'review {done}/{target}' },
  'report.study.minutes': { zh: '{minutes} 分', en: '{minutes} min' },
  'report.study.surplus': { zh: '超额 {count}', en: '{count} extra' },
  'report.study.duolingo': { zh: '多邻国 {lessons} 节 {minutes} 分', en: 'Duolingo ×{lessons} · {minutes} min' },
  'report.study.duolingo.none': { zh: '多邻国 —', en: 'Duolingo —' },
  'report.study.duolingo.lessons': { zh: '多邻国 {lessons} 节', en: 'Duolingo {lessons} lessons' },
  'report.training.none': { zh: '健身 —', en: 'Training —' },
  'report.run': { zh: '跑步 {distance}km {minutes} 分', en: 'Run {distance}km, {minutes} min' },
  'report.rope': { zh: '跳绳 {count} 个（{sets} 组）{duration}', en: 'Rope {count} skips in {sets} sets, {duration}' },
  'report.pullup': { zh: '引体 {sets} 组（{seconds}）', en: 'Pull-ups {sets} sets ({seconds})' },
  'report.plank': { zh: '平板 {sets} 组（{seconds}）', en: 'Plank {sets} sets ({seconds})' },
  'report.equipment': { zh: '器材 {detail}', en: 'Equipment {detail}' },
  'report.equipment.set': { zh: '{name} {weight} {sets} 组 {reps} 次', en: '{name} {weight} {sets} sets × {reps}' },
  'report.equipment.setPlain': { zh: '{name} {sets} 组 {reps} 次', en: '{name} {sets} sets × {reps}' },
  'report.free': { zh: '自由 {count} 次（{detail}）', en: 'Free {count} sessions ({detail})' },
  'report.free.measured': { zh: '{kcal} kcal，{measured}/{count} 次有记录', en: '{kcal} kcal, {measured}/{count} measured' },
  'report.free.kcal': { zh: '{kcal} kcal', en: '{kcal} kcal' },
  'report.seconds': { zh: '{seconds} 秒', en: '{seconds} s' },
  'report.tempo': { zh: '{tempo} 次/分', en: '{tempo}/min' },


  // ---- the training tiles ----------------------------------------------
  'field.minutes': { zh: '时长(分)', en: 'Duration (min)' },
  'field.distance': { zh: '里程(km)', en: 'Distance (km)' },
  'field.avgHr': { zh: '平均心率', en: 'Avg heart rate' },
  'field.count': { zh: '次数', en: 'Count' },
  'field.seconds': { zh: '用时(秒)', en: 'Time (s)' },
  'field.heartRate': { zh: '心率', en: 'Heart rate' },
  'field.holdSeconds': { zh: '支撑(秒)', en: 'Hold (s)' },
  'field.plankSeconds': { zh: '秒数', en: 'Seconds' },
  'field.equipment': { zh: '器材', en: 'Equipment' },
  'field.reps': { zh: '动作数', en: 'Reps' },
  'field.weight': { zh: '重量(kg)', en: 'Weight (kg)' },
  'field.kcal': { zh: '消耗(kcal)', en: 'Calories (kcal)' },
  'field.newWords': { zh: '新词', en: 'New words' },
  'field.review': { zh: '复习', en: 'Review' },
  'field.minutesUsed': { zh: '用时(分)', en: 'Time (min)' },
  'fitness.run.title': { zh: '跑步', en: 'Run' },
  'fitness.run.meta': { zh: '{distance} km · {minutes} 分', en: '{distance} km · {minutes} min' },
  'fitness.run.hint': { zh: '默认 30 分钟，记里程与平均心率', en: '30 min by default; log the distance and average heart rate' },
  'fitness.rope.title': { zh: '跳绳', en: 'Rope' },
  'fitness.rope.meta': { zh: '{sets} 组 · {count} 个 · {duration}', en: '{sets} sets · {count} skips · {duration}' },
  'fitness.rope.set': { zh: '{time} · {count} 个 · {duration}', en: '{time} · {count} skips · {duration}' },
  'fitness.rope.hint': { zh: '任意次数，记用时与心率', en: 'Any count; log the time and heart rate' },
  'fitness.notRecorded': { zh: '未记录', en: 'Not recorded' },
  'fitness.record': { zh: '记录', en: 'Record' },
  'fitness.sets': { zh: '组数', en: 'Sets' },
  'fitness.addSet': { zh: '加一组', en: 'Add a set' },
  'fitness.sessions': { zh: '次数', en: 'Sessions' },
  'fitness.pullup.title': { zh: '引体向上', en: 'Pull-ups' },
  'fitness.pullup.summary': { zh: '支撑 {seconds}s · {time}', en: 'Hold {seconds}s · {time}' },
  'fitness.plank.title': { zh: '平板支撑', en: 'Plank' },
  'fitness.equipment.title': { zh: '健身器材', en: 'Equipment' },
  'fitness.equipment.summary': { zh: '{name} · {reps} 次 · {weight}kg · {time}', en: '{name} · {reps} reps · {weight} kg · {time}' },
  'fitness.equipment.summaryPlain': { zh: '{name} · {reps} 次 · {time}', en: '{name} · {reps} reps · {time}' },
  'fitness.free.title': { zh: '自由锻炼', en: 'Free training' },
  'fitness.free.summary': { zh: '{minutes} 分 · {kcal} kcal · {time}', en: '{minutes} min · {kcal} kcal · {time}' },
  'fitness.free.summaryPlain': { zh: '{minutes} 分 · {time}', en: '{minutes} min · {time}' },
  'study.log': { zh: '学习记录', en: 'Study log' },
  'study.vocab.weighting': { zh: '复习词按新词的 1/5 计入进度', en: 'A review word counts as a fifth of a new one' },
  'study.vocab.editTarget': { zh: '改这一天的目标', en: 'Change this day’s target' },
  'study.vocab.new': { zh: '新 {done}', en: 'New {done}' },
  'study.vocab.review': { zh: '复 {done}', en: 'Review {done}' },
  'study.vocab.surplus': { zh: '超额 {surplus}', en: '{surplus} extra' },
  'study.vocab.targetNew': { zh: '新词目标', en: 'New-word target' },
  'study.vocab.targetReview': { zh: '复习目标', en: 'Review target' },
  'study.vocab.saveTarget': { zh: '保存目标', en: 'Save targets' },
  'study.vocab.summary': { zh: '{time} · 新 {new} 复 {review} · {minutes}分', en: '{time} · {new} new, {review} review · {minutes} min' },
  'study.addLesson': { zh: '加一节', en: 'Add a lesson' },
  'study.duolingo.label': { zh: '多邻国 · {lessons} 节 {minutes}分', en: 'Duolingo · {lessons} lessons, {minutes} min' },
  'study.lesson.summary': { zh: '{time} · {minutes} 分钟', en: '{time} · {minutes} min' },
  'tile.addSession': { zh: '加一次', en: 'Add a session' },
  'unit.tempo': { zh: '{tempo} 次/分', en: '{tempo}/min' },


  // ---- the reading / film registry ---------------------------------------
  'media.title': { zh: '影视 / 书籍', en: 'Films / books' },
  'media.empty': { zh: '空', en: 'Empty' },
  'media.live': { zh: '在列 {count}', en: '{count} listed' },
  'media.add': { zh: '新增记录', en: 'New entry' },
  'media.record': { zh: '记下', en: 'Log it' },
  'media.emptyHint': { zh: '看完一部、读完一本，随时补记', en: 'Log a film or a book whenever you finish one' },
  'media.noneLive': { zh: '没有在看或在读的记录', en: 'Nothing being watched or read' },
  'media.archiveTitle': { zh: '已完成或已放弃的记录', en: 'Finished or dropped entries' },
  'media.field.kind': { zh: '类型', en: 'Type' },
  'media.field.title': { zh: '名称', en: 'Title' },
  'media.field.status': { zh: '状态', en: 'Status' },
  'media.field.rating': { zh: '评分', en: 'Rating' },
  'media.kind.film': { zh: '电影', en: 'Film' },
  'media.kind.book': { zh: '书', en: 'Book' },
  'task.title': { zh: '任务 / 作业', en: 'Tasks / homework' },
  'task.meta.open': { zh: '未完成 {count}', en: '{count} open' },
  'task.meta.today': { zh: '今日到期 {count}', en: '{count} due today' },
  'task.meta.overdue': { zh: '逾期 {count}', en: '{count} overdue' },
  'task.empty': { zh: '还没有任务', en: 'No tasks yet' },
  'task.noneLive': { zh: '没有进行中的任务', en: 'Nothing in progress' },
  'task.archiveTitle': { zh: '过了截止日且已完成的任务', en: 'Done and past their due date' },
  'task.add': { zh: '新建任务', en: 'New task' },
  'task.field.title': { zh: '事项', en: 'Item' },
  'task.field.category': { zh: '分类', en: 'Category' },
  'task.field.categoryHint': { zh: '课程名等', en: 'e.g. a course name' },
  'task.field.due': { zh: '截止', en: 'Due' },
  'task.field.current': { zh: '当前', en: 'Current' },
  'task.field.total': { zh: '目标量', en: 'Target' },
  'task.field.checkpoints': { zh: '检查点', en: 'Checkpoints' },
  'task.field.checkpointsHint': { zh: '每行一个：第一章@10', en: 'One per line: Chapter 1@10' },
  'task.checkpoint.needTotal': { zh: '检查点需要目标量', en: 'Checkpoints need a target amount' },
  'task.checkpoint.beyond': { zh: '检查点「{label}」的位置 {at} 超过目标量 {total}', en: 'Checkpoint “{label}” at {at} is past the target of {total}' },
  'task.state.overdue': { zh: '逾期未完成', en: 'Overdue' },
  'task.state.doing': { zh: '进行中', en: 'In progress' },
  'task.bar.done': { zh: '已完成 {percent}%（{current}/{total}）', en: 'Done {percent}% ({current}/{total})' },
  'task.bar.overdue': { zh: '逾期未完成 {percent}%（{current}/{total}）', en: 'Overdue {percent}% ({current}/{total})' },
  'task.bar.doing': { zh: '进行中 {percent}%（{current}/{total}）', en: 'In progress {percent}% ({current}/{total})' },
  'task.bar.todo': { zh: '未完成 {percent}%（{current}/{total}）', en: 'Not started {percent}% ({current}/{total})' },
  'task.completedAt': { zh: '完成于 {date}', en: 'Finished {date}' },
  'task.checkpoint.pending': { zh: '{label}@{at} 未到', en: '{label}@{at} not reached' },
  'task.checkpoint.reached': { zh: '{label}@{at} 已到 {date} {time}', en: '{label}@{at} reached {date} {time}' },
  'task.bar.release': { zh: '松开写入进度', en: 'Release to set progress' },
  'task.bar.drag': { zh: '拖动或 ←/→ 调整进度', en: 'Drag or press ←/→ to set progress' },
  'task.bar.click': { zh: '点击切换完成，←/→ 也可', en: 'Click to toggle done, or press ←/→' },
  'task.count': { zh: '当前 / 目标量', en: 'current / target' },
  'task.progressLabel': { zh: '{title} 进度', en: '{title} progress' },
  'registry.openFocus': { zh: '进入专注模式', en: 'Open focus mode' },
  'registry.archive': { zh: '归档 {count} 条', en: '{count} archived' },
  'registry.field.notes': { zh: '备注', en: 'Notes' },


  // ---- the statistics view -----------------------------------------------
  'stats.range.week': { zh: '近 7 天', en: 'Last 7 days' },
  'stats.range.month': { zh: '本月', en: 'This month' },
  'stats.range.d30': { zh: '近 30 天', en: 'Last 30 days' },
  'stats.range.d90': { zh: '近 90 天', en: 'Last 90 days' },
  'stats.title': { zh: '习惯统计', en: 'Habit stats' },
  'stats.range.from': { zh: '自定义起始日', en: 'Custom start day' },
  'stats.range.to': { zh: '自定义结束日', en: 'Custom end day' },
  'stats.range.reset': { zh: '默认范围', en: 'Default range' },
  'stats.loading': { zh: '加载中…', en: 'Loading…' },
  'stats.heat.title': { zh: '完成热力图', en: 'Completion heatmap' },
  'stats.heat.meta': { zh: '{days} 天 · 完美日 {perfect}', en: '{days} days · {perfect} perfect' },
  'stats.heat.cell': { zh: '{date}　{state}', en: '{date} {state}' },
  'stats.heat.streak': { zh: '连续 {count}', en: 'streak {count}' },
  'stats.heat.note': { zh: '每格一天；「连续」是到区间结束为止的连续达标天数', en: 'One cell a day; the streak counts met days back from the range\'s end.' },
  'curve.title': { zh: '心率-配速曲线', en: 'Heart rate and pace' },
  'curve.points': { zh: '{count} 个点', en: '{count} points' },
  'curve.empty': { zh: '这段时间没有同时记录了里程与心率的跑步', en: 'No runs in this range recorded both distance and heart rate' },
  'curve.aria': { zh: '心率-配速散点，按里程分色', en: 'Heart rate and pace scatter, coloured by distance' },
  'curve.point': { zh: '{date} · {km} km · {pace} 分/km · ♥{hr}', en: '{date} · {km} km · {pace} min/km · ♥{hr}' },
  'curve.xAxis': { zh: '配速（越右越快）', en: 'Pace (faster to the right)' },
  'curve.legend': { zh: '{km} km · {count} 次', en: '{km} km · {count} runs' },
  'curve.frontier': { zh: '前沿', en: 'Frontier' },
  'stats.registry.title': { zh: '登记', en: 'Registry' },
  'stats.media.finished': { zh: '完成（区间）', en: 'Finished (in range)' },
  'stats.media.listed': { zh: '在列 / 弃', en: 'Listed / dropped' },
  'stats.media.kinds': { zh: '电影 / 书', en: 'Films / books' },
  'stats.media.rating': { zh: '平均评分', en: 'Average rating' },
  'stats.tasks.done': { zh: '任务完成（区间）', en: 'Tasks done (in range)' },
  'stats.tasks.doneLate': { zh: '其中逾期完成', en: 'Done late' },
  'stats.tasks.open': { zh: '未完成 / 进行中', en: 'Open / doing' },
  'stats.tasks.overdue': { zh: '当前逾期', en: 'Overdue now' },
  'stats.focus.total': { zh: '累计专注', en: 'Focus time' },
  'stats.focus.detail': { zh: '{minutes} 分（{sessions} 段）', en: '{minutes} min ({sessions} sessions)' },
  'stats.card.run': { zh: '跑步', en: 'Running' },
  'stats.card.rope': { zh: '跳绳', en: 'Jump rope' },
  'stats.card.pullup': { zh: '引体向上', en: 'Pull-ups' },
  'stats.card.plank': { zh: '平板支撑', en: 'Plank' },
  'stats.card.equipment': { zh: '健身器材', en: 'Equipment' },
  'stats.card.free': { zh: '自由锻炼', en: 'Free training' },
  'stats.row.newReview': { zh: '新词 / 复习', en: 'New / review' },
  'stats.row.minutes': { zh: '总时长', en: 'Total time' },
  'stats.row.daysMet': { zh: '达标天数', en: 'Days met' },
  'stats.row.surplus': { zh: '超额', en: 'Above target' },
  'stats.row.lessons': { zh: '节数', en: 'Lessons' },
  'stats.row.duration': { zh: '时长', en: 'Time' },
  'stats.row.runs': { zh: '次数', en: 'Runs' },
  'stats.row.km': { zh: '里程', en: 'Distance' },
  'stats.row.avgHr': { zh: '平均心率', en: 'Avg heart rate' },
  'stats.row.ropeDays': { zh: '记录天数', en: 'Days recorded' },
  'stats.row.totalJumps': { zh: '总次数', en: 'Total jumps' },
  'stats.row.tempo': { zh: '平均节奏', en: 'Avg tempo' },
  'stats.row.sets': { zh: '组数', en: 'Sets' },
  'stats.row.hold': { zh: '支撑总时长', en: 'Total hold' },
  'stats.row.setsAndMoves': { zh: '组数 / 动作数', en: 'Sets / moves' },
  'stats.row.sessions': { zh: '次数', en: 'Sessions' },
  'stats.row.kcal': { zh: '消耗', en: 'Burned' },
  'stats.row.washes': { zh: '洗涤次数', en: 'Washes' },
  'stats.row.pieces': { zh: '总件数', en: 'Pieces' },
  'stats.row.breakfast': { zh: '早饭打卡', en: 'Breakfast days' },
  'stats.row.spend': { zh: '总花费', en: 'Total spend' },
  'stats.equipment.entry': { zh: '{sets} 组 · {reps} 次', en: '{sets} sets · {reps} reps' },
  'stats.free.kcalMeasured': { zh: '{kcal} kcal（{count} 次有记录）', en: '{kcal} kcal ({count} measured)' },
  'stats.meals.breakfastValue': { zh: '{days} 天（{percent}%）', en: '{days} days ({percent}%)' },

  // ---- the focus column ------------------------------------------------
  'focus.progress': { zh: '进度 {current}/{total}', en: '{current}/{total} done' },
  'focus.due.today': { zh: '截止于今天', en: 'due today' },
  'focus.due': { zh: '截止于{date}', en: 'due {date}' },
  'focus.kind.film': { zh: '影', en: 'Film' },
  'focus.kind.book': { zh: '书', en: 'Book' },
  'habitDay': { zh: '习惯日 {date}', en: 'Habit day {date}' },
  'focus.night': { zh: '夜', en: 'night' },
  'focus.openTasks': { zh: '剩余任务', en: 'open' },
  'focus.overdueTasks': { zh: '逾期', en: 'overdue' },

  // ---- the left column's todos -------------------------------------------
  'todo.title': { zh: '待办', en: 'Todos' },
  // The phone's fold row, which is the whole column when it is closed.
  'todo.openCount': { zh: '{count} 条未完成', en: '{count} open' },
  'todo.add': { zh: '新建待办', en: 'Add a todo' },
  'todo.addHint': { zh: '加一条待办…', en: 'Add a todo…' },
  'todo.empty': { zh: '还没有待办：在上面写一条，按回车就行', en: 'No todos yet — type one above and press Enter' },
  'todo.focused': { zh: '专注过', en: 'Focused on' },
  'todo.focus': { zh: '专注 {duration}', en: '{duration} focused' },
  'todo.markDone': { zh: '标记完成', en: 'Mark done' },
  'todo.markUndone': { zh: '取消完成', en: 'Mark not done' },
  'todo.remove': { zh: '删除这条待办', en: 'Delete this todo' },

  // ---- data in and out (export / import / sweep) -----------------------
  'data.title': { zh: '数据', en: 'Data' },
  'data.pending': { zh: '待导入 {name}', en: '{name} to import' },
  'data.export': { zh: '导出', en: 'Export' },
  'data.pick': { zh: '选择备份…', en: 'Choose a backup…' },
  'data.sweep': { zh: '清理未引用图片', en: 'Sweep unreferenced images' },
  'data.exported': { zh: '已导出 {days} 天记录', en: 'Exported {days} days' },
  'data.imported': {
    zh: '导入完成：{days} 天、{media} 影视书籍、{tasks} 任务',
    en: 'Imported {days} days, {media} films and books, {tasks} tasks',
  },
  'data.imported.assets': { zh: '、{count} 张图片', en: ', {count} images' },
  'data.imported.removed': { zh: '，清掉 {count} 条本地多余记录', en: ' ({count} extra local records removed)' },
  'data.staged': {
    zh: '{days} 天、{media} 影视书籍、{tasks} 任务',
    en: '{days} days, {media} films and books, {tasks} tasks',
  },
  'data.merge': { zh: '合并', en: 'Merge' },
  'data.replace': { zh: '覆盖（清空现有）', en: 'Replace (clear what is there)' },
  'data.cancel': { zh: '取消导入', en: 'Cancel the import' },
  'data.note': {
    zh: '合并：文件中的记录覆盖同键项；覆盖：文件里没有的本地记录会被删除',
    en: 'Merge: the file wins on shared keys. Replace: local records the file omits are deleted.',
  },
  'data.swept': { zh: '已清理 {count} 张未引用的图片', en: 'Swept {count} unreferenced images' },
  'data.nothingToSweep': { zh: '没有可清理的图片', en: 'Nothing to sweep' },
  'data.tooBig': { zh: '文件超过 64 MB，可能不是本插件的备份', en: 'That file is over 64 MB and is probably not this plugin’s backup' },
  'data.badJson': { zh: '文件不是合法的 JSON', en: 'That file is not valid JSON' },
  'data.notBackup': { zh: '这不是本插件的备份文件', en: 'That file is not this plugin’s backup' },


  // ---- focus mode (overlay) --------------------------------------------
  'focus.block.new': { zh: '新文本块', en: 'New block' },
  'focus.total.live': { zh: '累计专注 {duration}（含本段）', en: '{duration} focused in total, this session included' },
  'focus.progress.label': { zh: '进度', en: 'Progress' },
  'focus.progress.minus': { zh: '减 1', en: 'One less' },
  'focus.progress.plus': { zh: '加 1', en: 'One more' },
  'focus.progressOf': { zh: '{title} 进度', en: '{title} progress' },
  'focus.markDone': { zh: '标记完成', en: 'Mark done' },
  'focus.markUndone': { zh: '标记未完成', en: 'Mark not done' },
  'focus.fullscreen.toggle': { zh: '切换浏览器全屏', en: 'Toggle browser fullscreen' },
  'focus.fullscreen.enter': { zh: '屏幕全屏', en: 'Fullscreen' },
  'focus.fullscreen.exit': { zh: '退出全屏', en: 'Exit fullscreen' },
  'focus.fullscreen.denied': { zh: '浏览器拒绝了全屏请求，已用页内全屏', en: 'The browser refused fullscreen; this view stays in the page' },
  'focus.exit': { zh: '退出专注', en: 'Leave focus' },
  'focus.exit.title': { zh: '退出专注（Esc）', en: 'Leave focus (Esc)' },
  'note.title': { zh: '笔记', en: 'Notes' },
  'note.saving': { zh: '保存中…', en: 'Saving…' },
  'note.saveFailed': { zh: '保存失败', en: 'Not saved' },
  'note.saved': { zh: '已保存 ✓', en: 'Saved ✓' },
  'note.placeholder': { zh: '随手记：思路、待查、解题步骤……', en: 'Quick notes: ideas, things to check, steps…' },
  'checkpoint.jump': { zh: '进度跳到这里', en: 'Jump to this point' },
  'checkpoint.reached': { zh: '已到', en: 'reached' },
  'checkpoint.ahead': { zh: '未到', en: 'ahead' },
  'material.title': { zh: '素材', en: 'Materials' },
  'material.none': { zh: '空', en: 'None' },
  'material.counts': { zh: '{texts} 文本 · {images} 图', en: '{texts} text · {images} images' },
  'material.text': { zh: '文本', en: 'Text' },
  'material.addImage': { zh: '添加图片…', en: 'Add image…' },
  'material.dropHint': { zh: '粘贴或拖入图片', en: 'Paste or drop images' },
  'material.noImage': { zh: '拖入的文件里没有图片', en: 'No images in those files' },
  'material.markdown': { zh: '文本 · Markdown', en: 'Text · Markdown' },
  'material.done': { zh: '完成编辑', en: 'Done editing' },
  'material.removeBlock': { zh: '删除这块', en: 'Delete this block' },
  'material.missing': { zh: '图片缺失：{name}', en: 'Image missing: {name}' },
  'material.removeEntry': { zh: '移除这条', en: 'Remove this one' },
  'material.imageAlt': { zh: '素材图', en: 'Material image' },
  'material.zoomOut': { zh: '缩回整页适应', en: 'Fit the page' },
  'material.zoomIn': { zh: '查看原始尺寸', en: 'Actual size' },
  'material.removeImage': { zh: '删除这张', en: 'Delete this image' },
  'material.tooBig': { zh: '「{name}」超过 {limit} MB，已拒绝', en: '{name} is over {limit} MB and was refused' },
  'material.unreadable': { zh: '「{name}」读取失败', en: 'Could not read {name}' },
  'material.notImage': { zh: '「{name}」不是可识别的图片', en: '{name} is not an image this browser can read' },

  // ---- shared units that read differently in a sentence ----------------
  'unit.minutes': { zh: '{minutes} 分', en: '{minutes} min' },
  'unit.seconds': { zh: '{seconds} 秒', en: '{seconds} s' },
  'unit.dash': { zh: '——', en: '—' },

  // ---- failures: the host sends a code, the panel says the sentence ----
  'error.withCode': { zh: '{message}（{code}）', en: '{message} ({code})' },
  'error.habit.check-limit': { zh: '{habit}今天已经打过卡了', en: '{habit} is already checked in today' },
  'error.habit.not-found': { zh: '没有这条记录', en: 'No such record' },
  'error.habit.bad-request': { zh: '这个请求主机不接受', en: 'The host rejected this request' },
  'error.habit.range-too-large': { zh: '统计范围最多 {days} 天', en: 'A statistics range covers at most {days} days' },
  'error.habit.too-large': { zh: '请求体太大', en: 'The request body is too large' },
  'error.habit.bad-json': { zh: '请求体不是合法 JSON', en: 'The request body is not valid JSON' },
  'error.habit.bad-backup': { zh: '这不是本插件的备份文件', en: 'That file is not this plugin’s backup' },
  'error.habit.internal': { zh: '插件内部出错了', en: 'The plugin failed internally' },
  'error.habit.stale-host': { zh: '插件宿主半身未更新：请重启 dsh --profile web', en: 'The plugin’s host half is stale: restart dsh --profile web' },
  'error.habit.unreachable': { zh: '无法连接插件服务：{detail}', en: 'Cannot reach the plugin service: {detail}' },
} as const satisfies Record<string, CopyRow>

/** Every key, as a union — the argument type of `t`. */
export type CopyKey = keyof typeof COPY

/** One language's dictionary, projected from the table. */
export type Dictionary = Record<CopyKey, string>

/** Project one language out of the table: same keys, by construction. */
export function dictionaryOf(language: keyof CopyRow): Dictionary {
  const out = {} as Record<CopyKey, string>
  for (const key of Object.keys(COPY) as CopyKey[]) out[key] = COPY[key][language]
  return out
}

/** The Chinese dictionary. */
export const ZH: Dictionary = dictionaryOf('zh')

/** The English dictionary. */
export const EN: Dictionary = dictionaryOf('en')
