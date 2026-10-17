// Isolated real acceptance: production cover IPC, SQLite, Electron nativeImage,
// and the real Unity package worker. No application boot/discovery or user assets.
// Run fixtures only (Node ABI is fine): node tools/verify-cover-tasks-live.cjs --fixtures-only
// After installing the Electron SQLite ABI: node tools/verify-cover-tasks-live.cjs
// Reuse retained fixtures: node tools/verify-cover-tasks-live.cjs --reuse=<printed sandbox>
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const evidenceRoot = path.join(root, 'tmp', 'all-covers', 'live');
const editor = path.resolve(process.env.ATRIUM_PACKAGE_EDITOR || 'E:/wn/Unity Hub/2022.3.22f1/Editor/Unity.exe');
const TIMEOUT_MS = 12 * 60_000;
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertOwnedRun(run) {
  const relative = path.relative(evidenceRoot, run);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Sandbox must be inside tmp/all-covers/live');
  assert.match(path.basename(run), /^avca-sandbox-live-/);
  assert.ok(fs.lstatSync(run).isDirectory() && !fs.lstatSync(run).isSymbolicLink());
  assert.equal(fs.realpathSync(run).toLowerCase(), path.resolve(run).toLowerCase());
}

function runOwned(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, env: options.env || process.env });
    let timedOut = false;
    const output = options.output ? fs.createWriteStream(options.output) : null;
    const capture = bytes => { output?.write(bytes); process.stdout.write(bytes); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    const beat = setInterval(() => console.log('[COVER_TASKS_LIVE] waiting for owned ' + (options.label || 'child') + ' pid=' + child.pid), 20_000);
    const interrupt = () => child.kill();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const finish = error => {
      clearTimeout(timer); clearInterval(beat);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      output?.end();
      if (error) reject(error); else resolve();
    };
    child.once('error', finish);
    child.once('exit', (code, signal) => finish(timedOut ? new Error('Owned child exceeded 12 minutes') : code === 0 ? null : new Error('Owned child failed: code=' + code + ', signal=' + signal)));
  });
}

const FACTORY_CS = `using System;
using System.IO;
using UnityEditor;
using UnityEngine;

// This script stays only in the fixture factory, never in an exported package.
public static class AtriumCoverTaskFixtures {
    public static void Create() {
        string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
        string output = Path.Combine(project, "..", "sources");
        Directory.CreateDirectory(output);
        AssetDatabase.CreateFolder("Assets", "CoverFixtures");
        string single = Make("SingleGreenCube", new Color(0.16f, 0.8f, 0.35f), new Vector3(1, 1, 1));
        string blue = Make("TallBlueCube", new Color(0.15f, 0.35f, 0.95f), new Vector3(0.65f, 1.6f, 0.65f));
        string orange = Make("WideOrangeCube", new Color(0.95f, 0.4f, 0.08f), new Vector3(1.6f, 0.6f, 0.85f));
        AssetDatabase.SaveAssets();
        AssetDatabase.ExportPackage(new[] { single }, Path.Combine(output, "one-cube.unitypackage"), ExportPackageOptions.IncludeDependencies);
        AssetDatabase.ExportPackage(new[] { blue, orange }, Path.Combine(output, "two-cubes.unitypackage"), ExportPackageOptions.IncludeDependencies);
        Debug.Log("[ATRIUM_COVER_TASK_FIXTURES] Exported owned primitive-only packages");
    }
    private static string Make(string name, Color color, Vector3 scale) {
        Shader shader = Shader.Find("Standard");
        if (shader == null) throw new InvalidOperationException("Standard shader missing");
        var material = new Material(shader) { name = name + "Material", color = color };
        material.SetFloat("_Metallic", 0);
        material.SetFloat("_Glossiness", 0.2f);
        string folder = "Assets/CoverFixtures/";
        AssetDatabase.CreateAsset(material, folder + name + ".mat");
        var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
        cube.name = name;
        cube.transform.localScale = scale;
        cube.GetComponent<Renderer>().sharedMaterial = material;
        UnityEngine.Object.DestroyImmediate(cube.GetComponent<Collider>());
        string prefab = folder + name + ".prefab";
        PrefabUtility.SaveAsPrefabAsset(cube, prefab);
        UnityEngine.Object.DestroyImmediate(cube);
        return prefab;
    }
}
`;

