using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace AVCA.Bridge
{
    /// <summary>Static object photography. Never instantiate user scripts or modify source objects.</summary>
    public static class AVCAPreview
    {
        public const int Width = 640;
        public const int Height = 480;
        public sealed class Result { public int width = Width; public int height = Height; public int rendererCount; }
        private sealed class Part { public Renderer source; public Mesh mesh; public bool owned; public Matrix4x4 matrix; }

        public static string Targets(string payload)
        {
            var candidates = new List<GameObject>();
            string query = JsonRead.String(payload, "query").Trim();
            if (query.Length > 100) throw new InvalidOperationException("covers.invalidRequest");
            if (query.Length == 0)
            {
                foreach (var go in Selection.gameObjects)
                {
                    if (go != null && !candidates.Contains(go)) candidates.Add(go);
                    if (candidates.Count >= 50) break;
                }
            }
            else
            {
                foreach (string guid in AssetDatabase.FindAssets("t:GameObject " + query, new[] { "Assets" }))
                {
                    var go = AssetDatabase.LoadAssetAtPath<GameObject>(AssetDatabase.GUIDToAssetPath(guid));
                    if (go != null && !candidates.Contains(go)) candidates.Add(go);
                    if (candidates.Count >= 50) break;
                }
            }
            var sb = new StringBuilder("{\"targets\":[");
            for (int i = 0; i < candidates.Count; i++)
            {
                if (i != 0) sb.Append(',');
                sb.Append(Describe(candidates[i]));
            }
            return sb.Append("]}").ToString();
        }

        /// <summary>Resolve only already imported assets identified by the card's exact GUIDs.</summary>
        public static string Candidates(string payload)
        {
            string array = JsonRead.Array(payload, "guids");
            // StringArray alone tolerates other JSON values; this command accepts GUID strings only.
            if (array == null || !Regex.IsMatch(array,
                "^\\[\\s*(?:\"[0-9a-fA-F]{32}\"\\s*(?:,\\s*\"[0-9a-fA-F]{32}\"\\s*)*)?\\]$"))
                throw new InvalidOperationException("covers.invalidRequest");
            var guids = JsonRead.StringArray(payload, "guids");
            if (guids.Count > 500) throw new InvalidOperationException("covers.invalidRequest");
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var targets = new List<GameObject>();
            bool truncated = false;
            foreach (string guid in guids)
            {
                if (!seen.Add(guid)) continue;
                string path = AssetDatabase.GUIDToAssetPath(guid.ToLowerInvariant());
                if (!path.StartsWith("Assets/", StringComparison.Ordinal)
                    || (!path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)
                        && !path.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase))) continue;
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (go == null || !HasDrawableMesh(go)) continue;
                if (targets.Count == 50) { truncated = true; break; }
                targets.Add(go);
            }
            var sb = new StringBuilder("{\"targets\":[");
            for (int i = 0; i < targets.Count; i++)
            {
                if (i != 0) sb.Append(',');
                sb.Append(Describe(targets[i]));
            }
            return sb.Append("],\"truncated\":").Append(truncated ? "true" : "false").Append('}').ToString();
        }

        private static bool HasDrawableMesh(GameObject target)
        {
            var lowLods = LowerLods(target);
            foreach (var renderer in target.GetComponentsInChildren<Renderer>(true))
            {
                if (lowLods.Contains(renderer) || !VisibleBelow(renderer, target.transform)) continue;
                Mesh mesh = null;
                var skin = renderer as SkinnedMeshRenderer;
                if (skin != null) mesh = skin.sharedMesh;
                else if (renderer is MeshRenderer)
                {
                    var filter = renderer.GetComponent<MeshFilter>();
                    if (filter != null) mesh = filter.sharedMesh;
                }
                if (mesh != null && mesh.vertexCount > 0 && mesh.subMeshCount > 0) return true;
            }
            return false;
        }

        public static string Describe(GameObject go)
        {
            bool isScene = !EditorUtility.IsPersistent(go);
            bool persistent = !isScene || (go.scene.IsValid() && !string.IsNullOrEmpty(go.scene.path));
            var globalId = GlobalObjectId.GetGlobalObjectIdSlow(go);
            if (isScene && globalId.targetObjectId == 0) persistent = false;
            string id = persistent ? globalId.ToString() : "instance:" + go.GetInstanceID();
            var source = isScene ? PrefabUtility.GetCorrespondingObjectFromSource(go) : go;
            string sourcePath = source != null ? AssetDatabase.GetAssetPath(source) : "";
            string sourceGuid = string.IsNullOrEmpty(sourcePath) ? "" : AssetDatabase.AssetPathToGUID(sourcePath);
            string path = go.name;
            for (var p = go.transform.parent; p != null; p = p.parent) path = p.name + "/" + path;
            if (!isScene) path = sourcePath;
            return "{\"id\":" + JsonWrite.Quote(id) + ",\"name\":" + JsonWrite.Quote(go.name)
                + ",\"path\":" + JsonWrite.Quote(path) + ",\"persistent\":" + (persistent ? "true" : "false")
                + ",\"isScene\":" + (isScene ? "true" : "false") + ",\"sourceGuid\":"
                + (string.IsNullOrEmpty(sourceGuid) ? "null" : JsonWrite.Quote(sourceGuid)) + "}";
        }

        public static GameObject Resolve(string id)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 200) throw new InvalidOperationException("covers.targetMissing");
            GameObject go = null;
            if (id.StartsWith("instance:", StringComparison.Ordinal))
            {
                int instance;
                if (int.TryParse(id.Substring(9), out instance)) go = EditorUtility.InstanceIDToObject(instance) as GameObject;
            }
            else
            {
                GlobalObjectId global;
                if (GlobalObjectId.TryParse(id, out global)) go = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(global) as GameObject;
            }
            if (go == null) throw new InvalidOperationException("covers.targetMissing");
            return go;
        }

        public static string RenderCommand(string id, string payload, string bridgeRoot)
        {
            if (!Regex.IsMatch(id ?? "", "^[A-Za-z0-9_-]{1,100}$")) throw new InvalidOperationException("covers.invalidRequest");
            var target = Resolve(JsonRead.String(payload, "targetId"));
            string relative = "previews/" + id + ".png";
            string output = Path.Combine(bridgeRoot, "previews", id + ".png");
            var result = Render(target, output, JsonRead.String(payload, "direction"), JsonRead.String(payload, "background"));
            return "{\"relativePath\":" + JsonWrite.Quote(relative) + ",\"width\":" + result.width
                + ",\"height\":" + result.height + ",\"rendererCount\":" + result.rendererCount + "}";
        }

        private static bool VisibleBelow(Renderer renderer, Transform root)
        {
            if (!renderer.enabled || renderer.forceRenderingOff) return false;
            for (var p = renderer.transform; p != null && p != root; p = p.parent)
                if (!p.gameObject.activeSelf) return false;
            return true;
        }

        private static HashSet<Renderer> LowerLods(GameObject target)
        {
            var low = new HashSet<Renderer>();
            var high = new HashSet<Renderer>();
            foreach (var group in target.GetComponentsInChildren<LODGroup>(true))
            {
                var lods = group.GetLODs();
                for (int i = 0; i < lods.Length; i++) foreach (var renderer in lods[i].renderers)
                    if (renderer != null) { if (i == 0) high.Add(renderer); else low.Add(renderer); }
            }
            low.ExceptWith(high);
            return low;
        }

        private static IEnumerable<Vector3> Corners(Bounds bounds)
        {
            for (int i = 0; i < 8; i++) yield return bounds.center + Vector3.Scale(bounds.extents,
                new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1));
        }

        private static Quaternion ViewRotation(string direction, Bounds bounds)
        {
            switch (direction)
            {
                case "scene":
                    return SceneView.lastActiveSceneView != null ? SceneView.lastActiveSceneView.rotation : ViewRotation("auto", bounds);
                case "front": return Quaternion.Euler(0, 180, 0);
                case "back": return Quaternion.identity;
                case "left": return Quaternion.Euler(0, 90, 0);
                case "right": return Quaternion.Euler(0, -90, 0);
                case "top": return Quaternion.Euler(90, 0, 0);
                case "bottom": return Quaternion.Euler(-90, 0, 0);
                case "auto":
                    // Face the broadest side of the bounds rather than a thin edge.
                    if (bounds.size.y < bounds.size.x && bounds.size.y < bounds.size.z) return Quaternion.Euler(90, 0, 0);
                    if (bounds.size.x < bounds.size.z) return Quaternion.Euler(0, -90, 0);
                    return Quaternion.Euler(0, 180, 0);
                default: throw new InvalidOperationException("covers.invalidRequest");
            }
        }

        public static Result Render(GameObject target, string output, string direction, string background)
        {
            if (target == null) throw new InvalidOperationException("covers.targetMissing");
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("covers.unityBusy");
            if (GraphicsSettings.currentRenderPipeline != null) throw new InvalidOperationException("covers.pipelineUnsupported");
            if (string.IsNullOrEmpty(direction)) direction = "auto";
            if (string.IsNullOrEmpty(background)) background = "dark";
            if (background != "dark" && background != "light") throw new InvalidOperationException("covers.invalidRequest");
            var parts = new List<Part>();
            var materials = new List<Material>();
            PreviewRenderUtility preview = null;
            Texture2D image = null;
            var oldActive = RenderTexture.active;
            try
            {
                var lowLods = LowerLods(target);
                Bounds bounds = new Bounds(); bool hasBounds = false; int vertices = 0;
                foreach (var renderer in target.GetComponentsInChildren<Renderer>(true))
                {
                    if (lowLods.Contains(renderer) || !VisibleBelow(renderer, target.transform)) continue;
                    Mesh mesh = null; bool owned = false;
                    var skin = renderer as SkinnedMeshRenderer;
                    if (skin != null && skin.sharedMesh != null)
                    {
                        if (parts.Count >= 500 || (long)vertices + skin.sharedMesh.vertexCount > 2000000) throw new InvalidOperationException("covers.tooComplex");
                        mesh = new Mesh { hideFlags = HideFlags.HideAndDontSave }; owned = true;
                        // Register ownership before BakeMesh so a thrown bake is cleaned too.
                        parts.Add(new Part { source = renderer, mesh = mesh, owned = true, matrix = renderer.localToWorldMatrix });
                        skin.BakeMesh(mesh, false);
                        // Unity can leave BakeMesh bounds at zero for a bone-free,
                        // blendshape-only renderer even though its vertices are valid.
                        // Recalculate on this owned snapshot, never the source asset.
                        mesh.RecalculateBounds();
                    }
                    else if (renderer is MeshRenderer)
                    {
                        var filter = renderer.GetComponent<MeshFilter>();
                        if (filter != null) mesh = filter.sharedMesh;
                    }
                    if (mesh == null || mesh.vertexCount == 0 || mesh.subMeshCount == 0) continue;
                    if (!owned) parts.Add(new Part { source = renderer, mesh = mesh, owned = false, matrix = renderer.localToWorldMatrix });
                    vertices += mesh.vertexCount;
                    if (parts.Count > 500 || vertices > 2000000) throw new InvalidOperationException("covers.tooComplex");
                    foreach (var point in Corners(mesh.bounds))
                    {
                        var world = renderer.localToWorldMatrix.MultiplyPoint3x4(point);
                        if (float.IsNaN(world.x) || float.IsNaN(world.y) || float.IsNaN(world.z)
                            || float.IsInfinity(world.x) || float.IsInfinity(world.y) || float.IsInfinity(world.z))
                            throw new InvalidOperationException("covers.invalidBounds");
                        if (!hasBounds) { bounds = new Bounds(world, Vector3.zero); hasBounds = true; }
                        else bounds.Encapsulate(world);
                    }
                }
                if (!hasBounds || parts.Count == 0) throw new InvalidOperationException("covers.noMesh");
                if (bounds.size.magnitude < 0.000001f || bounds.size.magnitude > 1000000f) throw new InvalidOperationException("covers.invalidBounds");
                var rotation = ViewRotation(direction, bounds);
                var inverse = Quaternion.Inverse(rotation);
                float vertical = 0, horizontal = 0;
                foreach (var point in Corners(bounds))
                {
                    var p = inverse * (point - bounds.center);
                    vertical = Mathf.Max(vertical, Mathf.Abs(p.y)); horizontal = Mathf.Max(horizontal, Mathf.Abs(p.x));
                }
                preview = new PreviewRenderUtility();
                preview.ambientColor = new Color(0.5f, 0.5f, 0.5f, 1);
                preview.BeginStaticPreview(new Rect(0, 0, Width, Height));
                var camera = preview.camera;
                camera.orthographic = true; camera.aspect = Width / (float)Height;
                camera.orthographicSize = Mathf.Max(vertical, horizontal / camera.aspect) * 1.18f;
                camera.transform.rotation = rotation;
                float distance = Mathf.Max(bounds.size.magnitude * 3, 0.01f);
                camera.transform.position = -(rotation * Vector3.forward) * distance;
                camera.nearClipPlane = Mathf.Max(distance * 0.001f, 0.00001f);
                camera.farClipPlane = distance * 3;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = background == "light" ? new Color(0.91f, 0.92f, 0.94f, 1) : new Color(0.11f, 0.12f, 0.15f, 1);
                preview.lights[0].intensity = 1.1f;
                preview.lights[0].transform.rotation = rotation * Quaternion.Euler(30, 25, 0);
                preview.lights[1].intensity = 0.7f;
                preview.lights[1].transform.rotation = rotation * Quaternion.Euler(-25, -150, 0);
                foreach (var part in parts)
                {
                    var slots = part.source.sharedMaterials;
                    if (slots.Length == 0) throw new InvalidOperationException("covers.missingShader");
                    var matrix = Matrix4x4.Translate(-bounds.center) * part.matrix;
                    for (int slot = 0; slot < Mathf.Max(part.mesh.subMeshCount, slots.Length); slot++)
                    {
                        var source = slots[Mathf.Min(slot, slots.Length - 1)];
                        if (source == null || source.shader == null || !source.shader.isSupported || source.shader.name == "Hidden/InternalErrorShader")
                            throw new InvalidOperationException("covers.missingShader");
                        var material = new Material(source) { hideFlags = HideFlags.HideAndDontSave };
                        materials.Add(material);
                        var properties = new MaterialPropertyBlock();
                        part.source.GetPropertyBlock(properties, Mathf.Min(slot, slots.Length - 1));
                        if (properties.isEmpty) part.source.GetPropertyBlock(properties);
                        preview.DrawMesh(part.mesh, matrix, material, Mathf.Min(slot, part.mesh.subMeshCount - 1), properties);
                    }
                }
                preview.Render(false, false);
                image = preview.EndStaticPreview();
                if (image == null) throw new InvalidOperationException("covers.renderFailed");
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                string temporary = output + ".tmp";
                try { File.WriteAllBytes(temporary, image.EncodeToPNG()); if (File.Exists(output)) File.Delete(output); File.Move(temporary, output); }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
                return new Result { width = image.width, height = image.height, rendererCount = parts.Count };
            }
            finally
            {
                RenderTexture.active = oldActive;
                if (image != null) Object.DestroyImmediate(image);
                if (preview != null) preview.Cleanup();
                foreach (var material in materials) Object.DestroyImmediate(material);
                foreach (var part in parts) if (part.owned && part.mesh != null) Object.DestroyImmediate(part.mesh);
            }
        }
    }
}
