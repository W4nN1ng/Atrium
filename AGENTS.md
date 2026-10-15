# Atrium 协作约定

- `main` 只接收已验证、可以构建和运行的代码。
- 所有仓库改动都从最新的 `main` 创建独立分支，默认使用 `codex/` 前缀，并通过 Pull Request 合并。不要直接在 `main` 开发或推送改动。
- 生产代码改动在合并前运行完整测试（`npm test`）、类型检查（`npm run typecheck`）、Electron Vite 构建及 worker 依赖检查；涉及界面或 IPC 时，在隔离数据目录验证相关实际操作。纯文档改动检查内容和差异即可。
- 合并前确认 PR 最新提交已经验证、没有冲突，且远端必需检查通过。目标分支有新改动时，先验证整合后的代码。
- 满足上述条件后，AI 协作者自行合并 PR，无需再向用户请求合并确认。使用正常 PR 合并流程，不绕过分支保护，不强制推送 `main`。
- 报告实际测试结果和仍未验证的行为；不要把条件跳过的测试说成已通过，也不要把可启动等同于所有功能都完成。
- **每一次修复、每一次更新，都必须同时把用户本机安装的 Atrium 也更新掉。** 只改源码、只发 Release 都不算做完 —— 用户是在**装好的那个程序**里用功能的，源码里修好了而他机器上还是旧行为，对他等于没修。
  收尾时必须：`npm run build` → 静默覆盖安装（`Start-Process dist\Atrium-Setup-<版本>.exe -ArgumentList '/S' -Wait`）→ 用 `node tools/installed-version.cjs --expect=<版本>` 核实注册表里的 `DisplayVersion` 真的变了。
  ⚠ 起装好的程序时**必须清掉 `ELECTRON_RUN_AS_NODE`**（有些 agent/harness 环境会设它，Electron 会退化成 Node 直接退出，看起来像"程序崩了"，其实什么事都没有）。`tools/dev.cjs` 里有同样的护栏。
