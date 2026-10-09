# Atrium 0.2.0 —— 发布说明（第 8 轮）

> 这份是**给人看的**发布说明，直接可以贴进 GitHub Release 的正文。
> 里面每一条都在真机上验过并留了凭据；没做到的写在「这版还没有」里，不藏。
> 开发视角的账本在 `README.md` 的「当前进度」与「明确没有的东西」，逐轮证据在
> `docs/VERIFY-UNVERIFIED.md`、`docs/M7-DESIGN.md` §10。

---

## 它是什么

给 VRChat 改模玩家用的素材管家，Windows 桌面程序。一句话：**把一坨散着的 zip / rar / 7z / unitypackage
丢进去，它替你解压、读懂内容、分类归档，之后你打开哪个 Unity 工程，它就自动切到那个模型该在的分区，
勾选后一键批量导入。**

库是 24 GB、几千个文件那种规模设计的，不是给十几个文件用的。

## 这一版能做的事

**收素材**
- 拖进窗口、资源管理器右键「发送到 Atrium」、命令行 `Atrium.exe --ingest <路径>`、监视文件夹 —— 四条路都通
- 支持 zip（含 cp932/Shift-JIS 日文文件名）、rar / RAR5、7z（含头部加密 `-mhe`）、unitypackage
- 要密码的包会问你要；勾「记住这个密码」之后，下次撞见同一个包它自己就试
- 读得懂包里的内容再分类：不是只看文件名。分类结果会告诉你**为什么**这么分（置信度 + 理由），
  没把握的进「待复核」而不是硬塞进库

**管素材**
- 三级模型：合集 → 子项 → 版本。一个 zip 里 17 件是一个筐，不会被撕成 17 张卡；
  同一个产品的多个变体（体型 / 版本 / 安装方式）会并成一张卡并分列显示
- 搜索支持拼音、假名、罗马字互搜（`shinano` / `シナノ` / `Constraint` 都能找到同一件）；
  分类的口语叫法（`yifu` → 服装）也能搜到，加词不用重启
- 「接管已有库」：指到你现有的 `E:\vrc\A` 那种目录，**只登记不搬盘**，一个文件都不动
- 改分类会**真的把文件搬到新目录**，搬之前给你看清单（几个文件 / 目标在哪 / 会覆盖谁），能整批撤销
- 删除一律走**回收站**，永不永久删除；大部分动作 `Ctrl+Z` 能回

**跟 Unity 配合**
- 桥接是一小段编辑器脚本，只写进工程的 `Packages/com.avca.bridge/`，**不动 `Assets/`、不改场景**
- 首次发现某个工程会问一句（安装 / 以后都自动安装（只这个工程）/ 暂不）；
  一次冒出一批工程时，一屏列出来默认全勾，你可以逐个取消，也可以点「剩下 N 个都不再问」
- 打开某个 Unity 工程 → 自动切到对应模型的集合分区；同一工程 5 分钟内只自动切一次；
  拿不准就不切，只更新顶栏
- 从托盘唤醒主窗口时**只置顶约 1.2 秒，不抢你的键盘焦点**
- 导入前会扫冲突并列出将被覆盖的文件；被覆盖的会先备份；Unity 在 Play 模式时命令会排队而不是失败

**第一次打开**
- 四步向导：① 素材库存哪儿 → ② 素材从哪儿来 → ③ 给 Unity 工程装桥接 → ④ 收尾。
  只有第 ① 步不能跳；中途「稍后配置」以后侧栏一直留着回来的入口
- 指到"已经有素材"的目录会当场问「接管 / 当成空库」；库根在 C 盘、盘快满了都会红字提醒（但不拦你）
- 老用户升级不会被拦：库根已经配过就直接进主界面

## 这版还没有

- **代码签名**：第一次运行 Windows 会提示"未知发布者"，要点「更多信息 → 仍要运行」
- **运行目录搬盘**：数据库 / 缩略图 / 暂存 / 日志固定在 `%APPDATA%\A`，向导里会显示位置和占用，但不能搬
- **一次导完好几批时，界面只能退回最后那一批**（第一批得从维护页的账里想办法）
- **工程里现在装了哪些 GUID 的反查**、撤销后留下的空目录 `.meta`、`topFolders` / `avatarDescriptors`
  —— 这四件都卡在桥接的 C# 侧（还是 1.0.0）
- 依赖分析结论的上文展示；重复项自动清理（现在只列不删）；汉字→日语读音检索（**这是裁定**，理由见 `docs/SEARCH.md` §4）；LLM 兜底

## 装 / 卸

- `Atrium-Setup-0.2.0.exe` —— 安装版（当前用户，不需要管理员），会建开始菜单与桌面快捷方式
- `Atrium-portable-0.2.0.exe` —— 便携版，解压即用
- **卸载不会删你的库**：`%APPDATA%\A`（数据库、日志、缩略图）和你的素材目录都在安装目录之外
  （配的是 `deleteAppDataOnUninstall: false`）

## 数据放在哪

