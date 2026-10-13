using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace AVCA.Bridge
{
    /// <summary>
    /// Atrium ⇄ Unity 的本地文件信箱桥接（第 3 份 §6）。
    ///
    /// 目录布局（相对工程根）：
    /// <code>
    /// Temp/AVCABridge/
    ///   ├─ bridge.json        Unity 写 / A 读   心跳与状态
    ///   ├─ inbox/&lt;id&gt;.json  A 写 / Unity 消费后删
    ///   └─ outbox/&lt;id&gt;.json Unity 写 / A 读后删
    /// </code>
    ///
    /// ⚠ 本文件是全文最容易翻车的地方，下面每条都是"写错了就表现为偶尔成功偶尔失败"的坑：
    ///
    ///  1. <b>导入必须事件驱动 + 严格串行</b>。AssetDatabase.ImportPackage 是<b>异步</b>的，
    ///     连发会导致导入互相打断、结果不可预测。必须靠 importPackageCompleted /
    ///     importPackageFailed / importPackageCancelled 三个回调推进队列（见 ImportPackageQueue）。
    ///  2. <b>不要手写 .meta 文件</b>。散文件用 FileUtil.CopyFileOrDirectory + AssetDatabase.Refresh()，
    ///     让 Unity 自己生成。
    ///  3. <b>不在静态构造里做耗时扫描</b>。这里只建目录、注册 update、写一次心跳。
    ///  4. <b>Tick 里不做同步 IO 等待</b>，只用 File.ReadAllText/WriteAllText 这种极快的操作。
    ///  5. <b>不用 EditorUtility.DisplayProgressBar</b>（会阻塞），让 Unity 自己的进度条工作。
    ///  6. <b>不调用任何改变用户状态的操作</b>（EditorApplication.Exit / 存场景 等）。
    ///  7. <b>不静默吞异常</b>：完整堆栈回传（exception + stackTrace），A 侧要能展示。
    ///  8. <b>读 inbox 遇到 .tmp 后缀要跳过</b>（说明 A 还没写完）。
    ///  9. <b>删除失败不要抛</b>，下次 Tick 重试即可。
    /// 10. <b>不做任何联网请求</b>（本机文件信箱是唯一通道）。
    /// </summary>
    [InitializeOnLoad]
    public static class AVCABridge
    {
        public const int ProtocolVersion = 1;
        public const string BridgeVersion = "1.2.0";

        private const string BridgeDirName = "AVCABridge";
        private const double TickThrottleSeconds = 0.5;   // §6.2：500ms 节流
        private const double HeartbeatSeconds = 2.0;      // §2.2：心跳 2 秒

        private static readonly string ProjectPath;
        private static readonly string BridgeDir;
        private static readonly string InboxDir;
        private static readonly string OutboxDir;
        private static readonly string HeartbeatFile;

        private static double _lastTick;
        private static double _lastHeartbeat;

        /// <summary>还没被消费的命令 id，按文件名排序（先到先做）</summary>
        private static readonly List<string> Queue = new List<string>();

        /// <summary>正在处理的那一条。串行闸门就靠它 + Queue.Count（§6.2）</summary>
        private static string _current;

        static AVCABridge()
        {
            // §6.1：静态构造里只做轻量工作。绝对不要在这里 FindAssets / 全工程扫描。
            ProjectPath = NormalizeProjectPath(Environment.CurrentDirectory);
            BridgeDir = Path.Combine(ProjectPath, "Temp", BridgeDirName);
            InboxDir = Path.Combine(BridgeDir, "inbox");
            OutboxDir = Path.Combine(BridgeDir, "outbox");
            HeartbeatFile = Path.Combine(BridgeDir, "bridge.json");

            try
            {
                Directory.CreateDirectory(InboxDir);
                Directory.CreateDirectory(OutboxDir);
            }
            catch (Exception e)
            {
                // Temp 目录可能被清理/被杀毒软件锁住，这里失败不该让整个工程编译不过
                Debug.LogWarning("[AVCA] 建桥接目录失败：" + e.Message);
            }

            EditorApplication.update += Tick;

            // 导入回调：三条都必须接（§6.3）。这是"串行推进队列"的唯一正确做法。
            AssetDatabase.importPackageCompleted += OnImportCompleted;
            AssetDatabase.importPackageFailed += OnImportFailed;
            AssetDatabase.importPackageCancelled += OnImportCancelled;

            // §6.1：脚本重编译后要能自动恢复。静态构造在重编译后会重新跑一次，
            // 这里再挂一次 delayCall 作为额外保险（重复注册是无害的，回调里自己会去重）。
            EditorApplication.delayCall += () =>
            {
                try
                {
                    WriteHeartbeat();
                }
                catch (Exception e)
                {
                    Debug.LogWarning("[AVCA] 首次心跳失败：" + e.Message);
                }
            };

            Debug.Log("[AVCA] 桥接已就绪：" + BridgeDir);
        }

        // ------------------------------------------------------------------ Tick

        private static void Tick()
        {
            // §6.2 三道闸门，顺序不能变
            if (EditorApplication.timeSinceStartup - _lastTick < TickThrottleSeconds) return;
            _lastTick = EditorApplication.timeSinceStartup;

            // 心跳按 2 秒节流（Tick 本身是 500ms 一次，所以心跳每 4 个 Tick 写一次）
            if (EditorApplication.timeSinceStartup - _lastHeartbeat >= HeartbeatSeconds)
            {
                WriteHeartbeat();
                _lastHeartbeat = EditorApplication.timeSinceStartup;
            }

            /**
             * ⚠ **`RefreshQueue()` 必须在忙判定之前。** 顺序错了会死锁。
             *
             * 曾经的顺序是：
             * ```
             * if (IsBusy()) { ReportBusyToPending(); return; }   // 内部会 RefreshQueue → Queue 变 1
             * if (Queue.Count > 0) return;                       // 从此永远在这里返回
             * RefreshQueue();                                    // 再也跑不到
             * ```
             *
             * 死锁链条（2026-10-06 在真机上撞到，Play 模式退出后导入永久卡住）：
             *   1. Unity 进 Play，A 发来命令 → `ReportBusyToPending()` 把命令读进 `Queue`
             *   2. 用户退出 Play → 不再忙，但 `Queue.Count > 0` → **直接 return**
             *   3. `RefreshQueue()` 在检查之后，永远调不到 → 那条命令**永远不被处理**
             *
             * 修法：把 `RefreshQueue()` 提到最前面（仅次于心跳）。它只做一件事 ——
             * 把 inbox 里的新文件读进 `Queue`，幂等、廉价，每 500ms 跑一次没问题。
             */
            if (_current != null) return;

            RefreshQueue();

            /**
             * 「正在处理一条命令」与「忙」是两件不同的事，必须分开：
             *
             *  - `_current != null`：导入已经在跑了。它的进度由 AssetDatabase 的回调驱动，
             *    这里**什么都别做** —— 尤其不要写 busy，否则 A 会把一条正在正常进行的
             *    导入当成"被拒了"而去重投。
             *  - `IsBusy()` 且没有正在跑的命令：Unity 在编译 / Play / 刷新，**无法接收新命令**。
             *    这时必须按 §2.5「**不消费命令，直接写回 `busy` + `busyReason`**」，
             *    否则 A 侧收到的是**沉默**，会等到超时并报"桥接没有回应" ——
             *    命令直接失败，而不是排队。那正是验收 §8-5（Play 模式下点导入要排队、
             *    退出 Play 后自动执行）过不去的原因。
             */
            if (IsBusy())
            {
                ReportBusyToPending();
                return;
            }

            // 串行：一次只处理一个（§6.2）
            if (Queue.Count == 0) return;

            string id = Queue[0];
            Queue.RemoveAt(0);
            HandleCommand(id);
        }

        /// <summary>
        /// 把"现在忙"如实回给 inbox 里每一条还没被消费的命令（§2.5）。
        ///
        /// **不删 inbox 里的命令文件** —— 那条命令还没被执行，A 侧要能退避重投。
        /// 终态才删（§2.5 的 ack 契约）。
        ///
        /// 每 500ms 重写一次同一份 busy 结果是可以接受的：A 侧读到 busy 就按
        /// 1s→2s→5s→10s→30s 退避，这期间的重复写入它不会重复消费（读到就删 outbox）。
        /// </summary>
        private static void ReportBusyToPending()
        {
            try
            {
                RefreshQueue();
                if (Queue.Count == 0) return;
                string reason = BusyReason();
                foreach (string id in Queue)
                {
                    WriteResult(id, "busy", null, null, null, reason);
                }
            }
            catch (Exception e)
            {
                // 写不进去不是致命错误：A 会重投，下一次 Tick 再试
                Debug.LogWarning("[AVCA] 写 busy 结果失败：" + e.Message);
            }
        }

        /// <summary>§6.2 原文的忙判定。四个条件缺一不可。</summary>
        private static bool IsBusy()
        {
            return EditorApplication.isCompiling
                || EditorApplication.isUpdating
                || EditorApplication.isPlayingOrWillChangePlaymode
                || EditorApplication.isPlaying;
        }

        private static string BusyReason()
        {
            if (EditorApplication.isCompiling) return "Unity 正在编译脚本";
            if (EditorApplication.isUpdating) return "Unity 正在刷新资源";
            if (EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isPlaying)
                return "Unity 正在运行 Play 模式";
            return "Unity 正忙";
        }

        /// <summary>枚举 inbox，**跳过 .tmp**（§6.6：说明 A 还没写完）。读失败不抛。</summary>
        private static void RefreshQueue()
        {
            try
            {
                if (!Directory.Exists(InboxDir)) return;
                foreach (string file in Directory.GetFiles(InboxDir, "*.json"))
                {
                    string name = Path.GetFileNameWithoutExtension(file);
                    if (string.IsNullOrEmpty(name)) continue;
                    if (!Queue.Contains(name)) Queue.Add(name);
                }
                Queue.Sort(StringComparer.Ordinal);
            }
            catch (Exception e)
            {
                // 目录可能正被清理。不抛。
                Debug.LogWarning("[AVCA] 枚举 inbox 失败：" + e.Message);
            }
        }

        // ------------------------------------------------------------------ 命令分发

        private static void HandleCommand(string id)
        {
            string file = Path.Combine(InboxDir, id + ".json");
            string json;
            try
            {
                if (!File.Exists(file)) return;   // 已经被消费掉了
                json = File.ReadAllText(file, Encoding.UTF8);
            }
            catch (Exception e)
            {
                // 读不到就当这条不存在，下次 Tick 再说（§6.6：删除失败不要抛）
                Debug.LogWarning("[AVCA] 读命令失败 " + id + "：" + e.Message);
                return;
            }

            string type = JsonRead.String(json, "type");
            string payload = JsonRead.Object(json, "payload");
            int protocol = JsonRead.Int(json, "protocolVersion", 0);

            if (protocol != ProtocolVersion)
            {
                CompleteCurrent(id, false, null,
                    "协议版本不匹配：桥接 " + ProtocolVersion + "，请求 " + protocol);
                return;
            }

            _current = id;
            try
            {
                switch (type)
                {
                    case "ping":
                        CompleteCurrent(id, true, "{\"pong\":true}", null);
                        return;

                    case "get_status":
                        CompleteCurrent(id, true, StatusJson(), null);
                        return;

                    case "get_preview_targets":
                        CompleteCurrent(id, true, AVCAPreview.Targets(payload), null);
                        return;

                    case "get_preview_candidates":
                        CompleteCurrent(id, true, AVCAPreview.Candidates(payload), null);
                        return;

                    case "render_preview":
                        CompleteCurrent(id, true, AVCAPreview.RenderCommand(id, payload, BridgeDir), null);
                        return;

                    case "refresh":
                        AssetDatabase.Refresh();
                        CompleteCurrent(id, true, null, null);
                        return;

                    case "resolve_guids":
                        CompleteCurrent(id, true, ResolveGuids(payload), null);
                        return;

                    case "list_project_assets":
                        CompleteCurrent(id, true, ListProjectAssets(), null);
                        return;

                    case "open_folder":
                        OpenFolder(payload);
                        CompleteCurrent(id, true, null, null);
                        return;

                    case "import_unitypackage":
                        StartImportPackage(id, payload);
                        return;   // 异步：终态由导入回调写，_current 保持不动

                    case "import_files":
                        DoImportFiles(id, payload);
                        return;

                    case "delete_guids":
                        DoDeleteGuids(id, payload);
                        return;

                    default:
                        CompleteCurrent(id, false, null, "不认识的命令类型：" + type);
                        return;
                }
            }
            catch (Exception e)
            {
                // §6.6：不得静默吞异常，完整堆栈回传
                CompleteCurrent(id, false, null, e.Message, e.ToString());
            }
        }

        // ------------------------------------------------------------------ 各命令实现

        private static string StatusJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\"isPlaying\":").Append(Bool(EditorApplication.isPlaying));
            sb.Append(",\"isCompiling\":").Append(Bool(EditorApplication.isCompiling));
            sb.Append(",\"isUpdating\":").Append(Bool(EditorApplication.isUpdating));
            sb.Append(",\"isBusy\":").Append(Bool(IsBusy()));
            sb.Append(",\"unityVersion\":").Append(JsonWrite.Quote(Application.unityVersion));
            sb.Append(",\"queueLength\":").Append(Queue.Count + (_current != null ? 1 : 0));
            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>
        /// §3：批量查 GUID 是否已在工程中。单次 ≤ 2000，超出分批（分批由 A 侧做，这里只处理一批）。
        /// §6.4：GUIDToAssetPath 对不存在的 GUID 返回空字符串，**不抛异常**。
        /// </summary>
        private static string ResolveGuids(string payload)
        {
            List<string> guids = JsonRead.StringArray(payload, "guids");
            var sb = new StringBuilder();
            sb.Append("{\"resolved\":{");
            bool first = true;
            foreach (string g in guids)
            {
                if (string.IsNullOrEmpty(g)) continue;
                string path = AssetDatabase.GUIDToAssetPath(g);
                if (!first) sb.Append(',');
                first = false;
                sb.Append(JsonWrite.Quote(g)).Append(':');
                if (string.IsNullOrEmpty(path)) sb.Append("null");
                else sb.Append(JsonWrite.Quote(path));
            }
            sb.Append("}}");
            return sb.ToString();
        }

        /// <summary>
        /// §3：工程里已装的资源与包。
        /// §3 原文要求「反射查找（找不到类型时返回空数组，**不能抛异常**）」——
        /// 这里只做**一定能成功**的两部分：Packages/manifest.json 的 dependencies +
        /// 已解析的包名。反射去凑 VRChat SDK 的内部列表属于 M5-B（依赖分析）的活，
        /// 现在硬凑反而会引入"某个 SDK 版本下就抛异常"的脆弱点。
        /// </summary>
        private static string ListProjectAssets()
        {
            var sb = new StringBuilder();
            sb.Append("{\"installedPackages\":[");
            bool first = true;
            string manifest = Path.Combine(ProjectPath, "Packages", "manifest.json");
            try
            {
                if (File.Exists(manifest))
                {
                    string text = File.ReadAllText(manifest, Encoding.UTF8);
                    // dependencies 块里的键名就是包名
                    string deps = JsonRead.Object(text, "dependencies");
                    foreach (string key in JsonRead.Keys(deps))
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        sb.Append(JsonWrite.Quote(key));
                    }
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AVCA] 读 manifest.json 失败：" + e.Message);
            }
            sb.Append("]}");
            return sb.ToString();
        }

        /// <summary>§3：`EditorGUIUtility.PingObject` 定位。找不到就静默返回，不抛。</summary>
        private static void OpenFolder(string payload)
        {
            string assetPath = JsonRead.String(payload, "assetPath");
            if (string.IsNullOrEmpty(assetPath)) return;
            UnityEngine.Object obj = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(assetPath);
            if (obj != null) EditorGUIUtility.PingObject(obj);
        }

        // ------------------------------------------------------------------ .unitypackage 导入（异步 + 串行）

        /// <summary>本次导入前对"包内 GUID"的快照。导入后重新查，导入前为空、导入后有值的即为新建（§6.3）。</summary>
        private static readonly Dictionary<string, bool> BeforeExists = new Dictionary<string, bool>();
        private static List<string> _importGuids = new List<string>();
        private static string _importPath;
        private static bool _importBackupOverwritten;

        private static void StartImportPackage(string id, string payload)
        {
            string path = JsonRead.String(payload, "path");
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                CompleteCurrent(id, false, null, "包文件不存在：" + path);
                return;
            }

            List<string> knownGuids = JsonRead.StringArray(payload, "guids");

            _importPath = path;
            _importGuids = knownGuids;
            _importBackupOverwritten = JsonRead.Bool(payload, "backupOverwritten");
            BeforeExists.Clear();

            // 导入前的快照：A 侧已经解析过包内 GUID（它读 unitypackage 比 Unity 快得多），
            // 所以这里通常直接用传进来的列表；没传就退化成"导入前后都查一遍"。
            foreach (string g in knownGuids)
            {
                if (string.IsNullOrEmpty(g)) continue;
                BeforeExists[g] = !string.IsNullOrEmpty(AssetDatabase.GUIDToAssetPath(g));
            }

            WriteResult(id, "progress", 0.0, "开始导入 " + Path.GetFileName(path), null);
            try
            {
                // §6.3：立即返回，进度条由 Unity 显示。**绝对不要连发。**
                AssetDatabase.ImportPackage(path, false);
            }
            catch (Exception e)
            {
                CompleteCurrent(id, false, null, e.Message, e.ToString());
            }
        }

        private static void OnImportCompleted(string packageName)
        {
            if (_current == null) return;
            string id = _current;
            try
            {
                string data = BuildImportResult();
                CompleteCurrent(id, true, data, null);
            }
            catch (Exception e)
            {
                CompleteCurrent(id, false, null, e.Message, e.ToString());
            }
        }

        private static void OnImportFailed(string packageName, string errorMessage)
        {
            if (_current == null) return;
            CompleteCurrent(_current, false, null, errorMessage);
        }

        private static void OnImportCancelled(string packageName)
        {
            if (_current == null) return;
            // 取消不算失败，但也不是 ok —— 用 cancelled 让 A 侧区分对待
            CompleteCurrent(_current, "cancelled", null, null, null);
        }

        /// <summary>
        /// §6.3：createdGuids = 导入前为空、导入后有值的那些。
        /// overwrittenGuids = 导入前后都存在的那些（可能被覆盖了）。
        /// </summary>
        private static string BuildImportResult()
        {
            var created = new List<string>();
            var overwritten = new List<string>();
            foreach (KeyValuePair<string, bool> kv in BeforeExists)
            {
                bool now = !string.IsNullOrEmpty(AssetDatabase.GUIDToAssetPath(kv.Key));
                if (now && !kv.Value) created.Add(kv.Key);
                else if (now && kv.Value) overwritten.Add(kv.Key);
            }

            var sb = new StringBuilder();
            sb.Append("{\"createdGuids\":[");
            for (int i = 0; i < created.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonWrite.Quote(created[i]));
            }
            sb.Append("],\"overwrittenGuids\":[");
            for (int i = 0; i < overwritten.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonWrite.Quote(overwritten[i]));
            }
            sb.Append("],\"package\":").Append(JsonWrite.Quote(_importPath ?? string.Empty));
            sb.Append('}');
            _importGuids = new List<string>();
            BeforeExists.Clear();
            return sb.ToString();
        }

        // ------------------------------------------------------------------ 散文件导入（不用手写 .meta）

        /// <summary>
        /// §6.5：散文件/文件夹用 FileUtil.CopyFileOrDirectory + AssetDatabase.Refresh()，
        /// **让 Unity 自己生成 .meta**。目标路径必须落在工程内（A 侧也校验过一道）。
        /// </summary>
        private static void DoImportFiles(string id, string payload)
        {
            List<string> sources = JsonRead.StringArray(payload, "sources");
            string destRel = JsonRead.String(payload, "destFolder");
            if (string.IsNullOrEmpty(destRel)) destRel = "Assets/AVCA_Imports";

            string destAbs = Path.Combine(ProjectPath, destRel.Replace('/', Path.DirectorySeparatorChar));
            if (!IsInsideProject(destAbs))
            {
                CompleteCurrent(id, false, null, "目标路径不在工程内：" + destAbs);
                return;
            }

            var created = new List<string>();
            Directory.CreateDirectory(destAbs);
            foreach (string src in sources)
            {
                if (string.IsNullOrEmpty(src) || !File.Exists(src) && !Directory.Exists(src)) continue;
                string name = Path.GetFileName(src.TrimEnd(Path.DirectorySeparatorChar, '/'));
                string target = Path.Combine(destAbs, name);
                if (File.Exists(target) || Directory.Exists(target))
                {
                    CompleteCurrent(id, false, null, "目标已存在，拒绝覆盖：" + target);
                    return;
                }
                FileUtil.CopyFileOrDirectory(src, target);
                created.Add(destRel.TrimEnd('/') + "/" + name);
            }
            AssetDatabase.Refresh();

            var sb = new StringBuilder();
            sb.Append("{\"created\":[");
            for (int i = 0; i < created.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonWrite.Quote(created[i]));
            }
            sb.Append("]}");
            CompleteCurrent(id, true, sb.ToString(), null);
        }

        // ------------------------------------------------------------------ 撤销：只删白名单里的 GUID

        /// <summary>
        /// §5.3：回滚用。**只删 Assets/ 下、且属于本次导入 createdGuids 白名单的文件。**
        ///
        /// ⚠ 这是本桥接里最危险的一个命令，所以校验是**双重**的：
        ///   1. 每个 GUID 必须在 payload 的 `allow` 白名单里（调用方传本次导入新建的那些）
        ///   2. 解析出来的路径必须以 `Assets/` 开头
        /// 两者任一不满足就**整条命令拒绝**，不做部分删除 —— 部分删除会留下半成品更难解释。
        /// 绝不提供"按 GUID 随便删"的接口。
        /// </summary>
        private static void DoDeleteGuids(string id, string payload)
        {
            List<string> guids = JsonRead.StringArray(payload, "guids");
            List<string> allow = JsonRead.StringArray(payload, "allow");
            var allowSet = new HashSet<string>(allow, StringComparer.OrdinalIgnoreCase);

            var toDelete = new List<string>();
            foreach (string g in guids)
            {
                if (string.IsNullOrEmpty(g)) continue;
                if (!allowSet.Contains(g))
                {
                    CompleteCurrent(id, false, null, "拒绝：GUID " + g + " 不在本次导入的白名单里");
                    return;
                }
                string path = AssetDatabase.GUIDToAssetPath(g);
                if (string.IsNullOrEmpty(path)) continue;          // 已经不在了，当成已删
                if (!path.StartsWith("Assets/", StringComparison.OrdinalIgnoreCase))
                {
                    CompleteCurrent(id, false, null, "拒绝：路径不在 Assets/ 下：" + path);
                    return;
                }
                toDelete.Add(path);
            }

            var deleted = new List<string>();
            var failed = new List<string>();
            foreach (string path in toDelete)
            {
                try
                {
                    if (AssetDatabase.DeleteAsset(path)) deleted.Add(path);
                    else failed.Add(path);
                }
                catch (Exception e)
                {
                    failed.Add(path + "：" + e.Message);
                }
            }
            AssetDatabase.Refresh();

            var sb = new StringBuilder();
            sb.Append("{\"deleted\":[");
            for (int i = 0; i < deleted.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonWrite.Quote(deleted[i]));
            }
            sb.Append("],\"failed\":[");
            for (int i = 0; i < failed.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(JsonWrite.Quote(failed[i]));
            }
            sb.Append("]}");
            CompleteCurrent(id, true, sb.ToString(), null);
        }

        // ------------------------------------------------------------------ 心跳与结果

        private static void WriteHeartbeat()
        {
            var sb = new StringBuilder();
            sb.Append("{\"protocolVersion\":").Append(ProtocolVersion);
            sb.Append(",\"pid\":").Append(System.Diagnostics.Process.GetCurrentProcess().Id);
            sb.Append(",\"projectPath\":").Append(JsonWrite.Quote(ProjectPath));
            sb.Append(",\"projectName\":").Append(JsonWrite.Quote(Path.GetFileName(ProjectPath)));
            sb.Append(",\"unityVersion\":").Append(JsonWrite.Quote(Application.unityVersion));
            sb.Append(",\"bridgeVersion\":").Append(JsonWrite.Quote(BridgeVersion));
            sb.Append(",\"capabilities\":[\"object_preview\",\"preview_candidates\"]");
            sb.Append(",\"isPlaying\":").Append(Bool(EditorApplication.isPlaying));
            sb.Append(",\"isCompiling\":").Append(Bool(EditorApplication.isCompiling));
            sb.Append(",\"isUpdating\":").Append(Bool(EditorApplication.isUpdating));
            sb.Append(",\"isPlayingOrWillChangePlaymode\":")
                .Append(Bool(EditorApplication.isPlayingOrWillChangePlaymode));
            sb.Append(",\"activeScene\":").Append(JsonWrite.Quote(ActiveScenePath()));
            sb.Append(",\"busyReason\":").Append(IsBusy() ? JsonWrite.Quote(BusyReason()) : "null");
            sb.Append(",\"queueLength\":").Append(Queue.Count + (_current != null ? 1 : 0));
            sb.Append(",\"heartbeatUtc\":").Append(NowMs());
            sb.Append('}');

            try
            {
                WriteAllTextAtomic(HeartbeatFile, sb.ToString());
            }
            catch (Exception e)
            {
                // Temp 可能被清理；下一次 Tick 会再试。不抛。
                Debug.LogWarning("[AVCA] 写心跳失败：" + e.Message);
            }
        }

        private static string ActiveScenePath()
        {
            try
            {
                UnityEngine.SceneManagement.Scene s =
                    UnityEngine.SceneManagement.SceneManager.GetActiveScene();
                return s.IsValid() ? s.path : null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// 写一条结果。**进度与终态都覆写同一个 outbox/&lt;id&gt;.json**（§2.4），
        /// 所以这里永远是"整个文件替换"，不是追加。
        ///
        /// `busyReason` 只在写 `busy` 时给（§2.5：「直接写回 `busy` + `busyReason`」）——
        /// A 侧拿它给用户看"Unity 正在运行/编译，已排队（第 3 位）"。
        /// </summary>
        private static void WriteResult(string id, string status, double? progress,
            string message, string dataJson, string busyReason = null)
        {
            var sb = new StringBuilder();
            sb.Append("{\"id\":").Append(JsonWrite.Quote(id));
            sb.Append(",\"status\":").Append(JsonWrite.Quote(status));
            if (progress.HasValue)
                sb.Append(",\"progress\":").Append(progress.Value.ToString("0.###", CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(message))
                sb.Append(",\"message\":").Append(JsonWrite.Quote(message));
            if (!string.IsNullOrEmpty(busyReason))
                sb.Append(",\"busyReason\":").Append(JsonWrite.Quote(busyReason));
            if (!string.IsNullOrEmpty(dataJson))
                sb.Append(",\"data\":").Append(dataJson);
            sb.Append('}');

            try
            {
                WriteAllTextAtomic(Path.Combine(OutboxDir, id + ".json"), sb.ToString());
            }
            catch (Exception e)
            {
                Debug.LogWarning("[AVCA] 写结果失败 " + id + "：" + e.Message);
            }
        }

        /// <summary>
        /// 收尾三步（§6.3）：写终态结果 → 删掉 inbox 里的命令文件 → 放开串行闸门。
        /// 下一次 Tick 会自动取队列里的下一条。
        /// </summary>
        private static void CompleteCurrent(string id, bool ok, string dataJson, string error,
            string stackTrace = null)
        {
            CompleteCurrent(id, ok ? "ok" : "error", dataJson, error, stackTrace);
        }

        private static void CompleteCurrent(string id, string status, string dataJson,
            string error, string stackTrace)
        {
            string payload = dataJson;
            if (!string.IsNullOrEmpty(error))
            {
                var sb = new StringBuilder();
                sb.Append("{\"exception\":").Append(JsonWrite.Quote(error));
                if (!string.IsNullOrEmpty(stackTrace))
                    sb.Append(",\"stackTrace\":").Append(JsonWrite.Quote(stackTrace));
                sb.Append('}');
                payload = sb.ToString();
            }

            WriteResult(id, status, null, null, payload);

            // §2.5 终态：Unity 删 inbox 里的命令文件。删不掉不抛，下次 Tick 重试。
            TryDelete(Path.Combine(InboxDir, id + ".json"));

            _current = null;
        }

        // ------------------------------------------------------------------ 工具

        private static void WriteAllTextAtomic(string file, string text)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            string tmp = file + ".tmp";
            File.WriteAllText(tmp, text, new UTF8Encoding(false));
            // File.Replace/Move 在同卷上是原子的，避免 A 读到半截 JSON
            if (File.Exists(file)) File.Delete(file);
            File.Move(tmp, file);
        }

        private static void TryDelete(string file)
        {
            try
            {
                if (File.Exists(file)) File.Delete(file);
            }
            catch (Exception e)
            {
                // §6.6：删除失败不要抛异常，下次 Tick 重试
                Debug.LogWarning("[AVCA] 删不掉 " + file + "：" + e.Message);
            }
        }

        private static bool IsInsideProject(string absPath)
        {
            string norm = NormalizeProjectPath(absPath);
            return norm.StartsWith(ProjectPath + Path.DirectorySeparatorChar,
                       StringComparison.OrdinalIgnoreCase)
                   || string.Equals(norm, ProjectPath, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeProjectPath(string p)
        {
            if (string.IsNullOrEmpty(p)) return p;
            return Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar, '/');
        }

        private static string Bool(bool b)
        {
            return b ? "true" : "false";
        }

        private static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }

    /// <summary>
    /// 极简 JSON 取值。**刻意不引第三方库**（§10-2：自包含、零第三方依赖），
    /// 也刻意不做通用反序列化：命令的 payload 形状是我们自己定的，
    /// 通用实现只会带来"某个版本行为不一致"的脆弱点。
    ///
    /// 所有方法在找不到键时返回默认值，**绝不抛**。
    /// </summary>
    internal static class JsonRead
    {
        public static string String(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");
            return m.Success ? Unescape(m.Groups[1].Value) : null;
        }

        public static int Int(string json, string key, int fallback)
        {
            if (string.IsNullOrEmpty(json)) return fallback;
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(-?\\d+)");
            if (!m.Success) return fallback;
            int v;
            return int.TryParse(m.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)
                ? v : fallback;
        }

        public static bool Bool(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return false;
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(true|false)");
            return m.Success && m.Groups[1].Value == "true";
        }

        /// <summary>取一个**对象**字面量（用于 payload / dependencies）。取不到返回空串。</summary>
        public static string Object(string json, string key)
        {
            return Block(json, key, '{', '}');
        }

        public static string Array(string json, string key)
        {
            return Block(json, key, '[', ']');
        }

        public static List<string> StringArray(string json, string key)
        {
            var list = new List<string>();
            string arr = Array(json, key);
            if (string.IsNullOrEmpty(arr)) return list;
            foreach (Match m in Regex.Matches(arr, "\"((?:\\\\.|[^\"\\\\])*)\""))
                list.Add(Unescape(m.Groups[1].Value));
            return list;
        }

        /// <summary>一个对象字面量里的全部键名（用于 Packages/manifest.json 的 dependencies）</summary>
        public static List<string> Keys(string jsonObject)
        {
            var list = new List<string>();
            if (string.IsNullOrEmpty(jsonObject)) return list;
            foreach (Match m in Regex.Matches(jsonObject, "\"((?:\\\\.|[^\"\\\\])*)\"\\s*:"))
                list.Add(Unescape(m.Groups[1].Value));
            return list;
        }

        /// <summary>
        /// 按括号配对抠出一段子块。字符串里的括号要跳过，否则
        /// `{"a":"}{"}` 这种值会把配对带偏。
        /// </summary>
        private static string Block(string json, string key, char open, char close)
        {
            if (string.IsNullOrEmpty(json)) return null;
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\\" + open);
            if (!m.Success) return null;

            int start = m.Index + m.Length - 1;
            int depth = 0;
            bool inString = false;
            bool escaped = false;
            for (int i = start; i < json.Length; i++)
            {
                char c = json[i];
                if (inString)
                {
                    if (escaped) escaped = false;
                    else if (c == '\\') escaped = true;
                    else if (c == '"') inString = false;
                    continue;
                }
                if (c == '"') inString = true;
                else if (c == open) depth++;
                else if (c == close)
                {
                    depth--;
                    if (depth == 0) return json.Substring(start, i - start + 1);
                }
            }
            return null;
        }

        private static string Unescape(string s)
        {
            if (string.IsNullOrEmpty(s) || s.IndexOf('\\') < 0) return s;
            var sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                if (s[i] != '\\' || i + 1 >= s.Length)
                {
                    sb.Append(s[i]);
                    continue;
                }
                i++;
                switch (s[i])
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'u':
                        if (i + 4 < s.Length)
                        {
                            int code;
                            if (int.TryParse(s.Substring(i + 1, 4), NumberStyles.HexNumber,
                                    CultureInfo.InvariantCulture, out code))
                            {
                                sb.Append((char)code);
                                i += 4;
                            }
                        }
                        break;
                    default: sb.Append(s[i]); break;
                }
            }
            return sb.ToString();
        }
    }

    /// <summary>JSON 字符串转义。所有写出去的值都过这里，别在别处手拼引号。</summary>
    internal static class JsonWrite
    {
        public static string Quote(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        // 控制字符必须转义，否则 JSON 非法（Windows 路径里不会有，但别赌）
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}
