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
