# P5-B 交接文档（新建工程、校验与最近路径）

> 写于 **2026-10-22 18:30**。读者：P5-C / P5-D 的接手人。
>
> 状态：**完成**。唯一缺口是"真 Unity 打开新建工程"——需要开 GUI，本工作站不做。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| 名称/路径校验矩阵（Windows 规则/已存在/权限/长路径/空间/Unity 版本） | ✅ |
| 最小骨架 + `ProjectVersion.txt`（不写 `.meta`、不写 `ProjectSettings.asset`） | ✅ |
| 初始 `vpm-manifest.json` | ✅ |
| 模板依赖走 P3/P4 计划 + 事务安装 | ✅ |
| 失败归档（回滚仓 `create-failed/`，回滚仓不可用则父目录兜底） | ✅ |
| 依赖安装失败保留工程 | ✅ |
| 最近 8 个父目录（`vpm.db`，不污染核心设置） | ✅ |
| typecheck / 定向测试 | ✅ 18 条新用例 |
| **真 Unity 打开新建工程** | ❌ 需要 GUI |

---

## 1. 契约变化

| 变化 | 说明 |
|---|---|
| `main/vpm/unity/create.ts` | **新增** `ProjectCreateService`（`validate` / `create`） |
| `main/vpm/projects/recent.ts` | **新增** `RecentLocationStore`（`vpm_recent_location` 唯一 SQL 入口） |
| `VpmRuntime.create` | **新增** |
| 新错误码 | `vpmCreateRejected`（校验不过）、`vpmCreateFailed`（建到一半失败，现场已保留） |
| `TemplateAttachmentPort` | **新增**（P5-C 注入；没注入时带附件的模板会在校验阶段被拒） |

`TemplateService.recentLocations/recordLocation` 仍然可用，内部改成委托 `RecentLocationStore`。

---

## 2. 校验矩阵（`validate()` 是只读的）

| 检查 | 拒绝码 |
|---|---|
| 父目录不存在 / 不是目录 / 是符号链接 | `parentMissing` / `parentNotDirectory` / `parentSymlink` |
| 父目录在已有 Unity 工程内（往上找 `ProjectSettings/ProjectVersion.txt`） | `parentInsideProject` |
| 父目录在禁用根里（数据根、应用目录） | `parentUnsafe` |
| 父目录不可写 | `parentNotWritable` |
| 名称空 / >80 / 非法字符 `<>:"/\|?*` / 保留名 / 结尾点或空格 / `.` `..` | `nameEmpty` `nameTooLong` `nameIllegal` `nameReserved` `nameTrailing` |
| 目标已存在（**空目录也算存在**） | `targetExists` |
| 最终路径 ≥260 | `longPath` |
| 剩余空间 < 估算×1.2 + 512 MiB | `noSpace` |
| Unity 版本解析不了 | `unityVersionInvalid` |
| Unity 版本不在已安装列表 | `unityVersionMissing` |
| 模板带附件但没注入端口 | `attachmentsUnsupported` |
| 模板 id 不存在 | `templateMissing` |

警告（不阻塞）：`unityVersionUnverified`（没探测到任何编辑器）、`dependenciesFailed`（依赖没装完）。

> 空间估算 = 64 MiB 骨架 + 模板 `files/` 实际大小。

---

## 3. 创建流程

```text
validate()
  ↓
lease = activity.acquireMaintenance(parentDir, 'create-project')   // P4-F 闸门
  ↓
<parent>/.atrium-create-<op>/
  Assets/  ProjectSettings/ProjectVersion.txt  Packages/vpm-manifest.json
  （可选）模板附件 → Assets/
  ↓
rename → <parent>/<name>            ← 目标必须不存在
  ↓
projects.addExisting()              ← 核心 project 表 + VPM 台账
templates.markUsed() + recordLocation(parent)
  ↓
plans.resolve({ requests: 模板依赖 }) → transactions.apply()
  ↓
{ projectPath, dependencyStatus: none|installed|failed, operationId, errorCode, warnings }
```

### 写什么、不写什么

- **写**：`Assets/`、`Packages/`、`ProjectSettings/ProjectVersion.txt`、`Packages/vpm-manifest.json`。
- **不写**：`ProjectSettings.asset`（Unity 首次打开生成）、任何 `.meta`、场景/材质/脚本、
  UPM 的 `Packages/manifest.json`、VCC 的 LiteDB/settings。

`ProjectVersion.txt`：

```text
m_EditorVersion: 2022.3.22f1
m_EditorVersionWithRevision: 2022.3.22f1 (887be4894c44)   ← 只有知道 revision 时才写
```

### 失败策略（重要）

