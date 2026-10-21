# P4-B 缓存、下载、hash 与解压安全

> 阶段规格：`../VPM-P4.md`（只读 §5、§6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-C
> 覆盖对账项：B20 / B21 / C9
> 建议上下文：≤ 30k tokens

## 目标

- 把包下载到非 C 缓存，流式 hash，原子落盘，支持断点/失败清理。
- 实现 ZIP 解压的安全边界：zip-slip、绝对路径、`..`、符号链接、bomb、大小/条目上限。
- 缓存命中/损坏/重下的行为可测试；不写工程。

## 不做什么

- 不装包、不改 manifest、不做包 UI。
- 不把整包读进内存。
- 不接受无 hash 的包作为可安装。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.1、§10.3
- `docs/prompts/VPM-P4.md` §5、§6
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §4.2
- `src/main/vpm/http/`、`cache/`

## 文件所有权

- 新增：`src/main/vpm/cache/` 完整实现、`install/archive.ts` 解压适配器
- 新增：`tests/vpm/cache/*.spec.ts`、`tests/vpm/install/archive.spec.ts`
- 修改：`http/` 只加下载所需能力

## 交付物

- 缓存路径/配额边界；临时文件→hash→rename；损坏可重下。
- ZIP 解压到同卷临时目录，逐条目校验路径/类型/大小。
- 安全错误码：zip-slip、bomb、hash、空间、损坏。
- 解压后目录结构校验（包根/package.json）。

## 施工步骤

1. 先写恶意 zip fixture 与安全测试。
2. 实现流式下载/hash/原子落盘。
3. 实现安全解压与包根校验。
4. 实现缓存命中/损坏重下。
5. 写 README：缓存不变量与清理边界。

## 契约与不变量

- 缓存/临时目录不落 C。
- 解压路径必须在临时根内；不跟随符号链接。
- hash 不匹配/无 hash 不进入安装。

## 测试与证据

- zip-slip/绝对路径/`..`/symlink/bomb/超大。
- 下载中断/超时/hash 不匹配/缓存损坏。
- 成功解压的包根识别。
- 全量测试/typecheck。

## 完成定义

- 所有恶意样本被拒绝且有错误码。
- 缓存/解压不触碰工程。
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
