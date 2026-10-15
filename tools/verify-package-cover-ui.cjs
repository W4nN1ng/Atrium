const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'tmp', 'package-cover-ui-verification');

// This fixture runs the actual CoverEditor, React, locales and IPC in Electron.
// Only the external cover/settings/native-picker boundary is controlled; it
// does not load SQLite or change the native module ABI used by parallel tests.
if (!process.versions.electron) {
  (async () => {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(evidenceDir, 'avca-sandbox-ui-'));
    const source = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
    fs.writeFileSync(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./entry.tsx"></script>');
    fs.writeFileSync(path.join(fixture, 'entry.tsx'), `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { CoverEditor } from ${source('src/renderer/components/CoverEditor.tsx')};
      import { useUi } from ${source('src/renderer/stores/ui.ts')};
      import { initI18n } from ${source('src/renderer/i18n/index.ts')};
      await initI18n('zh-CN');
      useUi.setState({projects:[{id:'registered',name:'Shader Project',path:'fixture-only'},{id:'registered-two',name:'Second Project',path:'fixture-only-two'}],unity:{targetProjectId:'registered'}});
      createRoot(document.getElementById('root')!).render(<CoverEditor assetId="package-one" name="Package Fixture" />);
    `);
    fs.writeFileSync(path.join(fixture, 'preload.cjs'), `
      const { contextBridge, ipcRenderer } = require('electron');
      const call = (name, ...args) => ipcRenderer.invoke('fixture:'+name, ...args);
      contextBridge.exposeInMainWorld('a', {
        covers:Object.fromEntries(['status','packageStatus','packageSetup','discover','discoverPackage','packageProgress','targets','preview','save','discard','upload','restore','upgradeBridge'].map(name=>[name,(...args)=>call(name,...args)])),
        system:{pickFiles:(...args)=>call('pickFiles',...args)},settings:{setMany:(...args)=>call('setMany',...args)}
      });
      contextBridge.exposeInMainWorld('fixture', {control:(...args)=>call('control',...args)});
    `);
    const { build } = await import('vite');
    await build({ root: fixture, base: './', logLevel: 'error', build: { target: 'esnext', outDir: path.join(fixture, 'dist'), emptyOutDir: true,
      rollupOptions: { onwarn: (warning, warn) => { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); } } } });
    const env = { ...process.env, ATRIUM_PACKAGE_UI_FIXTURE: fixture };
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer = setTimeout(() => { child.kill(); reject(Error('Package cover UI verification timed out')); }, 120000);
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Electron package UI verification failed: ' + code)); });
    });
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
  const fixture = process.env.ATRIUM_PACKAGE_UI_FIXTURE;
  assert.ok(fixture && path.resolve(fixture).startsWith(evidenceDir + path.sep), 'An isolated fixture directory is required');
  app.setPath('userData', path.join(fixture, 'user-data'));
  const calls = { discover: [], previews: [], discard: [], save: [], settings: [], upload: [], restore: 0, targets: [] };
  let record = null, available = false, blockDiscovery = true, blockPreview = false, blockSave = false;
  let discoveryError = '', previewError = '';
  let releaseSave;
  const pendingDiscovery = [], pendingPreview = [];
  const target = index => ({ id: 'package:' + index.toString(16).padStart(32, '0'), sourceGuid: index.toString(16).padStart(32, '0'), name: 'Item ' + index, path: 'Assets/Original/Item' + index + '.prefab', persistent: true, isScene: false, memberPaths: ['bundle/source.unitypackage'] });
  const discovery = () => ({ targets: Array.from({ length: 50 }, (_, index) => target(index + 1)), warnings: [], truncated: true });
  const png = nativeImage.createFromBitmap(Buffer.from([20, 80, 220, 255]), { width: 1, height: 1 }).toDataURL();
  const handler = (name, fn) => ipcMain.handle('fixture:' + name, (_event, ...args) => fn(...args));
  handler('status', () => ({ record, bridge: 'ready', candidates: true }));
  handler('packageStatus', () => ({ available, editorPath: available ? 'fixture/Unity.exe' : null, version: available ? '2022.3.22f1' : null }));
  handler('packageSetup', () => ({ dependencies: ['registered','registered-two'].map(projectId => ({projectId,name:projectId,version:'2.3.4',status:'ready'})),
    recommendedProjectId: record?.source === 'package' ? record.projectId : null, reason: record?.source === 'package' ? 'saved' : 'none' }));
  handler('packageProgress', () => ({ stage: 'reading', done: 2, total: 4 }));
  handler('pickFiles', options => options.filters[0].extensions.includes('exe') ? ['fixture/Unity.exe'] : ['fixture/manual.png']);
  handler('setMany', values => { calls.settings.push(values); available = Boolean(values.unityExePath); });
  handler('discoverPackage', async (assetId, requestId, dependencyProjectId) => {
    calls.discover.push({ provider: 'package', assetId, requestId, dependencyProjectId });
    if (blockDiscovery) await new Promise(resolve => pendingDiscovery.push(resolve));
    if (discoveryError) throw Error(discoveryError);
    return discovery();
  });
  handler('discover', (assetId, projectId, requestId) => { calls.discover.push({ provider: 'project', assetId, projectId, requestId }); return { targets: [], warnings: [], truncated: false }; });
  handler('targets', projectId => { calls.targets.push(projectId); return [{ ...target(1), id: 'asset:project', path: 'Assets/Project.prefab', memberPaths: undefined }]; });
  handler('preview', async request => {
    calls.previews.push(request);
    if (blockPreview) await new Promise(resolve => pendingPreview.push(resolve));
    if (previewError) throw Error(previewError);
    return { id: request.requestId, url: png, width: 640, height: 480, rendererCount: 1 };
  });
  handler('discard', id => { calls.discard.push(id); });
  handler('save', async (assetId, id) => {
    calls.save.push({ assetId, id });
    if (blockSave) await new Promise(resolve => { releaseSave = resolve; });
    const request = calls.previews.find(item => item.requestId === id);
    assert.ok(request, 'Explicit Save must use a generated preview');
    record = { assetId, source: request.provider === 'package' ? 'package' : 'unity', projectId: request.dependencyProjectId || request.projectId || null, target: request.target, options: request.options, coverImage: 'saved-cover', previousImage: 'original-cover' };
    return record;
  });
  handler('upload', (assetId, file) => { calls.upload.push({ assetId, file }); record = { assetId, source: 'image', target: null, projectId: null, options: null, coverImage: 'manual-cover', previousImage: 'original-cover' }; return record; });
  handler('restore', () => { calls.restore++; record = null; });
  handler('upgradeBridge', () => {});
  handler('control', change => {
    if (Object.hasOwn(change, 'blockDiscovery')) blockDiscovery = change.blockDiscovery;
    if (Object.hasOwn(change, 'blockPreview')) blockPreview = change.blockPreview;
    if (Object.hasOwn(change, 'blockSave')) blockSave = change.blockSave;
    if (Object.hasOwn(change, 'discoveryError')) discoveryError = change.discoveryError;
    if (Object.hasOwn(change, 'previewError')) previewError = change.previewError;
    if (change.releaseDiscovery) pendingDiscovery.splice(0).forEach(resolve => resolve());
    if (change.releasePreview) pendingPreview.splice(0).forEach(resolve => resolve());
    if (change.releaseSave) releaseSave?.();
    if (Object.hasOwn(change, 'record')) record = change.record;
    return { calls, record };
  });
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(fixture, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false } });
    try {
      await win.loadFile(path.join(fixture, 'dist/index.html'));
      const result = await win.webContents.executeJavaScript(`(async () => {
        const delay = () => new Promise(resolve => setTimeout(resolve, 40));
        const wait = async (fn, reason) => { for (let i = 0; i < 250; i++) { if (await fn()) return; await delay(); } throw Error(reason || 'UI condition timed out: ' + fn.toString()); };
        const dialog = () => document.querySelector('[role="dialog"]');
        const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
        const click = text => { const item = button(text); if (!item || item.disabled) throw Error('Unavailable button: ' + text); item.click(); };
        const provider = () => dialog()?.querySelector('[data-cover-provider]');
        const change = (element, value) => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); };
        const cards = () => [...(dialog()?.querySelectorAll('[data-cover-candidate]') ?? [])];
        const imagesReady = () => cards().length > 0 && cards().every(item => item.querySelector('img')?.naturalWidth > 0);
        await wait(() => button('编辑封面')); click('编辑封面'); await wait(() => dialog());
        if (!provider()) throw Error('Missing preview source selector: unlinked items must support package preview');
        if (provider().value !== 'package') throw Error('New unlinked cover did not default to package preview');
        await wait(() => button('选择 Unity.exe'));
        if ([...dialog().querySelectorAll('option')].some(option => option.value === 'scene')) throw Error('Package mode exposed the Unity scene direction');
        click('选择 Unity.exe'); await wait(() => button('取消查找'));
        await wait(() => dialog().textContent.includes('2 / 4'), 'Package preparation progress was not visible');
        change(provider(), 'project'); await wait(() => button('读取 Unity 当前选中物品'));
        await window.fixture.control({ releaseDiscovery: true, blockDiscovery: false }); await delay();
        if (cards().length || !button('保存封面').disabled) throw Error('A package result survived a mode switch');
        change(provider(), 'package'); await wait(imagesReady);
        if (cards().length !== 8 || !button('保存封面').disabled || cards().some(item => item.getAttribute('aria-pressed') === 'true')) throw Error('Candidates were not bounded or were automatically selected');
        const dependency = dialog().querySelector('[data-cover-dependency]');
        change(dependency, 'registered'); await wait(imagesReady);
        const routed = await window.fixture.control({});
        if (routed.calls.discover.at(-1).dependencyProjectId !== 'registered') throw Error('Shader dependency selection did not refresh package discovery');
        if (routed.calls.settings[0]?.unityExePath !== 'fixture/Unity.exe') throw Error('Chosen Unity executable was not persisted');
        click('显示更多物品'); await wait(() => cards().length === 16 && imagesReady());
        cards()[1].click(); await wait(() => !button('保存封面').disabled);
        const angle = dialog().querySelector('[data-cover-angle]'); change(angle, 'back');
        await wait(() => imagesReady() && !button('保存封面').disabled);
        await window.fixture.control({ blockSave: true }); click('保存封面'); await delay();
        if ([...dialog().querySelectorAll('select')].some(item => !item.disabled) || !button('取消').disabled) throw Error('Controls remained mutable during explicit Save');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await delay();
        if (!dialog()) throw Error('Escape closed the editor during pending Save');
        await window.fixture.control({ releaseSave: true, blockSave: false }); await wait(() => !dialog());
        const saved = await window.fixture.control({});
        if (saved.calls.save.length !== 1 || saved.record.source !== 'package' || saved.record.options.direction !== 'back') throw Error('Save did not retain the explicit package choice and direction');
        click('编辑封面'); await wait(() => provider()?.value === 'package' && button('重新查找物品'));
        if (cards().length) throw Error('Saved package association was automatically rediscovered');
        if (dialog().querySelector('[data-cover-dependency]').value !== 'registered') throw Error('Saved package shader dependency was not restored');
        click('生成预览'); await wait(() => !button('保存封面').disabled);
        click('取消'); await wait(() => !dialog());
        await window.fixture.control({ record: null, blockDiscovery: true }); click('编辑封面'); await wait(() => button('取消查找'));
        click('取消查找'); await window.fixture.control({ releaseDiscovery: true, blockDiscovery: false }); await delay();
        if (cards().length || !button('保存封面').disabled) throw Error('Late discovery survived cancellation');
        click('重新查找物品'); await wait(imagesReady);
        cards()[1].click(); await wait(() => !button('保存封面').disabled);
        await window.fixture.control({ blockPreview: true });
        change(dialog().querySelector('[data-cover-angle]'), 'front'); await wait(() => button('取消查找'));
        change(dialog().querySelector('[data-cover-angle]'), 'right'); await delay();
        await window.fixture.control({ releasePreview: true, blockPreview: false });
        await wait(() => imagesReady() && !button('保存封面').disabled);
        const replaced = await window.fixture.control({});
        const rightRequests = replaced.calls.previews.filter(item => item.options.direction === 'right');
        if (!rightRequests.length || replaced.calls.previews.filter(item => item.options.direction === 'front').some(item => !replaced.calls.discard.includes(item.requestId))) throw Error('Angle change retained a pending obsolete thumbnail');
        await window.fixture.control({ blockPreview: true });
        change(dialog().querySelector('[data-cover-angle]'), 'top'); await wait(() => button('取消查找'));
        change(provider(), 'project'); await wait(() => button('读取 Unity 当前选中物品'));
        await window.fixture.control({ releasePreview: true, blockPreview: false }); await delay();
        if (dialog().querySelector('img') || !button('保存封面').disabled) throw Error('Late thumbnail survived a mode switch');
        const projectSelect = [...dialog().querySelectorAll('select')].find(item => item !== provider() && [...item.options].some(option => option.value === 'registered-two'));
        change(projectSelect, 'registered-two'); await delay();
        click('读取 Unity 当前选中物品'); await wait(() => [...dialog().querySelectorAll('option')].some(option => option.textContent.startsWith('Item 1 —')) && !button('生成预览').disabled);
        await window.fixture.control({ blockPreview: true }); click('生成预览'); await wait(() => button('取消查找'));
        change(projectSelect, 'registered'); await delay();
        await window.fixture.control({ releasePreview: true, blockPreview: false }); await delay();
        if (dialog().querySelector('img') || !button('保存封面').disabled) throw Error('Late preview survived a project switch');
        change(provider(), 'package'); await wait(imagesReady);
        await window.fixture.control({ blockPreview: true });
        change(dialog().querySelector('[data-cover-angle]'), 'left'); await wait(() => button('取消查找'));
        click('取消查找'); await window.fixture.control({ releasePreview: true, blockPreview: false }); await delay();
        if (dialog().querySelector('img') || !button('保存封面').disabled) throw Error('Late thumbnail survived cancellation');
        await window.fixture.control({ blockDiscovery: true }); click('重新查找物品'); await wait(() => button('取消查找'));
        click('取消'); await wait(() => !dialog());
        await window.fixture.control({ releaseDiscovery: true, blockDiscovery: false }); await delay();
        click('编辑封面'); await wait(imagesReady);
        if (!button('保存封面').disabled || cards().some(item => item.getAttribute('aria-pressed') === 'true')) throw Error('Reopened editor reused a closed session result');
        click('选择本地图片'); await wait(() => !dialog());
        click('编辑封面'); await wait(imagesReady);
        if ((await window.fixture.control({})).record.coverImage !== 'manual-cover') throw Error('Automatic candidates replaced a manual cover');
        click('恢复原始封面'); await wait(() => !dialog());
        await window.fixture.control({ record: {assetId:'package-one',source:'unity',projectId:'registered',target:{id:'asset:project',name:'Project Item',path:'Assets/Project.prefab',persistent:true,isScene:false,sourceGuid:null},options:{direction:'scene',background:'light'},coverImage:'project-cover',previousImage:'original-cover'} });
        click('编辑封面'); await wait(() => provider()?.value === 'project');
        if (!button('读取 Unity 当前选中物品') || ![...dialog().querySelectorAll('option')].some(option => option.value === 'scene')) throw Error('Legacy project association lost its project controls');
        click('读取 Unity 当前选中物品'); await wait(() => [...dialog().querySelectorAll('option')].some(option => option.textContent.startsWith('Item 1 —')) && !button('生成预览').disabled);
        click('生成预览'); await wait(() => !button('保存封面').disabled); click('取消'); await wait(() => !dialog());
        await window.fixture.control({ record: null, discoveryError: 'covers.dependencyMissing' });
        click('编辑封面'); await wait(() => dialog()?.querySelector('[role="alert"]'));
        if (!dialog().querySelector('[role="alert"]').textContent.includes('请选择包含 lilToon 的已登记工程')) throw Error('Missing dependency did not offer an actionable registered-project choice');
        await window.fixture.control({ discoveryError: '', previewError: 'covers.missingShader' });
        click('重新查找物品'); await wait(() => cards().length === 8 && !button('重新查找物品').disabled);
        if (!cards()[0].textContent.includes('着色器依赖工程')) throw Error('Package shader failure used instructions for a user Unity scene');
        click('取消'); await wait(() => !dialog());
        return {missingEditorPicker:true,modeSwitchLateResult:true,packageProgress:true,explicitSave:true,initialCandidates8:true,pagination:true,shaderDependency:true,optionsRefresh:true,saveControlsLocked:true,packageReplay:true,cancellationLateResults:true,optionProjectCloseLateResults:true,manualProtected:true,restore:true,legacyProject:true,actionableDependencyErrors:true};
      })()`);
      const chosen = calls.previews.find(request => request.requestId === calls.save[0].id);
      assert.equal(chosen.provider, 'package'); assert.equal(chosen.projectId, '');
      assert.match(chosen.target.id, /^package:[a-f0-9]{32}$/);
      assert.equal(calls.save.length, 1); assert.equal(calls.restore, 1); assert.equal(calls.upload.length, 1);
      assert.ok(calls.discover.every(item => calls.discard.includes(item.requestId)), 'Every discovery request must be discarded when its session ends');
      assert.ok(calls.previews.every(item => calls.discard.includes(item.requestId)), 'Every thumbnail and preview must be discarded when its session ends');
      assert.equal(new Set([...calls.discover.map(item => item.requestId), ...calls.previews.map(item => item.requestId)]).size, calls.discover.length + calls.previews.length, 'Requests must have unique IDs');
      fs.writeFileSync(path.join(evidenceDir, 'electron-package-ui-evidence.json'), JSON.stringify({ method: 'Production CoverEditor in isolated Electron with real IPC and controlled cover/settings/picker responses', fixture, ...result, calls }, null, 2));
      console.log('[ATRIUM_PACKAGE_COVER_UI] PASS'); app.quit();
    } catch (error) {
      console.error(error.stack);
      console.error(JSON.stringify({ discoveryCalls: calls.discover.length, previews: calls.previews.length, saves: calls.save.length,
        uploads: calls.upload.length, restores: calls.restore, record }, null, 2));
      console.error(await win.webContents.executeJavaScript('document.body.textContent.slice(-5000)'));
      app.exit(1);
    }
  });
}
