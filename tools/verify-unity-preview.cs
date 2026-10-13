// Copy into the isolated test project's Assets/Editor, never the user's avatar project.
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

public static class AtriumPreviewVerification
{
    // Keep only the disposable test editor alive for actual file-mailbox/UI verification.
    public static void Serve()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Valentines/Valentines.prefab");
        Check(prefab != null, "Chocolate fixture missing");
        Selection.activeObject = prefab;
        Debug.Log("[ATRIUM_PREVIEW_SERVER] READY");
    }
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    [Serializable] private sealed class CandidateTarget
    {
        public string id;
        public string name;
        public string path;
        public bool persistent;
        public bool isScene;
        public string sourceGuid;
    }
    [Serializable] private sealed class CandidateResult
    {
        public CandidateTarget[] targets;
        public bool truncated;
    }
    private static CandidateResult CandidateCall(MethodInfo method, params string[] guids)
    {
        string payload = "{\"guids\":[" + string.Join(",", guids.Select(g => "\"" + g + "\"")) + "]}";
        return JsonUtility.FromJson<CandidateResult>((string)method.Invoke(null, new object[] { payload }));
    }
    private static void CandidateRejects(MethodInfo method, string payload)
    {
        try { method.Invoke(null, new object[] { payload }); throw new Exception("Invalid candidate request returned success: " + payload); }
        catch (TargetInvocationException e) { Check(e.InnerException.Message == "covers.invalidRequest", "Wrong candidate request error"); }
    }

    // Independent entry point: the baseline bridge must fail on the missing API before any setup.
    public static void RunCandidates()
    {
        const string folder = "Assets/__AtriumCandidateVerification";
        var selected = Selection.objects;
        bool createdFolder = false;
        try
        {
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("AVCA.Bridge.AVCAPreview")).FirstOrDefault(t => t != null);
            Check(type != null, "Object preview renderer is not implemented");
            var candidates = type.GetMethod("Candidates", BindingFlags.Public | BindingFlags.Static);
            Check(candidates != null, "Automatic cover candidate API is missing");
            Check(!AssetDatabase.IsValidFolder(folder), "Candidate fixture folder must be absent before verification");
            AssetDatabase.CreateFolder("Assets", "__AtriumCandidateVerification");
            createdFolder = true;
            AssetDatabase.CreateFolder(folder, "OtherResource");
            var requested = GameObject.CreatePrimitive(PrimitiveType.Cube);
            requested.name = "Exact GUID fixture";
            PrefabUtility.SaveAsPrefabAsset(requested, folder + "/Requested.prefab");
            PrefabUtility.SaveAsPrefabAsset(requested, folder + "/OtherResource/Requested.prefab");
            UnityEngine.Object.DestroyImmediate(requested);
            var empty = new GameObject("No geometry");
            PrefabUtility.SaveAsPrefabAsset(empty, folder + "/Empty.prefab");
            UnityEngine.Object.DestroyImmediate(empty);
            var hidden = new GameObject("Inactive descendant only");
            var hiddenCube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            hiddenCube.transform.SetParent(hidden.transform);
            hiddenCube.SetActive(false);
            PrefabUtility.SaveAsPrefabAsset(hidden, folder + "/Hidden.prefab");
            UnityEngine.Object.DestroyImmediate(hidden);
            var disabled = GameObject.CreatePrimitive(PrimitiveType.Cube);
            disabled.GetComponent<MeshRenderer>().enabled = false;
            PrefabUtility.SaveAsPrefabAsset(disabled, folder + "/Disabled.prefab");
            UnityEngine.Object.DestroyImmediate(disabled);
            var noMesh = GameObject.CreatePrimitive(PrimitiveType.Cube);
            noMesh.GetComponent<MeshFilter>().sharedMesh = null;
            PrefabUtility.SaveAsPrefabAsset(noMesh, folder + "/NoMesh.prefab");
            UnityEngine.Object.DestroyImmediate(noMesh);
            var material = new Material(Shader.Find("Standard"));
            AssetDatabase.CreateAsset(material, folder + "/Excluded.mat");
            string requestedGuid = AssetDatabase.AssetPathToGUID(folder + "/Requested.prefab");
            string emptyGuid = AssetDatabase.AssetPathToGUID(folder + "/Empty.prefab");
            string materialGuid = AssetDatabase.AssetPathToGUID(folder + "/Excluded.mat");
            string hiddenGuid = AssetDatabase.AssetPathToGUID(folder + "/Hidden.prefab");
            string disabledGuid = AssetDatabase.AssetPathToGUID(folder + "/Disabled.prefab");
            string noMeshGuid = AssetDatabase.AssetPathToGUID(folder + "/NoMesh.prefab");
            var script = AssetDatabase.FindAssets("t:MonoScript", new[] { "Assets" }).FirstOrDefault();
            Check(script != null, "Verification script fixture missing");
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(folder + "/Requested.prefab");
            string sourceBefore = EditorJsonUtility.ToJson(source);
            string prefabBefore = File.ReadAllText(folder + "/Requested.prefab");
            var scene = SceneManager.GetActiveScene();
            bool dirtyBefore = scene.isDirty;
            int rootsBefore = scene.rootCount;
            Selection.activeObject = source;
            var result = CandidateCall(candidates, requestedGuid, requestedGuid.ToUpperInvariant(),
                "ffffffffffffffffffffffffffffffff", materialGuid, script, emptyGuid, hiddenGuid, disabledGuid, noMeshGuid);
            Check(result.targets != null && result.targets.Length == 1 && !result.truncated, "Exact GUID filtering/duplicate exclusion failed");
            var target = result.targets[0];
            Check(target.sourceGuid == requestedGuid && target.path == folder + "/Requested.prefab", "Candidate resolved a same-name asset instead of the requested GUID");
            Check(!string.IsNullOrEmpty(target.name) && target.persistent && !target.isScene, "Candidate target metadata is wrong");
            var resolve = type.GetMethod("Resolve", BindingFlags.Public | BindingFlags.Static);
            Check(resolve != null && (GameObject)resolve.Invoke(null, new object[] { target.id }) == source, "Candidate ID cannot resolve the imported source");
            Check(scene.isDirty == dirtyBefore && scene.rootCount == rootsBefore, "Candidate discovery changed the source scene");
            Check(Selection.activeObject == source, "Candidate discovery changed selection");
            Check(EditorJsonUtility.ToJson(source) == sourceBefore && File.ReadAllText(folder + "/Requested.prefab") == prefabBefore, "Candidate discovery modified its source prefab");
            Check(CandidateCall(candidates).targets.Length == 0, "Empty GUID list found unrelated assets");
            CandidateRejects(candidates, "{}");
            CandidateRejects(candidates, "{\"guids\":\"wrong type\"}");
            CandidateRejects(candidates, "{\"guids\":[\"not-a-guid\"]}");
            CandidateRejects(candidates, "{\"guids\":[\"" + requestedGuid + "\",2]}");
            CandidateRejects(candidates, "{\"guids\":[" + string.Join(",", Enumerable.Repeat("\"" + requestedGuid + "\"", 501)) + "]}");
            var limitGuids = new string[51];
            for (int i = 0; i < limitGuids.Length; i++)
            {
                string path = folder + "/Limit" + i + ".prefab";
                AssetDatabase.CopyAsset(folder + "/Requested.prefab", path);
                limitGuids[i] = AssetDatabase.AssetPathToGUID(path);
            }
            var exactLimit = CandidateCall(candidates, limitGuids.Take(50).ToArray());
            Check(exactLimit.targets.Length == 50 && !exactLimit.truncated, "Exactly 50 candidates were incorrectly truncated");
            var overLimit = CandidateCall(candidates, limitGuids);
            Check(overLimit.targets.Length == 50 && overLimit.truncated, "Candidate limit failed to report truncation");
            Check(overLimit.targets.Select(t => t.sourceGuid).SequenceEqual(limitGuids.Take(50)), "Candidate discovery changed the supplied GUID order or hid a variant");
            // Optional existing FBX fixture exercises imported model roots without source edits.
            string modelGuid = AssetDatabase.AssetPathToGUID("Assets/Stick/fbx/stick_choco.fbx");
            if (!string.IsNullOrEmpty(modelGuid))
                Check(CandidateCall(candidates, modelGuid).targets.Single().sourceGuid == modelGuid, "Imported FBX candidate was dropped");
            else Debug.Log("[CANDIDATE_FBX] SKIP: optional licensed fixture not installed");
            Debug.Log("[ATRIUM_CANDIDATE_VERIFICATION] PASS");
        }
        catch (Exception e) { Debug.LogException(e); EditorApplication.Exit(1); return; }
        finally
        {
            Selection.objects = selected;
            if (createdFolder) AssetDatabase.DeleteAsset(folder);
        }
        EditorApplication.Exit(0);
    }

    public static void Run()
    {
        try
        {
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("AVCA.Bridge.AVCAPreview")).FirstOrDefault(t => t != null);
            Check(type != null, "Object preview renderer is not implemented");
            var render = type.GetMethod("Render", BindingFlags.Public | BindingFlags.Static);
            Check(render != null, "Render API is missing");
            var scene = SceneManager.GetActiveScene();
            var selected = Selection.objects;
            var root = GameObject.CreatePrimitive(PrimitiveType.Cube);
            root.name = "Cover verification cube";
            var shader = Shader.Find("Standard");
            var material = new Material(shader); material.color = Color.red;
            root.GetComponent<MeshRenderer>().sharedMaterial = material;
            var originalMaterial = EditorJsonUtility.ToJson(material);
            Selection.activeGameObject = root;
            var dirtyBefore = scene.isDirty;
            int previewScenes = SceneManager.sceneCount;
            int meshesBefore = Resources.FindObjectsOfTypeAll<Mesh>().Length;
            string directory = Path.Combine(Directory.GetCurrentDirectory(), "PreviewEvidence");
            Directory.CreateDirectory(directory);
            for (int i = 0; i < 3; i++)
            {
                var file = Path.Combine(directory, "cube-" + i + ".png");
                render.Invoke(null, new object[] { root, file, "front", i == 1 ? "light" : "dark" });
                var bytes = File.ReadAllBytes(file);
                var image = new Texture2D(2, 2); image.LoadImage(bytes);
                Check(image.width == 640 && image.height == 480, "Preview dimensions are wrong");
                var pixels = image.GetPixels();
                Check(pixels.Count(c => c.r > c.g * 1.8f && c.r > c.b * 1.8f) > 1000, "Cube was not rendered in red");
                UnityEngine.Object.DestroyImmediate(image);
                Check(scene.isDirty == dirtyBefore, "Source scene dirty state changed");
                Check(Selection.activeGameObject == root, "Selection changed");
                Check(EditorJsonUtility.ToJson(material) == originalMaterial, "Source material changed");
                Check(SceneManager.sceneCount == previewScenes, "Preview scene leaked");
            }
            Check(Resources.FindObjectsOfTypeAll<Mesh>().Length == meshesBefore, "Preview mesh leaked");
            // Skin baking and renderer-wide property blocks must be copied into the preview.
            var skinObject = new GameObject("Skin fixture");
            var skin = skinObject.AddComponent<SkinnedMeshRenderer>();
            var skinMesh = UnityEngine.Object.Instantiate(root.GetComponent<MeshFilter>().sharedMesh);
            var weights = new BoneWeight[skinMesh.vertexCount];
            for (int i = 0; i < weights.Length; i++) weights[i] = new BoneWeight { boneIndex0 = 0, weight0 = 1 };
            skinMesh.boneWeights = weights; skinMesh.bindposes = new[] { Matrix4x4.identity };
            skin.sharedMesh = skinMesh; skin.bones = new[] { skinObject.transform }; skin.rootBone = skinObject.transform;
            skin.sharedMaterial = material;
            var properties = new MaterialPropertyBlock(); properties.SetColor("_Color", Color.green); skin.SetPropertyBlock(properties);
            int skinMeshesBefore = Resources.FindObjectsOfTypeAll<Mesh>().Length;
            var skinFile = Path.Combine(directory, "skin.png");
            render.Invoke(null, new object[] { skinObject, skinFile, "front", "dark" });
            var skinImage = new Texture2D(2, 2); skinImage.LoadImage(File.ReadAllBytes(skinFile));
            Check(skinImage.GetPixels().Count(c => c.g > c.r * 1.8f && c.g > c.b * 1.8f) > 1000, "Skinned mesh property block was not rendered");
            UnityEngine.Object.DestroyImmediate(skinImage);
            Check(Resources.FindObjectsOfTypeAll<Mesh>().Length == skinMeshesBefore, "Baked skin mesh leaked");
            Check(EditorJsonUtility.ToJson(material) == originalMaterial, "Skin capture changed source material");
            UnityEngine.Object.DestroyImmediate(skinObject); UnityEngine.Object.DestroyImmediate(skinMesh);
            // Blendshape-only props have no bones (the real Pocky asset uses this layout).
            var shapeObject = new GameObject("Blendshape-only fixture");
            var shapeRenderer = shapeObject.AddComponent<SkinnedMeshRenderer>();
            var shapeMesh = UnityEngine.Object.Instantiate(root.GetComponent<MeshFilter>().sharedMesh);
            var deltas = Enumerable.Repeat(Vector3.right * 0.1f, shapeMesh.vertexCount).ToArray();
            shapeMesh.AddBlendShapeFrame("Bite", 100, deltas, null, null);
            shapeRenderer.sharedMesh = shapeMesh; shapeRenderer.sharedMaterial = material;
            var shapeBounds = shapeMesh.bounds;
            int shapeMeshesBefore = Resources.FindObjectsOfTypeAll<Mesh>().Length;
            int shapeScenesBefore = SceneManager.sceneCount;
            var shapeFile = Path.Combine(directory, "blendshape-only.png");
            var diagnosticBake = new Mesh(); shapeRenderer.BakeMesh(diagnosticBake, false);
            Debug.Log("[BLENDSHAPE_ONLY] source=" + shapeMesh.bounds + " baked=" + diagnosticBake.bounds + " vertices=" + diagnosticBake.vertexCount);
            UnityEngine.Object.DestroyImmediate(diagnosticBake);
            render.Invoke(null, new object[] { shapeObject, shapeFile, "front", "dark" });
            var shapeImage = new Texture2D(2, 2); shapeImage.LoadImage(File.ReadAllBytes(shapeFile));
            Check(shapeImage.GetPixels().Count(c => c.r > c.g * 1.8f && c.r > c.b * 1.8f) > 1000, "Blendshape-only object did not render");
            UnityEngine.Object.DestroyImmediate(shapeImage);
            Check(shapeMesh.bounds == shapeBounds, "Source mesh bounds changed");
            Check(Resources.FindObjectsOfTypeAll<Mesh>().Length == shapeMeshesBefore, "Blendshape snapshot mesh leaked");
            Check(SceneManager.sceneCount == shapeScenesBefore, "Blendshape preview scene leaked");
            Check(EditorJsonUtility.ToJson(material) == originalMaterial, "Blendshape source material changed");
            UnityEngine.Object.DestroyImmediate(shapeObject); UnityEngine.Object.DestroyImmediate(shapeMesh);
            // Imported, bone-free, blendshape-only mesh from the actual failing prop.
            var stickMesh = AssetDatabase.LoadAllAssetsAtPath("Assets/Stick/fbx/stick_choco.fbx").OfType<Mesh>().FirstOrDefault();
            if (stickMesh != null)
            {
            var stickBoundsBefore = stickMesh.bounds;
            var stickObject = new GameObject("Pocky fixture");
            stickObject.transform.localScale = Vector3.one * 100;
            var stickSkin = stickObject.AddComponent<SkinnedMeshRenderer>(); stickSkin.sharedMesh = stickMesh;
            stickSkin.sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/Stick/material/stick_choco.mat");
            var stickBake = new Mesh(); stickSkin.BakeMesh(stickBake, false);
            Debug.Log("[POCKY_BAKE] source=" + stickMesh.bounds + " baked=" + stickBake.bounds + " vertex0=" + stickBake.vertices[0] + " vertices=" + stickBake.vertexCount + " shapes=" + stickMesh.blendShapeCount);
            UnityEngine.Object.DestroyImmediate(stickBake);
            int stickMeshesBefore = Resources.FindObjectsOfTypeAll<Mesh>().Length;
            int stickScenesBefore = SceneManager.sceneCount;
            render.Invoke(null, new object[] { stickObject, Path.Combine(directory, "pocky.png"), "right", "dark" });
            var stickImage = new Texture2D(2, 2); stickImage.LoadImage(File.ReadAllBytes(Path.Combine(directory, "pocky.png")));
            Check(stickImage.GetPixels().Count(c => c.r > c.g * 1.5f && c.r > c.b * 1.5f) > 2000, "Pocky output was empty");
            UnityEngine.Object.DestroyImmediate(stickImage);
            Check(stickMesh.bounds == stickBoundsBefore, "Source imported mesh bounds were modified");
            Check(Resources.FindObjectsOfTypeAll<Mesh>().Length == stickMeshesBefore, "Pocky snapshot mesh leaked");
            Check(SceneManager.sceneCount == stickScenesBefore, "Pocky preview scene leaked");
            UnityEngine.Object.DestroyImmediate(stickObject);
            }
            else Debug.Log("[POCKY_FIXTURE] SKIP: optional licensed mesh not installed");
            var empty = new GameObject("No renderable geometry");
            try { render.Invoke(null, new object[] { empty, Path.Combine(directory, "empty.png"), "front", "dark" }); throw new Exception("Empty target returned success"); }
            catch (TargetInvocationException e) { Check(e.InnerException.Message.Contains("covers.noMesh"), "Wrong error for empty target"); }
            UnityEngine.Object.DestroyImmediate(empty);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Valentines/Valentines.prefab");
            Check(prefab != null, "Chocolate fixture missing");
            foreach (string direction in new[] { "auto", "front", "back", "left", "top", "bottom" })
                render.Invoke(null, new object[] { prefab, Path.Combine(directory, "chocolate-" + direction + ".png"), direction, "dark" });
            UnityEngine.Object.DestroyImmediate(root); UnityEngine.Object.DestroyImmediate(material);
            Selection.objects = selected;
            File.WriteAllText(Path.Combine(directory, "result.json"), "{\"passed\":true,\"width\":640,\"height\":480,\"sceneUnchanged\":true,\"materialUnchanged\":true,\"selectionUnchanged\":true}");
            Debug.Log("[ATRIUM_PREVIEW_VERIFICATION] PASS");
            EditorApplication.Exit(0);
        }
        catch (Exception e) { Debug.LogException(e); EditorApplication.Exit(1); }
    }
}
