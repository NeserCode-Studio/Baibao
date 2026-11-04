# dsh-baibao · 百宝

DSH 里的一个**独立 Agent**：有自己的性格、跨会话的长期记忆、安静的主动连接和独立设置。

它不是收藏箱，也不是某个对话里的角色。百宝是一个长期存在的实体；对话只是它与你交互的一个面。

> **状态：M0 · 方向重置。**
> 仓库已移除旧的「收藏箱」实现（本地收藏列表、复制/删除、预览脚本），目前只保留插件骨架与产品结构。Agent 运行时、记忆、推送与设置会在 `.agent/plan.md` 的 M1–M7 中逐步接入；面板会明确标注“规划中”，不伪造功能。

---

## 为什么是百宝

单个对话窗口不适合承载长期关系：

- 换一个话题，上下文就断了；
- 换一个会话，偏好和承诺就忘了；
- 你同时只能盯 3–5 个窗口，剩下的只能靠人记。

百宝把“连续的人格与记忆”放在对话之上：

| 层 | 百宝的答案 |
|---|---|
| 连续 | 一个百宝，多个 thread；人格与长期记忆共享 |
| 记忆 | core / episode / semantic / procedural 分层；惰性巩固，不每轮烧 token |
| 主动 | 规则快筛 → 语义判断 → 投机执行；有具体结果才开口 |
| 持久 | 会话与记忆落在本地；重启、换 thread 都不丢 |
| 一致 | 复用 DSH 原生 Agent Loop、工具、审批、沙箱与模型选择 |

参考方向：DeepSeek 的 Super-agent 设计（Router/Worker、全局记忆、Inline/Spill、两级过滤、投机执行）。我们借用的是这些工程原则，不是某个具体实现。

---

## 现在有什么

```
assets/icon.svg        百宝品牌图标（机器人 + 光点天线）
src/index.js           宿主入口：M0 无行为，只让包进入 profile 插件树
src/client/index.tsx   客户端入口：侧栏行 + 百宝面板
src/client/panel.tsx   面板骨架：对话页 + 设置面板（记忆 / 连接 / 设置）
src/client/panel.css   仅使用 DSH 主题变量
src/client/icon.tsx    侧栏字形与设置/返回图标（currentColor）
src/client/locales.ts  zh / en 词典（typed namespace）
build.mjs              esbuild → window.__ModuleLoader__ 包封装
cordis.patch.yml       bundle 挂载声明
```

面板目前是**对话页 + 设置面板**的结构预览：对话页只有空态和 composer，发送能力尚未接入；记忆/连接/设置三类内容都在设置面板里。

---

## 架构（目标）

```text
Client（浏览器）
  sidebar 入口 → 百宝面板（main: dsh-baibao）
                  ├─ 对话页：原生 Session / 空态 / composer
                  └─ 设置面板：记忆 / 连接 / 设置
  原生 Conversation 的百宝 chrome（header / composer dock / message actions）

Host（Node）
  BaibaoService   身份、workspace、thread 引导
  BaibaoMemory    storageDomain + 巩固队列 + memory_* 工具
  BaibaoPush      schedule/webhook + 两级过滤 + 收件箱
  BaibaoSettings  Config 默认值 + 单一设置源

DSH
  Agent Loop + Session + Tools + 审批/沙箱 + 模型选择
```

关键决策：

- **复用原生会话**，不重写聊天壳（除非 M1 证明不可行）。
- **专用 workspace** 承载百宝会话，`session.header.cwd` 作为身份边界。
- **一个百宝 + 多个 thread**；人格与记忆全局共享，未巩固的上下文不跨 thread。
- **记忆本地优先**；每条记忆有来源、置信度、有效期；可查看、可删除、可导出。
- **设置单一数据源**：插件内为主，DSH 设置中心为可选镜像。

更完整的设计见本地 `.agent/plan.md` 与 `.agent/plan-*/`（该目录被 `.gitignore` 排除，属于工作区文档）。

---

## 安装

```bash
# 从本目录安装到 desktop profile
dsh plugin --profile desktop add Z:\Repo\Github\NCS\Baibao
```

> 首次从源码安装前先执行 `npm install && npm run build`：本包的入口是 `lib/index.js` 与 `lib/client.js`，仓库里不提交 `lib/`。

`dsh plugin add` 会读取本包的 `dsh.bundle.patch`，把 `dsh-baibao` 追加进
`dsh.profile.bundles`，无需手改 profile 文件。想手动挂载时，在本 profile 的
`cordis.patch.yml` 里加：

