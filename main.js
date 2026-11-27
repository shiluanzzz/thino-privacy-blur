"use strict";

const { Plugin, PluginSettingTab, Setting, Notice, setIcon, moment } = require("obsidian");
const { EditorView, Decoration, ViewPlugin } = require("@codemirror/view");
const { Compartment, StateEffect, RangeSetBuilder } = require("@codemirror/state");

const DEFAULT_SETTINGS = {
  enabled: true,
  onlyInFocusMode: false,
  clearTailChars: 6,
  blurRadius: 5,
  idleBlurSeconds: 3,
  blurOnEditorBlur: true,
  revealGranularity: "clause", // "clause" | "line"
};

const THINO_EDITOR_SELECTOR =
  '.common-editor-inputer .cm-editor, .memo-editor-wrapper .cm-editor, [data-type="thino_view"] .cm-editor';

const STRINGS = {
  en: {
    commandToggle: "Toggle privacy blur",
    noticeEnabled: "Thino privacy blur enabled",
    noticePaused: "Thino privacy blur paused",
    statusPaused: "Thino privacy blur: paused (click to enable)",
    statusWaitingFocus: "Thino privacy blur: waiting for Focus mode (click to toggle)",
    statusActive: "Thino privacy blur: active (click to pause)",
    settingEnableName: "Enable privacy blur",
    settingEnableDesc: "Automatically blur previously typed content in Thino and reveal it on mouse hover.",
    settingFocusOnlyName: "Only active in Thino Focus mode",
    settingFocusOnlyDesc: "Apply input privacy blur only when Thino Focus mode is enabled.",
    settingClearTailName: "Clear characters before cursor",
    settingClearTailDesc: "Number of characters before the cursor kept readable while typing (0 blurs immediately).",
    settingBlurRadiusName: "Blur radius (px)",
    settingBlurRadiusDesc: "Strength of the blur filter in pixels (4 to 7 recommended).",
    settingIdleBlurName: "Idle full-blur delay (seconds)",
    settingIdleBlurDesc: "Blur the remaining clear tail after pausing typing for this many seconds (0 disables).",
    settingFocusOutName: "Blur all on focus loss",
    settingFocusOutDesc: "Immediately blur all editor content when switching away from the editor or window.",
    settingGranularityName: "Hover reveal granularity",
    settingGranularityDesc: "Reveal either the hovered clause/segment or the entire hovered line.",
    granularityClause: "By clause or segment",
    granularityLine: "By full line",
  },
  zh: {
    commandToggle: "切换 Thino 输入防窥模糊",
    noticeEnabled: "Thino 防窥模糊已开启",
    noticePaused: "Thino 防窥模糊已暂停",
    statusPaused: "Thino 防窥模糊：已暂停（点击开启）",
    statusWaitingFocus: "Thino 防窥模糊：等待 Focus 模式（点击切换）",
    statusActive: "Thino 防窥模糊：运行中（点击暂停）",
    settingEnableName: "启用 Thino 输入防窥模糊",
    settingEnableDesc: "输入时自动模糊已经输出的内容，鼠标移到对应内容上时清晰显示。",
    settingFocusOnlyName: "仅在 Thino Focus 模式下生效",
    settingFocusOnlyDesc: "开启后，仅当 Thino 处于 Focus 模式时才自动模糊输入框内已输出的内容。",
    settingClearTailName: "光标前保留清晰字数",
    settingClearTailDesc: "正在输入时，光标前保留多少个字符不模糊（设为 0 则已输入的字符立即模糊）。",
    settingBlurRadiusName: "模糊强度 (px)",
    settingBlurRadiusDesc: "数值越大越难从旁窥视，建议 4–7 px。",
    settingIdleBlurName: "停顿自动全模糊 (秒)",
    settingIdleBlurDesc: "停止输入超过该秒数后，连光标前保留的尾部文字也自动模糊（设为 0 关闭）。",
    settingFocusOutName: "输入框失焦时立即全模糊",
    settingFocusOutDesc: "切走窗口或点击其他区域时，立刻模糊输入框里的全部内容。",
    settingGranularityName: "鼠标悬停显示粒度",
    settingGranularityDesc: "按句/片段：只显示鼠标所指的那一句；按整行：显示鼠标所在整行。",
    granularityClause: "按句/片段局部显示",
    granularityLine: "按整行显示",
  },
};

