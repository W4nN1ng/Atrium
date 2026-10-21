# VPM-P7 执行提示词：仓库治理、本地包、VCC 导入与深链

> 前置：P1–P6 已合并；仓库/工程/装包/备份可用。
> 必读：`AGENTS.md`、`docs/VPM-MERGE-PLAN.md`、`docs/VPM-CLEANROOM.md`、
> `docs/VPM-PARITY.md`、`docs/VPM-IMPLEMENTATION-GUIDE.md` §1、§10、§11。
>
> 本阶段把"生态入口"补齐：仓库排序/请求头、本地用户包、VCC 只读导入、
> `atrium://` 深链与单实例。**绝不写 VCC 数据，不抢占 `vcc://`。**

---

## 1. 开始前

```bash
git fetch origin
git switch -c codex/vpm-p7-ecosystem origin/main
```

确认 P6 的备份/迁移测试仍绿；记录基线。

---

## 2. 目标

1. 仓库：编辑、启用/停用、排序、请求头、测试连接、导入/导出列表。
2. 本地用户包：添加目录、扫描 `package.json`、作为 local 源参与目录/装包。
3. VCC 只读导入：项目、仓库、用户包目录、Unity 提示、预发布设置；
   预览 + 选择 + 去重；不写 VCC。
4. 深链：`atrium://vpm/addRepo`；`vcc://` 仅在用户显式接管时处理；
   添加前必须确认。
5. 单实例：第二个实例把 argv 交给第一个；工程/设置窗口聚焦。
6. 外部模板（`.alcomtemplate`/VCC）只做文件导入适配，不注册全局关联。

---

## 3. 明确不做

- 不写 VCC 的 `settings.json`/`vcc.liteDb`。
- 不默认抢 `vcc://`，不默认关联 `.alcomtemplate`。
- 不做 VCC LiteDB 写入；只读解析如果做，必须可选/可失败。
- 不新增核心 `library.db` schema。
- 不做 macOS/Linux 协议注册。

---

## 3.5 本阶段实现解剖（ALCOM → Atrium）

**ALCOM 的关键机制（行为观察）**

- 用户仓库来自 VCC `settings.json` 的 `userRepos`（URL/本地路径/名称/ID/headers）；
  ALCOM 还会把扩展字段（`vrc-get` 子对象）写回 VCC 设置，并共享 `Templates/`。
- VCC 的 `vcc.liteDb` 存 projects/unityVersions；ALCOM 直接读写，并用
  **基于路径 hash 的全局命名 mutex** 防并发写。
- 本地用户包是目录里的 `package.json`，与远程仓库合并到同一个包集合。
- 深链/单实例是桌面壳的职责：第二次启动把 URI/参数交给已运行实例；
  模板导入是文件级操作，不靠覆盖别人的关联。

**Atrium 的独立实现**

- 仓库治理只动自己的 `vpm.db`：每仓库加密 `headers_enc`，包级头单独加密列，
  刷新时合并（包级覆盖同名仓库级），值绝不写日志、绝不进 `source_url`。
  导入/导出只导出 URL/名称/启用状态，**不导出 token**。
- 本地用户包：扫描用户选择的包目录，读 `package.json`，归一到同一目录模型；
  只读，不修改用户包；安装时走 P4 的 `PreparedPackage` 本地分支（递归复制）。
- VCC 互操作：只读 `settings.json` 的项目/仓库/包目录/Unity 提示/预发布；
  **绝不写 VCC settings/LiteDB**，不使用 ALCOM 的扩展字段；LiteDB 读取列为可选/部分，
  失败只降级，不影响手动导入。
- 导入流程是"预览 → 勾选 → 去重 → headers 加密 → 写 `vpm_import_log`"，
  绝不静默全量；token 不落日志/不显示明文。
- 深链：注册 `atrium://` 自己的协议，默认不抢 `vcc://`；只接受仓库 URL/名称、
  工程路径等**非敏感**参数，不接受 headers/token；单实例用 Electron 的
  requestSingleInstanceLock，第二实例把参数交给主实例后退出。
- 外部模板只做文件导入（P5 格式适配），不默认关联 `.alcomtemplate`。

**施工顺序**

1. 仓库治理：加密头/本地包/导入导出（复用 P1 刷新）。
2. VCC `settings.json` 只读解析 + 预览/去重/导入日志。
3. 本地包目录扫描/安装分支。
4. `atrium://` 注册 + 单实例 + 参数校验。
5. 外部模板导入；LiteDB 只读（可选）最后。

