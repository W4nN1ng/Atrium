# P5-A 交接文档（模板格式、存储与原创内置模板）

> 写于 **2026-10-22 18:05**。读者：P5-B（新建工程）的接手人。
>
> 状态：**完成**。没有 UI（P5-D），也没有 `.atriumtemplate` 的 ZIP 打包/解包（P7-D）。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| `template.json` schema（schemaVersion=1）+ 校验 | ✅ |
| base 继承（交集/覆盖/追加/深度/循环） | ✅ |
| 用户模板存储（非 C 数据根、原子写） | ✅ |
| 内置空白/角色/世界（只有包 ID + 范围，无资产） | ✅ |
| 列表/新增/编辑/复制/收藏/最近/隐藏（不删文件） | ✅ |
| vpm.db v4（`vpm_template`、`vpm_recent_location`） | ✅ |
| typecheck / 定向 / 全量 | ✅ 30 条新用例 |
| ZIP 打包解包、UI | ❌ 分别属 P7-D / P5-D |

---

## 1. 契约变化

| 变化 | 说明 |
|---|---|
| `shared/vpm/domain/template.ts` | **新增**：schema、校验、继承、范围交集（纯函数） |
| `main/vpm/templates/` | **新增**：`TemplateService` / `TemplateStore` / `BUILTIN_TEMPLATES` |
| `VpmRuntime.templates` | **新增**（组合根构造，`initVpm` 之后可用） |
| vpm.db **v4** | `vpm_template`、`vpm_recent_location`；`VPM_REQUIRED_TABLES[4]` 已加 |
| 新错误码 | `vpmTemplateNotFound` / `vpmTemplateInvalid` / `vpmTemplateReadOnly` / `vpmTemplateWriteFailed` |

> 数据库版本从 3 变 4：`tests/vpm/db/migrate.spec.ts` 与 `tests/vpm/runtime.spec.ts` 里
> 所有"当前版本"断言已同步升到 4，"更新版本"的合成库升到 5。

---

## 2. 模板格式（`template.json`）

```json
{
  "schemaVersion": 1,
  "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "name": "我的角色工程",
  "description": "一段自己的说明",
  "base": "builtin.avatars",
  "unity": { "min": "2022.3", "max": null, "recommended": "2022.3.22f1" },
  "dependencies": { "com.vrchat.avatars": ">=3.0.0 <4.0.0" },
  "unitypackages": [{ "path": "files/avatar.unitypackage", "name": "avatar" }],
  "settings": {}
}
```

规则（全部有测试）：

- `schemaVersion` 只认 1，不认识直接拒绝（不猜、不迁移）。
- `id`：`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`（ULID 是大写，必须接受；`builtin.xxx` 也合法）。
- `name` ≤120 字符、无控制字符；`description` ≤2000。
- `base`：可选，不能指向自己；解析时 base 必须先存在（create/update 会先校验）。
- `unity.min` 必须能解析（`2022.3` / `2022.3.22f1`）；`max` 必须 ≥ min。
- `dependencies`：包名走 `normalizePackageId`，范围走 `tryParseVpmRange`。
- `unitypackages[].path` 必须是 `files/` 下的相对路径；拒绝绝对路径、盘符、`..`、反斜杠、
  空段、重复（大小写不敏感）；最多 32 个。
- 未知顶层字段进 `extra`，序列化时原样写回。

### 继承合并

| 项 | 规则 |
|---|---|
| Unity 范围 | `min` 取较晚、`max` 取较早；交集为空 → `vpmTemplateInvalid` |
| 依赖 | 同名覆盖（子模板赢） |
| 附件 | 追加，按 path 去重 |
| settings | 浅合并（子赢） |
| 深度 | ≤8 |
| 循环 | 检测到就报 `cycle` |

`resolveTemplate()` 返回 `chain`（当前 → 最底层），界面可以直接显示"继承自 builtin.blank"。

---

## 3. 存储

```text
<dataRoot>/templates/<id>/
  template.json     原子写（.tmp → fsync → rename，不留临时文件）
  files/...         可选附件
```

- **内置模板不落盘、不入库**：`BUILTIN_TEMPLATES` 是代码常量，`list()` 每次现拼。
- **数据库只存索引**：收藏、可见性、最近使用、以及一份元数据快照（文件坏了时兜底显示）。
- **删除 = `visible=0`**：`removeReference()` 只改行，文件永远不动；`restore()` 恢复。
  真要删文件由用户在资源管理器里做（P5-D 可以给"打开文件夹"入口）。
