# P4-F 工程活动闸门与素材/包冲突防护

> 阶段规格：`../VPM-P4.md`（只读 §7.1、§7.2、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P4-D、P2-E
> 覆盖对账项：K4 / K5
> 建议上下文：≤ 30k tokens

## 目标

- 在核心建立**工程活动闸门**：同一工程上，素材写入（导入/撤销/删除 GUID/成员导入）
  与维护动作（装包/备份/复制/迁移/换版本）互斥。
- VPM 通过 gate 注入的端口申请维护租约；未拿到时不写工程，错误可解释。
- 把“桥接包与导入资产保护”变成机械规则：解析、事务、旧 Assets 清理都不能碰。

## 不做什么

- 不实现备份/复制/迁移/换版本本身（P6），只提供它们要用的闸门和测试。
- 不改素材导入算法、冲突确认、撤销规则。
- 不新增数据库表/迁移；锁是进程内状态 + 现有操作记录。
- 不做跨进程分布式锁；Atrium 单实例，跨进程靠 Unity/文件指纹与拒绝运行。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4.1、§7.3
- `docs/prompts/VPM-P4.md` §7.1、§7.2、§8
- `src/main/bridge/manager.ts`、`src/main/import/coordinator.ts`、`src/main/project/connections.ts`
- `src/main/vpm/install/`（P4-C 已落地部分）、`src/main/vpm/gate.ts`

## 文件所有权

- 新增：`src/main/project/activity.ts`（核心活动闸门）
- 新增：`src/shared/vpm/linkage.ts` 的活动类型（若 P2-E 尚未建）
- 修改：`src/main/index.ts`（注入 gate）、`src/main/vpm/gate.ts`、`src/main/vpm/install/*`
- 修改：`src/main/bridge/manager.ts` 或导入协调器（只上报 importing/结束，不改导入算法）
- 新增：`tests/project/activity.spec.ts`、`tests/vpm/install/activity-gate.spec.ts`
- 修改：`docs/VPM-ARCHITECTURE.md` §5/§7.3 若实现与合同有偏差（先改文档）

## 交付物

- `activity(projectId)`：`unityRunning`、`importing`、`maintenance`。
- `acquireMaintenance(projectId, kind)`：独占租约；拿不到返回 `vpmProjectBusy`（或既有等价错误码）。
- 包事务预检接闸门：Unity 运行 / 导入中 / 已有维护 → 拒绝，不进入写盘。
- 素材写入（导入/撤销/删除 GUID/成员导入）开始时上报 importing，结束后释放；
  不影响既有队列/撤销语义。
- 保护规则：`com.avca.bridge` 不在任何变更/清理集合；旧 Assets 清理只按包声明 GUID/路径，
  与 `import_log`/未知文件重叠时保留。
- 测试：同工程竞争、不同工程并行、租约释放、崩溃/取消后释放、导入中拒绝安装、安装中拒绝导入。

## 施工步骤

1. 先实现纯状态机（无 IO）+ 单测：租约、导入计数、Unity 运行组合。
2. 接桥接/导入协调器的开始/结束事件；确保异常/取消也释放。
3. 在 VPM gate 注入端口；P4-C 事务预检调用；错误码 + 三语。
4. 加保护检查：解析计划/清理列表拒绝 `com.avca.bridge`；清理遇 `import_log` 保留。
5. 竞争/失败注入测试；跑定向 + 全量。

## 契约与不变量

- 一个工程同时最多一个维护租约；素材导入可与只读浏览并行，但不能与维护写并行。
- 包事务必须同时满足 `unityRunning=false`、`importing=false`、租约到手。
- 释放必须幂等；异常/取消/窗口关闭都不能漏释放。
- 不同工程可并行；下载队列仍全局限流。
- 闸门不是安全边界之外的新写入者：它只拒绝/排队，不直接写工程。
- 错误只返回码 + 参数，不返回工程内容/文件句柄。

## 测试与证据

- 状态机：获取/重入/释放/异常释放/导入计数/Unity 运行。
- 集成：导入中安装被拒；安装中导入被拒或等待（按现有 UX，不静默排队）；不同工程并行。
- 保护：`com.avca.bridge` 在任何计划/清理里都被拒；`import_log` 资产不被移动。
- 失败注入：租约获取后抛错仍释放；进程内取消。
- 全量测试/typecheck。

## 完成定义

- 同一工程不会同时出现素材导入与包事务/维护写。
- 受保护包/导入资产有机械测试，不靠注释。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: P4-F
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ProjectLinkagePort.activity/acquireMaintenance；错误码 vpmProjectBusy
新增/修改模块 README: project/activity README 或架构 §7.3
已验证: ...
未验证: P6 备份/迁移接入（P6-D）、真 Unity 导入并发（P5-E）
给下一个任务: P6-D 所有维护动作先拿租约；导入进行中拒绝备份
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