**最容易做错**

- 写 VCC LiteDB/settings → 破坏官方客户端；任何"顺手同步"都不行。
- headers 明文进日志/导出/深链 → token 泄漏；只允许加密列。
- 静默全量导入 → 用户不知道改了哪些项目/仓库。
- 默认抢 `vcc://` 或 `.alcomtemplate` → 其他工具失效，且卸载不干净。
- 深链接受任意参数 → 远程触发安装/写入；必须白名单 + 用户确认。

**详细内容**：`docs/VPM-IMPLEMENTATION-GUIDE.md` §1、§10、§11。

---

## 4. 仓库治理

在 P1/P2 的 repo 服务上扩展：

### 4.1 编辑

- URL 变更：
  - 归一/HTTPS 校验；
  - 若已有同 URL 仓库 → 拒绝重复；
  - 保留 id，重新抓取；旧包行先保留，成功后事务替换；
  - 失败 → 旧数据保留，错误可见。
- 名称编辑：本地显示名；JSON 的 name 仍可作为默认。
- 启用/停用：停用后不参与解析/刷新；已安装包仍显示来源。
- 移除：二次确认；只删索引；缓存按配额回收；工程不动。

### 4.2 排序

- `sort_order` 决定同名包/同版本的优先来源（解析阶段用）。
- UI：拖拽 + 键盘上下；触屏/无鼠标可用按钮。
- 保存顺序；失败回滚 UI。

### 4.3 请求头

- 每仓库可选 headers（name/value）。
- 存储：
  - 用 Electron `safeStorage` 加密 JSON 后存 `vpm_repo.headers_enc`；
  - `safeStorage.isEncryptionAvailable()` false → 拒绝保存头（仓库仍可用）。
  - **列表/详情只返回 "hasHeaders/count"，不返回明文。**
- 使用：只在请求该仓库时解密；不写日志；不放进错误详情。
- 测试连接：
  - 发一个 HEAD/GET（按仓库支持）或抓取 JSON；
  - 只显示状态/host/耗时；不显示头/正文。
- 头值里可能有换行/非法字符 → 拒绝，防 header injection。

### 4.3b 包级请求头

- 仓库 JSON 的版本对象可能自带 `headers`（用于该包的下载）。
- P1 为了不落明文，已把它从 `manifest_json` 剥离；P7 补上：
  - v6 迁移给 `vpm_repo_package` 加 `headers_enc BLOB`（只增列）；
  - 迁移后提示/自动刷新一次仓库，才能把之前剥离的包级头补回来（失败不阻塞）；
  - 刷新仓库时，如果包级头存在：加密后写入；`manifest_json` 仍不含明文；
  - 下载时合并：仓库头 → 包级头（同名覆盖）；
  - 加密不可用 → 不保存包级头；下载失败给 `vpmPackageHeadersUnavailable`，
    不把请求发出去；
  - 列表/诊断不显示头；
  - 测试：合并顺序/覆盖/脱敏/加密不可用/迁移。

### 4.4 导入/导出仓库列表

- 导出纯文本：每行一个 URL（可选名称注释）；默认**不导出请求头**；
- 导入：逐行校验 HTTPS/去重；预览成功/失败；不自动刷新全部；
- 不导出 VCC LiteDB。

---

## 5. 本地用户包

新建 `src/main/vpm/localPackages.ts`。

- 用户选择文件夹（可多个）；每个文件夹作为 local 源：
  - 直接子目录里找 `package.json`（不要无限递归；可配置深度 ≤2）；
  - 解析 name/version/unity/vpmDependencies/legacy；
  - 包名/版本校验；重复包名 → 提示；
  - 不跟随 symlink/junction；路径必须在所选根内；
  - 不复制/不修改用户包文件。
- 目录/安装：
  - 目录里显示 local 来源；
  - 安装时：走 P4 的 `PreparedPackage.local`，复制到 `tx/install` 后再进
    `Packages/<id>`；不要另写一套绕过事务的复制；
  - 本地包没有 zip/hash：计算目录内容指纹（文件相对路径+大小+内容 hash）作为完整性校验；
    在计划/操作里显示 "local"；
  - 不要求远端 hash；但仍然做路径/大小/符号链接校验。
- 用户包目录移除：只移除引用，不删文件。
- 监视变更：可手动"重新扫描"；不做后台文件监视（保持轻量）。
- 安全：本地包可能含 Unity 编辑器脚本；首次添加提示信任。