```yaml
- insert:
    - id: dsh-baibao
      name: 'dsh-baibao'
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-baibao
```

> 本包声明了 `"private": true`：它是本地插件，不打算发布到 npm。若要发布，删掉该字段并补上 `repository`。

> 旧尝试在 profile 里留下了一个指向 `Z:\dsh-baibao` 的失效 bundle 行。安装/卸载前如遇到 “cannot resolve profile bundle”，先用 `plugin_manager` 或 `dsh plugin` 清理该行（需要用户授权）。

---

## 开发

```bash
npm install
npm run check      # tsc --noEmit + 构建
npm run build
```

M0 的客户端只依赖 React 与 DSH 注入的模块；`build.mjs` 把源码打成
`window.__ModuleLoader__.load({ id, factory })` 形式，`lib/client.js` 由 web host 直接加载。

当前工作区未安装 `node_modules`，因此 M0 没有执行 `npm run check`；开始 M1 前请允许安装依赖并跑一次完整构建。

### 热更新（开发）

当前 desktop profile 已经启用了 DSH 的客户端 bundle HMR（`include:client-hmr`，默认 500ms 轮询）。本包只需要持续重建 `lib/client.js`：

```bash
npm install
npm run build        # 首次生成 lib/，再挂载
dsh plugin --profile desktop add Z:\Repo\Github\NCS\Baibao
npm run dev          # 监听 src/，持续重建 lib/client.js
```

第一次挂载前必须已经有 `lib/client.js` 和 `lib/index.js`；否则 profile 会在启动时找不到客户端 bundle。

> **安装新插件后需要重启一次应用。** DSH 的 `clientModules` 在启动时扫描客户端 entry；运行中 `install_bundle` 只会让 Host 行生效，新的 client entry 不会进入当前 graph（实测 `clientPath` 为 `undefined`）。重启后才会出现侧栏「百宝」；之后的客户端源码修改才走 HMR。

之后修改 `src/client/**`（组件、词典、CSS）：

1. esbuild 重建 `lib/client.js`；
2. DSH 的 client HMR 发现 bundle 变化，替换客户端模块；
3. 不需要刷新页面，约 1–2s 后生效（2026-11-04 已用临时 `main` slot 探针实测）。

限制与排查：

- 改 `src/index.js`（宿主侧）走 Host HMR，可能触发插件重启；若没有生效，刷新页面或重启应用。
- 新增依赖、修改 `package.json` / `cordis.patch.yml`、改变插件注册结构，通常需要重新 `dsh plugin ... add` 或重启。
- HMR 是模块级替换，组件局部 state 可能重置；不要在未保存的表单里测试。
- 若 500ms 后没有反应：确认 `plugin_manager list_plugins` 里 `include:client-hmr` 是 `active`，并确认 profile 指向的是当前仓库（本地 link），而不是旧的 `Z:\dsh-baibao`。
- 确认 profile 的 `node_modules/dsh-baibao` 是指向本仓库的链接（junction/symlink），而不是拷贝；拷贝安装时 HMR 看不到源码改动。
- 没有 HMR 时的兜底：`npm run build` 后刷新页面。

### 约定

- 不新增 `.prettierrc` / `.eslintrc` / `.stylelintrc`，沿用现有风格（2 空格、无分号、单引号）。
- 不创建/切换分支，不做 force push。
- 不长期占用开发端口；视觉验收除外。
- AI 产物与临时脚本放 `.agent/`，用完即删。

---

## 路线图

| 里程碑 | 内容 |
|---|---|
| M0 | 方向重置；删除收藏箱；骨架、README、计划 |
| M1 | 技术 spike：host↔client 桥、原生会话打开、per-agent prompt/tool、storageDomain、llm、schedule |
| M2 | 百宝 workspace/session；人格；原生对话入口；基础设置 |
| M3 | 记忆 v1：core/facts/episodes/buffer；显式记住；轮末巩固；memory 工具；记忆浏览器 |
| M4 | 性格 v1：人格编辑器、风格映射、示例、一致性评估 |
| M5 | 推送 v1：收件箱、schedule 触发、免打扰/预算、两级过滤、投机执行、webhook |
| M6 | 设置中心镜像、onboarding、i18n、可访问性 |
| M7 | LongMemEval/LoCoMo 子集、自定义连续性套件、成本/安全/记忆投毒测试 |

每个里程碑结束后会请用户评审并更新本文件。

---

## 许可证

MIT，见 `LICENSE`。
