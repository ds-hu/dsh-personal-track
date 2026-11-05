# AGENTS.md

给在这个仓库里改代码的人（和 agent）。用户文档在 [README.md](./README.md)，
领域语言在 [CONTEXT.md](./CONTEXT.md)，决策背景在 [docs/adr/](./docs/adr/)。
这里只写**做错会静默出问题**的那些事实。

## 命令

```powershell
pnpm install      # 装依赖；prepare 顺带跑一次 build
pnpm build        # lib/index.js（ESM，宿主）+ lib/client.js（浏览器闭包工厂）
pnpm watch        # 只重建产物
pnpm typecheck    # 三个独立程序：tsconfig.host.json / .client.json / .tests.json
pnpm test         # 逐文件跑 tests/*.test.ts，任一失败即整体失败
pnpm verify       # 先构建，再跑 verify-client（facade）+ verify-host（真实栈）
```

- **测试与构建的入口都别改成 pnpm 脚本嵌套**：`verify` 里嵌 `pnpm build` 会触发 pnpm 的依赖自检，
  无 TTY 时以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止。检查链里一律写 `node scripts/*.mjs`。
- **跑测试用 Node 的原生类型剥离**（`node tests/x.test.ts`），不要引入 vitest：vite/vitest 经 esbuild
  的 JS API 转换 TS，在 DSH 文件沙箱里被拒（管道 stdio 派生 → `spawn EPERM`）。同理 `scripts/build.mjs`
  用的是 **esbuild 原生 CLI**，因为它自己就是编译器、无需派生。
- **一个文件一个进程**：`scripts/run-tests.mjs` 逐文件起 `node`，所以一个文件里的 `process.exitCode`
  不会污染下一个；写测试时按文件自足（自己的 fixture、自己的 `check()` 或共用的 `createChecker`）。
- **二次跑 `verify` 前删掉 `.tmp/verify-host`**：JSON 后端每次写入都是「临时文件 + rename」，
  而被中断的一次会留下文件，沙箱在工作区根上的删除拒绝项会让下一次的 `rename` 报 `EPERM`。

## 两个半身，两套重载规则

- **宿主半身**（`src/host`，`lib/index.js`）：模块源码改动**必须重启 `dsh --profile web`**。
  Node 的 ESM 缓存不因 patch 重载失效。只改 profile 的 `cordis.patch.yml` 是 live 的。
- **浏览器半身**（`src/client`，`lib/client.js`）：宿主对送出的 bundle 做 stat 轮询并推 SSE，
  改动会被自动换到新 rev——但前提是有 watcher（`pnpm watch` 或 `dsh` 自带的 dev 流程）。
  没有 watcher 时它**不报错**，只是安静地继续跑旧产物。
- 因此**客户端可以先于宿主更新**：契约不符时要大声失败，不要静默画半个界面。
  现成的一条是 `isEntryView` / `staleHostError()`，提示「插件宿主半身未更新」。
- **判断"改的代码在不在跑"**：看报错栈的行号与当前源码对不对得上。对不上就是旧 bundle。

## 依赖与模块身份

- 客户端 bundle 的运行时依赖只有冻结平台表里的模块（`react`、`react/jsx-runtime`、`react-dom`…）；
  其余 `@deepseek-ai/*` 一律 `import type`，构建期擦除。跨插件取值只能经 `ctx` 服务或 slots。
- **`ctx.<服务>` 每一个都要写进 `inject`**：声明合并让类型随时可见，运行时只认 inject 集合里的名字，
  漏写要到真正访问那一刻才抛 `cannot get property "…" without inject`。`verify-client.mjs` 的假
  context 是带同款守卫的 Proxy，未声明的访问在 facade 测试里当场失败。
- **SlotMap 按 import 做声明合并**：用到某个 slot 必须 import 声明它的包
  （如 `sidebar.panellist` 在 `@deepseek-ai/dsh-client-ui-sidebar/client`），否则类型上不存在。
- 外部包的版本**与本机运行时不齐**：本仓库 devDeps 是 0.1.5 线，运行中的 `dsh` 是 0.2.2 线。
  所以 `src/client/locale.ts` 自己声明了用到的四个 locale 成员，而不是引入 `dsh-client-locale` 的
  `.d.ts`（那会连带 package-manifest 与 settings 两张类型网）。要动这段，先确认运行时那侧的形状。

## 文案（唯一来源）

- **所有界面文字只在 `src/client/copy/table.ts` 里**：一行 = 一个键 + `{ zh, en }`，两本词典由它投影。
  在组件里写中文或英文句子会被 `verify-client.mjs` 拦下（它遍历 `src/client`，剥掉注释后不允许出现汉字）。
