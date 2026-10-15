const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'tmp', 'cover-verification');
const metadataFile = path.join(evidenceDir, 'actual-sample-clones.json');
const dependency = path.join(evidenceDir, 'unity-sandbox');
const editor = process.env.ATRIUM_PACKAGE_EDITOR;
const evidenceFile = path.join(evidenceDir, 'electron-package-integration-evidence.json');
const same = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const inside = (parent, file) => { const relative = path.relative(parent, path.resolve(file)); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// These are copied licensed inputs under ignored verification storage. Nothing
// is imported into the dependency project, and no cached inventory is seeded.
function samplesFromCopies() {
  const rows = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  assert.ok(Array.isArray(rows) && rows.length === 2, 'Provide the two copied licensed sample ZIPs');
  return rows.map((row, index) => {
    const source = path.resolve(row.source || row.file || '');
    assert.ok(inside(evidenceDir, source) && inside(evidenceDir, fs.realpathSync(source)), 'Source must be a copied verification ZIP');
    assert.ok(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink() && /\.zip$/i.test(source));
    const referencePath = /百奇|pocky/i.test(row.name) ? 'Assets/Stick/stick_choco_game_MA.prefab' : 'Assets/Valentines/Valentines.prefab';
    const expectedGuid = fs.readFileSync(path.join(dependency, referencePath + '.meta'), 'utf8').match(/^guid:\s*([a-f0-9]{32})\s*$/m)?.[1];
    assert.ok(expectedGuid, 'Reference metadata must supply the source GUID');
    return { id: 'package-live-' + index, name: 'Package ' + row.name, source, expectedGuid, targetId: 'package:' + expectedGuid, referencePath };
  });
}
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function dependencyHashes() {
  const files = {};
  const packageRoot = path.join(dependency, 'Packages', 'jp.lilxyzw.liltoon');
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name), relative = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), 'The dependency fixture must not contain links');
      if (entry.isDirectory()) walk(file, relative + '/');
      else if (entry.isFile()) files[relative] = hash(file);
    }
  };
  walk(packageRoot);
  return files;
}
function inputHashes(samples) {
  return { sources: Object.fromEntries(samples.map(sample => [sample.source, hash(sample.source)])),
    lilToon: dependencyHashes(), referenceMetadata: Object.fromEntries(samples.map(sample => [sample.referencePath, hash(path.join(dependency, sample.referencePath + '.meta'))])) };
}

// Verify shutdown by ownership-specific command lines, including workers that
// have not written a heartbeat yet. Never kill editors by process name or PID.
function ownedEditors(sandbox) {
  if (process.platform !== 'win32') throw Error('This acceptance fixture requires Windows Unity');
  const quoted = sandbox.replaceAll("'", "''");
  const command = `$taskPackageRoot = '${quoted}'; $taskRows = @(Get-CimInstance Win32_Process -Filter "Name = 'Unity.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($taskPackageRoot,[StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine.Contains('-avcaPackagePreview') } | Select-Object ProcessId,CommandLine); ConvertTo-Json -InputObject $taskRows -Compress`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
  return output ? JSON.parse(output) : [];
}
async function waitForOwnedShutdown(sandbox) {
  const started = Date.now();
  let workers = ownedEditors(sandbox);
  while (workers.length && Date.now() - started < 60000) { await pause(1000); workers = ownedEditors(sandbox); }
  assert.equal(workers.length, 0, 'Owned Unity workers must close before the next Electron stage: ' + JSON.stringify(workers));
  return { waitedMs: Date.now() - started, remainingOwnedEditors: 0 };
}

