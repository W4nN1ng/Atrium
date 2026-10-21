# P6-B ZIP 备份、记录与从备份新建

> 阶段规格：`../VPM-P6.md`（只读 §6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P6-A
> 覆盖对账项：A16 / A17 / E1 / E2 / E3 / E4 / E5 / E6 / E7
> 建议上下文：≤ 30k tokens

## 目标

- 基于收集器生成 ZIP，支持压缩级别/进度/取消/hash/记录。
- 备份记录存 vpm.db，支持列表/大小/时间/hash/打开位置。
- 从备份新建工程：解压到新目录，绝不覆盖；可选补装包。

## 不做什么

- 不做复制/换版本/迁移（P6-C/D）。
- 不自动删旧备份。
- 不把备份写到 C。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4
- `docs/prompts/VPM-P6.md` §6
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §6.3
- `backup/collector.ts`

## 文件所有权

- 新增：`src/main/vpm/backup/service.ts`、zip writer
- 新增：备份记录表（vpm.db 迁移）
- 新增：`tests/vpm/backup/service.spec.ts`

## 交付物

- ZIP 写入（store/fast/normal）、进度、取消、临时文件清理。
- 备份记录：项目/路径/大小/时间/hash/排除项。
- 从备份新建：目标非空拒绝、解压校验、可选补装包。
- 打开备份位置。

## 施工步骤

1. 实现 ZIP 写入与临时文件。
2. 接记录表与查询。
3. 实现从备份新建/解压校验。
4. 处理取消/失败/空间不足。
5. 写真机解压验证。

## 契约与不变量

- 取消/失败不留半个 zip 冒充成功。
- 从备份新建不覆盖任何已存在目录。
- 备份在非 C 数据根。

## 测试与证据

- ZIP 可解压/内容正确/排除正确。
- 取消/失败/空间不足清理。
- 从备份新建成功/非空拒绝。
- 全量测试/typecheck。

## 完成定义

- 备份可被标准工具解压。
- 记录/打开位置可用；未实现 UI 也要有服务 API。
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