- 组件里用 `useCopy()`（`src/client/copy`）；纯模块（报告、格式化）收 `Copy` 参数，测试传
  `copyFor('zh' | 'en')`。**不要**给组件加 `t` prop。
- 句子里有数字就写 `{name}` 占位符，一个键一句话；**不要把两段词典拼成一句**。
- **宿主不说语言**：习惯/格以 id 过 wire，名字由 `habit.<id>` / `cell.<id>` 给；
  失败以 `code` + `params` 过 wire，句子由 `error.<code>` 给。加一个习惯就要加一行字典，
  `tests/habits.test.ts` 会检查这一点。

## 域与数据

- **改了 `src/host/domain.ts` 的 `version` 就必须把旧版本列进 `compatibleVersions`**：
  per-record 后端对不接受的版本是**丢弃**而不是迁移——不列就等于删历史。
- **上限判定用同一个单位**：图片上限按**解码后字节数**比（base64 长度比它粗最多 3 字节）。
- **写入只有一种答复形状**：它改动的**习惯日 slice**（`day`/`stock`/`tasks`/`media`）加这次写独有的
  事实（`entry`、`sessionId`、`removed`、`report`）。**登记**的写带一个"视点日"（`date`，默认今天）。
  素材清扫是唯一例外（`{ok, removed}`）。登记写回的 `entry` 是**视图**（带派生的 `mime`、
  `focusSeconds`、`state`），不是存储记录——发错会让专注模式把图片判成缺失、专注时长变 `NaN`。
- **习惯日算术只有一份**（`src/shared/habit-day.ts`）：任何界面都不得从本地日历造日期。
  夜段里那是"专注模式显示今天、看板显示 3 天后"的来源（ADR 0005）。
- **打卡上限在 store 的原子改写内**：先读后写会让两个并发打卡都读到 1、落下第三次。

## UI 与样式

- **`prefers-color-scheme` 不是外壳主题的信号**：深浅由 `body[data-ds-dark-theme]` 判定。
  按系统偏好判，在「系统深色 + 外壳浅色」下会把整屏画成反的（不透明的弹窗尤其显眼）。
- **主题变量要写成继承的变量，别写成 `body[data-ds-dark-theme] .某元素 { … }`**：属性选择器多带
  一个 class 级权重，会压过 `.某元素:hover`，把悬停色吃掉。
- **`box-sizing` 没人替你重置**：外壳没有全局 `*` 重置；`width:100%` 再带 padding/border 的盒子
  在内容盒下必然宽出所在列。`verify-client.mjs` 按这个形状逐条断言。
- **SVG 的颜色不要写成表现属性**（`fill="…"`）：任何样式表规则都能压掉它，颜色必须用内联 `style`
  或变量。这条让五档曲线颜色全退成同一个绿一次。
- **主区域面板与右侧 tab body 都自己滚**：`flex: 1 1 auto; min-height: 0; overflow-y: auto`。
  `min-height: 0` 是承重的一半——不写它面板不肯收缩，`overflow-y` 永不生效。
- 客户端**不做轮询**：面板只在 mount / 窗口 focus / 写完时读。要加定时器先读
  `.dsh-docs` 里关于浏览器连接池的说明（每请求一条 HTTP POST，同一来源只有 6 条）。

## 验证口径

- **每条新断言都要先证明它会红**：制造它守的那个违规、看它以 exit 1 失败，再恢复原文件并**比对
  sha256**。备份要在注入**之前**做，否则"恢复成功"是假的。
- 规则类断言进 `tests/`（进程内、无端口、无磁盘）；**接线与持久化**进 `scripts/verify-*.mjs`
  （真 storage hub、真端口、真重启、真备份往返）。不要在两处重复同一条规则。
  `ApiDeps.now` / `Config.now` 是同一条时间缝线：需要"今天"的断言传固定时刻，不要读墙钟。
- 一次改动做完的最低门槛：`pnpm test` 全绿 + 三套 `tsc` 干净 + `build` / `verify-client` /
  `verify-host` 通过 + `git diff --check` 干净。

## 提交与发布

- Conventional Commits，一个提交一件事；正文说**为什么**，以及"如果不这样做会怎样"。
- 版本号遵循仓库惯例：0.x 期间新功能进次版本、修正进修订号；`lib/` 是构建产物，
  **不进版本库**，由 `prepare` 在安装时构建。
- 发布前把 `CHANGELOG.md` 的 `[Unreleased]` 收成带日期的版本段，并把 `package.json` 的 `version`
  对齐——两处不一致会被当成两回事。