`vpm.db` v6（按需）：

```sql
ALTER TABLE vpm_repo_package ADD COLUMN headers_enc BLOB;

CREATE TABLE IF NOT EXISTS vpm_import_log (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- vcc-settings/local
  source_path TEXT,
  summary_json TEXT,
  created_at INTEGER NOT NULL
);
```

本地源复用 `vpm_repo.kind='local'`，不另起一套包表。

---

## 6. VCC 只读导入

新建 `src/main/vpm/vccImport.ts`。

### 6.1 位置与字段

- 位置：`%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json`
  （用现有路径解析/环境变量，不要写死用户名）。
- 只读解析（防御式）：
  - `userProjects`: string[]
  - `userRepos`: [{ localPath?, name?, url?, id?, headers? }]
  - `userPackageFolders`: string[]
  - `unityEditors`: string[]；`preferredUnityEditors`: object
  - `defaultProjectPath`, `project_backup_path`
  - `showPrereleasePackages`
  - 未知字段忽略。
- 文件不存在/坏 JSON → 给 code，不崩。
- **绝不写回**；导入后 Atrium 用独立设置/DB。

### 6.2 导入流程

1. 读取 → 预览：
   - 项目：路径、存在/无效、是否已在列表；
   - 仓库：host、名称、是否重复；请求头只显示"有/无"；
   - 用户包目录：路径、存在/重复；
   - Unity 提示：路径/版本、是否可用；
   - 预发布设置：是否导入。
2. 用户勾选要导入的项；主按钮"导入所选"。
3. 执行：
   - 项目：校验后 `upsertProject` + 扫描；不复制文件；
   - 仓库：去重后添加；headers 立即加密存储；
   - 用户包目录：加入 local 源并扫描；
   - Unity：作为手动提示加入，验证后标记；
   - 预发布：只改 VPM 设置，不改 VCC；
   - 写 `vpm_import_log`（不含头）。
4. 结果：成功/跳过/失败数量；可重试。
5. 不做"静默全量导入"；每次用户确认。

### 6.3 外部模板导入（只读适配）

- 入口：文件选择/拖入 `.alcomtemplate` 或 VCC 模板文件/文件夹；**不注册全局关联**。
- 解析：
  - 先识别容器（zip/json/文件夹），再读模板元数据（名称、描述、Unity 范围、
    VPM 依赖、unitypackage 附件、继承关系）；
  - 未知字段忽略并保留原始文件；格式不支持 → `vpmTemplateUnsupported`，
    不猜、不执行；
  - 路径/大小/zip-slip/符号链接校验与自有模板一致。
- 转换：
  - 映射成 `.atriumtemplate`（P5 格式），`base` 尽可能映射到内置/已有模板；
  - 附件复制到 Atrium 模板存储（用户自己的数据）；不把附件写进安装包；
  - 不复制/不展示 ALCOM 的 logo/品牌；用户模板内容原样保留；
  - 导入后是"用户模板"，用户可编辑/导出/删除引用（不永久删原文件）。
- 安全：模板里的任何脚本/unitypackage 都只在用户创建工程时才会进入 Unity；
  导入本身不执行；导入前提示来源/附件数量/大小。
- 测试：自造 fixture；zip/json/文件夹；缺字段/坏路径/大文件/继承/循环；
  不复制 ALCOM 官方模板作为夹具。

### 6.4 LiteDB（可选、部分）

- 当前 VCC 仍以 `settings.json` 为项目真相；Atrium 先只读它。
- 如果后续 VCC 把项目/仓库只放 `vcc.liteDb`：
  - 只读解析，不写；
  - 必须先有稳定 fixture/格式验证；失败给 `vccLiteDbUnsupported`；
  - 不为了它阻塞 0.9.0；在已知限制里写"部分"。
- 不复制 ALCOM 的 LiteDB 读取代码；如实现，按 LiteDB 公开格式自己写。

---

## 7. 深链与单实例

### 7.1 `atrium://`

- 注册 `atrium://`（仅 Windows，安装器/运行时按现有 Electron 方式）。
- 支持：

  ```text
  atrium://vpm/addRepo?url=https%3A%2F%2F...&name=...
  ```

