# AGENTS.md

本文件适用于整个仓库，只维护当前项目规则、核心流程、核心资产与注意事项；规则变化时直接原位覆写，不追加历史或变更日志。

## 上下文入口

- [PROJECT.md](PROJECT.md)：项目简介、当前能力、待办、近期已办与重要踩坑经验。
- [INDEX.md](INDEX.md)：按任务意图或文件名一步直达项目文档。
- [memory/](memory/)：跨会话项目记忆（无内容时仅保留 `.gitkeep`），不可覆盖项目规则与代码事实。
- [.agents/notes/](.agents/notes/)：决策记录（ADR），不建索引；`implemented/` 为已落地，`proposed/` 为提案，`rejected/` 为已否决。

## 核心资产

- `main.js`：零构建依赖的 Obsidian 插件主源码（CodeMirror 6 扩展注入、多窗口管理、悬停显示、双语设置页）。
- `styles.css`：模糊滤镜、媒体/复选框模糊与状态栏图标样式。
- `manifest.json` / `versions.json` / `package.json`：Obsidian 插件清单、版本兼容表与校验脚本入口。
- `.github/workflows/release.yml`：推送 `X.Y.Z`（无 `v` 前缀）tag 时自动打包发布 Obsidian Release 资产。

## 核心流程

1. 改动前检查 `git status -s` 并阅读 `PROJECT.md` 及相关 `docs/`。
2. 保持最小改动，不引入无必要构建链或多余设置项；修 bug 先复现再验证。
3. 非平凡改动（架构、行为、交互契约或踩坑）在同一会话内按 `agent-note` 技能更新 `.agents/notes/` 并运行格式校验。
4. 每次提交前运行语法校验（`npm run check`）与文档体检，涉及运行时行为时在本地 Obsidian 中实测验证。
5. 本地提交逐文件 `git add`；严禁未经用户明确确认执行 `git push` 或触发远端 Release tag 推送。

## 文档维护

- 根目录 `AGENTS.md` 管规则，`PROJECT.md` 管现状，`INDEX.md` 管导航，`README.md` 保持精简入口（≤ 50 行）；详细指引放入 `docs/`，历史材料迁入 `docs/archive/` 并加顶部归档横幅。
- `INDEX.md` 仅设意图级与文件级两节，逐文件平铺；排除 `PROJECT.md`、`INDEX.md`、`HANDOFF.md`、`memory/` 与 `.agents/notes/`。
- `PROJECT.md` 近期已办与重要踩坑均严守 ≤ 10 条上限。

## 验证与发布边界

- **Obsidian 审核底线**：`manifest.json` 的 `id` / `name` 禁止包含 `obsidian`，`description` 使用英文动词开头并以句号结尾（≤ 250 字）；英文 UI 文案须遵循 Sentence case；禁止引入 `innerHTML`、`console.log` 或 Node/Electron 未声明依赖。
- **发布同步边界**：Release Git tag 必须与 `manifest.json` 的 `version` 完全一致且不带 `v` 前缀；未确认前不推送远端分支或 tag。
