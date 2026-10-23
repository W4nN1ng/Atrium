# ALCOM 1.1.8 → Atrium 功能对账表

> 参考：ALCOM 稳定版 **1.1.8**（2026-07-11）+ `vrc-get` master 观察（2026-10-19）。
> 范围：**Windows GUI** 的用户可完成能力；不是像素/按钮位置对等。
>
> 状态图例：
>
> - **完整**：目标就是把这个能力做齐，验收必须过。
> - **部分**：做核心，明确保留一个差异；差异必须写进 README/已知限制。
> - **不做**：不属于 Windows GUI 对等范围，或与产品底线冲突；写原因。
> - **额外**：Atrium 在 ALCOM 之外增加的能力，不拿来充数。
>
> **现在这张表是"目标"，不是"已完成"。** 每个阶段的 PR 要把证据填进最后一列；
> P8 逐行对账，P9 只修不减。
>
> 2026-10-21 v2：执行单位改为小任务卡。每张卡顶部列出它覆盖的对账项（如 `B19/B22`），
> P8-D 按任务卡反查证据；找不到任务卡的编号视为缺口，不能算完成。

---


> **P8-D 对账（2026-10-23）**：最后一列改为实际状态/证据/差异/去向。
> `GAP-01`…`GAP-11` 见 [`VPM-GAPS.md`](VPM-GAPS.md)；`部分` 不等于“已经完成”，
> 目标=完整但实际=部分的行在 P9 前必须补齐或由产品明确接受。

