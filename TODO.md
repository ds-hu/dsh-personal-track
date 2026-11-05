# TODO

五件事的清单、建议顺序与验收口径。**一轮只做一项**：改代码 + 测试 + 文档 + CHANGELOG，
做完把状态改成 ✅ 并写一句结果。下表的编号只是索引，**执行顺序看下面那节**。

## 状态

| # | 事项 | 状态 |
|---|---|---|
| 1 | README 重写 + badge/截图 + 中文版 + `AGENTS.md` | ⬜ |
| 2 | i18n 完善 | ✅ 本轮 |
| 3 | 跳绳：去掉强制 90/180 定数，向跑步看齐 | ✅ |
| 4 | 跑步：曲线按里程聚类分色，Pareto Frontier 虚线 | ✅ 本轮 |
| 5 | 报告复制：补 DDL 与当日及以后截止的已完成任务 | ✅ |

## 建议顺序与理由

**5 → 3 → 4 → 2 → 1**

1. **5 先做**：规格最完整、改动面最小（一个纯函数加它的测试），先把这一轮的
   实现—测试—文档闭环跑通，不改存储形状，不牵动别的任务。
2. **3 次之**：它改的是**存进磁盘的形状**（`rope[].preset`），统计、报告、备份兼容
   都从这条记录派生；越早定，后面越少返工。
3. **4 独立**：只动统计视图的客户端绘图，与 3 的记录形状无关，放 3 之后即可。
4. **2 靠后**：所有界面文案进字典前，最好先让 3/4/5 的文案定稿，否则新字符串要翻两遍。
5. **1 最后**：README/AGENTS 记录的是最终状态；放最后才不用边写边改。

---

## 1. README 重写 + badge/截图 + 中文版 + `AGENTS.md`

**现状**：`README.md` 335 行，功能说明、安装、开发、数据、结构与「工具链注意事项（都踩过）」
混在一起；最后那 40 行是给维护者/agent 的规则，不是用户文档。没有 badge、没有截图、只有中文。

**要做**

- README 只留用户需要的：一句话定位、截图、能力表、安装（link / GitHub / patch）、配置四个字段、
  数据与备份、开发命令、结构。目标 ≤ 120 行。
- 「工具链注意事项」整段搬进新建的 `AGENTS.md`（esbuild 走 CLI、测试用 Node 类型剥离、
  域版本与 `compatibleVersions`、box-sizing、`prefers-color-scheme`、inject 声明、写回形状等）。
  `AGENTS.md` 同时写清：构建/测试/验证命令、宿主改 vs 客户端热重载、上界单位、提交与发布口径。
- badge：license、version、`pnpm test`、DSH 插件、platform（web）。取 GitHub 静态 badge，
  不引第三方计数服务。
- 截图：看板、统计、专注模式、素材各一张，从 `http://127.0.0.1:3080` 的真实界面截，
  放 `docs/images/`；**先确认 profile 里装的是本仓库**，再决定是否用 `demo/focus-mode.html` 兜底。
- 中文版：`README.md` 用英文（GitHub 默认展示），`README.zh.md` 保留完整中文；两版互链，
  内容一一对应。**待定**：若更希望中文为主档，则反过来，只改文件名约定。

**验收**：README ≤ 120 行且不再包含工具链踩坑；两版章节对齐；badge 全部可解析；
`AGENTS.md` 里的每条命令都能直接跑；`docs/images/` 的图片在 README 里能显示。

## 2. i18n 完善

**现状**：`locale/{en,zh}.json` 只有 `meta.title` / `meta.description`（Plugins 面板用）；
界面文案、报告文本、宿主返回的习惯名全是硬编码中文。

**要做**

- 用外壳的 locale 服务：客户端插件 `inject: ['slots', 'locale']`，
  `ctx.locale.register(ns, { zh, en })` 注册字典，组件里用 `ctx.locale.bind(ns)` 或注入的 `t`。
  需要 `@deepseek-ai/dsh-client-locale/client` 的类型声明合并（`LocaleNamespaceMap`），
  因此要把它加进 devDependencies。
- **先对齐版本**：本仓库 devDeps 是 `0.1.5-rc.2`，运行时 dsh 是 `0.2.2-rc.1`；
  `dsh-client-locale` 的类型只在较新版本里有。本轮不动，做 2 之前先升级并对齐整套 `@deepseek-ai/*`。
- 范围：看板、统计、数据卡、专注模式、专注栏、表单标签、错误与空态、复制的报告文本；
  宿主返回的 `label`（`src/host/habits.ts` 的中文名、餐位名）应改成 id，由客户端翻译；
  `locale/*.json` 的 `meta` 保留并补全。