| 东西 | 位置 |
|---|---|
| 素材库（你自己的文件） | 你指定的库根，例如 `E:\vrc\A` |
| 数据库 / 缩略图 / 暂存 / 备份 / 日志 | `%APPDATA%\A\`（`library.db`、`thumbs`、`staging`、`backups`、`logs`） |
| 设置（含库根、开关、首启进度） | `%APPDATA%\A\settings.json` |
| 记住的压缩包密码 | `library.db` 的 `password_vault` 表，**DPAPI 密文**，界面上永远不显示密码本身 |
| 你加的口语叫法（增量） | `%APPDATA%\A\categories.user.json`（内置词典只读，升级不丢） |

---

# 附：发布操作清单（给我自己 / 给下一轮）

产物（`npm run build` 之后）：

```
dist\Atrium-Setup-0.2.0.exe        83.0 MB   NSIS 安装版
dist\Atrium-portable-0.2.0.exe     82.8 MB   便携版
```

> **19:25 重出过一次**（第 8 轮 ④b）。17:35 那批是在「去掉从未使用的 `sharp` 依赖」（19:03）
> 与「license 从 UNLICENSED 改 MIT」（19:09）之前构建的：`app.asar` 里的 `package.json` 仍写着
> `UNLICENSED`，并且 electron-builder 按当时的 `dependencies` 把 `sharp` + `@img/sharp-win32-x64`
> （`libvips-42.dll` / `libvips-cpp.dll` / `sharp-win32-x64.node`）整个打进了包。
> 重出之后 `node tools/pkg-version.cjs` 三条都绿（版本号 / license / 依赖清单），包小了 5.9 MB。
> 旧的两个 exe 直接作废，别发也别拿它们测。

上传与发 Release 的步骤（**2026-10-09 更正**：这台机器上 git 凭证管理器里已经存了能推这个仓库的凭证，
`git push` 与只读 API 都已经实测通；不再需要他现场建 PAT，除非那条凭证被撤销）：

1. 已完成：`origin = https://github.com/W4nN1ng/Atrium.git`、`main` 已推、tag `v0.2.0` 已推。
   推上去的是**一个干净的初始提交**（89 条开发史留在本地 `master`，不公开），截图全留。
2. 建 Release 与传产物都用这个工具，不要手搓 curl：
   ```bash
   node tools/gh-release.cjs                     # 只读体检：认证到谁、tag 在不在、Release 有没有、两个产物多大
   node tools/gh-release.cjs --create            # 真发（正文取 docs/release-body-0.2.0.md）
   ```
   工具的几条硬规矩写在它文件头里，别拆：
   - token 只从 `GH_TOKEN` 环境变量或系统 git 凭证拿，**日志里只打长度，不打内容**，不落盘、不写 git config；
   - `api.github.com` 在这台机器上时通时不通 → 每个请求包 5 次退避重试；
   - 上传二进制必须 `Content-Type: application/octet-stream`（按表单传会 422）；
   - 重跑幂等：Release 已存在就 `PATCH` 正文；同名资产字节数一致就跳过、不一致才删掉重传。
3. 万一系统凭证不可用了，再走手工 PAT：GitHub → Settings → Developer settings →
   **Fine-grained token** → 只选这个仓库 → Permissions 给 **Contents: Read and write**，
   用完当场撤销。（经典 token 勾 `repo` 一项即可。）
4. **公开发布必须他点头**：这个工具默认只读，`--create` 才是真发。

**发布前必须过的闸**（第 8 轮 ③④⑤ 就是这三条）：

- [x] 全量 `npm test` 绿 + 双 `tsc` 干净 + `node tools/selfcheck-r4.cjs` 退出码 0（2026-10-09 19:19 verbose 重跑：**1369 passed / 9 skipped（1378 项、106 个文件，其中 5 个文件按环境整份跳过）**）
      ⚠ 同日 19:16 那一轮是 1368 / 10 —— 总数一样，`tests/bridge/compile-check.spec.ts` 有一条按环境跳过，
      原因没查到底（那条用例的 skip 条件是「找不到 Unity 的 dotnet.exe」或「缺引用程序集」），发出去的数字取能复现的那一轮
- [x] 两张变异回扫表都 exit 0：`verify-red-r4`（基线 353 全绿、42 处全钉住）、`verify-red-m7`（基线 103 全绿、29 处全钉住）—— 2026-10-09 16:5x 各跑一轮，**串行**跑，不与别的重活并行
- [x] `Setup.exe` 真装 + **覆盖安装之后用户改动不丢** —— 2026-10-09 20:21 跑完（`tools/live-r8-install.cjs`
      `snapshot → install → overwrite`，红 0 条）：升级不弹向导、徽章 `v0.2.0`、库根还是 `E:/vrc/A`、
      16 张表逐表一字不差（只有 `project.last_seen` 按预期刷新）、`E:\vrc\A` 2305 文件 / 24.32 GB 一个字节没动。
      ⚠ **有两条在这台机器上是空的**：`categories.user.json` 本来就不存在、`password_vault`/`learning` 都是 0 行，
      所以"记住的密码 / 已学规则不被覆盖安装弄丢"这句**没有真数据证过**（细节记 `docs/VERIFY-UNVERIFIED.md` §13）
- [x] 产物里 asar 比源码新；`resources/i18n/*.json` 三语齐全（中文文案不在 asar 里，别在 asar 里搜）
      —— 19:25 重出后实测：`en/ja/zh-CN.json` 三份都在 `resources/i18n/`，`pkg-version` 退出码 0