- `recordLocation()` 维护 `vpm_recent_location`，只保留最近 8 条（防无限增长）。

---

## 4. 内置模板（原创，清房约束）

| id | 名称 | 依赖 | 附件 |
|---|---|---|---|
| `builtin.blank` | 空白工程 | 无 | 无 |
| `builtin.avatars` | 角色工程 | `com.vrchat.avatars >=3.0.0 <4.0.0` | 无 |
| `builtin.worlds` | 世界工程 | `com.vrchat.worlds >=3.0.0 <4.0.0` | 无 |

- 依赖范围故意宽（不是具体版本）：具体版本可能被 yank，让解析器挑当前稳定版。
- 不含场景/材质/图标/ProjectSettings/任何第三方资源（`docs/VPM-CLEANROOM.md` §3.3）。
- 名称/描述是中文文案；三语显示名由界面映射，**不写进模板文件**。

---

## 5. 证据

```
npm run typecheck                                   → exit 0
npx vitest run tests/vpm/domain/template.spec.ts    → 14 passed
npx vitest run tests/vpm/templates/service.spec.ts  → 16 passed
npx vitest run tests/vpm                            → 44 files / 439 tests passed
```

覆盖：

- schema：完整清单、未知字段保留与往返、schemaVersion、id/name、自引用 base、
  依赖名/范围、Unity max<min、附件路径（6 种非法）、附件重复、>32 个。
- 继承：合并四项、交集为空、chain 顺序、循环、缺失 base、深度 >8。
- 存储：原子写不留 `.tmp`、创建后 list 可见、非法输入不落盘、更新保留未知字段、
  复制含 `files/`、内置复制成用户模板、收藏排序、隐藏后默认列表不显示但文件在、恢复、
  坏 JSON 标 `broken`、文件被删报 `invalid`、base 不存在、最近位置有界。
- 内置：三个模板的 id/依赖/无附件、只读（改/隐藏/收藏都拒绝）。

---

## 6. 未验证

1. **`.atriumtemplate` ZIP 打包/解包**：本次只做 `template.json` 与目录结构；
   ZIP 的 zip-slip/重复条目/大小写冲突等防线属于 P7-D（模板导入导出）。
2. **被建工程真正消费**：P5-B 才会用 `get()` 的结果建目录、装依赖；现在没有端到端证据。
3. **UI**：P5-D 才做模板列表/编辑；没有目视检查。
4. **大附件**：2 GiB 上限与 32 个附件的边界只在校验层测了，没有真拷过大文件。

---

## 7. 给 P5-B（新建工程）

```ts
const { manifest } = runtime.templates.get(templateId)   // base 已合并
// 1) 在父目录建隐藏临时目录 `.atrium-create-<op>`
// 2) 写 Packages/ ProjectSettings/ProjectVersion.txt（用 manifest.unity.recommended）
// 3) 附件从 runtime.templates.filesDir(templateId) 读，用我们自己的 unitypackage 读取器
// 4) 初始 vpm-manifest 写 manifest.dependencies（用 buildManifest，别手写 JSON）
// 5) 临时目录 rename 成最终目录（目标必须不存在）
// 6) 建完：runtime.templates.markUsed(templateId) + recordLocation(父目录)
// 7) 依赖安装复用 P4 事务（kind: 'install'），并且要 acquireMaintenance('create-project')
```

注意：

- `manifest.dependencies` 的范围是**模板声明**，不是锁定版本；真正装哪个版本由解析器决定。
- `unitypackages[].path` 是相对模板目录的 `files/...`，读文件时用 `path.join(filesDir(id), ...)`
  并再校验一次没有逃出 `files/`。
- 建工程失败时保留临时目录（`docs/VPM-IMPLEMENTATION-GUIDE.md` §7.2）。

---

## 8. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| db 版本 | 现在是 **v4**；写迁移测试时"更新版本"的合成库要用 5 |
| 模板 id | ULID 大写合法；不要把 `[a-z]` 写死 |
| 全量测试约 3.3 分钟 | `tests/perf/scale.spec.ts` 占 160s |
