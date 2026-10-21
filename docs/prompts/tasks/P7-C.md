# P7-C 本地用户包目录

> 阶段规格：`../VPM-P7.md`（只读 §5）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P7-B、P4-C
> 覆盖对账项：C11
> 建议上下文：≤ 25k tokens

## 目标

- 扫描本地包目录的 `package.json`，作为 local 源加入目录/解析。
- 必须用户显式添加/信任；显示来源/版本/路径；可安装/重装。
- 不把本地包当远程包下载；hash/内容变化可检测。

## 不做什么

- 不自动扫描全盘。
- 不信任未确认目录。
- 不做 VCC 导入（P7-D）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.2、§6.3
- `docs/prompts/VPM-P7.md` §5
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §1.2
- `catalog/`、`install/transaction.ts`

## 文件所有权

- 新增：`src/main/vpm/catalog/local.ts`、IPC/UI
- 新增：`tests/vpm/catalog/local.spec.ts`

## 交付物

- 扫描/校验 package.json（包名/版本/Unity/依赖）。
- 显式信任/添加/移除；来源标记 local。
- 目录合并与解析输入；安装走事务（拷贝/链接策略明确）。
- 内容变化/hash/缺失检测。

## 施工步骤

1. 定义 local 包模型与校验。
2. 实现扫描/信任/持久化。
3. 接目录与解析。
4. 接安装/重装（走事务）。
5. 写坏包/缺文件/重名测试。

## 契约与不变量

- 未信任目录不进入目录/解析。
- 不把本地包上传/外发。
- 安装不永久删源目录。

## 测试与证据

- 正常/坏 package.json/缺文件/重名/信任。
- 安装/重装/内容变化。
- 全量测试/typecheck。

## 完成定义

- 本地包可被目录/解析/安装正确消费。
- 信任边界清楚。
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
