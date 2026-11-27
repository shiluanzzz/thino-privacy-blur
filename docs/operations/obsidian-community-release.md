# Obsidian 社区插件发布指引

本文记录将 `thino-privacy-blur` 发布到 GitHub 并注册进 Obsidian 官方社区插件市场的标准步骤。

## 1. 发布前核查

- `manifest.json`：`id` 不含 `obsidian`、`description` 为英文动词开头且以句号结尾（≤ 250 字）、`version` 与即将发布的 tag 一致。
- `versions.json`：包含当前版本到 `minAppVersion` 的映射。
- `LICENSE`：根目录包含开源协议（当前为 MIT）。
- 本地检查通过：`npm run check` 与真实 Obsidian 桌面端验证无控制台报错。

## 2. 推送公开仓库并触发 Release

1. 推送代码到公开仓库 `shiluanzzz/thino-privacy-blur`。
2. 推送与 `manifest.json` `version` 完全一致、**不带 `v` 前缀**的 tag，触发 `.github/workflows/release.yml` 自动生成正式 Release（含 `main.js`、`manifest.json`、`styles.css`、`versions.json`）：
   ```bash
   git tag 0.1.0
   git push origin 0.1.0
   ```
3. 打开 GitHub Releases 页面确认对应版本已发布且 4 个附件完整（非 Draft）。

## 3. 在 Obsidian Community Directory 提交插件

Obsidian 已停用旧的 `obsidianmd/obsidian-releases` Pull Request 流程，现统一通过官方社区平台提交：

1. 打开 [https://community.obsidian.md](https://community.obsidian.md) 并使用你的 **Obsidian 账号**登录。
2. 进入个人资料设置，**连接 GitHub 账号**（授予只读仓库归属校验权限）。
3. 在左侧边栏进入 **Plugins** → 点击 **New plugin**。
4. 填写公开仓库地址：`https://github.com/shiluanzzz/thino-privacy-blur`，选择归属者，勾选同意 Developer policies 后点击 **Submit**。
5. 等待自动校验与 Obsidian 审核通过，插件即会上架到社区插件市场。

## 4. 后续迭代发版

上架后每次发新版本无需再次在网页端提交，只需更新 `manifest.json`、`package.json`、`versions.json` 中的版本号，提交并推送新的无 `v` 前缀 tag 即可自动发布新版本 Release。
