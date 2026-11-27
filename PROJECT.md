# Thino Privacy Blur

## 1. 项目简介

Thino Privacy Blur 是一个面向桌面端 Obsidian 的轻量开源插件，用于在办公室等公共场景下使用 Thino 记录时自动模糊已输出内容，并在鼠标主动移到目标内容上时局部清晰显示。插件零构建依赖，采用 CodeMirror 6 `Compartment` 动态注入，不改动 Thino 本体，也不影响普通 Markdown 笔记。

## 2. 当前能力全集

以下仅列当前已实现能力（使用现在时态），发布流程与更多细节通过 [INDEX.md](INDEX.md) 查阅。

- **输入自动模糊**：非当前行整行模糊（含行内图片、嵌入块与任务复选框）；当前行保留光标前可配置字数清晰，更早内容及行中光标后的已有内容自动模糊。
- **主动悬停局部显示**：支持按句/意群或按整行显示，跨 Markdown 语法 token（加粗、标签、链接等）同步清晰；屏蔽静止鼠标、桌面微抖与行尾右侧空白区误触发。
- **停顿与失焦全模糊**：停止输入超过设定秒数，或编辑器/窗口失焦、页面隐藏时立即全模糊并清除悬停清晰态。
- **多窗口与状态自愈**：原生兼容 Obsidian 主窗口与独立弹出窗口；Thino 提交清空触发 `view.setState()` 重建状态后自动重挂扩展；中文 IME 组合输入期间不打断候选词。
- **双语交互与快捷控制**：随 Obsidian 语言自动切换英文（Sentence case）或中文界面；提供状态栏开关图标、命令面板切换与完整设置页。

## 3. 目前待办

- 在 [Obsidian Community Directory](https://community.obsidian.md) 登录 Obsidian 账号、绑定 GitHub 账号并提交 `https://github.com/shiluanzzz/thino-privacy-blur`（步骤见 [Obsidian 社区发布指引](docs/operations/obsidian-community-release.md)）。

## 4. 近期已办

**铁律：最多 10 条，按 LRU 维护；单条限 1–3 句结论与引用链接，禁止把多件无关事项拼成巨段以绕过条数限制。新增或对同一事项作实质更新时合并去重并移到首条，记录更新日期；单纯阅读不刷新顺序。超过 10 条立即删除末尾最久未更新项，不在本节另建归档或追加历史。**

- 2026-11-27：完成公开 GitHub 仓库发布、首个 `0.1.0` Release 资产打包、4.8 秒演示 GIF 与中英文 README 补齐，并将发布指引更新为官方 `community.obsidian.md` 新流程；核心架构决策见 [插件架构与关键踩坑决策](.agents/notes/implemented/2026-11-27-thino-privacy-blur-architecture.md)。

## 5. 重要踩坑经验

**铁律：最多 10 条，按防错价值维护，不采用 LRU。新增前先合并重复经验；超限时删除已失效、影响较小或已被代码/CI 可靠覆盖的条目，优先保留高影响且容易复发的风险；单条保持精炼，不得扩容或无限追加。**

- **Thino 弹出窗口跨 Document**：Thino 常在 Obsidian popout window 打开，主窗口 `document.querySelectorAll` 与 `instanceof Element` 均会失效；必须遍历所有打开窗口的 `Document` 并使用 `nodeType === 1` 判别节点。
- **提交清空触发 `view.setState()` 冲掉扩展**：Thino 清空输入框时在同一 `EditorView` 上替换全新 `EditorState`，会清除 `appendConfig` 注入的扩展；判重必须查 `compartment.get(view.state)` 并在 `ViewPlugin.destroy()` 中自动重挂。
- **静止鼠标触发 CSS `:hover` 漏显**：点击空输入框中央打字时，新行长到静止光标下会被纯 CSS `:hover` 被动点亮；禁止使用被动 `:hover`，且打字与失焦时必须清除并抑制悬停直到指针移动 ≥6px。
- **中文 IME 组合期拆改装饰打断拼音**：在 `view.composing === true` 期间不可重建当前行 `Decoration.mark`，应仅映射变更并在 `compositionend` 后下一帧刷新。