- 规则：
  - 只接受 HTTPS URL + 名称；长度/参数上限；
  - **不从深链接收 headers/token**（防止钓鱼链接塞凭据）；需要时用户手动加头；
  - 添加前弹确认：host、名称；
  - 不自动刷新/不自动安装；
  - 拒绝 `file:`/`javascript:`/userinfo；
  - 日志脱敏（query 里的 token 打码）。

### 7.2 `vcc://`（显式接管）

- 默认**不注册** `vcc://`，避免抢 VCC。
- 设置里提供"临时接管 vcc:// 链接"开关：
  - 说明会影响其他 VCC 兼容工具；
  - 打开时才 `setAsDefaultProtocolClient('vcc')`；关闭时解除；
  - **先验证当前 Electron/Windows 能否可靠解除注册**；如果不能，就不提供这个开关，
    只支持把 `vcc://` 链接粘贴到 Atrium 里解析（更安全）。
  - 只处理 `vcc://vpm/addRepo` 这一种；其余提示不支持；
  - 添加前同样确认；不自动执行。
- 不做 `.alcomtemplate` 全局关联；只在文件选择/拖入时导入。

### 7.3 单实例

- `app.requestSingleInstanceLock()`：
  - 第二个实例退出，把 argv 交给第一个；
  - 第一个实例解析深链/文件路径，聚焦窗口；
  - 如果 VPM 停用/安全模式：忽略 VPM 深链，给通知，不崩。
- 测试：手动起两个实例；开发/打包各一次。

---

## 8. UI

- 设置 → 项目与包：
  - 仓库：列表 + 编辑/启用/排序/请求头/测试连接/导入导出；
    行内保留勾选启用、移除、拖拽把手这三个高频动作；
  - 本地包：目录列表 + 添加/重新扫描/移除引用；
  - 数据：导入 VCC（预览对话框）；
  - 高级：接管 `vcc://`（默认关）、深链说明、诊断。
- 仓库编辑对话框：
  - URL/名称/头（密码输入，保存后不再显示）；
  - 测试连接；保存/取消。
- 导入 VCC 对话框：
  - 分组勾选；每项状态；主按钮"导入所选"；
  - 不显示请求头明文。
- 按钮纪律：一个主按钮；排序用拖拽+键盘；危险动作二次确认。
- 三语文案；截图。

---

## 9. 测试

新增：

```text
tests/vpm/repo-edit.spec.ts
tests/vpm/repo-order.spec.ts
tests/vpm/repo-headers.spec.ts
tests/vpm/repo-import-export.spec.ts
tests/vpm/local-packages.spec.ts
tests/vpm/vcc-import.spec.ts
tests/vpm/deep-link.spec.ts
tests/vpm/single-instance.spec.ts
tests/vpm/db-v6.spec.ts
```

覆盖：

1. 仓库编辑/URL 变更/重复/失败保留旧数据/启用停用/排序。
2. 请求头：仓库级/包级加密存储、合并顺序/覆盖、列表不返回明文、解密只在请求、
   日志脱敏、非法头拒绝、加密不可用。
3. 导入/导出：HTTPS 校验、去重、预览、失败隔离、默认不导头。
4. 本地包：扫描/深度/重复/symlink/路径逃逸/内容指纹/装包/移除引用。
5. VCC：正常/缺文件/坏 JSON/缺字段/重复/无效路径/headers 加密/不写 VCC（mtime/hash 断言）。
6. 外部模板：zip/json/文件夹、缺字段/坏路径/大文件/继承/循环/不执行脚本/不抢关联。
7. 深链：HTTPS/非法协议/参数/确认/停用态/日志脱敏。
8. 单实例：第二实例转发；VPM 停用时忽略。
9. DB v5→v6 迁移；核心 schema 不变。

手工：

- 用一份**复制的** VCC settings fixture（不要读用户真实文件做断言；如需真实只读，先备份/脱敏）。
- 导入预览/选择/去重/结果。
- 两个 Atrium 实例；深链。
- 仓库排序、请求头测试（可用假服务器）。
- 截图。

---

## 10. 完成定义

- [ ] 仓库治理/请求头/导入导出可用。
- [ ] 本地包可用，走 P4 事务。
- [ ] VCC 只读导入可用，绝不写 VCC。
- [ ] `atrium://` 深链 + 单实例；`vcc://` 默认不抢，显式接管。
- [ ] 外部模板（`.alcomtemplate`/VCC）只做文件导入适配，不抢关联。
- [ ] 安全/脱敏/确认齐全。
- [ ] 全量测试/类型/构建通过；净室检查表；PR 合并；安装版更新。
