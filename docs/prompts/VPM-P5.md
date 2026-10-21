# VPM-P5 执行提示词：项目创建、模板与启动 Unity

> **执行入口（2026-10-21 起）**：本文件是 P5 阶段规格，不是一次执行的任务。
> 请按 [`tasks/P5-*.md`](tasks/) 的任务卡逐个执行；本文件只查阅任务卡列出的章节。
> 任务板：[`../VPM-TASKS.md`](../VPM-TASKS.md) · 共同规则：[`_COMMON.md`](_COMMON.md) · 架构：[`../VPM-ARCHITECTURE.md`](../VPM-ARCHITECTURE.md)。

> 前置：P4 已合并，事务能在沙盒里安全装包。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §7。
>
> 本阶段做"从无到有"：自有模板格式、空白/角色/世界模板、新建工程、
> unitypackage 附件、启动 Unity。**不复制 ALCOM 的模板/资产/工程设置。**

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p5-templates origin/main
```

确认 P4 的真 Unity 沙盒记录；记录基线。

---

## 2. 目标

1. 定义并实现 `.atriumtemplate`：可导入/导出、可带依赖和 unitypackage 附件。
2. 内置三个原创模板：空白、角色、世界（只含元数据 + 官方包依赖，不含美术资源）。
3. 新建工程：校验路径 → 空白骨架 → 解包附件 → 写初始 manifest → 安装依赖 → 入列表。
4. 启动 Unity：按工程版本匹配编辑器，安全参数，运行状态。
5. 模板管理 UI：列表、收藏、最近使用、新建/编辑/复制/隐藏、导入/导出。
6. 工程创建 UI：模板 → 名称/位置/Unity → 确认；一个主按钮。

---

## 3. 明确不做

- 不导入 ALCOM/VCC 模板（P7 做只读适配）。
- 不复制 ALCOM 的 tar.gz/ProjectSettings/场景/材质/图标。
- 不手写 `.meta`、不生成 Unity 资源、不改 `ProjectSettings.asset` 的 YAML。
- 不做工程备份/复制/换版本（P6）。
- 不写 VCC；不接深链（P7）。
- 不新增核心 `library.db` schema。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 内置角色/世界模板按 Unity 版本打包成 tar.gz，内含完整工程骨架/设置/资源；
  空白模板只建 `Assets`、`ProjectSettings`、`Packages` 和 `ProjectVersion.txt`。
- 自定义模板有两种：VCC 的 `Templates/<name>` 文件夹（递归复制）；
  `.alcomtemplate` 带 `base` 继承、`vpmDependencies`、`unityPackages` 附件；
  继承时依赖范围取**交集**，附件追加。
- 建工程顺序：目标目录必须不存在 → 解包 base → 导入 unitypackage 附件 →
  更新工程名/GUID → 写初始 manifest → 解析安装依赖 → 注册到项目列表。
- unitypackage 是一个 gzip tar：每个 GUID 一个目录，里面有 `pathname`、`asset`、
  `asset.meta`；把 asset 和 meta 复制到 `pathname` 指定位置，忽略 preview，
  最后清临时目录。它**自带 `.meta`**，所以导入不能手写 meta。

**Atrium 的独立实现**

- 不复制 ALCOM 模板/资产/ProjectSettings，定义自有 `.atriumtemplate`：
  ZIP + `template.json` + `files/`；支持 base 继承、依赖范围合并、附件追加、
  循环/深度检测。内置空白/角色/世界三个**原创最小骨架**，只带依赖元数据，不带美术资源。
- 建工程在父目录的隐藏临时目录 `.atrium-create-<op>` 完成：
  写骨架/`ProjectVersion.txt`/初始 `vpm-manifest.json` → 导入附件 →
  rename 成最终目录（目标必须不存在）→ 注册项目 → 复用 P4 事务装依赖。
- 不写 `ProjectSettings.asset` YAML，不手写 `.meta`；工程名由文件夹名决定；
  unitypackage 附件只搬包内自带的 asset/meta，preview 一律忽略。
- 失败保留临时目录/半工程供重试，不永久删除；角色/世界模板的完整设置差异在
  parity 里标"部分"，不假装与 ALCOM 内置模板等价。

**施工顺序**

1. 模板格式/校验/继承纯逻辑（含循环检测）。
2. 自造 unitypackage tar.gz 夹具 + 读取器。
3. 工程骨架/临时目录/rename。
4. 初始 manifest + 复用 P4 装依赖。
5. 启动 Unity 真机打开。
6. 模板 UI/编辑器。

**最容易做错**

- 手写 `.meta` → GUID 与包内不一致，资源引用全断；只能搬包内 meta 或让 Unity 生成。
- 直接在最终目录里建 → 中途失败留下半工程；必须临时目录 + rename。
- 依赖范围简单覆盖 → base 的约束丢失；要合并/取交集。
- 把 unitypackage 的 preview 当资源导入 → 垃圾文件。
- 复制 ALCOM 的模板资产 → 版权问题；只做依赖预设与自有骨架。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §7。

---

## 4. 自有模板格式

### 4.1 容器

`.atriumtemplate` = ZIP：

```text
template.json
files/...                 （可选，附件）
```

`template.json`：

```json
{
  "schemaVersion": 1,
  "id": "ulid",
  "name": "我的角色工程",
  "description": "一段自己的说明",
  "base": null,
  "unity": {
    "min": "2022.3",
    "max": null,
    "recommended": "2022.3.22f1"
  },
  "dependencies": {
    "com.vrchat.avatars": "3.x"
  },
  "unitypackages": [
    { "path": "files/avatar.unitypackage", "name": "avatar" }
  ],
  "settings": {}
}
```

- `dependencies` 的值是 VPM 范围字符串；空 = 无依赖。
- `unitypackages[].path` 必须是 `files/` 下的相对路径；禁止绝对/`..`/符号链接。
- 单文件上限：模板 ZIP ≤2 GiB；附件数 ≤32；`template.json` ≤256 KiB。
- 解析要防 zip-slip、重复条目、大小写冲突、保留名、ADS、符号链接。
- `settings` 保留给未来，不要写 Unity YAML。
- `base`：可选，指向另一个可见模板的 id；解析时先取 base 的 Unity 范围/依赖/附件，
  再用当前模板覆盖（依赖同名覆盖、附件追加）。深度 ≤8，检测循环。
  内置模板也可以作为 base；P7 导入外部模板时把它的继承关系映射到 `base`。
- 导出时重新打包（不要直接复制用户原始 zip 的未知条目）；保留用户附件原样。

### 4.2 内置模板（原创）

| id | 名称 | 依赖 | 说明 |
|---|---|---|---|
| `builtin.blank` | 空白工程 | 无 | 只建目录 + 版本文件 |
| `builtin.avatars` | 角色工程 | `com.vrchat.avatars`（兼容范围） | 不打包 SDK；安装时从官方仓库取 |
| `builtin.worlds` | 世界工程 | `com.vrchat.worlds`（兼容范围） | 同上 |

- 依赖范围要让解析器选到当前稳定版；不要硬编码一个可能被 yank 的具体版本。
- Unity 推荐 `2022.3.22f1`；min `2022.3`。
- 不包含场景/材质/图标/ProjectSettings 资产。
- 名称/描述用我们自己的文案；三语显示名可以另外映射，不写进模板文件。

### 4.3 存储

- 用户模板：`<dataRoot>/templates/<id>/`（`template.json` + `files/`）。
  模板可能带大附件，放非 C 数据根。
- 内置模板：代码生成，不入库/不落盘。
- `vpm.db` v4：

```sql
CREATE TABLE IF NOT EXISTS vpm_template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,          -- builtin/imported/user
  format TEXT NOT NULL,          -- atrium
  unity_range TEXT,
  dependencies_json TEXT,
  unitypackages_json TEXT,
  settings_json TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vpm_recent_location (
  path TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL
);
```

- 删除模板 = 从列表隐藏/移除引用，**不永久删用户文件**；文件可留在原处或移到回滚仓，
  由用户明确选择。

---

## 5. 新建工程

### 5.1 校验

- 父目录存在、可写；**父目录不能在已有 Unity 工程内、素材库内、应用安装目录内**；
  工程名：
  - 非空、≤80 字符；不能是 `.`/`..`；
  - 不能含 Windows 非法字符 `<>:"/\|?*`、控制字符、结尾点/空格；
  - 不能是保留名；最终路径必须在父目录下（不逃逸）。
