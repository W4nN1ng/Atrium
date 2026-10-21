# P1-D 仓库服务、官方/curated 与来源合并

> 阶段规格：`../VPM-P1.md`（只读 §8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-B、P1-C
> 覆盖对账项：C1 / C2 / C8 / C10 / C14 / B15
> 建议上下文：≤ 25k tokens

## 目标

- 实现仓库用例：添加、移除、刷新单个/全部、错误隔离、条件请求。
- 联网可用且仓库表为空时种子 official/curated；用户仓库排在后面。
- 把多仓库同名包/版本合并成目录查询，同版本不同 hash 标记冲突而不是静默选一个。
- 把服务接入 VPM 组合根，但先不暴露 IPC/UI。

## 不做什么

- 不做仓库编辑/排序/请求头/导入导出（P7-A/B）。
- 不做安装/解析（P3/P4）。
- 不自动高频刷新。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §4、§5、§6.2、§7.2
- `docs/prompts/VPM-P1.md` §8
- `src/main/vpm/db/`、`repos/`、`http/`、`cache/`
- `src/main/vpm/index.ts`（本任务新建组合根；P1-A 不建空壳）

## 文件所有权

- 新增：`src/main/vpm/reposService.ts`、`src/main/vpm/catalog/`
- 新增：`src/main/vpm/index.ts` 组合根（只接服务，不接 IPC）
- 新增：`reposService`/`catalog` 的 README 与测试
- 新增：`tests/vpm/repos/*.spec.ts`

## 交付物

- 仓库用例：list/add/remove/refresh/refreshAll，返回稳定 DTO。
- 官方/curated 种子与顺序；URL 归一/去重。
- 刷新事务替换包行；304 保留旧包；失败保留旧数据 + 错误码。
- 目录查询：按包名/显示名/关键词/别名搜索，带来源、版本数、yanked/hidden。
- 同版本多源 hash 冲突标记。

## 施工步骤

1. 实现仓库仓储用例和种子。
2. 接入 HTTP/缓存，做刷新与错误隔离。
3. 实现来源合并/搜索纯查询。
4. 接入组合根；测试禁用状态不加载/不联网。
5. 写模块 README 与交接。

## 契约与不变量

- 一个仓库失败不影响其他仓库。
- 304/失败都不能清空旧目录。
- 请求头/token 不落明文、不进日志。

## 测试与证据

- fake 仓库：成功、304、坏 JSON、超时、部分失败。
- 同名包多源、同版本不同 hash、官方+curated 顺序。
- 禁用或关闭联网开关时初始化不联网。
- 全量测试/typecheck。

## 完成定义

- 组合根可初始化/释放服务；核心仍只在启用时加载。
- 目录 API 有明确的 DTO 与错误码。
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
