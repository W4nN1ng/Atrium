# P4-C 单包安装事务、manifest 最后写与 vault

> 阶段规格：`../VPM-P4.md`（只读 §7、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P4-A、P4-B、P3-D
> 覆盖对账项：B4 / B5 / B6 / B8 / B19 / B22 / B25 / B29 / K4 / K5
> 建议上下文：≤ 35k tokens

## 目标

- 实现单包安装/升级/降级/重装/卸载的事务：预检→暂存→旧文件入 vault→换入→manifest 最后写→提交。
- 任何一步失败回滚；无法安全回滚进入 needs_attention。
- 受保护包、Unity 运行中、工程外部修改、素材写入进行中、hash/空间不足都在预检拒绝。

## 不做什么

- 不做批量/UI（P4-E）。
- 不做 legacy 迁移（P6）。
- 不永久删用户文件。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4、§7.1
- `docs/prompts/VPM-P4.md` §7、§8
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §4.2–§4.4
- `install/journal.ts`、`cache/`、`vault/`

## 文件所有权

- 新增：`src/main/vpm/install/transaction.ts`、`preflight.ts`、`vault/`
- 修改：`install/journal.ts` 接真实步骤
- 新增：`tests/vpm/install/transaction.spec.ts`

## 交付物

- 预检：Unity 关闭、工程指纹、计划 hash、缓存/hash、空间、受保护包、manifest 可解析。
- 事务区 `.atrium-tx` 同卷；旧包/旧 Assets 进 vault；manifest 最后原子写。
- 旧 Assets 清理只按包声明 GUID/路径；`com.avca.bridge`、`import_log` 已知资产、未知文件保留。
- 成功提交清理临时；失败反向恢复；无法恢复进 needs_attention。
- 单包操作日志与错误码。

## 施工步骤

1. 先写预检与拒绝矩阵。
2. 实现暂存/换入/回滚步骤。
3. 接 vault 与 manifest 最后写。
4. 用 journal 记录每步。
5. 写成功/失败/外部修改/Unity 运行测试。

## 契约与不变量

- manifest 成功写之前不能标记 committed。
- 旧文件不永久删；vault 失败则中止。
- 工程外部改动/Unity 运行中不得继续。

## 测试与证据

- 单包安装/升级/降级/重装/卸载成功。
- 每步失败→回滚；manifest 不半写。
- Unity 运行/外部修改/受保护包/空间不足/素材写入进行中拒绝。
- 旧 Assets 清理碰到导入资产/桥接包/未知文件保留。
- 全量测试/typecheck。

## 完成定义

- 单包事务可独立跑通（无 UI）。
- 失败后工程恢复原状或明确 needs_attention。
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