async function packagePaths(file) {
  const paths = [];
  await require('tar').t({ file, onentry: entry => {
    if (!entry.path.endsWith('/pathname')) { entry.resume(); return; }
    const chunks = [];
    entry.on('data', chunk => chunks.push(chunk));
    entry.on('end', () => paths.push(Buffer.concat(chunks).toString('utf8').trim()));
  } });
  return paths.sort();
}

async function prepareFixtures(run) {
  assertOwnedRun(run);
  assert.ok(fs.statSync(editor).isFile(), 'Set ATRIUM_PACKAGE_EDITOR to installed Unity 2022.3');
  const project = path.join(run, 'fixture-factory');
  fs.mkdirSync(path.join(project, 'Assets', 'Editor'), { recursive: true });
  fs.mkdirSync(path.join(project, 'Packages'), { recursive: true });
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true });
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n');
  writeJson(path.join(project, 'Packages', 'manifest.json'), { dependencies: {
    'com.unity.modules.physics': '1.0.0', 'com.unity.modules.imageconversion': '1.0.0'
  } });
  fs.writeFileSync(path.join(project, 'Assets', 'Editor', 'AtriumCoverTaskFixtures.cs'), FACTORY_CS);
  console.log('[COVER_TASKS_LIVE] creating synthetic Unity packages in ' + run);
  await runOwned(editor, ['-batchmode', '-projectPath', project, '-executeMethod', 'AtriumCoverTaskFixtures.Create', '-quit', '-logFile', path.join(run, 'fixture-factory.log')], { label: 'Unity fixture factory' });
  const fixtures = [];
  for (const [name, expected] of [['one-cube.unitypackage', ['SingleGreenCube']], ['two-cubes.unitypackage', ['TallBlueCube', 'WideOrangeCube']]]) {
    const file = path.join(run, 'sources', name), members = await packagePaths(file);
    const prefabs = members.filter(member => /\.prefab$/i.test(member));
    assert.deepEqual(prefabs.map(member => path.posix.basename(member, '.prefab')).sort(), expected.sort());
    assert.ok(members.every(member => member.startsWith('Assets/CoverFixtures')));
    assert.ok(!members.some(member => /\.(cs|dll|exe|asmdef|asmref)$/i.test(member)), 'No fixture script may reach source packages');
    const targets = prefabs.map(member => ({ path: member, guid: fs.readFileSync(path.join(project, member + '.meta'), 'utf8').match(/^guid:\s*([a-f0-9]{32})\s*$/m)?.[1] }));
    assert.ok(targets.every(target => target.guid));
    fixtures.push({ file, sha256: sha256(file), members, targets });
  }
  const manifest = { run, editor, unityVersion: '2022.3.22f1', createdAt: new Date().toISOString(), fixtureMethod: 'Unity APIs: primitive cubes + Standard materials + PrefabUtility + AssetDatabase.ExportPackage', fixtures };
  writeJson(path.join(run, 'fixtures.json'), manifest);
  console.log('[COVER_TASKS_LIVE] fixtures ready ' + path.join(run, 'fixtures.json'));
  return manifest;
}