- 最终目录 `<parent>/<name>` **必须不存在**（空目录也算存在，拒绝，避免覆盖）。
- 父目录/工程卷剩余空间 ≥ 估算 ×1.2 + 512 MiB。
- Unity 版本必须在已安装列表里；首选/真机只验证 `2022.3.22f1`。
  其他版本不要写死拒绝；允许选择，但 UI 标记"未验证"，报告里也不能宣称已支持。

### 5.2 创建流程

1. 在父目录创建隐藏临时目录 `<parent>/.atrium-create-<op>`（同卷，确保不存在）。
2. 创建：

   ```text
   Assets/
   ProjectSettings/
   Packages/
   ProjectSettings/ProjectVersion.txt
   ```

   `ProjectVersion.txt`：

   ```text
   m_EditorVersion: 2022.3.22f1
   m_EditorVersionWithRevision: 2022.3.22f1 (<revision，若已知>)
   ```

   - 不写 `ProjectSettings.asset`；让 Unity 生成。
   - 不写任何 `.meta`。
3. 处理模板附件：
   - 逐个解包 `.unitypackage` 到临时工程的 `Assets/`；
   - 只复制 `asset` + `asset.meta`（如果包内提供）；不复制 `preview.png`；
   - `pathname` 必须在 `Assets/` 下；拒绝 `..`/绝对/符号链接/重复目标；
   - 已存在同名文件 → 中止整个创建（不覆盖），临时目录移到回滚/垃圾区；
   - 缺 `.meta` → 复制 asset + warning（让 Unity 生成；不手写）；
   - 记录 GUID 冲突/重复路径；不生成 GUID。