## A. 项目

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| A1 | 发现已有 Unity 工程 | 完整 | P2 | 扫描 + VCC `userProjects` + 手工添加；工程卡片出现 | 实际=完整；证据=tests/vpm/projects/service.spec.ts、P2-D 沙盒 DemoProject（vpm-p2d-projects.png）；差异=沿用核心工程发现，不另起一套；去向=接受 |
| A2 | 判断 Unity 是否在运行 | 完整 | P2 | 桥接/锁文件/WMI 三路；回归用例 | 实际=完整；证据=tests/project/connections.spec.ts、running-wiring.spec.ts、wmi-*；差异=沿用核心三路检测；去向=接受 |
| A3 | 添加已有工程 | 完整 | P2 | 选目录 → 校验 `ProjectVersion.txt` → 入列表；不复制文件 | 实际=完整；证据=tests/vpm/projects/service.spec.ts、P2-D add；差异=不复制文件；去向=接受 |
| A4 | 新建空白工程 | 完整 | P5 | 真 Unity 能打开；`Assets/Packages/ProjectSettings` + 版本文件 | 实际=部分；证据=tests/vpm/unity/create.spec.ts(18)；差异=代码完整，未用真 Unity 打开新建工程；去向=GAP-01/P5-D |
| A5 | 角色模板建工程 | 部分 | P5 | 空白骨架 + 官方 SDK 包依赖；装包后 Unity 打开无错 | 实际=部分；证据=tests/vpm/templates/service.spec.ts、P5-A 内置 avatars；差异=缺 VRChat 推荐工程设置/场景；去向=GAP-09/已知限制 |
| A6 | 世界模板建工程 | 部分 | P5 | 同 A5 | 实际=部分；证据=tests/vpm/templates/service.spec.ts、P5-A 内置 worlds；差异=缺 VRChat 推荐工程设置/场景；去向=GAP-09/已知限制 |
| A7 | 模板列表/收藏/最近使用 | 完整 | P5 | 设置页模板列表；收藏持久化；上次模板记忆 | 实际=完整；证据=tests/vpm/templates/service.spec.ts、P5-D 模板列表；差异=自有 UI；去向=接受 |
| A8 | 模板新增/编辑/复制/删除 | 完整 | P5 | 表单 + 校验 + 继承（base）+ 只删列表引用不删文件 | 实际=完整；证据=tests/vpm/templates/service.spec.ts(17)、tests/vpm/ipc/templates.spec.ts(5)、tests/renderer/vpm-templates.spec.ts(3)、截图 vpm-p8f-templates/editor；差异=附件只显示引用不编辑，符合本卡；去向=接受 |
| A9 | 导入 VCC/ALCOM 模板 | 部分 | P7 | 文件选择/拖入；解析失败有错误码 | 实际=部分；证据=tests/vpm/interop/vcc.spec.ts(模板导入)、P7-D；差异=只导入文件，不注册全局关联；去向=GAP-09/已知限制 |
| A10 | 导出模板 | 完整 | P7 | 导出 `.atriumtemplate`；可被 Atrium 再导入 | 实际=完整；证据=tests/vpm/interop/vcc.spec.ts(模板导出)、P7-D；差异=Atrium 自有格式；去向=接受 |
| A11 | 模板带 unitypackage 附件 | 完整 | P5 | 解包到 Assets，保留包内 `.meta`；真 Unity 验证 | 实际=部分；证据=tests/vpm/domain/unitypackage.spec.ts、tests/vpm/unity/unitypackage.spec.ts；差异=字节级 .meta 保真；未在真 Unity 看导入结果；去向=GAP-01/P5-D |
| A12 | 启动 Unity | 完整 | P5 | 按工程版本匹配编辑器；detached 启动；错误可见 | 实际=部分；证据=tests/vpm/unity/launch.spec.ts(10)、P5-D；差异=代码/参数/绑定完整；未真启动 Unity；去向=GAP-01/P5-D |
| A13 | 已在运行时把窗口顶到前台 | 部分 | P8 | 可选；Windows 上按 PID/窗口查找 | 实际=部分；证据=src/main/vpm/unity/launch.ts 返回 alreadyRunning；P8-E 判定为可选未做；差异=已运行不重复启动，但不把窗口顶到前台；去向=接受差异 |
| A14 | 打开工程文件夹 | 完整 | P2 | `shell.openPath`，路径校验 | 实际=完整；证据=tests/vpm/ipc/vpm-ipc.spec.ts、P2-D 打开文件夹；差异=路径校验；去向=接受 |
| A15 | 复制工程 | 完整 | P6 | 排除重型目录；进度/取消；目标非空拒绝 | 实际=完整；证据=tests/vpm/backup/copy.spec.ts(9)、P6-C；差异=排除 Library；未跑 GB 级工程；去向=接受 |
| A16 | 备份工程 | 完整 | P6 | ZIP + 进度/取消 + 记录；可解压校验 | 实际=完整；证据=tests/vpm/backup/service.spec.ts(10)、P6-B；差异=yauzl 读回校验；未用 7-Zip 目视；去向=接受 |
| A17 | 从备份新建工程 | 额外 | P6 | 解压到新目录；绝不覆盖；可选补装包 | 实际=部分；证据=tests/vpm/backup/service.spec.ts、P6-B；差异=额外能力；未真机恢复后打开 Unity；去向=GAP-01 |
| A18 | 从列表移除（不删盘） | 部分 | P2 | 只移除记录；文件仍在；二次确认 | 实际=部分；证据=src/renderer/vpm/components/projects/VpmProjectsSection.tsx:406；P8 R17；差异=只有删除进回收站，没有“只移除台账”入口；去向=接受差异（R17 用户裁定） |
| A19 | 更换 Unity 版本 | 完整 | P6 | 关闭 Unity；备份/确认；写版本文件；可回退 | 实际=部分；证据=tests/vpm/backup/copy.spec.ts(版本)、P6-C；差异=写版本文件/回退有测试；未真 Unity 验证打开；去向=GAP-01 |
| A20 | 项目排序/搜索/网格 | 部分 | P8 | 搜索、按名称/最近使用；列表为主 | 实际=部分；证据=P8-A 审计、项目页截图；差异=有搜索/列表；不做网格视图；去向=GAP-09/已知限制 |
| A21 | 最近工程位置 | 完整 | P5 | 建工程对话框记忆最近 8 个位置 | 实际=完整；证据=tests/vpm/unity/create.spec.ts、RecentLocationStore；差异=最近 8 个位置；去向=接受 |
| A22 | 工程名/路径校验 | 完整 | P5 | 非法字符/已存在/无权限/长路径 | 实际=完整；证据=tests/vpm/unity/create.spec.ts；差异=Windows 名称/路径/<260/空间；去向=接受 |
| A23 | 从 VCC 导入工程 | 完整 | P2/P7 | 只读 settings.json；去重；不写 VCC | 实际=部分；证据=tests/vpm/projects/service.spec.ts(VCC 注入)、P2-C；差异=真实 VCC userProjects 未跑；去向=GAP-07 |

---

