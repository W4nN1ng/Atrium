using System;
using System.Diagnostics;
using System.IO;
using UnityEditor;

namespace AVCA.Bridge
{
    /// <summary>Lifecycle for an explicitly owned, isolated package preview editor only.</summary>
    [InitializeOnLoad]
    public static class AVCAPackageWorker
    {
        private static readonly string Project = Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('/', '\\');
        private static readonly string Mailbox = Path.Combine(Project, "Temp", "AVCABridge");
        private static readonly int Pid = Process.GetCurrentProcess().Id;
        private static readonly int ParentPid = ParentProcessId();
        private static readonly string ParentIdentity;
        private static double lastTick;

        static AVCAPackageWorker()
        {
            if (!IsOwnedWorker()) return;
            // SessionState survives domain reloads. A recycled OS pid must never adopt an orphaned worker.
            string key = "AVCA.PackageWorker.Parent." + ParentPid;
            ParentIdentity = SessionState.GetString(key, "");
            if (string.IsNullOrEmpty(ParentIdentity))
            {
                try
                {
                    using (var parent = Process.GetProcessById(ParentPid))
                        ParentIdentity = parent.StartTime.ToUniversalTime().Ticks.ToString();
                    SessionState.SetString(key, ParentIdentity);
                }
                catch { ParentIdentity = ""; }
            }
            EditorApplication.update += Tick;
        }

        private static int ParentProcessId()
        {
            string[] args = Environment.GetCommandLineArgs();
            int index = Array.IndexOf(args, "-avcaPackagePreviewParentPid");
            int pid;
            return index >= 0 && index + 1 < args.Length && int.TryParse(args[index + 1], out pid) && pid > 0 ? pid : -1;
        }

        private static bool ParentIsAlive()
        {
            if (ParentPid <= 0 || string.IsNullOrEmpty(ParentIdentity)) return false;
            try
            {
                using (var parent = Process.GetProcessById(ParentPid))
                    return !parent.HasExited && parent.StartTime.ToUniversalTime().Ticks.ToString() == ParentIdentity;
            }
            catch { return false; }
        }

        public static void Start()
        {
            if (!IsOwnedWorker()) throw new InvalidOperationException("covers.invalidRequest");
            // Import only resources already validated and prepared by Atrium. No supplier code, scene,
            // animator, SDK/NDMF build or dependency installation is invoked by the worker.
            AssetDatabase.Refresh();
        }

        private static bool IsOwnedWorker()
        {
            if (Array.IndexOf(Environment.GetCommandLineArgs(), "-avcaPackagePreview") < 0) return false;
            try
            {
                string markerPath = Path.Combine(Project, ".atrium-cover-preview.json");
                if ((File.GetAttributes(markerPath) & FileAttributes.ReparsePoint) != 0) return false;
                if (new FileInfo(markerPath).Length > 4096) return false;
                string marker = File.ReadAllText(markerPath);
                return JsonRead.String(marker, "kind") == "atrium-package-preview"
                    && JsonRead.Int(marker, "version", 0) == 1
                    && string.Equals(Path.GetFullPath(JsonRead.String(marker, "projectPath")).TrimEnd('/', '\\'),
                        Project, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        private static void Tick()
        {
            if (EditorApplication.timeSinceStartup - lastTick < 0.25) return;
            lastTick = EditorApplication.timeSinceStartup;
            if (!IsOwnedWorker()) return;
            if (!ParentIsAlive())
            {
                EditorApplication.Exit(0);
                return;
            }
            string shutdown = Path.Combine(Mailbox, "package-worker-shutdown.json");
            try
            {
                if (File.Exists(shutdown) && new FileInfo(shutdown).Length <= 4096
                    && JsonRead.Int(File.ReadAllText(shutdown), "pid", -1) == Pid)
                {
                    EditorApplication.Exit(0);
                }
            }
            catch { /* Transient file writes are retried on the next tick. */ }
        }
    }
}
