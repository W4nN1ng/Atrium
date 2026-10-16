/* Real compiled Electron + real Unity, scoped to an owned empty project.
 * Process discovery still runs the real Windows query; its output is filtered
 * at the OS boundary so verification cannot install into unrelated open editors.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'tmp', 'unity-auto-connect');
const editor = process.env.ATRIUM_AUTO_CONNECT_EDITOR;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

if (!process.versions.electron) {
  (async () => {
    assert.ok(editor && fs.existsSync(editor) && path.basename(editor).toLowerCase() === 'unity.exe', 'Set ATRIUM_AUTO_CONNECT_EDITOR to Unity 2022.3');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const sandbox = fs.mkdtempSync(path.join(evidenceDir, 'avca-sandbox-live-'));
    const project = path.join(sandbox, 'AutoConnectProject');
    for (const dir of ['Assets', 'ProjectSettings', 'Packages']) fs.mkdirSync(path.join(project, dir), { recursive: true });
    fs.writeFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n');
    fs.writeFileSync(path.join(project, 'Packages/manifest.json'), JSON.stringify({ dependencies: {} }));
    fs.mkdirSync(path.join(sandbox, 'Local/VRChatCreatorCompanion'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'Local/VRChatCreatorCompanion/settings.json'), JSON.stringify({ userProjects: [] }));
    fs.mkdirSync(path.join(sandbox, 'Library'));
    fs.writeFileSync(path.join(sandbox, 'settings.json'), JSON.stringify({ language: 'zh-CN', libraryRoot: path.join(sandbox, 'Library'),
      onboardingDone: true, autoLaunchAsked: true, minimizeToTray: false, watchedFolders: [], projectRoots: [],
      autoArchive: false, autoExtract: false, autoRemergeRunRoot: path.join(sandbox, 'Library'), autoRemergeRunAt: Date.now(),
      bridgeAutoInstall: false, unityAutoConnect: true, autoSwitchBehavior: 'never', confirmBeforeImport: false }));
    const guid = '12f066de475344b7933475b2197f1906';
    const packageSource = path.join(sandbox, 'package-source', guid);
    fs.mkdirSync(packageSource, { recursive: true });
    fs.writeFileSync(path.join(packageSource, 'pathname'), 'Assets/AutoConnectAcceptance.txt');
    fs.writeFileSync(path.join(packageSource, 'asset'), 'Imported by an explicit Atrium GUI click.\n');
    fs.writeFileSync(path.join(packageSource, 'asset.meta'), `fileFormatVersion: 2\nguid: ${guid}\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`);
    await require('tar').c({ gzip: true, cwd: path.dirname(packageSource), file: path.join(sandbox, 'Acceptance.unitypackage') }, [guid]);
    const env = { ...process.env, AVCA_APP_HOME: sandbox, AVCA_REQUIRE_SANDBOX_HOME: '1',
      APPDATA: path.join(sandbox, 'Roaming'), LOCALAPPDATA: path.join(sandbox, 'Local') };
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    console.log('[AUTO_CONNECT] isolated project: ' + project);
    const stages = [];
    for (const stage of ['first', 'restart']) {
      await new Promise((resolve, reject) => {
      const child = cp.spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [__filename],
        { cwd: root, env: { ...env, ATRIUM_AUTO_CONNECT_STAGE: stage }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer = setTimeout(() => { child.kill(); reject(Error('Real auto-connect acceptance timed out')); }, 720000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Real auto-connect acceptance failed: ' + code)); });
      });
      const result = JSON.parse(fs.readFileSync(path.join(sandbox, 'result-' + stage + '.json'), 'utf8'));
      assert.equal(result.ok, true);
      stages.push({ stage, ...result });
    }
    assert.equal(stages[0].bridgeHash, stages[1].bridgeHash, 'Restart must reuse the same installed bridge files');
    fs.writeFileSync(path.join(evidenceDir, 'live-result.json'), JSON.stringify({ ok: true, sandbox, stages }, null, 2));
    console.log('[AUTO_CONNECT] PASS real discovery, automatic installation, real heartbeat, explicit GUI import, closed target removal');
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const sandbox = process.env.AVCA_APP_HOME;
  assert.ok(sandbox && inside(evidenceDir, sandbox) && path.basename(sandbox).startsWith('avca-sandbox-live-'));
  const project = path.join(sandbox, 'AutoConnectProject');
  const stage = process.env.ATRIUM_AUTO_CONNECT_STAGE;
  assert.ok(['first', 'restart'].includes(stage));
  const originalExecFile = cp.execFile;
  // Scope only process visibility; do not fake Unity, heartbeats, installation,
  // file imports, IPC results, SQLite rows, or renderer actions.
  cp.execFile = function (file, args, options, callback) {
    const isProbe = /powershell(?:\.exe)?$/i.test(file) && Array.isArray(args) && args.includes('-EncodedCommand') &&
      Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le').includes('Win32_Process');
    if (!isProbe) return originalExecFile.apply(this, arguments);
    return originalExecFile.call(this, file, args, options, (error, stdout, stderr) => {
      const scoped = String(stdout).split(/\r?\n/).filter(line => line.toLowerCase().includes(project.toLowerCase())).join('\n');
      callback(error, scoped, stderr);
    });
  };
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
  const { app, BrowserWindow } = require('electron');
  const Database = require('better-sqlite3');
  BrowserWindow.prototype.show = function () {}; BrowserWindow.prototype.focus = function () {};
  process.argv = [process.argv[0]];
  let checked = false, unity = null;
  app.on('browser-window-created', (_event, win) => win.webContents.once('did-finish-load', async () => {
    if (checked) return; checked = true;
    win.webContents.setBackgroundThrottling(false);
    const started = Date.now(), phases = [], results = {};
    const run = source => win.webContents.executeJavaScript(source);
    const call = (method, ...args) => run(`window.a.unity[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const database = action => {
      const db = new Database(path.join(sandbox, 'library.db'));
      try { return action(db); } finally { db.close(); }
    };
    const counts = () => database(db => ({ imports: db.prepare('SELECT COUNT(*) AS n FROM import_log').get().n,
      installs: db.prepare("SELECT COUNT(*) AS n FROM journal WHERE op='bridge_install'").get().n }));
    const wait = async (fn, reason, timeout = 360000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(1000); }
      throw Error(reason + '\nUnity: ' + (fs.existsSync(path.join(sandbox, 'unity.log')) ? fs.readFileSync(path.join(sandbox, 'unity.log'), 'utf8').slice(-8000) : 'no log'));
    };
    try {
      await wait(() => run("!!window.a && document.body.textContent.includes('全部素材')"), 'Renderer did not boot', 30000);
      assert.equal((await call('resolveTarget')).kind, 'none');
      assert.equal(counts().imports, stage === 'first' ? 0 : 1);
      assert.equal(fs.existsSync(path.join(project, 'Packages/com.avca.bridge')), stage === 'restart');
      unity = cp.spawn(editor, ['-batchmode', '-nographics', '-projectPath', project, '-logFile', path.join(sandbox, 'unity.log')],
        { windowsHide: true, stdio: 'ignore' });
      fs.writeFileSync(path.join(sandbox, 'owned-unity.json'), JSON.stringify({ pid: unity.pid, project, editor }));
      const row = await wait(async () => {
        const list = await call('refreshProjects');
        for (const item of list) assert.ok(inside(sandbox, item.path), 'Discovered unrelated user project: ' + item.path);
        const snapshot = await call('connection');
        for (const state of snapshot.projects) if (!phases.includes(state.phase)) phases.push(state.phase);
        return list.find(item => item.path.toLowerCase() === project.toLowerCase() && item.running);
      }, 'Running unlisted project was not discovered', 60000);
      results.discoveredWithoutVccEntry = true;
      // Real renderer cancellation must end only this wait, never import later.
      const requestId = crypto.randomUUID();
      const cancelled = call('prepareTarget', row.id, requestId).then(value => ({ value }), error => ({ error: error.message }));
      await call('cancelTargetPreparation', requestId);
      const cancelResult = await cancelled;
      assert.match(cancelResult.error ?? '', /connectionCancelled/);
      results.cancelledPreparation = true;
      const connected = await call('prepareTarget', row.id, crypto.randomUUID());
      assert.equal(connected.phase, 'ready');
      phases.push('ready');
      const heartbeat = JSON.parse(fs.readFileSync(path.join(project, 'Temp/AVCABridge/bridge.json'), 'utf8'));
      assert.equal(heartbeat.pid, unity.pid);
      assert.equal((await call('resolveTarget')).projectId, row.id);
      assert.equal(counts().imports, stage === 'first' ? 0 : 1, 'Opening an editor must never import');
      assert.equal(counts().installs, 1);
      const bridgeFile = path.join(project, 'Packages/com.avca.bridge/Editor/AVCABridge.cs');
      const bridgeHash = crypto.createHash('sha256').update(fs.readFileSync(bridgeFile)).digest('hex');
      results.bridgeHash = bridgeHash;
      if (stage === 'first') {
        database(db => db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,cover_image,source_path,created_at,updated_at) VALUES('auto-connect-acceptance','Auto Connect Acceptance','Acceptance.unitypackage','props','classified','index',1,'none',?,?,?)")
        .run(path.join(sandbox, 'Acceptance.unitypackage'), Date.now(), Date.now()));
      await run(`(async () => {
        const pause = () => new Promise(resolve => setTimeout(resolve, 100));
        const wait = async fn => { for(let i=0;i<150;i++){if(fn())return;await pause();}throw Error(document.body.textContent); };
        await window.a.assets.patch('auto-connect-acceptance',{name:'Auto Connect Acceptance'});
        await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='全部素材'));
        [...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='全部素材').click();
        await wait(()=>[...document.querySelectorAll('.card')].some(el=>el.textContent.includes('Auto Connect Acceptance')));
        [...document.querySelectorAll('.card')].find(el=>el.textContent.includes('Auto Connect Acceptance')).click();
        await wait(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='导入到 AutoConnectProject'&&!el.disabled));
        [...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='导入到 AutoConnectProject').click();
      })()`);
      await wait(() => fs.existsSync(path.join(project, 'Assets/AutoConnectAcceptance.txt')), 'Explicit GUI import did not reach the project', 90000);
      await wait(() => counts().imports === 1, 'Successful import was not logged', 30000);
      assert.equal(fs.readFileSync(path.join(project, 'Assets/AutoConnectAcceptance.txt'), 'utf8'), 'Imported by an explicit Atrium GUI click.\n');
      for (let i = 0; i < 3; i++) await call('refreshProjects');
      assert.equal(counts().installs, 1, 'Repeated discovery must reuse installed bridge');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(bridgeFile)).digest('hex'), bridgeHash);
        results.explicitGuiImport = true;
      } else {
        assert.equal(counts().imports, 1);
        assert.equal(counts().installs, 1);
        results.reusedBridgeAfterRestart = true;
      }
      results.heartbeatPid = heartbeat.pid;
      fs.writeFileSync(path.join(sandbox, 'screen-' + stage + '.png'), (await win.webContents.capturePage()).toPNG());
      unity.kill();
      await wait(async () => {
        await call('refreshProjects');
        return (await call('connection')).projects.find(item => item.projectId === row.id)?.phase === 'closed';
      }, 'Closed project remained an import target', 30000);
      assert.equal((await call('resolveTarget')).kind, 'none');
      results.closedTargetRemoved = true;
      results.finalCounts = counts(); results.phases = [...new Set(phases)];
      results.method = 'Compiled production main/preload/React + real Unity 2022.3, scoped OS process visibility, empty isolated application/project, synthetic unitypackage';
      results.ok = true;
      console.log('[AUTO_CONNECT] real acceptance passed');
    } catch (error) { results.ok = false; results.error = error.stack; console.error(error.stack); }
    finally {
      if (unity && unity.exitCode === null) unity.kill();
      results.sandbox = sandbox; results.elapsedMs = Date.now() - started;
      fs.writeFileSync(path.join(sandbox, 'result-' + stage + '.json'), JSON.stringify(results, null, 2));
      app.exit(results.ok ? 0 : 1);
    }
  }));
  require(path.join(root, 'out/main/index.js'));
}
