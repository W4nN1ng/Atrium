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

## 不支持的范围写法

`~>`、`!=`、逗号分隔、括号组合、`||` 空分支、部分版本带预发布后缀都不接受；
遇到时抛 `vpmRangeInvalid`，不猜测语义。预发布默认遵循 SemVer 范围规则，
解析器可以显式传 `includePrerelease`。

## 规则

- 所有入口对输入做防御，不能因为一个坏条目抛未捕获异常。
- 新增文件必须在 `tests/vpm/domain/` 有对应纯函数测试。
- 跨模块只从本目录的公开文件导入，不依赖 `src/main/**`/`src/renderer/**`。