## B. 包

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| B1 | 浏览仓库包目录 | 完整 | P1 | 包列表、来源、版本数；离线可看缓存 | 实际=完整；证据=tests/vpm/repos/repos-service.spec.ts、P1-E 真实 official/curated 刷新；差异=不复制目录 UI；去向=接受 |
| B2 | 搜索/筛选 | 完整 | P1/P4 | 包名/显示名/关键词/别名；工程页"筛选软件包"（全部/已安装/可更新/有冲突） | 实际=完整；证据=tests/vpm/catalog/catalog.spec.ts、P4-E 包面板筛选；差异=不做拼音搜索；去向=接受 |
| B3 | 包详情/版本/changelog/docs | 完整 | P1 | 侧栏详情；外部链接需确认 | 实际=完整；证据=P1-E 详情截图 vpm-p1e-package-detail.png、外链确认；差异=链接只允许 http(s)；去向=接受 |
| B4 | 安装包 | 完整 | P4 | 真 Unity 沙盒：包目录 + manifest 正确 | 实际=部分；证据=tests/vpm/install/transaction.spec.ts(29)、failure-injection(29)、P4-E UI；差异=代码/失败注入完整；缺真 Unity 装包；去向=GAP-01/P4-E |
| B5 | 升级包 | 完整 | P4 | 锁定/范围/依赖升级；计划显示 | 实际=部分；证据=tests/vpm/install/transaction.spec.ts、P4-E UI；差异=缺真 Unity 升级；去向=GAP-01/P4-E |
| B6 | 降级包 | 完整 | P4 | 每行已安装版本下拉/抽屉版本选择；警告；事务 | 实际=部分；证据=tests/vpm/install/transaction.spec.ts、P4-E UI；差异=缺真 Unity 降级；去向=GAP-01/P4-E |
| B7 | 重装包 | 完整 | P4 | 强制重新下载/解压；hash 校验 | 实际=部分；证据=tests/vpm/install/transaction.spec.ts、P4-E UI；差异=重装/强制重下有测试；缺真 Unity；去向=GAP-01/P4-E |
| B8 | 卸载包 | 完整 | P4 | 依赖者处理；旧文件入回滚仓 | 实际=部分；证据=tests/vpm/install/transaction.spec.ts、vault/store.spec.ts、P4-E UI；差异=卸载/旧包进 vault 有测试；缺真 Unity；去向=GAP-01/P4-E |
| B9 | 多选/批量变更 | 完整 | P4 | 选中后才出现变更条；一次计划/应用 | 实际=部分；证据=tests/vpm/renderer/cart.spec.ts(9)、P4-E UI；差异=多选/一次计划有测试；缺真 Unity；去向=GAP-01/P4-E |
| B10 | 依赖解析 | 完整 | P3 | 确定性贪心；锁定包；缺失/冲突报告 | 实际=完整；证据=tests/vpm/domain/resolver*.spec.ts、真实仓库 387 版本解析；差异=不回溯；去向=接受 |
| B11 | 冲突/缺失解释 | 完整 | P3 | 显示包、要求来源、可选版本 | 实际=完整；证据=resolver/plan 矩阵、P3-D 截图；差异=冲突来源/版本可解释；去向=接受 |
| B12 | 锁定包/固定版本 | 完整 | P3 | `locked` 读取/保持/升级规则 | 实际=部分；证据=resolver locked 用例、P3-B；差异=缺真实工程 locked 快照长期对比；去向=GAP-08/P9-C |
| B13 | 预发布开关 | 完整 | P1/P4 | 全局开关；稳定优先；范围需要时可选中 | 实际=完整；证据=tests/vpm/settings.spec.ts、catalog 测试、P8-C；差异=只过滤浏览；已装不受影响；去向=接受 |
| B14 | 隐藏包 | 完整 | P1/P8 | 仓库 `hidden` 默认隐藏；设置可显示 | 实际=完整；证据=tests/vpm/settings.spec.ts、catalog 测试、P8-C；差异=隐藏只影响浏览/详情；去向=接受 |
| B15 | yanked/弃用版本 | 完整 | P1/P3 | yanked 不参与选择；已装给警告 | 实际=完整；证据=resolver/catalog yanked 用例；差异=已装给警告；去向=接受 |
| B16 | Unity 版本兼容过滤 | 完整 | P1/P3 | 包的 `unity` 最低版本；不兼容不可选 | 实际=完整；证据=tests/vpm/domain/unity-version.spec.ts、resolver；差异=按包元数据；去向=接受 |
| B17 | 旧式包检测 | 完整 | P2 | 扫描 `Assets/` 的包/legacy 路径；只读报告 | 实际=完整；证据=tests/vpm/domain/project.spec.ts、P2-D DemoProject legacy；差异=只读报告；去向=接受 |
| B18 | 旧式包迁移 | 部分 | P6 | 引导式；备份/事务/回滚仓；真 Unity | 实际=部分；证据=tests/vpm/backup/migrate.spec.ts(5)、P6-D；差异=服务/拒绝矩阵完整；缺真 Unity 迁移；去向=GAP-01 |
| B19 | 安装事务/回滚 | 完整 | P4 | 每步失败注入；manifest 最后写；崩溃恢复 | 实际=完整；证据=tests/vpm/install/{transaction,failure-injection,recovery,concurrency}.spec.ts、P4-VERIFICATION §8；差异=manifest 最后写/崩溃恢复/回滚仓；去向=接受 |
| B20 | 离线/缓存安装 | 完整 | P4 | 断网 + 缓存齐全可装；hash 校验 | 实际=完整；证据=tests/vpm/cache/download.spec.ts(12)、P4-VERIFICATION §9；差异=离线缓存/hash；去向=接受 |
| B21 | SHA-256 校验 | 完整 | P4 | 不匹配拒绝；缓存损坏重下 | 实际=完整；证据=tests/vpm/cache/*、install/archive.spec.ts、P4-VERIFICATION §2-3；差异=无 hash 拒绝/损坏重下；去向=接受 |
| B22 | 受保护包 | 完整 | P3/P4 | `com.avca.bridge` 不可装/升/卸/覆盖 | 实际=完整；证据=resolver protected、transaction/legacy 保护测试；差异=com.avca.bridge 永不变更；去向=接受 |
| B23 | 撤销上一次装包 | 额外 | P4 | 仅最后一次且工程未变；从回滚仓恢复 | 实际=部分；证据=tests/vpm/domain/undo.spec.ts(4)、tests/vpm/ipc/install.spec.ts(9)、P4-E；差异=反向计划/安全检查有测试；缺真 Unity；去向=GAP-01 |
| B24 | 包图标 | 部分 | P8 | 可选缓存；失败用首字母 | 实际=部分；证据=P8-A 审计 §5、首字母回退；差异=无远程图标管线；去向=GAP-09/已知限制 |
| B25 | 包内脚本风险提示 | 完整 | P4 | 首次装包/添加仓库时提示"Unity 会执行编辑器脚本" | 实际=完整；证据=VpmApplyPlanSheet 风险勾选、i18n vpm.packages.apply.risk；差异=首次应用提示编辑器脚本；去向=接受 |
| B26 | Unity 运行时装包 | 部分 | P4 | **拒绝**，提示关闭 Unity | 实际=部分；证据=launch/transaction 预检 Unity running、P4-E UI；差异=刻意拒绝；缺真机提示；去向=GAP-09/已知限制 |
| B27 | 一键升级全部（最新） | 完整 | P3/P4 | 生成一个"全部升级到最新兼容"的计划；预览后应用；受保护/冲突/预发布规则同单包 | 实际=部分；证据=plan upgradeAll、P4-E 批量 UI；差异=缺真 Unity 批量装；去向=GAP-01/P4-E |
| B28 | 已安装包清单（版本/来源/锁定） | 完整 | P2/P4 | 工程详情只读列出；包页可操作；来源/锁定/更新标记可见 | 实际=完整；证据=P2-D 详情、P4-E 包面板、DTO 测试；差异=来源/锁定/更新标记；去向=接受 |
| B29 | manifest 字段保真与外部变更检测 | 完整 | P3/P4 | 保留未知字段/locked；提交前比较指纹；外部改动中止 | 实际=完整；证据=tests/vpm/domain/manifest.spec.ts、transaction 外部 hash 测试；差异=保留未知字段/locked；提交前指纹；去向=接受 |

---

## C. 仓库

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| C1 | 官方 + curated 默认仓库 | 完整 | P1 | 默认加入；不自动频繁刷新 | 实际=完整；证据=P1-D 种子、P1-E 真实 294/93 包；差异=不自动高频刷新；去向=接受 |
| C2 | 添加远程仓库 | 完整 | P1 | HTTPS 校验；抓取；失败保留条目 | 实际=完整；证据=tests/vpm/repos/*、HTTP/策略；差异=HTTPS/去重；去向=接受 |
| C3 | 编辑名称/URL | 完整 | P7 | URL 变更要重新抓取；旧缓存按 hash 保留 | 实际=完整；证据=tests/vpm/repos/governance.spec.ts(7)、P7-A UI；差异=URL 变更重抓；去向=接受 |
| C4 | 移除仓库 | 完整 | P7 | 二次确认；只删仓库索引，不删缓存/工程 | 实际=完整；证据=governance、P7-A UI；差异=只删索引；去向=接受 |
| C5 | 启用/停用 | 完整 | P7 | 停用后不参与解析/刷新 | 实际=完整；证据=governance、P7-A UI；差异=停用不参与解析/刷新；去向=接受 |
| C6 | 排序 | 完整 | P7 | 拖拽 + 键盘上下；顺序影响同名版本优先级 | 实际=完整；证据=governance、P7-A UI ↑/↓；差异=不做复杂优先级 UI；去向=接受 |
| C7 | 每仓库请求头 | 完整 | P7 | 加密存储；列表不回明文；测试连接 | 实际=完整；证据=tests/vpm/secrets/store.spec.ts(8)、docs/VERIFY-2026-10-22-VPM-UI.md 真 safeStorage；差异=列表只回头名；去向=接受 |
| C8 | 刷新/ETag/304 | 完整 | P1 | 条件请求；304 保留旧数据；失败不清空 | 实际=完整；证据=tests/vpm/repos/repos-service.spec.ts、http/client.spec.ts；差异=304 保留旧数据；去向=接受 |
| C9 | 断网/旧缓存 | 完整 | P1 | 显示上次成功时间 + 错误；可继续浏览/离线装 | 实际=完整；证据=P1-E network-off 截图、catalog 缓存；差异=显示上次成功/错误；去向=接受 |
| C10 | 每仓库错误隔离 | 完整 | P1 | 一个仓库坏不影响其他；错误码 | 实际=完整；证据=repos-service 错误隔离用例；差异=不弹 HTML；去向=接受 |
| C11 | 本地用户包目录 | 完整 | P7 | 扫描 `package.json`；作为 local 源；可安装 | 实际=部分；证据=tests/vpm/catalog/local*.spec.ts；P7-C；差异=本地包装入工程有测试；未真机装；去向=GAP-01 |
| C12 | 导入 VCC 仓库 | 完整 | P7 | 读 settings.json `userRepos`；去重；头加密 | 实际=部分；证据=tests/vpm/interop/vcc.spec.ts(7)、P7-D；差异=真实 VCC userRepos 未跑；去向=GAP-07 |
| C13 | 仓库列表导入/导出 | 完整 | P7 | 导出 `repositories.txt` 等价物；导入去重 | 实际=完整；证据=governance import/export 用例、P7-A UI；差异=自有格式/纯 URL；去向=接受 |
| C14 | 同名包/版本多源 | 完整 | P1/P3 | 显示来源；解析按仓库顺序；hash 冲突拒绝 | 实际=完整；证据=catalog/resolver 多源/hash 冲突用例；差异=按仓库序；去向=接受 |
| C15 | 私有仓库头安全 | 完整 | P7 | DPAPI；日志脱敏；错误不含头 | 实际=完整；证据=tests/vpm/secrets/store.spec.ts、真实 safeStorage；差异=DPAPI/脱敏；去向=接受 |

---

## D. Unity

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| D1 | 发现 Unity Hub 安装（Windows） | 完整 | P2 | 读 Hub 配置 + 版本/路径；fixture + 真机 | 实际=完整；证据=tests/vpm/unity/editors.spec.ts、P2-A 真实发现 E:/unity/2022.3.22f1；差异=不调用 Hub 无头；去向=接受 |
| D2 | 手动添加 Unity | 完整 | P2 | 选 `Unity.exe`；校验；版本识别/让用户确认 | 实际=完整；证据=editors.spec.ts、P2-A 手动添加；差异=missing 标记；去向=接受 |
| D3 | 版本识别 | 完整 | P2 | 优先 Hub 元数据；手动用路径/文件/用户确认 | 实际=完整；证据=editors/unity-version.spec.ts；差异=不启动 Unity 询问；去向=接受 |
| D4 | 每工程 Unity 覆盖 | 完整 | P2/P5 | 工程详情可选编辑器；按版本匹配 | 实际=完整；证据=P5-D 编辑器下拉、vpm_project unity_exe_path 测试；差异=存 vpm.db；去向=接受 |
| D5 | 启动参数 | 完整 | P5 | "打开 Unity"菜单：默认参数/选择编辑器/自定义参数；数组传参 | 实际=部分；证据=tests/vpm/unity/launch.spec.ts(10)、P5-D；差异=数组传参/许可参数有测试；未真启动；去向=GAP-01 |
| D6 | 更换版本 | 完整 | P6 | 见 A19 | 实际=部分；证据=tests/vpm/backup/copy.spec.ts(版本)、P6-C；差异=写版本文件/回退有测试；未真 Unity；去向=GAP-01 |
| D7 | macOS/Linux | 不做 | — | — | 实际=不做；证据=明确裁定；差异=首发 Windows；去向=接受 |
| D8 | 安装 Unity/模块 | 不做 | — | — | 实际=不做；证据=明确裁定；差异=ALCOM 也不安装 Unity；去向=接受 |
| D9 | noexec 挂载检查 | 不做 | — | — | 实际=不做；证据=明确裁定；差异=仅 Linux 有意义；去向=接受 |
| D10 | Unity 2019/2021/6000 等版本 | 部分 | P2/P5 | 版本发现不写死；仅在 2022.3.22f1 做真机验收 | 实际=部分；证据=editors/unity-version 测试、P2-A 真实 2022.3.22f1；差异=仅 2022.3.22f1 真机；其他版本未验；去向=GAP-08/P9-C |

---

## E. 备份与迁移

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| E1 | 工程 ZIP 备份 | 完整 | P6 | 可解压；内容与排除规则正确 | 实际=完整；证据=tests/vpm/backup/service.spec.ts(10)、collector(14)；差异=yauzl 读回；未用 7-Zip 目视；去向=接受 |
| E2 | 压缩级别 | 完整 | P6 | store/fast/normal；进度 | 实际=完整；证据=service.spec.ts store/normal 体积差异；差异=真三档；去向=接受 |
| E3 | 可选排除 VPM 包 | 完整 | P6 | 设置 + 每次确认；恢复时提示补装 | 实际=完整；证据=collector/service 排除用例；差异=未知/本地包保留；去向=接受 |
| E4 | 进度/取消 | 完整 | P6 | 可取消；取消后临时文件可清理 | 实际=完整；证据=service 取消用例、collector 取消；差异=不留半个 zip；去向=接受 |
| E5 | 打开备份位置 | 完整 | P6 | `shell.showItemInFolder` | 实际=部分；证据=backup service reveal 接线；P6-B 未真机点开；差异=未在 Electron 里点开；去向=GAP-06/P8-E |
| E6 | 备份记录 | 完整 | P6 | 列表、大小、时间、hash、项目 | 实际=完整；证据=backup list/get 测试、维护面板；差异=不自动删；去向=接受 |
| E7 | 从备份新建 | 额外 | P6 | 见 A17 | 实际=部分；证据=service restore 测试、P6-B；差异=额外能力；未真机恢复后打开；去向=GAP-01 |
| E8 | 旧式 VPM 迁移 | 部分 | P6 | 见 B18 | 实际=部分；证据=migrate.spec.ts(5)、P6-D；差异=只覆盖常见 legacy；缺真 Unity；去向=GAP-01 |
| E9 | Unity 版本升级 | 完整 | P6 | 见 A19 | 实际=部分；证据=copy/version 测试、P6-C；差异=大版本警告；未真 Unity；去向=GAP-01 |

---

## F. VCC 互操作

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| F1 | 读 VCC 项目列表 | 完整 | P2 | settings.json `userProjects`；已有能力 | 实际=部分；证据=tests/vpm/projects/service.spec.ts(VCC 注入)、P2-C；差异=真实 VCC 未跑；去向=GAP-07 |
| F2 | 读 VCC 仓库 | 完整 | P7 | `userRepos`；去重/加密头 | 实际=部分；证据=tests/vpm/interop/vcc.spec.ts、P7-D；差异=真实 VCC userRepos 未跑；去向=GAP-07 |
| F3 | 读 VCC 用户包目录 | 完整 | P7 | `userPackageFolders` | 实际=部分；证据=tests/vpm/interop/vcc.spec.ts、P7-D；差异=真实 VCC userPackageFolders 未跑；去向=GAP-07 |
| F4 | 读 VCC Unity 提示 | 完整 | P2/P7 | 编辑器路径/偏好；验证后使用 | 实际=部分；证据=P2-A 编辑器发现、interop vcc 测试；差异=真实 VCC Unity 偏好未跑；去向=GAP-07 |
| F5 | 读 VCC 模板（LiteDB） | 部分 | P7 | 仅当文件格式可稳定读取；失败给错误码 | 实际=部分；证据=P7-D 交接；LiteDB 未读；差异=仅 settings.json 只读；LiteDB 延后；去向=GAP-09/已知限制 |
| F6 | 写 VCC 数据 | 不做 | — | — | 实际=不做；证据=明确裁定；差异=不写 VCC 数据；去向=接受 |
| F7 | `vcc://` 深链 | 部分 | P7 | 解析 `vcc://vpm/addRepo` 的 URL/名称；**确认后才添加** | 实际=部分；证据=tests/vpm/interop/deeplink.spec.ts(7)、P7-E；差异=vcc:// 只解析/确认，不默认接管；去向=GAP-09/已知限制 |
| F8 | `.alcomtemplate` 文件关联 | 部分 | P7 | 文件选择/拖入导入 | 实际=部分；证据=P7-D 模板导入/文件选择；差异=不注册全局关联；去向=GAP-09/已知限制 |

---

## G. 设置、日志、更新

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| G1 | 语言/主题/紧凑模式 | 部分 | P8 | 三语齐；主题沿用现有；紧凑模式可选 | 实际=部分；证据=tests/vpm/settings.spec.ts、i18n；P8-C；差异=三语/主题沿用；无紧凑模式/全语言列表；去向=GAP-09/已知限制 |
| G2 | 预发布/隐藏包设置 | 完整 | P1/P8 | 持久化；影响目录/解析 | 实际=完整；证据=P8-C settings 测试(17)、catalog/plan；差异=持久化；默认关闭；去向=接受 |
| G3 | VPM 数据根/配额 | 部分 | P0/P8 | 非 C 校验；用量；清理缓存 | 实际=部分；证据=P8-B usage/cleanup、P8-C 配额设置；gate R19；差异=数据根固定 %APPDATA%/Atrium（C），无界面迁移；配额/清理可选；去向=接受差异（R19 用户裁定） |
| G4 | 日志查看/打开 | 完整 | P8 | 操作日志、脱敏、打开目录 | 实际=完整；证据=tests/vpm/log/diagnostics.spec.ts、MaintenanceLogPanel；差异=操作记录/打开目录/脱敏；去向=接受 |
| G5 | 诊断导出 | 额外 | P8 | 版本/错误/操作/用量；不含密钥 | 实际=完整；证据=diagnostics.spec.ts、P8-B IPC；差异=zip JSON；无路径/密钥；去向=接受 |
| G6 | 更新检查/安装 | 部分 | P8 | 手动检查 → 下载 → 校验 → 用户点安装 | 实际=部分；证据=tests/vpm/updater.spec.ts(19)、P8-C UI；差异=手动检查；GitHub/安装器未真跑；去向=GAP-04/P9-E |
| G7 | 遥测 | 不做 | — | — | 实际=不做；证据=明确裁定；差异=无遥测；去向=接受 |
| G8 | 迁移/回退 | 完整 | P0/P9 | 开关、安全模式、回退手册、演练 | 实际=部分；证据=docs/VPM-ROLLBACK.md、P0 gate；P9-D 未做；差异=回退手册/开关/安全模式有；演练未做；去向=GAP-05/P9-D |
| G9 | 安全模式 | 完整 | P0 | `--safe-mode`/环境变量；异常降级 | 实际=完整；证据=tests/vpm/gate.spec.ts、config/data-root；差异=安全模式/降级；去向=接受 |

---

## H. 平台与形态

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| H1 | Windows 10/11 | 完整 | 全部 | 安装版 + 真机 | 实际=部分；证据=Windows 11 真机；README 只声明 Win11；差异=Windows 10 未实机；去向=GAP-08/P9-C |
| H2 | macOS/Linux | 不做 | — | — | 实际=不做；证据=明确裁定；差异=首发 Windows；去向=接受 |
| H3 | CLI / CI | 不做 | — | — | 实际=不做；证据=明确裁定；差异=GUI 无 CLI；去向=接受 |
| H4 | 单实例/深链唤醒 | 完整 | P7 | 第二实例把 argv 交给第一实例 | 实际=部分；证据=src/main/index.ts single-instance、deeplink.spec.ts(7)；差异=代码/测试有；未装包真点链接；去向=GAP-06/P9-D |
| H5 | 安装/卸载 | 完整 | P9 | NSIS 安装、静默升级、卸载不删用户库 | 实际=部分；证据=P9-E 未执行；差异=安装/卸载/静默升级未真跑；去向=GAP-04/P9-E |

---

## I. 质量与产品底线

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| I1 | 按钮少/单一主操作 | 完整 | P8 | 截图复核 + 交互清单 | 实际=完整；证据=docs/VPM-P8A-UI-AUDIT.md、tests/renderer/vpm-ui.spec.ts、截图 vpm-p8-*；差异=一屏一实心；离屏截图；去向=接受 |
| I2 | 键盘/可访问性 | 完整 | P8 | Esc/Enter/Tab/焦点；不只靠颜色 | 实际=部分；证据=tests/renderer/vpm-a11y.spec.ts(5)、vpm-contrast.spec.ts(2)、tools/preview/a11y.cjs(14 项)、截图 vpm-p8e-100/125；差异=菜单/弹窗焦点、方向键/End/Esc、对比度、100/125 无溢出已验；真实屏幕阅读器/真实 DPI/合成 Enter 未验；去向=GAP-06/P9-C |
| I3 | 操作可恢复 | 完整 | P4/P8 | 崩溃恢复、操作记录、回滚仓 | 实际=完整；证据=P4-D recovery/failure-injection、P8-B log/usage；差异=崩溃恢复/操作记录/回滚仓；去向=接受 |
| I4 | 永不永久删用户素材 | 完整 | 全部 | 代码审查 + 测试：无 `unlink` 用户文件 | 实际=完整；证据=tests/vpm/security/static.spec.ts 删除白名单、vault/store 测试、事务失败注入、P9-A 安全报告；差异=缓存/临时例外；去向=接受 |
| I5 | 不手写 `.meta` | 完整 | 全部 | 代码审查 + 真 Unity | 实际=完整；证据=unitypackage 测试、tests/vpm/security/static.spec.ts .meta 静态扫描、P4 真实包 519 .meta 原样；差异=不生成/改写 .meta；去向=接受 |
| I6 | 缓存不落 C | 部分 | P0/P1 | 数据根校验 + 测试 | 实际=部分；证据=gate.ts R19 defaultVpmDataRoot=%APPDATA%/Atrium；cache/vault/backups 派生；差异=缓存/回滚仓/备份在 C；去向=接受差异（R19 用户裁定，P9-A 记为安全例外） |
| I7 | 核心库 schema 不变 | 完整 | 全部 | 断言 `SCHEMA_VERSION=11`；无新迁移 | 实际=完整；证据=SCHEMA_VERSION=11 断言、vpm 独立库 v6；差异=核心库不变；去向=接受 |
| I8 | 三语文案齐全 | 完整 | 全部 | i18n 测试零漂移 | 实际=完整；证据=tests/renderer/i18n.spec.ts、errors-i18n；差异=zh/en/ja 零漂移；去向=接受 |
| I9 | 真 Unity 验收 | 完整 | P4/P5/P6 | 2022.3.22f1 沙盒记录 | 实际=部分；证据=P4-E/P5-D/P5-E/P6-D review；P4-VERIFICATION 仅无头；差异=真 Unity 2022.3.22f1 未验；去向=GAP-01/P9-D |
| I10 | 性能 | 完整 | P8/P9 | 目录/解析/备份基准；不卡 UI | 实际=部分；证据=tests/perf/vpm-perf.spec.ts（隔离 3 条）、docs/VPM-PERF.md；差异=5k 版本目录 p95 145ms、200 包解析 25ms、10k 文件收集 597ms 已量；10k 目录/长稳/全量并行下的稳定 p95 未做；去向=GAP-06/P9-C |

---

## J. P8 对账时要补的内容

> “不做”的行只覆盖非 Windows GUI 功能面（macOS/Linux、CLI/CI）或违反产品底线
> （写 VCC 数据、遥测）；它们是明确裁定，不是漏做的 ALCOM 功能。
> K 组是 Atrium 特有硬需求，同样要逐行对账。

对每一行补充：

1. **实际状态**：完整/部分/不做/失败。
2. **证据**：测试文件/用例名、真机截图或日志、PR 号。
3. **差异**：与 ALCOM 的具体差别；用户会感知到什么。
4. **去向**：接受 / 进已知限制 / 开后续任务 / 回退该行。

P8 的退出条件：

- 所有"目标=完整"的行，实际=完整且有证据；
- 所有"目标=部分"的行，差异写进 `README.md` 或 `docs/DEVELOPMENT.md` 的已知限制；
- 所有"不做"的行，有原因且不和产品底线冲突；
- 没有"未开始/待定"的空白行。

P9 只允许：

- 修 P8 发现的问题；
- 补证据/文案/性能；
- 不允许悄悄把"完整"降成"部分"而不写原因。

---

## K. Atrium 素材与桥接联动（本产品硬需求）

> 这些不是 ALCOM 的界面功能，而是把 VPM 并进 Atrium 后必须成立的产品行为。
> 没有它们，包管理和素材导入会各说各话，等于没合并。
> P8 对账必须覆盖到 K，不能因为“不是 ALCOM 原功能”跳过。

| # | 能力 | 目标 | 阶段 | 验收证据（计划） | P8 实际状态 / 证据 / 差异 / 去向 |
|---|---|---|---|---|---|
| K1 | 打开 Unity 工程即绑定为导入目标 | 完整 | P2/P5 | 启动前绑定；启动中/连接中立即生效；失败清除；显式选择优先 | 实际=部分；证据=tests/vpm/unity/launch.spec.ts、launch-target.spec.ts、P5-E 脚本；差异=启动前绑定/失败清除有测试；真 Unity 未验；去向=GAP-01/P9-D |
| K2 | 双击素材导入当前工程 | 完整 | P1/P5 | 沿用现有双击导入；真机导入到刚启动的工程；不静默改投 | 实际=部分；证据=tests/renderer/vpm-launch-target.spec.ts(3)、P5-E 脚本；差异=双击导入链路未真机；去向=GAP-01/P9-D |
| K3 | 多 Unity 实例目标优先级 | 完整 | P2 | 显式选择 > 启动绑定 > 单工程自动；关闭/移除清除；选择器可见 | 实际=部分；证据=core connections 测试、P5-E 脚本；差异=优先级有测试；多实例真机未验；去向=GAP-01/P9-D |
| K4 | 素材写入与包事务/维护互斥 | 完整 | P4/P6 | 导入/撤销/删 GUID 中拒绝包事务/备份/复制/迁移/换版本；包事务要求 Unity 关闭 | 实际=部分；证据=tests/project/activity.spec.ts(14)、tests/vpm/install/activity-gate.spec.ts(6)；差异=互斥/租约有测试；真 Unity 并发未验；去向=GAP-01/P9-D |
| K5 | 桥接包与导入资产不被 VPM 清理 | 完整 | P3/P4/P6 | `com.avca.bridge` 受保护；旧 Assets 只按包声明 GUID/路径；未知/`import_log` 资产保留 | 实际=部分；证据=transaction legacy 保护、import_log guard 测试；差异=受保护/未知资产保留有测试；真 Unity 未验；去向=GAP-01/P9-D |
| K6 | 工程身份与目标单一真相 | 完整 | P2 | 核心 `project.id`/路径唯一；VPM 台账不另存当前目标；UI 显示目标徽标 | 实际=完整；证据=core UnityConnections、P2-E、architecture 测试；差异=不另存目标状态；去向=接受 |