- 字典要求：`zh` / `en` 两套键完全一致；报告跟随界面语言（它要贴进聊天）。
- **验收**：切换语言即时生效；`grep` 不到残留的中文 UI 字面量（报告/日志/测试除外）；
  新增一条测试断言两套字典的键集合相同；`pnpm verify` 通过。

## 3. 跳绳：去掉强制 90/180 定数，向跑步看齐 ✅

**现状**：`day.rope[]` 每条是 `{ id, at, preset: 90 | 180, seconds, avgHr? }`；
表单是「定数 90/180」下拉。统计出 `sets90/sets180`，报告写 `90×n 180×m`。

**要做**

- **口径已定**：每天一条 `{ at, count, seconds, avgHr? }`，交互照跑步（一条、可改可删）；
  `count` 必填、`seconds` 必填、`avgHr` 可选。时长仍以秒存（跳绳按秒计，与现有字段一致），
  卡片在不足 1 分时显示秒、否则折成分钟。
- 兼容：域里 `rope` 仍是数组（旧文档照常解析），**读取时把多组合并成一天一条**
  （次数与秒数相加、心率按秒数加权、时间取最早一组），新写入只落一条；
  域版本不升，备份版本不动。
- **统计面板**：`StatsView.rope` 改为 `{ days, count, seconds, tempo?, avgHr? }`，删掉
  `sets / sets90 / sets180`；卡片五行——记录天数、总次数、总时长、
  平均节奏（总次数 ÷ 总分钟）、平均心率（只算有读数的记录）；空区间保持 0 与 ——。
- 落点：`src/host/domain.ts`、`routes.ts`（`sessionSchemas`）、`store.ts`、`stats.ts`、
  `src/client/types.ts`、`fitness.tsx`、`report.ts`、`stats-panel.tsx`，
  `tests/{api-handle,store,stats,data-layer,habits,client-format}.test.ts`，
  `scripts/verify-host.mjs`，`CONTEXT.md`/README/CHANGELOG。
- **验收**：可记任意次数；`POST /session` 不再接受 90/180 枚举；旧日文档与 v1–v3 备份照常读；
  统计给出记录天数 / 总次数 / 总时长 / 平均节奏 / 平均心率；报告写合并后的次数、时长、节奏与心率；
  测试覆盖"遗留 preset 仍可读"与"任意次数可写"。

## 4. 跑步：曲线按里程聚类分色 + Pareto Frontier

**现状**：`stats.runs.points`（`{date, pace, avgHr, km}`）按日期相邻连成一条 `path`；
一次 3 km 和一次半马会被直接连起来，轨迹没有含义。

**口径**（第 3 轮前经 clarity round 定稿，A 方案）

- **分档**：`max(1, round(km))`——最近整公里，不用固定区间（阈值是编造的常量，里程一变就失准）。
  档名就是 `4 km`，3.62 km 那次也算这一档，精确里程留在 tooltip。
- **档内排序**：按配速升序（同速按日期）；同配速只留心率最低的一次，所以重复记录不会叠出两个点。
- **前沿**：**每档各求各的**非支配点集（配速不更大、心率不更高），档内按配速升序用虚线连；
  不足 2 点就只画套圈。不跨档求全局前沿——本机 15 次跑出来的全局前沿只剩「最快的 1 km」
  与「最慢的 4 km」两个点，说的是「跑得快心率高」这种废话。
- **不再连线**：除前沿虚线外没有任何线，日期只进 tooltip（用户原话：不再随意连接相邻两点）。
- **颜色**：同一绿色 5 档深浅（`--pt-curve-1..5`，半透明以同时适配明暗主题），出现的档
  均匀铺满整条 ramp；图例只在 ≥2 档时出现。
- **坐标域**仍是全体点，不按档归一化，否则三档无法互相比较。

**落点**：`src/client/board/run-curve.ts`（新）、`stats-panel.tsx` 的 `Curve`、`styles.ts`、
`tests/run-curve.test.ts`（新）。宿主、域、备份都不动。

**验收**：跨档不连；前沿按档各一条；空集 / 单点 / 单档都退化为可读状态；
测试覆盖分档边界（0.4 / 1.49 / 1.5 / 4.5 / 21.1）与支配关系，并把「全局前沿只剩两点」钉成断言。

## 5. 报告复制：补 DDL 与当日及以后截止的已完成任务 ✅