function t(key) {
  let lang = "";
  try {
    lang = (window.localStorage && window.localStorage.getItem("language")) || "";
  } catch (_err) {
    // ignore storage access errors
  }
  if (!lang && moment && typeof moment.locale === "function") {
    lang = moment.locale() || "";
  }
  const dict = String(lang).toLowerCase().startsWith("zh") ? STRINGS.zh : STRINGS.en;
  return dict[key] || STRINGS.en[key] || key;
}

const refreshBlurEffect = StateEffect.define();

const STRONG_BREAK_RE = /[。！？；…!?;]/;
const WEAK_BREAK_RE = /[，,、：:]/;
const CLAUSE_MIN_STRONG = 4;
const CLAUSE_MIN_WEAK = 10;
const CLAUSE_MAX_LEN = 26;

function isElementNode(node) {
  return Boolean(node && node.nodeType === 1 && typeof node.closest === "function");
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

function stepBackChars(text, endOffset, count) {
  let idx = Math.min(endOffset, text.length);
  let remaining = count;
  while (idx > 0 && remaining > 0) {
    idx -= 1;
    if (idx > 0 && isLowSurrogate(text.charCodeAt(idx)) && isHighSurrogate(text.charCodeAt(idx - 1))) {
      idx -= 1;
    }
    remaining -= 1;
  }
  return idx;
}

function splitClauseRanges(lineText, relFrom, relTo, granularity) {
  if (relTo <= relFrom) return [];
  if (granularity === "line") {
    return [{ from: relFrom, to: relTo }];
  }

  const ranges = [];
  let start = relFrom;
  let charCount = 0;

  let i = relFrom;
  while (i < relTo) {
    const code = lineText.charCodeAt(i);
    const step =
      isHighSurrogate(code) && i + 1 < relTo && isLowSurrogate(lineText.charCodeAt(i + 1)) ? 2 : 1;
    const ch = lineText.slice(i, i + step);
    i += step;
    charCount += 1;

    const isStrong = STRONG_BREAK_RE.test(ch);
    const isWeak = WEAK_BREAK_RE.test(ch);

    if ((isStrong && charCount >= CLAUSE_MIN_STRONG) || (isWeak && charCount >= CLAUSE_MIN_WEAK)) {
      ranges.push({ from: start, to: i });
      start = i;
      charCount = 0;
      continue;
    }

    if (charCount >= CLAUSE_MAX_LEN) {
      let cut = i;
      const lookbackStart = Math.max(start + CLAUSE_MIN_WEAK, i - 8);
      for (let j = i - 1; j >= lookbackStart; j--) {
        if (lineText[j] === " " || lineText[j] === "\t") {
          cut = j + 1;
          break;
        }
      }
      ranges.push({ from: start, to: cut });
      start = cut;
      charCount = i - cut;
    }
  }

  if (start < relTo) {
    if (ranges.length > 0 && relTo - start <= 2 && ranges[ranges.length - 1].to === start) {
      ranges[ranges.length - 1].to = relTo;
    } else {
      ranges.push({ from: start, to: relTo });
    }
  }

  return ranges;
}

function isThinoFocusModeActive(doc) {
  if (document.body.classList.contains("thino-focus")) return true;
  if (doc && doc.body && doc.body.classList.contains("thino-focus")) return true;
  return false;
}

function resolveEditorViewFromEl(cmEl) {
  if (!cmEl) return null;
  if (typeof EditorView.findFromDOM === "function") {
    const found = EditorView.findFromDOM(cmEl);
    if (found) return found;
  }
  const content = cmEl.querySelector ? cmEl.querySelector(".cm-content") : null;
  return (content && content.cmTile && content.cmTile.view) || null;
}

function createPrivacyBlurExtension(plugin) {
  return ViewPlugin.fromClass(
    class ThinoPrivacyBlurViewPlugin {
      constructor(view) {
        this.view = view;
        this.decorations = Decoration.none;
        this.isIdleBlurred = false;
        this.idleTimer = null;
        this.hoveredChunkId = null;
        this.hoveredLineEl = null;
        this.lastPointerPos = null;
        this.hoverSuppressedUntilMove = false;
        this.suppressOrigin = null;

        this.onPointerMove = this.handlePointerMove.bind(this);
        this.onPointerLeave = this.handlePointerLeave.bind(this);
        this.onFocusIn = this.handleFocusIn.bind(this);
        this.onFocusOut = this.handleFocusOut.bind(this);
        this.onCompositionEnd = this.handleCompositionEnd.bind(this);
        this.onVisibilityChange = this.handleVisibilityChange.bind(this);

        this.ownerDoc = (this.view.dom && this.view.dom.ownerDocument) || document;
        this.ownerWin = this.getOwnerWindow();
        view.contentDOM.addEventListener("pointermove", this.onPointerMove, { passive: true });
        view.contentDOM.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
        view.dom.addEventListener("pointerleave", this.onPointerLeave, { passive: true });
        view.contentDOM.addEventListener("focus", this.onFocusIn, { passive: true });
        view.contentDOM.addEventListener("blur", this.onFocusOut, { passive: true });
        view.contentDOM.addEventListener("compositionend", this.onCompositionEnd, { passive: true });
        this.ownerWin.addEventListener("blur", this.onFocusOut, { passive: true });
        this.ownerDoc.addEventListener("visibilitychange", this.onVisibilityChange, { passive: true });

        this.syncStyleVars();
        this.decorations = this.buildDecorations(view);
      }

      getOwnerWindow() {
        return (
          (this.view.dom && this.view.dom.ownerDocument && this.view.dom.ownerDocument.defaultView) ||
          window
        );
      }

      syncStyleVars() {
        this.view.dom.classList.add("thino-pb-editor");
        this.view.dom.style.setProperty("--thino-pb-blur-radius", `${plugin.settings.blurRadius}px`);
      }

      isActiveNow() {
        if (!plugin.settings.enabled) return false;
        if (plugin.settings.onlyInFocusMode && !isThinoFocusModeActive(this.view.dom.ownerDocument)) {
          return false;
        }
        return true;
      }

      clearIdleTimer() {
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
      }

      scheduleIdleBlur() {
        this.clearIdleTimer();
        const delaySec = plugin.settings.idleBlurSeconds;
        if (!this.isActiveNow() || delaySec <= 0) return;
        if (this.view.state.doc.length === 0) return;

        this.idleTimer = window.setTimeout(() => {
          this.idleTimer = null;
          if (!this.view.dom.isConnected || this.view.composing) return;
          if (!this.isActiveNow() || this.view.state.doc.length === 0) return;
          if (!this.isIdleBlurred) {
            this.isIdleBlurred = true;
            this.triggerRefresh();
          }
        }, delaySec * 1000);
      }

      triggerRefresh() {
        if (!this.view.dom.isConnected) return;
        try {
          this.view.dispatch({ effects: refreshBlurEffect.of(null) });
        } catch (_err) {
          // ignore destroyed or mid-update views
        }
      }

      handleFocusIn() {
        if (!this.isActiveNow()) return;
        this.triggerRefresh();
      }

      suppressHoverUntilMove() {
        this.clearHoverReveal();
        this.hoverSuppressedUntilMove = true;
        this.suppressOrigin = this.lastPointerPos ? { ...this.lastPointerPos } : null;
      }

      handleVisibilityChange() {
        if (this.ownerDoc && this.ownerDoc.hidden) {
          this.handleFocusOut();
        }
      }

      handleFocusOut() {
        this.suppressHoverUntilMove();
        if (!this.isActiveNow() || !plugin.settings.blurOnEditorBlur) return;
        if (this.view.state.doc.length === 0) return;
        this.clearIdleTimer();
        if (!this.isIdleBlurred) {
          this.isIdleBlurred = true;
          this.triggerRefresh();
        }
      }

      handleCompositionEnd() {
        const win = this.getOwnerWindow();
        win.requestAnimationFrame(() => {
          if (!this.view.dom.isConnected) return;
          this.triggerRefresh();
          this.scheduleIdleBlur();
        });
      }

      handlePointerMove(event) {
        if (!this.isActiveNow()) {
          this.clearHoverReveal();
          return;
        }

        const x = event.clientX;
        const y = event.clientY;
        this.lastPointerPos = { x, y };

        if (this.hoverSuppressedUntilMove) {
          if (!this.suppressOrigin) {
            this.suppressOrigin = { x, y };
            return;
          }
          const moved = Math.hypot(x - this.suppressOrigin.x, y - this.suppressOrigin.y);
          if (moved < 6) {
            return;
          }
          this.hoverSuppressedUntilMove = false;
          this.suppressOrigin = null;
        }

        const target = isElementNode(event.target) ? event.target : null;
        if (!target) {
          this.clearHoverReveal();
          return;
        }

        let nextChunkId = null;
        let nextLineEl = null;

        const markEl = target.closest(".thino-pb-blur[data-pb-chunk]");
        if (markEl && this.view.contentDOM.contains(markEl)) {
          nextChunkId = markEl.getAttribute("data-pb-chunk");
        } else {
          const mediaEl = target.closest(
            "img, .internal-embed, .cm-embed-block, .task-list-item-checkbox"
          );
          if (mediaEl && this.view.contentDOM.contains(mediaEl)) {
            const lineEl = mediaEl.closest(".cm-line.thino-pb-blurred-line");
            if (lineEl) {
              nextLineEl = lineEl;
            }
          }
        }

        if (nextChunkId !== this.hoveredChunkId || nextLineEl !== this.hoveredLineEl) {
          this.applyHoverReveal(nextChunkId, nextLineEl);
        }
      }

      handlePointerLeave() {
        this.clearHoverReveal();
      }

      clearHoverReveal() {
        if (this.hoveredChunkId !== null || this.hoveredLineEl !== null) {
          this.applyHoverReveal(null, null);
        }
      }

      applyHoverReveal(nextChunkId, nextLineEl) {
        const prevRevealed = this.view.contentDOM.querySelectorAll(".thino-pb-revealed");
        for (const el of prevRevealed) {
          el.classList.remove("thino-pb-revealed");
        }
        if (this.hoveredLineEl && this.hoveredLineEl !== nextLineEl) {
          this.hoveredLineEl.classList.remove("thino-pb-line-revealed");
        }

        this.hoveredChunkId = nextChunkId;
        this.hoveredLineEl = nextLineEl;

        if (nextChunkId) {
          const escaped =
            typeof CSS !== "undefined" && CSS.escape ? CSS.escape(nextChunkId) : nextChunkId;
          const targets = this.view.contentDOM.querySelectorAll(
            `.thino-pb-blur[data-pb-chunk="${escaped}"]`
          );
          for (const el of targets) {
            el.classList.add("thino-pb-revealed");
          }
        }

        if (nextLineEl) {
          nextLineEl.classList.add("thino-pb-line-revealed");
        }
      }

      reapplyHoverRevealSoon() {
        if (!this.hoveredChunkId && !this.hoveredLineEl) return;
        const chunkId = this.hoveredChunkId;
        const lineEl = this.hoveredLineEl;
        const win = this.getOwnerWindow();
        win.requestAnimationFrame(() => {
          if (!this.view.dom.isConnected) return;
          if (this.hoveredChunkId === chunkId && this.hoveredLineEl === lineEl) {
            this.applyHoverReveal(chunkId, lineEl && lineEl.isConnected ? lineEl : null);
          }
        });
      }

      update(update) {
        this.syncStyleVars();

        if (!this.isActiveNow()) {
          this.clearIdleTimer();
          this.isIdleBlurred = false;
          this.clearHoverReveal();
          this.decorations = Decoration.none;
          return;
        }

        // Preserve active CJK IME composition without splitting the composing text node.
        if (update.view.composing) {
          this.clearIdleTimer();
          if (update.docChanged) {
            this.isIdleBlurred = false;
            this.suppressHoverUntilMove();
            this.decorations = this.decorations.map(update.changes);
          }
          return;
        }

        const hasRefresh = update.transactions.some((tr) =>
          tr.effects.some((ef) => ef.is(refreshBlurEffect))
        );

        if (update.docChanged) {
          this.isIdleBlurred = false;
          this.suppressHoverUntilMove();
          this.scheduleIdleBlur();
        }

        if (update.docChanged || update.selectionSet || update.viewportChanged || hasRefresh) {
          this.decorations = this.buildDecorations(update.view);
          this.reapplyHoverRevealSoon();
        }
      }

      buildDecorations(view) {
        if (!this.isActiveNow()) {
          return Decoration.none;
        }

        const { state } = view;
        const doc = state.doc;
        if (doc.length === 0) {
          return Decoration.none;
        }

        const head = state.selection.main.head;
        const activeLine = doc.lineAt(head);
        const clearTail = Math.max(0, plugin.settings.clearTailChars);
        const granularity = plugin.settings.revealGranularity;
        const hasFocus = view.hasFocus;
        const blurAll = this.isIdleBlurred || (plugin.settings.blurOnEditorBlur && !hasFocus);

        const builder = new RangeSetBuilder();

        for (const { from: vpFrom, to: vpTo } of view.visibleRanges) {
          let pos = vpFrom;
          while (pos <= vpTo) {
            const line = doc.lineAt(pos);
            const isActiveLine = !blurAll && line.number === activeLine.number;

            if (!isActiveLine) {
              builder.add(
                line.from,
                line.from,
                Decoration.line({ class: "thino-pb-blurred-line" })
              );

              if (line.length > 0) {
                const chunks = splitClauseRanges(line.text, 0, line.length, granularity);
                for (let idx = 0; idx < chunks.length; idx++) {
                  const chunk = chunks[idx];
                  const absFrom = line.from + chunk.from;
                  const absTo = line.from + chunk.to;
                  if (absTo > absFrom) {
                    builder.add(
                      absFrom,
                      absTo,
                      Decoration.mark({
                        class: "thino-pb-blur",
                        attributes: { "data-pb-chunk": `L${line.number}-${idx}` },
                      })
                    );
                  }
                }
              }
            } else {
              const relHead = Math.max(0, Math.min(line.length, head - line.from));
              const clearStart = clearTail > 0 ? stepBackChars(line.text, relHead, clearTail) : relHead;

              if (clearStart > 0) {
                const beforeChunks = splitClauseRanges(line.text, 0, clearStart, granularity);
                for (let idx = 0; idx < beforeChunks.length; idx++) {
                  const chunk = beforeChunks[idx];
                  const absFrom = line.from + chunk.from;
                  const absTo = line.from + chunk.to;
                  if (absTo > absFrom) {
                    builder.add(
                      absFrom,
                      absTo,
                      Decoration.mark({
                        class: "thino-pb-blur",
                        attributes: { "data-pb-chunk": `L${line.number}-pre-${idx}` },
                      })
                    );
                  }
                }
              }

              if (relHead < line.length) {
                const afterChunks = splitClauseRanges(line.text, relHead, line.length, granularity);
                for (let idx = 0; idx < afterChunks.length; idx++) {
                  const chunk = afterChunks[idx];
                  const absFrom = line.from + chunk.from;
                  const absTo = line.from + chunk.to;
                  if (absTo > absFrom) {
                    builder.add(
                      absFrom,
                      absTo,
                      Decoration.mark({
                        class: "thino-pb-blur",
                        attributes: { "data-pb-chunk": `L${line.number}-post-${idx}` },
                      })
                    );
                  }
                }
              }
            }

            if (line.to >= doc.length) break;
            pos = line.to + 1;
          }
        }

        return builder.finish();
      }

      destroy() {
        this.clearIdleTimer();
        this.view.contentDOM.removeEventListener("pointermove", this.onPointerMove);
        this.view.contentDOM.removeEventListener("pointerleave", this.onPointerLeave);
        this.view.dom.removeEventListener("pointerleave", this.onPointerLeave);
        this.view.contentDOM.removeEventListener("focus", this.onFocusIn);
        this.view.contentDOM.removeEventListener("blur", this.onFocusOut);
        this.view.contentDOM.removeEventListener("compositionend", this.onCompositionEnd);
        if (this.ownerWin) {
          this.ownerWin.removeEventListener("blur", this.onFocusOut);
        }
        if (this.ownerDoc) {
          this.ownerDoc.removeEventListener("visibilitychange", this.onVisibilityChange);
        }
        this.view.dom.classList.remove("thino-pb-editor");
        this.view.dom.style.removeProperty("--thino-pb-blur-radius");

        // Re-attach immediately when Thino replaces EditorState via view.setState() on submit/clear.
        if (!plugin.unloading && this.view.dom && this.view.dom.isConnected) {
          plugin.scheduleReattach(this.view);
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  );
}

class ThinoPrivacyBlurSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("settingEnableName"))
      .setDesc(t("settingEnableDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settingFocusOnlyName"))
      .setDesc(t("settingFocusOnlyDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.onlyInFocusMode).onChange(async (value) => {
          this.plugin.settings.onlyInFocusMode = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settingClearTailName"))
      .setDesc(t("settingClearTailDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 24, 1)
          .setValue(this.plugin.settings.clearTailChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.clearTailChars = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settingBlurRadiusName"))
      .setDesc(t("settingBlurRadiusDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(2, 12, 1)
          .setValue(this.plugin.settings.blurRadius)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.blurRadius = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settingIdleBlurName"))
      .setDesc(t("settingIdleBlurDesc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 15, 1)
          .setValue(this.plugin.settings.idleBlurSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.idleBlurSeconds = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settingFocusOutName"))
      .setDesc(t("settingFocusOutDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.blurOnEditorBlur).onChange(async (value) => {
          this.plugin.settings.blurOnEditorBlur = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("settingGranularityName"))
      .setDesc(t("settingGranularityDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("clause", t("granularityClause"))
          .addOption("line", t("granularityLine"))
          .setValue(this.plugin.settings.revealGranularity)
          .onChange(async (value) => {
            this.plugin.settings.revealGranularity = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

class ThinoPrivacyBlurPlugin extends Plugin {
  async onload() {
    this.unloading = false;
    this.compartment = new Compartment();
    this.cmExtension = createPrivacyBlurExtension(this);
    this.attachedViews = new Set();
    this.docObservers = new Map();
    this.scanScheduled = false;

    await this.loadSettings();

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("thino-pb-status-bar");
    this.registerDomEvent(this.statusBarEl, "click", async () => {
      await this.toggleEnabled();
    });
    this.updateStatusBar();

    this.addCommand({
      id: "toggle",
      name: t("commandToggle"),
      callback: () => {
        this.toggleEnabled();
      },
    });

    this.addSettingTab(new ThinoPrivacyBlurSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("thino-editor-created", (containerEl, editor) => {
        if (containerEl && containerEl.ownerDocument) {
          this.observeDocument(containerEl.ownerDocument);
        }
        const cmView =
          (editor && editor.cm) ||
          resolveEditorViewFromEl(
            containerEl && containerEl.querySelector && containerEl.querySelector(".cm-editor")
          );
        if (cmView) {
          this.attachToView(cmView);
        } else {
          this.scheduleScan();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("window-open", (_wsWin, win) => {
        if (win && win.document) {
          this.observeDocument(win.document);
          this.scheduleScan();
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("window-close", (_wsWin, win) => {
        if (win && win.document) {
          this.unobserveDocument(win.document);
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.scheduleScan();
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.observeAllOpenDocuments();
      this.scanAndAttachAll();
    });
  }

  onunload() {
    this.unloading = true;
    for (const doc of Array.from(this.docObservers.keys())) {
      this.unobserveDocument(doc);
    }
    for (const view of Array.from(this.attachedViews)) {
      if (view && view.dom && view.dom.isConnected) {
        try {
          if (this.compartment.get(view.state) !== undefined) {
            view.dispatch({ effects: this.compartment.reconfigure([]) });
          }
        } catch (_err) {
          // ignore destroyed views
        }
      }
    }
    this.attachedViews.clear();
  }

  collectOpenDocuments() {
    const docs = new Set([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const doc = leaf && leaf.view && leaf.view.containerEl && leaf.view.containerEl.ownerDocument;
      if (doc) docs.add(doc);
    });
    return docs;
  }

  observeAllOpenDocuments() {
    for (const doc of this.collectOpenDocuments()) {
      this.observeDocument(doc);
    }
  }

  observeDocument(doc) {
    if (!doc || !doc.body || this.docObservers.has(doc)) return;

    const focusObserver = new MutationObserver(() => {
      if (this.settings.onlyInFocusMode) {
        this.refreshAllViews();
      }
      this.updateStatusBar();
    });
    focusObserver.observe(doc.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!isElementNode(node)) continue;
          if (
            node.matches(THINO_EDITOR_SELECTOR) ||
            node.classList.contains("common-editor-inputer") ||
            node.classList.contains("memo-editor-wrapper") ||
            node.querySelector(".common-editor-inputer .cm-editor, .memo-editor-wrapper .cm-editor")
          ) {
            this.scheduleScan();
            return;
          }
        }
      }
    });
    domObserver.observe(doc.body, { childList: true, subtree: true });

    const onEditorActivity = (event) => {
      if (this.unloading) return;
      const target = isElementNode(event.target) ? event.target : null;
      if (!target) return;
      const cmEl = target.closest(THINO_EDITOR_SELECTOR);
      if (!cmEl) return;
      const view = resolveEditorViewFromEl(cmEl);
      if (view) {
        this.attachToView(view);
      }
    };
    doc.addEventListener("focusin", onEditorActivity, true);
    doc.addEventListener("beforeinput", onEditorActivity, true);

    this.docObservers.set(doc, { focusObserver, domObserver, onEditorActivity });
  }

  unobserveDocument(doc) {
    const entry = this.docObservers.get(doc);
    if (!entry) return;
    entry.focusObserver.disconnect();
    entry.domObserver.disconnect();
    doc.removeEventListener("focusin", entry.onEditorActivity, true);
    doc.removeEventListener("beforeinput", entry.onEditorActivity, true);
    this.docObservers.delete(doc);
  }

  scheduleReattach(view) {
    if (this.unloading || !view) return;
    queueMicrotask(() => {
      if (this.unloading) return;
      this.attachToView(view);
    });
    const win =
      (view.dom && view.dom.ownerDocument && view.dom.ownerDocument.defaultView) || window;
    win.requestAnimationFrame(() => {
      if (this.unloading) return;
      this.attachToView(view);
    });
  }

  scheduleScan() {
    if (this.scanScheduled) return;
    this.scanScheduled = true;
    window.requestAnimationFrame(() => {
      this.scanScheduled = false;
      this.observeAllOpenDocuments();
      this.scanAndAttachAll();
    });
  }

  scanAndAttachAll() {
    const docs = this.collectOpenDocuments();
    for (const doc of docs) {
      this.observeDocument(doc);
      const cmNodes = doc.querySelectorAll(THINO_EDITOR_SELECTOR);
      for (const cmEl of cmNodes) {
        const view = resolveEditorViewFromEl(cmEl);
        if (view) {
          this.attachToView(view);
        }
      }
    }

    const memosPlugin = this.app.plugins && this.app.plugins.getPlugin("obsidian-memos");
    if (memosPlugin && Array.isArray(memosPlugin._children)) {
      for (const child of memosPlugin._children) {
        if (child && child.cm && child.cm.dom && child.cm.dom.isConnected) {
          this.attachToView(child.cm);
        }
      }
    }

    for (const view of Array.from(this.attachedViews)) {
      if (!view || !view.dom || !view.dom.isConnected) {
        this.attachedViews.delete(view);
      }
    }
  }

  attachToView(view) {
    if (this.unloading || !view || !view.dom || !view.dom.isConnected) return;
    this.attachedViews.add(view);
    if (this.compartment.get(view.state) !== undefined) return;
    try {
      view.dispatch({
        effects: StateEffect.appendConfig.of(this.compartment.of(this.cmExtension)),
      });
    } catch (_err) {
      // ignore views mid-teardown
    }
  }

  async toggleEnabled() {
    this.settings.enabled = !this.settings.enabled;
    await this.saveSettings();
    new Notice(this.settings.enabled ? t("noticeEnabled") : t("noticePaused"), 1800);
  }

  updateStatusBar() {
    if (!this.statusBarEl) return;
    this.statusBarEl.empty();

    const active =
      this.settings.enabled && (!this.settings.onlyInFocusMode || isThinoFocusModeActive());
    const iconEl = this.statusBarEl.createSpan({ cls: "thino-pb-status-icon" });
    setIcon(iconEl, this.settings.enabled ? "eye-off" : "eye");

    this.statusBarEl.toggleClass("is-active", active);
    this.statusBarEl.toggleClass("is-paused", !active);

    const statusText = !this.settings.enabled
      ? t("statusPaused")
      : this.settings.onlyInFocusMode && !isThinoFocusModeActive()
        ? t("statusWaitingFocus")
        : t("statusActive");
    this.statusBarEl.setAttribute("aria-label", statusText);
  }

  refreshAllViews() {
    this.scanAndAttachAll();
    for (const view of Array.from(this.attachedViews)) {
      if (!view || !view.dom || !view.dom.isConnected) {
        this.attachedViews.delete(view);
        continue;
      }
      try {
        view.dispatch({ effects: refreshBlurEffect.of(null) });
      } catch (_err) {
        // ignore detached views
      }
    }
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStatusBar();
    this.refreshAllViews();
  }
}

module.exports = ThinoPrivacyBlurPlugin;