4. 写初始 `Packages/vpm-manifest.json`：

   ```json
   { "dependencies": { "com.vrchat.avatars": { "version": "3.x" } } }
   ```

   - 用 P1 的序列化；保留 `locked` 为空或省略。
5. 把临时目录 rename 成最终 `<parent>/<name>`（同卷原子；目标已存在则失败）。
6. 调用现有 `upsertProject` 让工程入列表；扫描 VPM；记录最近位置/模板。
7. 解析并安装模板依赖（P3/P4 事务）：
   - 生成计划 → 应用；
   - 失败：工程保留（骨架 + manifest），标记"依赖未装完"；给重试/查看/移到回滚区；
     **不删除工程**；
   - 成功后：可选启动 Unity。
8. 失败在步骤 5 之前：临时目录移到 `<dataRoot>/vault/<projectSlug>/<op>/create-failed/`
   或用户指定位置；不永久删；给错误码。
9. 整个过程写操作记录（kind=create），可在历史里看到。

### 5.3 不写什么

- 不生成 `.meta`、不生成场景/材质/脚本。
- 不改 `Packages/manifest.json`（UPM 的）；让 Unity 首次打开生成。
- 不写 VCC 的 LiteDB/settings。
- 不把工程设置 YAML 拼出来；Unity 默认设置即可。
  这与 ALCOM 的内置模板（带完整 ProjectSettings/场景/资源）有差异：
  角色/世界模板先标记为"部分"；P8 再评估是否用**原创**编辑器脚本补推荐设置，
  没有真机验证就不宣称完整。

---

## 6. unitypackage 读取

新建 `src/main/vpm/unityPackage.ts`：

- `.unitypackage` 是 tar.gz；用现有 `tar` 依赖读取。
- 每条记录通常是一个 GUID 目录，包含：
  - `pathname`（目标资源路径，通常以 `Assets/` 开头）
  - `asset`（文件内容）
  - `asset.meta`（Unity 生成的 meta）
  - `preview.png`（忽略）
- 规则：
  - 只接受 `pathname` 在 `Assets/` 下；拒绝绝对/`..`/控制字符/保留名；
  - 目标路径不得重复/大小写冲突；
  - 不跟随符号链接；
  - 只写 `asset` 和 `asset.meta`；**绝不生成/补写 `.meta`**；
  - 缺 `asset.meta` 时复制 asset 并 warning；
  - 包内 `.meta` 的 GUID 冲突 → 中止/警告（新工程一般无冲突）；
  - 大小/条目数限制，防 zip bomb；
  - 解包临时目录在 `<dataRoot>/tmp` 或临时工程 `Temp`，完成后清理（应用自己的）。
- 用测试自造的 tar.gz（不要复制 ALCOM/VRChat 的 unitypackage 资产）。
  需要 `.meta` 时先用 Unity 生成，再打包；不要手写 meta 内容。

---

## 7. 启动 Unity

新建 `src/main/vpm/unityLaunch.ts`：

- 输入：工程路径、可选编辑器 id/路径、附加参数（工程设置里的 `unityArgs`）。
- 解析编辑器：
  - 优先工程 `vpm_project.unity_exe_path`；
  - 否则按 `ProjectVersion.txt` 的基础版本匹配 `vpm_unity_install`；
  - 找不到 → `vpmUnityNotFound`，给"添加 Unity/选择路径"。
- 校验：
  - 工程路径存在、是目录、有 `ProjectVersion.txt`；
  - 编辑器路径是文件；
  - 参数只作为数组传给 `spawn`，不经过 shell；拒绝换行/空字节。
- 启动：
  - `spawn(exe, ['-projectPath', projectPath, ...args], { cwd: projectPath, detached: true, stdio: 'ignore' })`；
  - `unref()`；不等待退出；
  - Windows 不弹控制台；
  - 失败给 `vpmUnityLaunchFailed` + 参数（不含敏感信息）。
- 已在运行：
  - 用现有三路状态判断；运行中不重复启动；
  - 返回 `alreadyRunning`（P8 可选"顶到前台"）。
- 不在启动时自动改工程/装包；启动是只读动作。

---

## 8. UI

### 8.1 项目列表