**目标**（用户原话）：逾期 / 当日的 DDL 也写进纯文本报告；当日及以后截止且已完成的任务也放。

**口径**

- 每条任务都写截止日的 `月-日`；**逾期**的在日期后加「逾期」；
- 列出：全部未完成任务 + 已完成且 `due >= 今天` 的任务（无截止的已完成不收）；
- 已完成项在行末标 ` ✓`；顺序仍用看板那一个比较器（未完成在前，各自按截止升序，无截止在末）。

**落点**：`src/client/board/report.ts`（`taskLines`）、`tests/client-format.test.ts`、
`CONTEXT.md` 的**习惯日报**与 `Flagged ambiguities`、README 的「复制纯文本报告」段、CHANGELOG。

**验收**：逾期行含日期与「逾期」；当日到期行含日期；当日/未来截止的已完成项出现且带 ` ✓`；
过期或没有截止的已完成项不出现；空任务日不出现任务段；上述各条都有断言。

---

## 第 1 轮结果（5）

- `taskLines` 改成「任务视图」：未完成 + 当日及以后截止的已完成，DDL 一律写出，逾期加标注，
  已完成行末 ` ✓`，标题从「剩余任务：」改为「任务：」。
- `tests/client-format.test.ts` 断言逾期日期、当日日期、已完成收录/排除与排序；空日断言同步。
- `CONTEXT.md`、README、CHANGELOG 同步口径。
- 验证：15/15 测试文件通过；三套 `tsc` 通过；`scripts/build.mjs` + `verify-client` + `verify-host` 通过。
  注入验证：把旧实现放回去后新断言以 exit 1 失败，恢复后文件 sha256 与原文件一致。

## 第 2 轮结果（3）

- **形状**：跳绳每天一条 `{ at, count, seconds, avgHr? }`；`count` 自由、写入必填，旧文档的
  `preset` 作为遗留字段只读不写。域里仍是数组，**读取时合并**：`src/shared/rope.ts` 的
  `mergeRope` 取最早时间、次数与用时相加、心率按用时加权；`addSession` / `patchSession` /
  `removeSession` 对 rope 都归一成一条，所以新建与编辑只有一条写路径。
- **界面**：`RopeTile` 与 `RunTile` 同形（未记录 → 记录；有记录 → 次数 / 用时 / 节奏 / 心率 / 时间，
  ✎ 与 ×），表单是 次数 / 用时(秒) / 心率，没有「定数」下拉。
- **统计**：`StatsView.rope` 改为 `{ days, count, seconds, tempo?, avgHr? }`；卡片五行——
  记录天数、总次数、总时长、平均节奏、平均心率；节奏是区间合计口径，空区间为 0 与 ——。
- **报告**：健身行写 `跳绳 1200 个 10 分 120 次/分 ♥135`，旧多组在报告里也是同一个合并值。
- 验证：新增 `tests/rope.test.ts`（合并 / 节奏 / 时长格式），store、stats、api、report、data-layer
  夹具与断言同步；`verify-host` 新增「一天一条、第二次写入替换」与「v1 文档里的旧组仍可读且统计合并」。
  16/16 测试文件通过；三套 `tsc` 通过；`build.mjs` + `verify-client` + `verify-host` 通过。
  注入验证：把 `addSession` 的 rope 分支换回追加、把 `mergeRope` 换成只取一组，各自让对应断言以
  exit 1 失败；恢复后两文件 sha256 与注入前一致。

## 第 3 轮结果（4）
- **分档**：`run-curve.ts` 的 `clusterKey` = `max(1, round(km))`；`clusterRuns` 按档升序返回，
  档内按配速（同速按日期）排序，并附上该档的前沿。
- **前沿**：`paretoFrontier` 先按配速去重（留低心率），再一趟扫描留心率严格下降的点，
  所以顺序天然是「最快在前、心率单调下降」。**每档各算各的**（clarity round 选 A）。
- **绘图**：`Curve` 删除日期折线，只画散点 + 每档一条虚线前沿 + 前沿点的套圈；
  颜色用 `--pt-curve-1..5` 的绿色深浅铺满 ramp，图例仅在 ≥2 档时出现。
  `pt-curve-line` 换成 `pt-curve-front` / `pt-curve-flag` / `pt-curve-legend`。
- 本机 15 次实测：1 km（4 次，前沿 1 点，画不出线）、3 km（3 次，前沿 3 点）、
  4 km（8 次，前沿 2 点：11-04 的 6.9/♥157 与 09-11 的 8.3/♥150）。
