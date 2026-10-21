# src/shared/vpm/domain

纯领域函数：版本/范围、仓库 JSON 归一、manifest、解析器、计划、模板等。

## 不负责什么

- 不碰 Electron、Node 文件系统、SQLite、HTTP。
- 不返回 UI 文案；只返回纯数据/错误码。
- 不持有状态。

## 当前

- `version.ts`：P1-D 的目录排序用最小 SemVer 比较；P3-A 会补严格解析/范围。

## 规则

- 所有入口对输入做防御，不能因为一个坏条目抛未捕获异常。
- 新增文件必须在 `tests/vpm/domain/` 有对应纯函数测试。
- 跨模块只从本目录的公开文件导入，不依赖 `src/main/**`/`src/renderer/**`。
