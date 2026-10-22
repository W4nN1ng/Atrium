# src/main/vpm/templates

## 职责

Atrium 自有模板（`.atriumtemplate` / `template.json`）的**存储与索引**（P5-A）：

- 内置模板：空白 / 角色 / 世界，**代码生成**，不落盘、不入库、不可改。
- 用户模板：`<dataRoot>/templates/<id>/template.json`（+ 可选 `files/`），
  数据库（`vpm_template`，vpm.db v4）只存索引：收藏、可见性、最近使用。
- 列表 / 读取（含 base 继承解析）/ 新增 / 编辑 / 复制 / 收藏 / 隐藏（删引用）/ 恢复 /
  标记最近使用 / 最近位置（`vpm_recent_location`）。

## 不负责什么

- 不建工程、不解包附件（P5-B/C 消费 `get()` 与 `filesDir()`）。
- 不做 `.atriumtemplate` ZIP 的导入导出（P7-D）；这里只认 `template.json` 与目录结构。
- 不做 UI（P5-D）。
- 不删用户文件：`removeReference()` 只把 `visible` 置 0；真要删由用户在资源管理器里做。
- 不写 Unity YAML / `ProjectSettings.asset`。

## 公开 API

只从 `index.ts` 导出：

- `TemplateService`
  - `templatesRoot` / `manifestPath(id)` / `filesDir(id)`
  - `list({ includeHidden? })` → `TemplateListEntry[]`（内置在前，其后按收藏/最近/名称）
  - `get(id)` → `{ manifest, chain }`（base 已合并；链从当前到最底层）
  - `raw(id)` → 原始清单（不解析 base）
  - `create(input)` / `update(id, patch)` / `duplicate(id, name?)`
  - `setFavorite(id, value)` / `removeReference(id)` / `restore(id)` / `markUsed(id)`
  - `recentLocations(limit)` / `recordLocation(path)`
- `TemplateStore`：`vpm_template` / `vpm_recent_location` 的唯一 SQL 入口。
- `BUILTIN_TEMPLATES` / `builtinTemplate(id)`
- 类型：`TemplateListEntry`、`CreateTemplateInput`、`UpdateTemplateInput`、`TemplateRow`、`ResolvedTemplate`。

纯逻辑（schema/继承/校验）在 `src/shared/vpm/domain/template.ts`：
`parseTemplateManifest`、`serializeTemplateManifest`、`resolveTemplate`、`mergeTemplate`、
`intersectUnityRange`、`rangesOverlap`、`normalizeAttachmentPath`、`isValidTemplateId`。

## 数据 / 写入

```text
<dataRoot>/templates/<id>/
  template.json      schemaVersion=1，原子写（写 .tmp → fsync → rename）
  files/...          可选附件；`unitypackages[].path` 必须是 files/ 下的相对路径
```

- 模板 id：`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`（ULID 大写、`builtin.xxx` 都合法）。
- `template.json` ≤256 KiB；附件 ≤32 个；容器（ZIP）≤2 GiB（P7-D 打包时检查）。
- 未知顶层字段原样保留（`extra`），编辑/复制/导出都不丢。
- `schemaVersion` 只认 1；不认识直接拒绝，不猜、不迁移。

### 继承规则（`resolveTemplate`）

| 项 | 规则 |
|---|---|
| Unity 范围 | `min` 取较晚、`max` 取较早；交集为空 → `unityRange` 错误 |
| 依赖 | 同名**覆盖**（子模板赢） |
| 附件 | 追加，按 path 去重（子模板先出现的不重复） |
| settings | 浅合并（子赢） |
| 深度 | ≤8（`TEMPLATE_MAX_DEPTH`） |
| 循环 | 检测到就报 `cycle` |

## 失败模式

- `vpmTemplateNotFound`：id 不合法、行不存在、base 指向不存在的模板。
- `vpmTemplateInvalid`：`schemaVersion` 不认识、字段不合法、文件缺失/不是 JSON/id 与目录不一致。
- `vpmTemplateReadOnly`：改/隐藏/收藏内置模板。
- `vpmTemplateWriteFailed`：数据根不可写、目录建不出来。
- 列表遇到坏文件**不抛异常**：该行标 `broken: true` 并带 `issues`，界面显示"需要修复"。

## 测试入口

- `tests/vpm/domain/template.spec.ts`（14 条）：schema、id/name/依赖/附件校验、
  未知字段保留、Unity 范围交集、继承合并、循环/深度/缺失 base、范围重叠。
- `tests/vpm/templates/service.spec.ts`（16 条）：内置三模板（依赖只写 ID+范围、无附件）、
  base 解析链、只读、原子写不留 .tmp、创建/更新/复制（含 files）、收藏排序、隐藏不删文件、
  坏文件标 broken、缺文件报 invalid、base 不存在、最近位置有界。

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根构造（`VpmRuntime.templates`）；P5-B/C 用 `get()`/`filesDir()`。
- 依赖：`shared/vpm/domain/{template,range,version,packageId,unityVersion}`、`../db`、
  `../fsUtil`（原子写）、`shared/ulid`。
- 不依赖 Electron、HTTP、渲染层；不 import 其他模块的内部文件。