- 验证：新增 `tests/run-curve.test.ts`（18 项，含把真实 15 次跑成夹具）；17/17 测试文件通过；
  三套 `tsc` 通过；`build.mjs` + `verify-client` + `verify-host` 通过。
  `verify-client` 新增三条守卫：五个 `--pt-curve-N` 必须齐全、必须同时有浅色与深色两套、
  深色那套必须挂在 `body[data-ds-dark-theme]` 上——少一个时类型检查、构建、CSS 解析都不报错，
  只有 SVG 的 `fill` 悄悄解析失败画成黑点。
  注入验证（三次）：把 `paretoFrontier` 的支配判断改成恒真（被支配点也进前沿），6 项断言以 exit 1
  失败；删掉 `--pt-curve-5`，守卫以 exit 1 失败；删掉深色那套的第一步，另一条守卫以 exit 1 失败。
  三次恢复后 sha256 均与注入前一致。
  宿主未改动，客户端热重载即可。
- **返工一次**（用户第一次实测打回：「这好像是同一个绿？」）：`.pt-curve-dot { fill: var(--pt-accent) }`
  压掉了每个圆点自己带的表现属性，五档颜色全退成同一个绿；而且同色相的透明度阶梯本来就
  区分度不够。两处一起改：颜色改走内联 `style`，ramp 从「一个绿的五个浓度」改成
  「蓝 → 青 → 绿 → 橄榄 → 琥珀」五色（深浅主题各一套）。返工后用 `styles.ts` 里的真实样式表
  在本地渲染了两种主题核对，不再用 mock 自带的颜色。

## 第 4 轮结果（2）

- **口径**（用户两个决定）：全量双语（357 条，英文逐条写）；宿主那半边**全部改成错误码 + 客户端翻译**。
- **字典**：`src/client/copy/table.ts` 一张表，一行 = 一个键 + `{ zh, en }`，两本词典由
  `dictionaryOf()` 投影。所以「两套键集合相同」是形状，不是靠测试盯着；`tests/copy.test.ts`
  只断言构造看不见的部分：英文里没有残留汉字、两边的占位符**名字与顺序**一致、填完不留花括号。
- **`t` 的到达方式**：`CopyProvider` + `useCopy()`（context），不是 props——整块面板是一棵树。
  provider 订阅 `locale.subscribe`：切语言不是重新挂载，不订阅的话每个标签都停在挂载时那门语言。
  纯模块（报告、格式化）收 `Copy` 参数，测试传 `copyFor('zh' | 'en')`，不需要 React。
- **`language` 挂在 `t` 上**：`Intl` 要的是 tag 不是句子（`9月16日` vs `Sep 16`），所以
  `Copy` 是个带 `language` 属性的函数，格式化函数只需一个参数，两个参数不会互相打架。
- **宿主不说语言**：`habits.ts` 去掉 `label`，wire 上的**格**只带 id（任务格仍带 title，那是内容）；
  统计行同样只带 id。失败改为 `ApiError(status, code, message, params)`，`params` 只装句子需要的
  数字/名字，`messageOf` 查 `error.<code>` 并把 `habit` 参数翻成习惯名，未知 code 退回原句 + code。
- **两处共用模块的修正**：`shared/rope.ts` 的 `ropeDurationText`（返回 `45 秒`）换成
  `ropeDurationOf`（返回 `{unit, value}`）——共用模块只决定用哪个单位，词归面板；
  `format.ts` 的 `timeOf` 不再用 `toLocaleTimeString('zh-CN')`，改成手写 pad（与语言无关）。
- **样式**：`.pt-heat-label` 从 `3.6em` 加到 `6.2em`——"Vocabulary""Breakfast" 是 洗漱/早饭 的两倍宽，
  内容自适应会让热力网格的行与行错位。
- **验证**：18/18 测试文件通过（新增 `tests/copy.test.ts`；`client-format` 增加一条英文报告断言，
  证明同一组数字用两种语言都念得出来）；三套 `tsc` 通过；`build.mjs` + `verify-client` + `verify-host` 通过。
  源码遍历确认：`src/client` 里除 `copy/table.ts` 之外**没有**汉字字面量（注释先剥掉，共 30 个文件）。
  注入验证（两次）：往 `Chip.tsx` 塞一个中文 `title` → 守卫 exit 1；从英文词典删掉 `panel.title` →
  第二条守卫 exit 1（须先 rebuild，守卫读产物）；恢复后 sha256 均与注入前一致。
- **已知边界**：英文没有复数机制（"1 entries"）；条目多到 6 档以上时曲线会出现相邻两档共色（第 3 轮已说明）。
