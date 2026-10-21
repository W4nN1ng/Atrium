# src/shared/vpm/domain

纯领域函数：版本/范围、仓库 JSON 归一、manifest、解析器、计划、模板等。

## 不负责什么

- 不碰 Electron、Node 文件系统、SQLite、HTTP。
- 不返回 UI 文案；只返回纯数据/错误码。
- 不持有状态。

## 当前

- `version.ts`：P3-A 严格 SemVer 2.0 解析/比较；`compareVpmVersions` 保留对历史
  部分版本的宽容降级，供目录排序使用。
- `range.ts`：精确、`^ ~ >= <= > <`、部分版本/`x/*`、`||`、连字符范围；
  非法语法抛 `vpmRangeInvalid`。
- `unityVersion.ts`：`YYYY.MINOR.PATCH[abfp]N[cN]` 解析/比较、部分版本和最低版本兼容；
  中国版后缀只保留显示，兼容按基础版本。
- `packageId.ts`：VPM 包名归一/校验；拒绝路径分隔符、`..`、尾点/空格、Windows 保留名。
- `project.ts`：P2-B 的工程快照纯逻辑（ProjectVersion、vpm-manifest、Packages、
  legacy 报告、指纹）；文件读取通过 `ProjectReaderPort` 注入，不 import `node:fs`。
- `resolver.ts`：P3-B 的确定性贪心解析器（约束表 + 工作队列 + 局部修复）；
  不做全局回溯，输出 selected/requirements/conflicts/missing/unused。
- `plan.ts`：P3-C 的只读 `ChangePlan`：装/升/降/重装/卸载/保持、mark-and-sweep、
  upgradeAll 展开、downloads/disk、冲突解释和稳定 planHash；不执行、不写盘。

### 解析器语义

- 根约束来源为 `''`；传递依赖来源是要求它的包名；
- locked 是偏好：无显式升级/降级且满足约束时保留；新约束不满足才重选；
- 候选过滤顺序：范围 → Unity → yanked/预发布 → 仓库优先级/同版本 hash；
- 受保护包（默认 `com.avca.bridge`）和 legacy 包永不选中；
- 找不到版本时 `blocked=true`，保留 requirements 与来源，不猜测、不回溯；
- 预发布默认遵循 SemVer；`allowPrerelease` 只影响候选策略，不改变范围解析。
- `unused` 只列已安装但不再可达的包；unlisted 单独列出，永不自动移除。
- `ChangePlan` 的 remove 只来自 resolver.unused，且排除 protected/legacy/unlisted；
  远端动作缺 URL/hash 会 blocked 且不产生 download；planHash 只由计划内容决定。

## 不支持的范围写法

`~>`、`!=`、逗号分隔、括号组合、`||` 空分支、部分版本带预发布后缀都不接受；
遇到时抛 `vpmRangeInvalid`，不猜测语义。预发布默认遵循 SemVer 范围规则，
解析器可以显式传 `includePrerelease`。

## 规则

- 所有入口对输入做防御，不能因为一个坏条目抛未捕获异常。
- 新增文件必须在 `tests/vpm/domain/` 有对应纯函数测试。
- 跨模块只从本目录的公开文件导入，不依赖 `src/main/**`/`src/renderer/**`。
