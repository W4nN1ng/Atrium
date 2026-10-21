# P1-B vpm.db v1、迁移器与仓储

> 阶段规格：`../VPM-P1.md`（只读 §5、§5.1）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-A
> 覆盖对账项：C8 / C14 / I7
> 建议上下文：≤ 25k tokens

## 目标

- 建立独立的 `vpm.db`：连接、WAL、外键、busy_timeout、schema v1。
- 实现只前进的迁移器：迁移前备份、完整性检查、版本更高时拒绝而不是重建。
- 把仓库/包索引的 SQL 收进 `db/` 与 `repos/`，应用服务只调仓储方法。

## 不做什么

- 不实现 HTTP、仓库刷新、包目录 UI。
- 不碰核心 `library.db`，不新增核心迁移。
- 不把数据库行直接暴露给 IPC/渲染层。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.2、§9、§10
- `docs/prompts/VPM-P1.md` §5、§5.1
- `src/main/db.ts`（现有连接/迁移风格）
- `src/main/services/paths.ts`

## 文件所有权

- 新增：`src/main/vpm/db/`（连接、迁移、v1 schema）
- 新增：`src/main/vpm/repos/`（仓库/包行仓储）
- 新增：`src/main/vpm/db/README.md`、`repos/README.md`
- 新增：`tests/vpm/db/*.spec.ts`

## 交付物

- `openVpmDb()` / `closeVpmDb()`，路径为 `P.vpm()/vpm.db`。
- `VPM_SCHEMA_VERSION = 1`、迁移函数、迁移前备份 `vpm.db.bak-v<from>-<ts>`。
- v1 表与索引（仓库、包版本），替换仓库包行用单事务。
- 仓储接口：listRepos、upsertRepo、replaceRepoPackages、queryCatalog 的初始版本。

## 施工步骤

1. 先写迁移器与备份逻辑，再写 v1 schema。
2. 实现连接配置和 fail-closed 的新版本检查。
3. 实现仓储 CRUD 与事务替换。
4. 写空库/重复迁移/更高版本/坏库/备份/替换失败回滚的测试。
5. 在模块 README 写清楚“谁能调仓储、谁不能”。

## 契约与不变量

- VPM 不迁移/不写 `library.db`；`user_version` 仍是 11。
- 迁移失败不留下半套 schema；备份失败则不迁移。
- 更高版本只降级 VPM，不让核心崩。

## 测试与证据

- 迁移：空库→v1、重复执行幂等、失败回滚。
- 版本更高：拒绝并返回明确错误码。
- 仓储事务：替换失败保留旧行。
- 全量测试/typecheck。

## 完成定义

- vpm.db 只在测试临时目录创建；真实数据根未被使用。
- 仓储公开面有 README，应用服务不写 SQL。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: <ID>
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
