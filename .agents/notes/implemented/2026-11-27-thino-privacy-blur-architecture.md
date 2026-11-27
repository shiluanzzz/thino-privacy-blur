# Agent Note: Thino Privacy Blur 架构与核心交互决策

Status: implemented

## Problem

Thino 内置 Focus 模式仅模糊历史 memo 列表与侧边栏，输入框中已输入的文本仍然完全清晰。在办公场景下输入较长或多行 memo 时容易被旁人窥视，需要在不影响正常 Markdown 笔记、不修改 Thino 本体且兼容独立弹出窗口（popout window）与中文 IME 的前提下，自动模糊已输出内容并仅在鼠标主动移到对应内容上时清晰显示。

## Decision

采用零构建依赖的本地 CommonJS 插件实现（`main.js` + `styles.css` + `manifest.json` + `versions.json`）：

- **CM6 `Compartment` 精准注入与 `setState` 自愈**：不注册全局 `registerEditorExtension`，而是通过 `EditorView.findFromDOM`、Thino 的 `thino-editor-created` 事件、`MutationObserver` 与 `obsidian-memos._children` 发现 Thino 编辑器，用 `Compartment` + `StateEffect.appendConfig` 注入 `ViewPlugin`。判重直接检查 `compartment.get(view.state) !== undefined`，并在 `ViewPlugin.destroy()` 中对仍挂载在 DOM 上的视图通过微任务自动重挂，解决 Thino 提交清空时调用 `view.setState()` 冲掉扩展的问题。
- **多窗口原生支持**：通过 `app.workspace.iterateAllLeaves` 与 `window-open`/`window-close` 监听所有打开窗口的 `Document`；跨窗口节点判断统一用 `nodeType === 1` 替代 `instanceof Element`。
- **主动悬停显示与防误触**：按句/意群或整行切分 `Decoration.mark` 并共享 `data-pb-chunk`，使同一句内跨加粗/标签/链接的多个 CM6 span 同步清晰；移除被动 CSS `:hover` 与行尾空白区触发逻辑，仅响应真实落在模糊文本或媒体上的 `pointermove`，在打字（`docChanged`）与编辑器/窗口失焦（`blur`、`window.blur`、`visibilitychange`）时清除悬停态并要求移动 ≥6px 后才恢复响应。
- **IME 安全与桌面端定位**：`view.composing === true` 期间只映射已有装饰、`compositionend` 后下一帧刷新；`manifest.json` 标记 `isDesktopOnly: true` 并提供中英文自动适配（英文遵循 Sentence case）以契合 Obsidian 社区插件审核规范。

## Alternatives considered

- **纯 CSS Snippet**：无法感知光标偏移实现“同行前文模糊、尾部清晰”和停顿/失焦全模糊，也无法按句合并跨 Markdown 语法的悬停显示，故放弃。
- **全局 `registerEditorExtension`**：无法热挂载到已打开的 Thino 内嵌 `MarkdownEditor`，且会在所有普通 Markdown 笔记上挂载扩展实例，隔离性不如按需 `Compartment` 注入。
- **引入 TypeScript + esbuild 构建链**：当前插件代码量小、无外部依赖，直接维护可读 `main.js` 可避免 `src/` 与构建产物不同步及额外构建维护成本；若后续复杂度显著增长再迁移不迟。
- **使用 CSS `:hover` 兜底显示**：点击空输入框中央打字时，新行长到静止鼠标下方会被被动点亮，造成隐私泄漏，因此彻底移除被动 `:hover`。

## Consequences

- **收益**：对普通 Markdown 笔记零开销；在主窗口、Focus 模式、独立弹出窗口及连续发送多条 memo 场景下均稳定生效；可直接满足 Obsidian 社区插件（`obsidian-releases`）的清单、文案与零冗余依赖审核要求。
- **代价与限制**：依赖 Thino 当前默认的 `EditorType: "obsidian"`（CodeMirror 6 编辑器）及 `.common-editor-inputer` / `.memo-editor-wrapper` 等容器类名；若 Thino 切回纯 `<textarea>` 模式或大幅重构 DOM 类名，需同步适配选择器。
