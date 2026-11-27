# Obsidian 社区插件发布指引

本文记录将 `thino-privacy-blur` 推送到 GitHub 并注册进 Obsidian 官方社区插件市场（`obsidianmd/obsidian-releases`）的标准步骤。

## 1. 发布前核查

- `manifest.json`：`id` 不含 `obsidian`、`description` 为英文动词开头且以句号结尾（≤ 250 字）、`version` 与即将发布的 tag 一致。
- `versions.json`：包含当前版本到 `minAppVersion` 的映射。
- `LICENSE`：根目录包含开源协议（当前为 MIT）。
- 本地检查通过：`npm run check` 与真实 Obsidian 桌面端验证无控制台报错。

## 2. 推送公开仓库并触发首个 Release

1. 在 GitHub 创建公开仓库 `shiluanzzz/thino-privacy-blur`：
   ```bash
   gh repo create shiluanzzz/thino-privacy-blur --public --source=. --remote=origin --push
   ```
2. 推送与 `manifest.json` `version` 完全一致、**不带 `v` 前缀**的 tag，触发 `.github/workflows/release.yml` 自动生成 Release 并附带 `main.js`、`manifest.json`、`styles.css`、`versions.json`：
   ```bash
   git tag 0.1.0
   git push origin 0.1.0
   ```
3. 打开 GitHub Releases 页面确认 `0.1.0` 已发布且 4 个附件完整（不能是 Draft 状态）。

## 3. 提交到 `obsidianmd/obsidian-releases`

1. Fork [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)。
2. 编辑根目录 `community-plugins.json`，按 `id` 字母序插入条目（`description` 与 `manifest.json` 保持一致）：
   ```json
   {
     "id": "thino-privacy-blur",
     "name": "Thino Privacy Blur",
     "author": "shiluan",
     "description": "Automatically blur previously typed content while writing in Thino and reveal on mouse hover.",
     "repo": "shiluanzzz/thino-privacy-blur"
   }
   ```
3. 提 Pull Request 到 `obsidianmd/obsidian-releases` 主分支，按 PR 模板逐项勾选确认。
4. 等待自动机器人（CI Validation）检查通过；若机器人提示代码或清单细节，在 `thino-privacy-blur` 仓库修复后重新打小版本 tag 或更新同版本 Release 资产。
5. 通过 Obsidian 团队人工审核并合并 PR（通常 1–4 周）后，插件即出现在 Obsidian 社区插件市场中。

## 4. 后续迭代发版

每次发新版本只需更新 `manifest.json`、`package.json`、`versions.json` 中的版本号，提交后打对应的无 `v` 前缀 tag 并推送即可，无需再向 `obsidian-releases` 提 PR。