| 失败位置 | 处理 |
|---|---|
| rename 之前（骨架/附件/manifest） | 临时目录 → 回滚仓 `vault/<slug>/<op>/create-failed/`；回滚仓不可用时 → 父目录旁 `.atrium-create-failed-<op>`。**不永久删**。抛 `vpmCreateFailed`（带 `opId`） |
| rename 之后（依赖安装） | **工程保留**，返回 `dependencyStatus='failed'` + 错误码，用户可以在列表里重试装依赖 |

---

## 4. 最近路径

`vpm_recent_location`（vpm.db v4，P5-A 建的表）只存父目录，最近 8 条，
同毫秒用 `rowid DESC` 兜底排序。**不写核心 `settings.json`**（那是素材库/界面偏好）。

---

## 5. 证据

```
npm run typecheck                              → exit 0
npx vitest run tests/vpm/unity/create.spec.ts  → 18 passed
```

覆盖：

- 校验：干净输入、父目录缺失/是文件、父目录在 Unity 工程内、禁用根、非法/保留/结尾点/
  前导空格/超长/空名称、目标已存在（空目录）、长路径、Unity 版本非法/未安装/未探测（只警告）、
  带附件但没端口。
- 创建：骨架三个目录 + 版本文件内容 + **没有 `.meta`、没有 `ProjectSettings.asset`**、
  初始 manifest `{dependencies:{},locked:{}}`、`addExisting` 被调用、最近位置写入。
- revision 行。
- 依赖：`builtin.avatars` 的请求带 `range`、成功后 `installed`、事务回滚后 `failed` 且工程保留、
  `resolve` 抛错也 `failed`。
- 失败归档：附件端口抛错 → 目标目录没出现、临时目录被挪到 `create-failed`（或兜底目录）、
  没有 `addExisting`。
- 附件端口注入后会被调用且文件落到 `Assets/`。
- 最近路径：12 条只留 8 条、最新在前、删除/清空。

---

## 6. 未验证

1. **真 Unity 打开新建工程**：这是本卡完成定义里的硬条件，需要 GUI。
   步骤见 §7，用户执行一次就能把状态坐实。
2. **模板附件**：P5-C 才实现；现在带附件的模板会被拒。
3. **`kind=create` 的操作记录**：没做。`vpm_operation.kind` 有 CHECK 约束
   （`install/remove/upgrade/undo`），加 `create` 要重建表；依赖安装本身有 `install` 记录，
   收益不大，留给需要时再迁移。
4. **权限拒绝**：`fs.accessSync(W_OK)` 在 Windows 上对 ACL 的判断偏宽松，没有用真实
   只读目录验证过（只读文件系统无法在 CI 里稳定模拟）。

---

## 7. 真 Unity 验证步骤（用户执行）

```powershell
$env:AVCA_APP_HOME = 'E:\avca-sandbox\app'
$env:AVCA_REQUIRE_SANDBOX_HOME = '1'
cd C:\程序\A素材管家
npm run dev
```

1. 设置 → 项目与包：启用 VPM，选**非 C** 数据根。
2. 新建工程：父目录选 `E:\avca-sandbox\projects`，名称 `BlankTest`，模板"空白工程"，
   Unity 选 **2022.3.22f1**。
3. 确认目录出现：`Assets/`、`Packages/vpm-manifest.json`、`ProjectSettings/ProjectVersion.txt`；
   **没有** `.meta`、没有 `ProjectSettings.asset`。
4. 用 Unity Hub 打开 `BlankTest`：能正常打开、Console 无错误、`ProjectSettings.asset` 被 Unity 生成。
5. 再建一个"角色工程"：依赖应通过事务装上，`Packages/com.vrchat.avatars` 存在，
   `vpm-manifest.json` 的 `dependencies`/`locked` 正确。
6. 关 Unity → 在列表里能看到这两个工程、最近路径里有 `E:\avca-sandbox\projects`。

---

## 8. 给 P5-C

```ts
const attachments: TemplateAttachmentPort = {
  async apply({ projectPath, templateId, attachments }) {
    // 解包到 <projectPath>/Assets/，只复制 asset + asset.meta，忽略 preview.png
    // 已存在同名 → 抛错（整个创建中止，P5-B 会把临时目录归档）
  }
}
// 建服务时传进去即可
```

注意：P5-B 在调用 `apply` 之前**已经建好** `Assets/`；`apply` 只需要往里放文件。
抛错 = 整个创建失败（临时目录归档），所以不要"部分成功还返回 ok"。

---

## 9. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| 回滚仓在 C: 不可用 | `VaultStore` 会抛 `vpmVaultUnavailable`；P5-B 已做父目录兜底 |
| 全量测试约 3.3 分钟 | `tests/perf/scale.spec.ts` 占 160s |
| 长路径 | 最终路径 ≥260 直接拒绝（与解压/清理策略一致） |