function bundleProduction(run) {
  const bundle = path.join(run, 'production.cjs');
  require('esbuild').buildSync({ stdin: { contents: `
    export { registerCoverIpc } from './src/main/covers/ipc';
    export { BridgeManager } from './src/main/bridge/manager';
    export { migrate } from './src/main/db';
    export { setAppPathsForTest, P } from './src/main/services/paths';
    export { setSettings } from './src/main/services/settings';
    export { getCover } from './src/main/db/repos/covers';
    export { captureCoverSnapshot } from './src/main/db/repos/coverTasks';
    export { writeThumbFromBuffer, pruneThumbCache } from './src/main/library/thumbs';
  `, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'cjs' });
}

async function electronAcceptance(run) {
  assertOwnedRun(run);
  const { app, nativeImage } = require('electron');
  const appHome = path.resolve(process.env.AVCA_APP_HOME || '');
  assert.ok(appHome.startsWith(run + path.sep) && /^avca-sandbox-app-/.test(path.basename(appHome)), 'Explicit owned application home required');
  fs.mkdirSync(appHome, { recursive: true });
  fs.mkdirSync(path.join(appHome, 'logs'), { recursive: true });
  app.setPath('userData', appHome);
  app.setPath('logs', path.join(appHome, 'logs'));
  app.setAppPath(root);
  await app.whenReady();
  const prod = require(path.join(run, 'production.cjs'));
  prod.setAppPathsForTest(appHome);
  assert.equal(prod.P.root(), appHome);
  prod.setSettings({ unityExePath: editor, coverDependencyProjectId: '' });
  const db = new (require('better-sqlite3'))(path.join(appHome, 'library.db'));
  prod.migrate(db);
  const manifest = JSON.parse(fs.readFileSync(path.join(run, 'fixtures.json'), 'utf8'));
  assert.equal(manifest.editor.toLowerCase(), editor.toLowerCase());
  for (const fixture of manifest.fixtures) assert.equal(sha256(fixture.file), fixture.sha256);
  const handlers = new Map(), broadcasts = [], bridgeCalls = [], snapshots = [];
  let service, manager, watchdog, currentTask;
  const call = (name, ...args) => {
    const handler = handlers.get('covers:' + name);
    assert.equal(typeof handler, 'function', 'Missing production handler covers:' + name);
    return handler(...args);
  };
  const imageOf = id => db.prepare('SELECT cover_image FROM asset WHERE id=?').get(id)?.cover_image;
  const imageFile = url => {
    assert.match(url, /^athumb:\/\/[A-Za-z0-9_-]+\.jpg$/);
    return path.join(prod.P.thumbs(), url.slice('athumb://'.length));
  };
  const assertImage = (url, label) => {
    const file = imageFile(url), image = nativeImage.createFromPath(file);
    assert.ok(!image.isEmpty(), 'Real image does not decode: ' + label);
    const size = image.getSize();
    assert.equal(Math.max(size.width, size.height), 320, 'Production thumbnail must have 320px max edge');
    const pixels = image.toBitmap(), colors = new Set();
    for (let i = 0; i < pixels.length; i += 4 * 23) colors.add(pixels.subarray(i, i + 3).toString('hex'));
    assert.ok(colors.size > 10, 'Rendered cube must have visible non-uniform GPU content');
    const evidence = path.join(run, label + '.jpg'); fs.copyFileSync(file, evidence);
    return { url, file: evidence, sha256: sha256(file), ...size, sampledColors: colors.size };
  };
  const solidPng = color => {
    const bitmap = Buffer.alloc(400 * 400 * 4);
    for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = color[2]; bitmap[i + 1] = color[1]; bitmap[i + 2] = color[0]; bitmap[i + 3] = 255; }
    return nativeImage.createFromBitmap(bitmap, { width: 400, height: 400, scaleFactor: 1 }).toPNG();
  };
  const addAsset = (id, source, cover = 'none') => db.prepare(`INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,source_path,cover_image,created_at,updated_at)
    VALUES(?,?,?,'props','classified','index',1,?,?,?,?)`).run(id, id, id, source, cover, Date.now(), Date.now());
  const startServices = () => {
    handlers.clear(); manager = new prod.BridgeManager();
    const original = manager.execute.bind(manager);
    manager.execute = async (...args) => {
      const startedAt = Date.now(), result = await original(...args);
      bridgeCalls.push({ project: args[0], type: args[1], startedAt, elapsedMs: Date.now() - startedAt, ok: result.ok, error: result.error, data: result.data });
      assert.ok(path.resolve(args[0]).toLowerCase().startsWith(path.resolve(appHome, 'cover-previews').toLowerCase() + path.sep));
      console.log('[COVER_TASKS_LIVE] real Unity ' + args[1] + ': ' + (result.ok ? 'ok' : result.error));
      return result;
    };
    service = prod.registerCoverIpc(db, manager, { ipc: { handle: (channel, handler) => handlers.set(channel, handler) }, broadcast: (channel, payload) => broadcasts.push({ channel, payload }) });
  };
  const stopServices = async () => {
    for (const project of new Set(bridgeCalls.map(call => call.project))) {
      for (const relative of ['Logs/package-preview.log', 'Temp/AVCABridge/bridge.json', 'Temp/AVCABridge/package-worker-owner.json', '.atrium-cover-preview.json']) {
        const file = path.join(project, relative);
        if (!fs.existsSync(file)) continue;
        const destination = path.join(run, 'worker-evidence', path.basename(project), relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(file, destination);
      }
    }
    if (service) { const provider = service.deps?.packageProvider; service.dispose(); await provider?.dispose(); service = null; }
    manager?.dispose(); manager = null;
  };
  const settled = async id => {
    let previous = '';
    for (;;) {
      const task = await call('task-status', id);
      assert.ok(task, 'Task status disappeared');
      const summary = task.items.map(item => item.assetId + ':' + item.state).join(', ');
      if (summary !== previous) { console.log('[COVER_TASKS_LIVE] ' + summary); previous = summary; }
      if (!task.running) { snapshots.push(structuredClone(task)); return task; }
      await sleep(150);
    }
  };
  const onlyItem = (task, id) => { const item = task.items.find(item => item.assetId === id); assert.ok(item, 'Task omitted ' + id); return item; };
  let result;
  try {
    watchdog = setTimeout(() => { console.error('[COVER_TASKS_LIVE] child deadline'); service?.dispose(); manager?.dispose(); app.exit(1); }, TIMEOUT_MS - 5000);
    startServices();
    assert.ok((await call('package-status')).available, 'Configured real Unity editor missing');
    const single = manifest.fixtures.find(f => f.targets.length === 1), multiple = manifest.fixtures.find(f => f.targets.length === 2);
    addAsset('single-auto', single.file); addAsset('multiple-review', multiple.file);
    const product = prod.writeThumbFromBuffer(solidPng([180, 80, 100]), 'fixture-product'); assert.ok(product.ok);
    addAsset('protected-product', single.file, product.url);
    addAsset('protected-manual', single.file);
    const beforeManual = path.join(run, 'manual-before.png'); fs.writeFileSync(beforeManual, solidPng([60, 120, 210]));
    await call('upload', 'protected-manual', beforeManual);
    const protectedBefore = ['protected-product', 'protected-manual'].map(id => ({ id, snapshot: prod.captureCoverSnapshot(db, id), hash: sha256(imageFile(imageOf(id))) }));
    assert.equal(prod.getCover(db, 'single-auto'), null, 'Unique fixture must start without association');
    assert.equal(prod.getCover(db, 'multiple-review'), null);
    currentTask = await call('start-task', { scope: 'all' });
    let completed = await settled(currentTask.id);
    assert.equal(completed.items.length, 4);
    assert.equal(onlyItem(completed, 'single-auto').state, 'done');
    assert.equal(onlyItem(completed, 'multiple-review').state, 'review');
    assert.equal(imageOf('multiple-review'), 'none', 'Many candidates must keep original until selection');
    assert.equal(prod.getCover(db, 'multiple-review'), null);
    for (const item of protectedBefore) {
      assert.equal(onlyItem(completed, item.id).state, 'skipped');
      assert.deepEqual(prod.captureCoverSnapshot(db, item.id), item.snapshot);
      assert.equal(sha256(imageFile(imageOf(item.id))), item.hash);
    }
    const autoRecord = prod.getCover(db, 'single-auto');
    assert.equal(autoRecord.source, 'package');
    assert.equal(autoRecord.target.sourceGuid, single.targets[0].guid);
    assert.equal(autoRecord.projectId, null, 'Internal preview project must not become a persisted user project association');
    const automaticImage = assertImage(imageOf('single-auto'), 'unique-auto');
    const choices = await call('task-choices', currentTask.id, 'multiple-review', 0);
    assert.equal(choices.total, 2); assert.ok(choices.choices.length > 0 && choices.choices.length <= 8);
    assert.equal(choices.truncated, false);
    assert.deepEqual(choices.choices.map(choice => choice.target.sourceGuid).sort(), multiple.targets.map(target => target.guid).sort());
    const candidateImages = choices.choices.map((choice, index) => {
      assert.equal(choice.error, null); assert.ok(choice.preview); assert.equal(choice.preview.rendererCount, 1);
      return assertImage(choice.preview.url, 'candidate-' + index);
    });
    assert.notEqual(candidateImages[0].sha256, candidateImages[1].sha256, 'Distinct cube choices must produce distinct images');
    assert.equal(imageOf('multiple-review'), 'none', 'Generating choices must not save');
    const chosen = choices.choices[1];
    await call('apply-task-choice', currentTask.id, 'multiple-review', chosen.target.id);
    const selected = prod.captureCoverSnapshot(db, 'multiple-review');
    assert.equal(selected.record.source, 'package'); assert.equal(selected.record.target.id, chosen.target.id);
    assert.equal(selected.record.target.sourceGuid, chosen.target.sourceGuid);
    const selectedImage = assertImage(selected.image, 'selected-choice');
    assert.equal(selectedImage.sha256, candidateImages[1].sha256, 'Click applies the displayed candidate image');
    assert.equal(onlyItem(await call('task-status', currentTask.id), 'multiple-review').state, 'done');

    // A fresh production service/provider proves association reuse after restart.
    await stopServices(); startServices();
    assert.deepEqual(prod.captureCoverSnapshot(db, 'multiple-review'), selected);
    const reuse = await call('start-task', { scope: 'ids', assetIds: ['multiple-review'] });
    completed = await settled(reuse.id);
    assert.equal(onlyItem(completed, 'multiple-review').state, 'done', 'Persisted association must bypass manual review');
    assert.equal(prod.getCover(db, 'multiple-review').target.id, chosen.target.id);
    assert.notEqual(imageOf('multiple-review'), selected.image, 'Existing generated covers are refreshed');
    const refreshedImage = assertImage(imageOf('multiple-review'), 'refreshed-association');
    prod.pruneThumbCache(db);
    assert.ok(fs.existsSync(imageFile(selected.image)), 'Task undo image must survive cache pruning');
    const undo = await call('undo-task', reuse.id);
    assert.deepEqual(undo, { restored: 1, preserved: 0 });
    assert.deepEqual(prod.captureCoverSnapshot(db, 'multiple-review'), selected, 'Undo must restore complete previous association and image');
    assert.equal(sha256(imageFile(selected.image)), selectedImage.sha256);

    const laterTask = await call('start-task', { scope: 'ids', assetIds: ['multiple-review'] });
    assert.equal(onlyItem(await settled(laterTask.id), 'multiple-review').state, 'done');
    const manualAfter = path.join(run, 'manual-after.png'); fs.writeFileSync(manualAfter, solidPng([220, 175, 70]));
    await call('upload', 'multiple-review', manualAfter);
    const afterManual = prod.captureCoverSnapshot(db, 'multiple-review');
    const preserved = await call('undo-task', laterTask.id);
    assert.deepEqual(preserved, { restored: 0, preserved: 1 });
    assert.deepEqual(prod.captureCoverSnapshot(db, 'multiple-review'), afterManual, 'Later manual upload must survive task undo');
    const initialUndo = await call('undo-task', currentTask.id);
    assert.deepEqual(initialUndo, { restored: 1, preserved: 1 });
    assert.equal(imageOf('single-auto'), 'none'); assert.equal(prod.getCover(db, 'single-auto'), null);
    assert.deepEqual(prod.captureCoverSnapshot(db, 'multiple-review'), afterManual);
    for (const fixture of manifest.fixtures) assert.equal(sha256(fixture.file), fixture.sha256, 'Synthetic source package changed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM import_log').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project').get().n, 0, 'Internal preview workers must never become user project rows');
    assert.ok(bridgeCalls.some(call => call.type === 'get_preview_candidates' && call.ok));
    assert.ok(bridgeCalls.filter(call => call.type === 'render_preview' && call.ok).length >= 5);
    assert.ok(broadcasts.some(event => event.channel === 'data:changed' && event.payload.reason === 'cover'));
    result = { status: 'PASS', run, at: new Date().toISOString(), electron: process.versions.electron, nodeAbi: process.versions.modules,
      sqlite: db.prepare('SELECT sqlite_version() AS version').get().version, editor,
      method: 'Production registerCoverIpc + CoverTasks + CoverService + PackageCoverProvider + BridgeManager, real disk SQLite/nativeImage and real Unity GPU worker; no provider/bridge mocks',
      checks: { uniqueAutoSaved: true, multipleReviewUnchanged: true, actualCandidateImages: true, candidatePageBound: 8, selectedImageApplied: true, associationReusedAfterServiceRestart: true,
        productAndManualProtected: true, exactUndoImageAndMetadata: true, laterManualEditPreserved: true, undoImagesSurvivePrune: true, originalsSha256Unchanged: true, importLogEmpty: true, internalProjectRows: 0, maxThumbnailEdge: 320 },
      automaticImage, candidateImages, selectedImage, refreshedImage, undo, preserved, initialUndo, protectedBefore, snapshots, bridgeCalls,
      notLiveValidated: ['UI navigation is validated separately by the renderer agent', '>500 rows, cancellation/retry and source-change races are covered by production regression tests, not this expensive Unity run'] };
    writeJson(path.join(run, 'evidence.json'), result);
    console.log('[ATRIUM_COVER_TASKS_LIVE] PASS ' + path.join(run, 'evidence.json'));
  } catch (error) {
    writeJson(path.join(run, 'failure.json'), { status: 'FAIL', at: new Date().toISOString(), error: error.stack, snapshots, bridgeCalls });
    console.error(error.stack);
    throw error;
  } finally {
    clearTimeout(watchdog); await stopServices();
    db.close();
    app.exit(result ? 0 : 1);
  }
}

async function main() {
  if (process.argv.includes('--electron-child')) return electronAcceptance(path.resolve(process.argv[process.argv.indexOf('--electron-child') + 1]));
  assert.ok(!process.versions.electron, 'Launch parent with Node');
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const reuse = process.argv.find(arg => arg.startsWith('--reuse='));
  const run = reuse ? path.resolve(reuse.slice('--reuse='.length)) : fs.realpathSync(fs.mkdtempSync(path.join(evidenceRoot, 'avca-sandbox-live-')));
  assertOwnedRun(run);
  if (!reuse) await prepareFixtures(run);
  else {
    const manifest = JSON.parse(fs.readFileSync(path.join(run, 'fixtures.json'), 'utf8'));
    for (const fixture of manifest.fixtures) assert.equal(sha256(fixture.file), fixture.sha256, 'Retained fixture changed');
  }
  if (process.argv.includes('--fixtures-only')) return;
  bundleProduction(run);
  if (process.argv.includes('--bundle-only')) {
    console.log('[COVER_TASKS_LIVE] production bundle ready ' + path.join(run, 'production.cjs'));
    return;
  }
  const env = { ...process.env, AVCA_APP_HOME: fs.mkdtempSync(path.join(run, 'avca-sandbox-app-')), AVCA_REQUIRE_SANDBOX_HOME: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  await runOwned(require('electron'), [__filename, '--electron-child', run], { env, output: path.join(run, 'electron-output.log'), label: 'Electron verification' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(run, 'evidence.json'), 'utf8')).status, 'PASS');
}

main().catch(error => {
  console.error(error.stack);
  if (process.versions.electron) require('electron').app.exit(1);
  else process.exitCode = 1;
});