if (!process.versions.electron) {
  (async () => {
    assert.ok(editor && fs.existsSync(editor) && path.basename(editor).toLowerCase() === 'unity.exe', 'Set ATRIUM_PACKAGE_EDITOR to the installed Unity.exe');
    assert.ok(fs.existsSync(path.join(root, 'out/main/index.js')), 'Build production Electron bundles before launching this verifier');
    const samples = samplesFromCopies(), before = inputHashes(samples);
    const sandbox = fs.mkdtempSync(path.join(evidenceDir, 'avca-sandbox-package-integration-'));
    fs.mkdirSync(path.join(sandbox, 'Library')); fs.mkdirSync(path.join(sandbox, 'temp'));
    const manifest = path.join(sandbox, 'Local/VRChatCreatorCompanion/settings.json');
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ userProjects: [dependency] }));
    const env = { ...process.env, AVCA_APP_HOME: sandbox, AVCA_REQUIRE_SANDBOX_HOME: '1',
      APPDATA: path.join(sandbox, 'Roaming'), LOCALAPPDATA: path.join(sandbox, 'Local'), TEMP: path.join(sandbox, 'temp'), TMP: path.join(sandbox, 'temp') };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const stages = [];
    try {
      for (const stage of ['first', 'restart']) {
        console.log('[PACKAGE_INTEGRATION] starting ' + stage + ' in ' + sandbox);
        const resultFile = path.join(sandbox, 'integration-' + stage + '.json');
        let exitCode;
        try {
          exitCode = await new Promise((resolve, reject) => {
            const child = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [__filename],
              { cwd: root, env: { ...env, ATRIUM_PACKAGE_INTEGRATION_STAGE: stage }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
            const timer = setTimeout(() => { child.kill(); reject(Error('Package integration stage timed out after 20 minutes: ' + stage)); }, 1200000);
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => { clearTimeout(timer); resolve(code); });
          });
        } finally {
          const cleanup = await waitForOwnedShutdown(sandbox);
          console.log('[PACKAGE_INTEGRATION] owned Unity cleanup complete ' + JSON.stringify(cleanup));
          stages.push({ stage, cleanup });
        }
        assert.equal(exitCode, 0, 'Electron stage exited unsuccessfully: ' + stage);
        const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        assert.ok(result.ok, 'Electron stage failed: ' + JSON.stringify(result));
        stages.at(-1).result = result;
      }
      const after = inputHashes(samples);
      assert.deepEqual(after, before, 'Source ZIPs and dependency rendering resources must remain byte-identical');
      fs.writeFileSync(evidenceFile, JSON.stringify({ method: 'Compiled production Electron main/preload/React, isolated SQLite, original licensed ZIPs, standalone owned Unity workers, native image decoding and GUI clicks',
        sandbox, dependency, editor, samples, stages, inputHashesBefore: before, inputHashesAfter: after, sourceAndDependencyUnchanged: true }, null, 2));
      console.log('[ATRIUM_PACKAGE_INTEGRATION_ELECTRON] PASS first+restart');
    } finally {
      assert.deepEqual(inputHashes(samples), before, 'Verification must not mutate source ZIPs or the dependency fixture');
    }
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const samples = samplesFromCopies();
  const sandbox = process.env.AVCA_APP_HOME;
  const stage = process.env.ATRIUM_PACKAGE_INTEGRATION_STAGE;
  assert.ok(sandbox && inside(evidenceDir, sandbox) && path.basename(sandbox).startsWith('avca-sandbox-package-integration-'));
  assert.ok(['first', 'restart'].includes(stage));
  const resultFile = path.join(sandbox, 'integration-' + stage + '.json');
  const Module = require('node:module'), originalLoad = Module._load;
  Module._load = function (request, ...args) {
    const api = originalLoad.call(this, request, ...args);
    if (request !== 'electron') return api;
    return new Proxy(api, { get(target, key) {
      if (key !== 'BrowserWindow') return Reflect.get(target, key);
      return new Proxy(target.BrowserWindow, { construct(Window, [options]) {
        return new Window({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true } });
      } });
    } });
  };
  const { app, BrowserWindow, dialog, nativeImage } = require('electron');
  const Database = require('better-sqlite3');
  const manualImage = path.join(sandbox, 'manual-fixture.png');
  dialog.showOpenDialog = async options => ({ canceled: false, filePaths: [options?.filters?.some(filter => filter.extensions.includes('exe')) ? editor : manualImage] });
  dialog.showOpenDialogSync = options => [options?.filters?.some(filter => filter.extensions.includes('exe')) ? editor : manualImage];
  process.argv = [process.argv[0]];
  BrowserWindow.prototype.show = function () {}; BrowserWindow.prototype.focus = function () {};
  let checked = false;
  const writeResult = value => fs.writeFileSync(resultFile, JSON.stringify(value, null, 2));
  const decoded = (paths, url) => {
    assert.match(url, /^athumb:\/\/(?:preview|cover)-[A-Za-z0-9._-]+$/);
    const file = path.join(paths.thumbs, url.replace('athumb://', ''));
    assert.ok(inside(paths.thumbs, file) && fs.existsSync(file));
    const size = nativeImage.createFromPath(file).getSize();
    assert.equal(size.width, 320, 'Real Unity preview image must decode at 320 pixels');
    assert.ok(size.height > 0 && size.height <= 320);
    return { url, file, ...size, sha256: hash(file) };
  };
  const snapshotDb = paths => {
    const db = new Database(paths.dbPath, { readonly: true, fileMustExist: true });
    try {
      const result = { schema: db.pragma('user_version', { simple: true }), imports: db.prepare('SELECT COUNT(*) AS n FROM import_log').get().n,
        packageEntries: db.prepare('SELECT COUNT(*) AS n FROM package_entry').get().n, projects: db.prepare('SELECT id,path FROM project').all(),
        covers: db.prepare('SELECT asset_id,source,project_id,target_json,options_json,cover_image,previous_image FROM asset_cover ORDER BY asset_id').all() };
      assert.equal(result.schema, 8); assert.equal(result.imports, 0); assert.equal(result.packageEntries, 0);
      for (const project of result.projects) {
        assert.ok(inside(evidenceDir, project.path), 'Isolated discovery must not register user projects');
        assert.ok(!inside(path.join(sandbox, 'cover-previews'), project.path), 'Internal preview projects must never become project rows');
        assert.ok(!fs.existsSync(path.join(project.path, '.atrium-cover-preview.json')), 'Marked preview projects must never be registered');
      }
      return result;
    } finally { db.close(); }
  };
  app.on('browser-window-created', (_event, win) => win.webContents.once('did-finish-load', async () => {
    if (checked) return; checked = true;
    win.webContents.setBackgroundThrottling(false);
    win.webContents.on('console-message', (_event, _level, message) => { if (message.startsWith('[PACKAGE_GUI]')) console.log(message); });
    let paths;
    try {
      const setup = await win.webContents.executeJavaScript(`(async () => {
        const delay = () => new Promise(resolve => setTimeout(resolve, 100));
        for (let i = 0; i < 150 && !document.body.textContent.includes('首次配置') && !document.body.textContent.includes('全部素材'); i++) await delay();
        await window.a.settings.setMany({language:'zh-CN',libraryRoot:${JSON.stringify(path.join(sandbox, 'Library'))},libraryMode:'fresh',onboardingDone:true,autoLaunchAsked:true,minimizeToTray:false,
          autoArchive:false,autoExtract:false,watchedFolders:[],bridgeAutoInstall:false,autoSwitchBehavior:'never',unityExePath:${JSON.stringify(editor)}});
        const projects = await window.a.unity.refreshProjects();
        for (const ask of await window.a.unity.pendingBridgeAsk()) await window.a.unity.answerBridgeAsk(ask.projectId, 'never');
        const project = projects.find(item => item.path.replaceAll('\\\\','/').toLowerCase() === ${JSON.stringify(dependency.replaceAll('\\', '/').toLowerCase())});
        if (!project) throw Error('Registered shader dependency fixture missing');
        await window.a.unity.setTarget(null);
        if ((await window.a.unity.status()).targetProjectId !== null) throw Error('Package fixture has an import target');
        return {dependencyId:project.id,paths:await window.a.system.paths()};
      })()`);
      paths = setup.paths; assert.equal(paths.appData, sandbox);
      const initial = snapshotDb(paths);
      if (stage === 'first') {
        assert.equal(initial.covers.length, 0);
        assert.ok(!fs.existsSync(path.join(sandbox, 'cover-previews')), 'Start with no preview projects or cached imported resources');
        const db = new Database(paths.dbPath);
        try {
          const insert = db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,cover_image,source_path,library_path,created_at,updated_at) VALUES(?,?,?,'props','classified','index',1,'none',?,NULL,?,?)");
          for (const sample of samples) insert.run(sample.id, sample.name, path.basename(sample.source), sample.source, Date.now(), Date.now());
        } finally { db.close(); }
        fs.writeFileSync(manualImage, nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 180), { width: 16, height: 16 }).toPNG());
      }
      await win.webContents.executeJavaScript(`(() => {
        const samples = ${JSON.stringify(samples)}, dependencyId = ${JSON.stringify(setup.dependencyId)};
        const delay = () => new Promise(resolve => setTimeout(resolve, 100));
        const dialog = () => document.querySelector('[role="dialog"]');
        const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
        const click = text => { const item = button(text); if (!item || item.disabled) throw Error('Unavailable button: ' + text); item.click(); };
        const wait = async (condition, reason, timeout = 360000) => {
          const end = Date.now() + timeout;
          while (Date.now() < end) { if (await condition()) return; await delay(); }
          throw Error((reason || 'Package GUI timed out: ' + condition.toString()) + '; UI: ' + document.body.textContent.slice(-5000));
        };
        const card = sample => [...document.querySelectorAll('.card')].find(item => item.textContent.includes(sample.name));
        const change = (element, value) => { element.value = value; element.dispatchEvent(new Event('change', {bubbles:true})); };
        const close = async () => { click('取消'); await wait(() => !dialog(), 'Cover editor did not close', 30000); };
        const cover = sample => window.a.assets.get(sample.id);
        const status = sample => window.a.covers.status(sample.id, '');
        const chooseCard = async sample => {
          await window.a.assets.patch(sample.id, {name:sample.name});
          await wait(() => button('全部素材'), 'Main asset navigation missing', 30000); click('全部素材');
          await wait(() => card(sample), 'Seeded source card missing', 30000); card(sample).click();
          await wait(() => [...document.querySelectorAll('aside')].some(aside => aside.textContent.includes(sample.name)), 'Selected asset detail missing', 30000);
          await wait(() => button('编辑封面'), 'Cover editor entry missing', 30000);
        };
        const open = async sample => { await chooseCard(sample); click('编辑封面'); await wait(() => dialog()?.querySelector('[data-cover-provider]'), 'Preview source selector missing', 30000); };
        const prepare = async sample => {
          console.log('[PACKAGE_GUI] generating original ZIP candidates for ' + sample.name);
          const before = (await cover(sample)).cover_image;
          await open(sample);
          if (dialog().querySelector('[data-cover-provider]').value !== 'package') throw Error('Original ZIP did not open package mode');
          const dependency = dialog().querySelector('[data-cover-dependency]');
          if (dependency.value !== dependencyId) { change(dependency, dependencyId); await delay(); }
          const target = () => dialog()?.querySelector('[data-cover-candidate="' + sample.targetId + '"]');
          await wait(() => dialog()?.querySelector('[data-cover-candidate]'), 'Original package produced no candidates');
          while (!target()) {
            await wait(() => button('显示更多物品') && !button('显示更多物品').disabled, 'Expected source GUID is absent from the bounded candidate list');
            click('显示更多物品'); await delay();
          }
          await wait(() => target()?.querySelector('img')?.naturalWidth > 0 && !button('重新查找物品').disabled, 'Expected original source did not render');
          if (!button('保存封面').disabled || dialog().querySelector('[data-cover-candidate][aria-pressed="true"]')) throw Error('Package discovery automatically selected or saved an object');
          if ((await cover(sample)).cover_image !== before) throw Error('Package previews changed the card before explicit Save');
          const images = [...dialog().querySelectorAll('[data-cover-candidate]')].filter(item => item.querySelector('img')?.naturalWidth > 0)
            .map(item => ({targetId:item.dataset.coverCandidate,url:item.querySelector('img').getAttribute('src'),text:item.textContent}));
          if (!images.some(image => image.targetId === sample.targetId)) throw Error('Expected GUID thumbnail is missing');
          return {before,images,visibleCandidates:dialog().querySelectorAll('[data-cover-candidate]').length};
        };
        const save = async (sample, direction = 'back') => {
          const before = (await cover(sample)).cover_image;
          dialog().querySelector('[data-cover-candidate="' + sample.targetId + '"]').click();
          await wait(() => !button('保存封面').disabled, 'Clicked candidate did not become saveable');
          change(dialog().querySelector('[data-cover-angle]'), direction);
          await delay();
          await wait(() => !button('保存封面').disabled && !button('重新查找物品').disabled, 'Changed direction did not regenerate');
          if ((await cover(sample)).cover_image !== before) throw Error('Direction change updated the card before Save');
          click('保存封面'); await wait(() => !dialog(), 'Explicit package Save did not finish', 30000);
          const result = await status(sample), current = await cover(sample);
          if (result.record?.source !== 'package' || result.record.target?.id !== sample.targetId || result.record.target?.sourceGuid !== sample.expectedGuid || result.record.projectId !== dependencyId)
            throw Error('Save retained a transient project or wrong source association: ' + JSON.stringify(result));
          if (!result.record.target.path.startsWith('Assets/') || result.record.target.isScene || !result.record.target.persistent) throw Error('Saved package target is not the original persistent Assets object');
          if (result.record.options.direction !== direction) throw Error('Saved direction does not match the GUI choice');
          await wait(() => card(sample)?.querySelector('img')?.getAttribute('src') === current.cover_image && card(sample).querySelector('img')?.naturalWidth > 0, 'Saved cover did not load in its card', 30000);
          console.log('[PACKAGE_GUI] explicitly saved stable source ' + result.record.target.id);
          return {cover:current.cover_image,record:result.record};
        };
        window.__atriumPackageGui = {samples,dependencyId,delay,dialog,button,click,wait,card,change,close,cover,status,chooseCard,open,prepare,save};
      })()`);
      const results = [];
      if (stage === 'first') {
        for (const [index, sample] of samples.entries()) {
          const prepared = await win.webContents.executeJavaScript(`window.__atriumPackageGui.prepare(window.__atriumPackageGui.samples[${index}])`);
          assert.ok(prepared.visibleCandidates <= 50);
          const images = prepared.images.map((image, imageIndex) => {
            const decodedImage = decoded(paths, image.url);
            const evidenceImage = path.join(evidenceDir, 'package-live-' + index + '-' + imageIndex + '.jpg');
            fs.copyFileSync(decodedImage.file, evidenceImage);
            return {...image,...decodedImage,evidenceImage};
          });
          const capture = await Promise.race([win.webContents.capturePage(), pause(5000).then(() => null)]);
          const screenshot = capture ? path.join(evidenceDir, 'package-live-ui-' + index + '.png') : null;
          if (capture) fs.writeFileSync(screenshot, capture.toPNG());
          const saved = await win.webContents.executeJavaScript(`window.__atriumPackageGui.save(window.__atriumPackageGui.samples[${index}])`);
          decoded(paths, saved.cover); results.push({sample,prepared,images,screenshot,saved});
        }
        const lifecycle = await win.webContents.executeJavaScript(`(async () => {
          const gui = window.__atriumPackageGui, first = gui.samples[0], second = gui.samples[1];
          console.log('[PACKAGE_GUI] restore and recreate the second package cover');
          await gui.open(second); await gui.wait(() => !gui.button('恢复原始封面').disabled, 'Restore action unavailable', 30000);
          gui.click('恢复原始封面'); await gui.wait(() => !gui.dialog(), 'Restore did not close the editor', 30000);
          if ((await gui.cover(second)).cover_image !== 'none' || (await gui.status(second)).record !== null) throw Error('Restore did not recover the original source cover');
          await gui.prepare(second); const recreated = await gui.save(second, 'front');
          console.log('[PACKAGE_GUI] cancel a real package render while preserving the saved cover');
          const savedFirst = (await gui.cover(first)).cover_image;
          await gui.open(first); await gui.wait(() => !gui.button('生成预览').disabled, 'Saved package could not regenerate', 30000); gui.click('生成预览');
          await gui.wait(() => gui.button('取消查找'), 'Package render did not expose cancellation', 30000); gui.click('取消查找');
          await gui.delay(); await gui.close();
          if ((await gui.cover(first)).cover_image !== savedFirst) throw Error('Cancelled package rendering changed a saved cover');
          console.log('[PACKAGE_GUI] upload a local image and cancel automatic package work');
          await gui.open(second); await gui.wait(() => !gui.button('选择本地图片').disabled, 'Local image action unavailable', 30000); gui.click('选择本地图片');
          await gui.wait(() => !gui.dialog(), 'Local image upload did not close the editor', 30000);
          const manual = (await gui.cover(second)).cover_image;
          if ((await gui.status(second)).record?.source !== 'image') throw Error('Local image upload did not create a manual association');
          await gui.open(second);
          const dep = gui.dialog().querySelector('[data-cover-dependency]'); if (dep.value !== gui.dependencyId) { gui.change(dep, gui.dependencyId); await gui.delay(); }
          await gui.wait(() => gui.button('取消查找'), 'Automatic candidates did not expose cancellation', 30000); gui.click('取消查找');
          await gui.delay(); await gui.close();
          if ((await gui.cover(second)).cover_image !== manual) throw Error('Cancelled automatic package work changed a manual image');
          console.log('[PACKAGE_GUI] batch update package association and preserve manual image');
          await gui.chooseCard(first); gui.card(second).dispatchEvent(new MouseEvent('click', {bubbles:true,ctrlKey:true}));
          await gui.wait(() => gui.button('更新所选封面'), 'Multi-select cover action missing', 30000); gui.click('更新所选封面');
          await gui.wait(() => gui.button('开始更新 2 项'), 'Batch confirmation missing', 30000); gui.click('开始更新 2 项');
          await gui.wait(() => gui.dialog()?.textContent.includes('已更新 1 / 2 项') && gui.dialog().textContent.includes('保留手动图片'), 'Package batch did not update one association and preserve the manual image');
          const batchText = gui.dialog().textContent;
          if ((await gui.cover(second)).cover_image !== manual) throw Error('Batch replaced the manual cover');
          const updated = await gui.status(first);
          if (updated.record?.source !== 'package' || updated.record.target?.id !== first.targetId || updated.record.projectId !== gui.dependencyId) throw Error('Batch lost the stable package association');
          gui.click('关闭'); await gui.wait(() => !gui.dialog(), 'Batch dialog did not close', 30000);
          await gui.chooseCard(first); const finalCover = (await gui.cover(first)).cover_image;
          await gui.wait(() => gui.card(first)?.querySelector('img')?.getAttribute('src') === finalCover && gui.card(first).querySelector('img')?.naturalWidth > 0, 'Batch cover did not refresh its card', 30000);
          if ((await window.a.unity.status()).targetProjectId !== null) throw Error('Internal preview changed the import target');
          return {restored:true,recreated,savedCancellationProtected:true,manualCancellationProtected:true,manual,batchText,batchUpdated:updated.record,finalCover};
        })()`);
        decoded(paths, lifecycle.finalCover);
        const finalDb = snapshotDb(paths);
        writeResult({ok:true,stage,dependencyId:setup.dependencyId,initialDb:initial,finalDb,results,lifecycle,sourcePackageNoImportHistory:true,noInventorySeed:true,noInternalProjectRegistration:true,importTargetNull:true});
      } else {
        const previous = JSON.parse(fs.readFileSync(path.join(sandbox, 'integration-first.json'), 'utf8'));
        const restart = await win.webContents.executeJavaScript(`(async () => {
          const gui = window.__atriumPackageGui, first = gui.samples[0], second = gui.samples[1];
          console.log('[PACKAGE_GUI] verify saved package and manual covers after production-app restart');
          const persisted = await gui.status(first), manual = await gui.status(second);
          if (persisted.record?.source !== 'package' || persisted.record.target?.id !== first.targetId || persisted.record.target?.sourceGuid !== first.expectedGuid || persisted.record.projectId !== gui.dependencyId) throw Error('Package association did not survive restart');
          if (manual.record?.source !== 'image' || manual.record.coverImage !== ${JSON.stringify(previous.lifecycle.manual)}) throw Error('Manual cover did not survive restart');
          await gui.chooseCard(first); const cover = (await gui.cover(first)).cover_image;
          await gui.wait(() => gui.card(first)?.querySelector('img')?.getAttribute('src') === cover && gui.card(first).querySelector('img')?.naturalWidth > 0, 'Restarted package cover did not decode in the card', 30000);
          await gui.open(first); await gui.wait(() => gui.dialog()?.querySelector('[data-cover-dependency]')?.value === gui.dependencyId, 'Restarted package shader dependency did not restore', 30000);
          if (gui.dialog().querySelector('[data-cover-provider]').value !== 'package') throw Error('Restarted association did not restore package mode');
          if (gui.dialog().querySelectorAll('[data-cover-candidate]').length || gui.dialog().querySelector('[data-cover-angle]').value !== persisted.record.options.direction) throw Error('Restart unexpectedly rediscovered or lost its angle');
          await gui.close(); await gui.chooseCard(second);
          const manualCover = (await gui.cover(second)).cover_image;
          await gui.wait(() => gui.card(second)?.querySelector('img')?.getAttribute('src') === manualCover && gui.card(second).querySelector('img')?.naturalWidth > 0, 'Restarted manual image did not decode in its card', 30000);
          if ((await window.a.unity.status()).targetProjectId !== null) throw Error('Restart changed the import target');
          return {packageModeRestored:true,dependencyRestored:true,stableGuidRestored:true,angleRestored:true,noAutomaticRediscovery:true,packageRecord:persisted.record,manualRecord:manual.record,cover,manualCover};
        })()`);
        decoded(paths, restart.cover);
        writeResult({ok:true,stage,dependencyId:setup.dependencyId,restart,finalDb:snapshotDb(paths),noInternalProjectRegistration:true,importTargetNull:true});
      }
      console.log('[ATRIUM_PACKAGE_INTEGRATION_STAGE] PASS ' + stage);
      // Use the normal close IPC so before-quit disposes the real cover worker.
      void win.webContents.executeJavaScript('window.a.system.close()').catch(() => undefined);
      setTimeout(() => app.quit(), 1000).unref();
    } catch (error) {
      console.error(error.stack);
      const body = await win.webContents.executeJavaScript('document.body.textContent.slice(-8000)').catch(() => 'renderer unavailable');
      console.error(body);
      writeResult({ok:false,stage,error:String(error.stack || error),body,paths});
      // app.exit skips production disposal; normal quit plus the parent-side
      // ownership wait lets the real worker shutdown/watchdog finish instead.
      app.quit();
    }
  }));
  require(path.join(root, 'out/main/index.js'));
}