- VPM 启用时，Project 页主按钮"新建项目"（唯一实心）。
- 现有"添加已有/从 VCC 导入"在溢出菜单。
- 新建对话框（最多 2 步）：
  1. 模板卡片（空白/角色/世界/用户模板；收藏/最近）；
  2. 名称、位置（最近位置）、Unity 版本、高级（依赖版本/附件）；
     主按钮"创建并打开"，次按钮"仅创建"。
- 创建进度：骨架/附件/依赖/完成；可取消（提交前）；失败给原因/重试/打开文件夹。
- 新建成功后进入详情；工程出现在列表。

### 8.2 模板设置

- 设置 → 项目与包 → 模板：
  - 卡片：名称、描述、Unity 范围、依赖数、附件数、收藏；
  - 主按钮"新建模板"；行溢出：编辑/复制/隐藏/导出；
  - 导入按钮（自有 `.atriumtemplate`）；P7 才接外部格式。
- 编辑器：
  - 名称/描述/Unity 范围/推荐版本；
  - 依赖：从包目录选包 + 版本范围；显示解析后预计版本（只读）；
  - 附件：选 `.unitypackage`，显示大小/数量；
  - 保存前校验；错误码。
- 删除/隐藏：不永久删文件；说明。

### 8.3 工程详情

- "打开 Unity"启用（P2 时是禁用占位），主按钮 + 下拉：
  - 用默认参数打开；
  - 选择其他已发现的编辑器（不写版本文件，只影响本次启动）；
  - 打开自定义参数（存到 `vpm_project.unity_args_json`，启动前预览实际 argv）；
  - "打开工程文件夹"放溢出/次要位置。
- 显示匹配的编辑器/版本；可切换（P6 才支持改版本，这里只选启动用的编辑器）。
- 依赖未装完的工程：顶部 warning + "重试安装"。

### 8.4 按钮纪律

- 一个主按钮；模板卡片不堆操作；溢出菜单收纳。
- 三语文案；截图 100%/125%。

---

## 9. 测试

新增：

```text
tests/vpm/template-format.spec.ts
tests/vpm/template-builtins.spec.ts
tests/vpm/project-create.spec.ts
tests/vpm/unity-package.spec.ts
tests/vpm/unity-launch.spec.ts
tests/vpm/db-v4.spec.ts
tests/vpm/create-ui.spec.ts
```

覆盖：

1. 模板 JSON：正常/缺字段/坏版本/非法依赖/非法路径/超大/重复条目/zip-slip/符号链接。
2. 模板继承：base 合并/覆盖/附件追加/循环/深度上限/缺失 base。
3. 内置模板：ID/依赖/Unity 范围；不包含资产；三语显示名。
4. 工程创建：
   - 名称/路径校验（非法字符/保留名/已存在/无权限/长路径）；
   - 骨架文件正确；无 `.meta` 生成；
   - 附件解包成功/冲突/缺 meta/路径逃逸；
   - 初始 manifest 形状；
   - 最终 rename 原子；失败清理到回滚区；
   - 依赖安装成功/失败状态。
5. unitypackage：自造 tar.gz；pathname 变体；缺 meta；GUID 冲突；preview 忽略；zip 炸弹。
6. 启动：
   - 参数数组、无 shell 注入、detached；
   - 默认参数/自定义参数/选择其他编辑器三种入口；
   - 找不到编辑器/已运行/路径无效；
   - 版本匹配（f/p/c）。
7. DB v3→v4 迁移。
8. 真 Unity 2022.3.22f1：
   - 空白工程能打开；
   - 角色/世界模板装官方包后能打开（若网络可用）；
   - 附件资源出现在 Assets，Unity 不报 GUID 错；
   - 工程设置是 Unity 默认（记录与 ALCOM 模板的差异）。
9. 只写测试：扫描新增代码，确保没有写 `.meta` 的路径（静态断言 + 真机）。

---

## 10. 手工验收（沙盒）

- 用沙盒数据根/工程目录。
- 新建空白工程 → 打开 Unity → 正常。
- 新建角色工程（网络可用时）→ 装 SDK → 打开；检查包目录/manifest。
- 新建带附件模板 → 检查 Assets/`.meta`/GUID。
- 路径/名称错误、已存在、无权限。
- 启动 Unity 失败（选一个假路径）、已在运行。
- 模板收藏/最近/导入/导出/隐藏。
- 截图。

---

## 11. 完成定义

- [ ] `.atriumtemplate` 格式/校验/导入导出可用。
- [ ] 三个原创内置模板可用；不复制任何 ALCOM 资产。
- [ ] 新建工程可用；不手写 `.meta`；失败可恢复。
- [ ] unitypackage 附件可用；真 Unity 无 GUID 错误。
- [ ] 启动 Unity 可用；参数安全。
- [ ] 模板/创建 UI 轻量；三语；截图。
- [ ] 全量测试/类型/构建通过；净室检查表；PR 合并；安装版更新。
