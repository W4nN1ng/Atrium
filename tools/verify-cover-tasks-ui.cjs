const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'tmp', 'cover-tasks', 'ui-evidence');

// Production grid, task panel, store, CSS and locales in real React/Electron.
// IPC data is controlled here; no SQLite, user library or Unity is opened.
if (!process.versions.electron) {
  (async () => {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(evidenceDir, 'component-'));
    const source = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
    fs.writeFileSync(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./entry.tsx"></script>');
    fs.writeFileSync(path.join(fixture, 'entry.tsx'), `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {AssetGrid} from ${source('src/renderer/components/AssetGrid.tsx')};
      import {CoverTasks} from ${source('src/renderer/components/CoverTasks.tsx')};
      import {useUi} from ${source('src/renderer/stores/ui.ts')};
      import {initI18n} from ${source('src/renderer/i18n/index.ts')};
      import ${source('src/renderer/styles.css')};
      await initI18n('en');
      useUi.setState({nav:'col:wardrobe',search:'silver',selection:[],cards:[],total:700});
      function Fixture(){const [page,setPage]=useState('library');return <div style={{height:'100vh'}}>
        <button data-fixture-nav onClick={()=>setPage(page==='library'?'other':'library')}>Switch page</button>
        <button data-fixture-select onClick={()=>useUi.setState({selection:['selected-a','selected-b']})}>Select fixtures</button>
        <CoverTasks />{page==='library'?<AssetGrid />:<p data-fixture-other>Other page</p>}
      </div>}
      createRoot(document.getElementById('root')!).render(<Fixture />);
    `);
    fs.writeFileSync(path.join(fixture, 'preload.cjs'), `
      const {contextBridge,ipcRenderer}=require('electron');const call=(name,...args)=>ipcRenderer.invoke('fixture:'+name,...args);
      contextBridge.exposeInMainWorld('a',{covers:Object.fromEntries(['startTask','taskStatus','taskChoices','applyTaskChoice','retryTask','cancelTask','undoTask'].map(name=>[name,(...args)=>call(name,...args)])),on:()=>()=>{},assets:{mergeSuggestions:()=>Promise.resolve([]),learnedHint:()=>Promise.resolve(null)}});
      contextBridge.exposeInMainWorld('fixture',{control:(...args)=>call('control',...args)});
    `);
    const { build } = await import('vite');
    await build({ root: fixture, base: './', logLevel: 'error', build: { target: 'esnext', outDir: path.join(fixture, 'dist'), emptyOutDir: true,
      rollupOptions: { onwarn: (warning, warn) => { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); } } } });
    const env = { ...process.env, ATRIUM_COVER_TASKS_FIXTURE: fixture }; delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
      const timer = setTimeout(() => { child.kill(); reject(Error('Cover task UI verification timed out')); }, 120000);
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Cover task UI failed: ' + code)); });
    });
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
  const fixture = process.env.ATRIUM_COVER_TASKS_FIXTURE;
  assert.ok(fixture && path.resolve(fixture).startsWith(evidenceDir + path.sep));
  app.setPath('userData', path.join(fixture, 'user-data'));
  const calls = { start: [], choices: [], apply: [], cancel: [], retry: [], undo: [] };
  let task = null, sequence = 0, blockStart = true, blockChoices = false, blockApply = false;
  let choicesError = '', startError = '';
  const pendingStart = [], pendingChoices = [], pendingApply = [];
  const png = nativeImage.createFromBitmap(Buffer.from([30, 80, 190, 255]), { width: 1, height: 1 }).toDataURL();
  const snapshot = () => task ? JSON.parse(JSON.stringify(task)) : null;
  const seed = () => ({ id: 'task-' + ++sequence, updatedAt: Date.now(), running: true, cancelled: false, canUndo: true, items: [
    { assetId: 'auto', name: 'Automatic outfit', state: 'done', reason: null },
    { assetId: 'review-a', name: 'Ambiguous outfit A', state: 'review', reason: 'covers.reviewRequired' },
    { assetId: 'review-b', name: 'Ambiguous outfit B', state: 'review', reason: 'covers.reviewRequired' },
    { assetId: 'failure', name: 'Failed outfit', state: 'failed', reason: 'covers.missingShader', detail: 'controlled shader detail' },
    { assetId: 'product', name: 'Product photo', state: 'skipped', reason: 'covers.productSkipped' },
    { assetId: 'current', name: 'Current outfit', state: 'running', reason: null }
  ] });
  const handler = (name, fn) => ipcMain.handle('fixture:' + name, (_event, ...args) => fn(...args));
  handler('startTask', async request => {
    calls.start.push(request); if (blockStart) await new Promise(resolve => pendingStart.push(resolve));
    if (startError) throw Error(startError); task = seed(); return snapshot();
  });
  handler('taskStatus', () => snapshot());
  handler('taskChoices', async (id, assetId, offset = 0) => {
    calls.choices.push({ id, assetId, offset }); assert.equal(id, task.id);
    if (blockChoices) await new Promise(resolve => pendingChoices.push(resolve));
    if (choicesError) throw Error(choicesError);
    return { total: 12, truncated: false, choices: Array.from({ length: Math.min(8, 12 - offset) }, (_, index) => {
      const n = offset + index;
      return { target: { id: assetId + '-target-' + n, name: assetId + ' candidate ' + n, path: 'Assets/Outfit' + n + '.prefab',
        persistent: true, isScene: false, sourceGuid: null, memberPaths: ['Outfit.unitypackage'] },
        preview: { id: assetId + '-preview-' + n, url: png, width: 640, height: 480, rendererCount: 1 }, error: null };
    }) };
  });
  handler('applyTaskChoice', async (id, assetId, targetId) => {
    calls.apply.push({ id, assetId, targetId }); assert.equal(id, task.id); assert.ok(targetId.startsWith(assetId + '-target-'));
    if (blockApply) await new Promise(resolve => pendingApply.push(resolve));
    task.items.find(item => item.assetId === assetId).state = 'done'; task.updatedAt = Date.now(); return snapshot();
  });
  handler('retryTask', id => { calls.retry.push(id); task.running = true; task.items.filter(item => item.state === 'failed').forEach(item => item.state = 'running'); task.updatedAt = Date.now(); return snapshot(); });
  handler('cancelTask', id => { calls.cancel.push(id); task.running = false; task.cancelled = true; task.items.filter(item => ['queued', 'running'].includes(item.state)).forEach(item => item.state = 'cancelled'); task.updatedAt = Date.now(); });
  handler('undoTask', id => { calls.undo.push(id); task.canUndo = false; task.items.filter(item => item.state === 'done').forEach(item => item.state = 'restored'); task.updatedAt = Date.now(); return { restored: 2, preserved: 1 }; });
  handler('control', change => {
    for (const [key, value] of Object.entries(change)) {
      if (key === 'blockStart') blockStart = value;
      if (key === 'blockChoices') blockChoices = value;
      if (key === 'blockApply') blockApply = value;
      if (key === 'choicesError') choicesError = value;
      if (key === 'startError') startError = value;
    }
    if (change.complete && task) { task.running = false; task.items.filter(item => item.state === 'running').forEach(item => item.state = 'done'); task.updatedAt = Date.now(); }
    if (change.releaseStart) pendingStart.splice(0).forEach(resolve => resolve());
    if (change.releaseChoices) pendingChoices.splice(0).forEach(resolve => resolve());
    if (change.releaseApply) pendingApply.splice(0).forEach(resolve => resolve());
    return { calls, task: snapshot() };
  });
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { preload: path.join(fixture, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false } });
    try {
      await win.loadFile(path.join(fixture, 'dist/index.html'));
      const result = await win.webContents.executeJavaScript(`(async()=>{
        const delay=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
        const wait=async(fn)=>{for(let i=0;i<250;i++){if(await fn())return;await delay();}throw Error('UI condition timed out: '+fn.toString());};
        const find=key=>key.startsWith('review-review-')?document.querySelector('[data-cover-task-review="'+key.slice(7)+'"]'):document.querySelector('[data-cover-task-'+key+']');
        const click=key=>{const button=find(key);if(!button||button.disabled)throw Error('Unavailable control: '+key);button.click();};
        const dialog=()=>document.querySelector('[role="dialog"]');
        const cards=()=>[...document.querySelectorAll('[data-cover-task-candidate]')];
        const ready=()=>cards().length>0&&cards().every(card=>card.querySelector('img')?.naturalWidth>0);
        const state=()=>window.fixture.control({});const checks=[];
        await wait(()=>find('start'));
        click('start');find('start').click();await wait(()=>find('starting'));
        if((await state()).calls.start.length!==1||(await state()).calls.start[0].scope!=='all')throw Error('Primary click must immediately start all once without selection or confirmation');
        if(dialog())throw Error('Starting the task must keep the library usable without hiding a modal');
        await window.fixture.control({blockStart:false,releaseStart:true});await wait(()=>find('reopen'));
        if(dialog()||(await state()).calls.cancel.length||(await state()).calls.choices.length)throw Error('Closing pending start must retain the task without reopening or rendering candidates');
        document.querySelector('[data-fixture-nav]').click();await wait(()=>document.querySelector('[data-fixture-other]'));
        await window.fixture.control({complete:true});await wait(()=>find('summary')?.textContent.includes('Updated 2'));
        await window.fixture.control({blockChoices:true});click('reopen');await wait(dialog);
        if(!find('summary').textContent.includes('Choose image 2')||!find('summary').textContent.includes('Failed 1')||!find('summary').textContent.includes('Skipped 1'))throw Error('Global summary lost counts across navigation');
        checks.push('one-click all, duplicate guard, pending hide, navigation and background progress');
        await wait(()=>find('choices-loading'));click('hide');await wait(()=>!dialog()&&find('reopen'));click('reopen');
        await window.fixture.control({blockChoices:false,releaseChoices:true});await wait(ready);
        click('review-review-b');await wait(()=>ready()&&cards()[0].dataset.coverTaskCandidate.startsWith('review-b-'));await delay(100);
        if(cards().length!==8||cards().some(card=>!card.dataset.coverTaskCandidate.startsWith('review-b-')))throw Error('A late hidden choice page replaced the current review');
        click('next-page');await wait(()=>cards().length===4&&ready());
        if((await state()).calls.choices.at(-1).offset!==8)throw Error('Candidate pagination did not request only the next eight');
        click('previous-page');await wait(()=>cards().length===8&&ready());
        checks.push('lazy eight-image pages and late response guards across hide/reopen');
        await window.fixture.control({choicesError:'covers.missingShader'});click('review-review-a');await wait(()=>find('choices-error'));
        if(!find('choices-error').textContent.includes('shader')||!find('retry-choices'))throw Error('Candidate load failure needs localized advice and retry');
        await window.fixture.control({choicesError:''});click('retry-choices');await wait(ready);
        await window.fixture.control({blockApply:true});cards()[0].click();cards()[1].click();await wait(()=>find('applying'));
        if((await state()).calls.apply.length!==1||[...dialog().querySelectorAll('button')].some(button=>['Save cover','Generate preview'].includes(button.textContent.trim())))throw Error('Image click must save immediately once without another generation/save step');
        await window.fixture.control({blockApply:false,releaseApply:true});await wait(()=>ready()&&cards()[0].dataset.coverTaskCandidate.startsWith('review-b-'));
        if((await state()).calls.choices.at(-1).assetId!=='review-b')throw Error('Saving did not advance to next review');
        await window.fixture.control({blockApply:true});cards()[0].click();await wait(()=>find('applying'));click('hide');await wait(()=>!dialog()&&find('reopen'));click('reopen');
        if(cards().length)throw Error('Reopening retained candidate thumbnails from a pending save');
        await window.fixture.control({blockApply:false,releaseApply:true});await wait(()=>find('summary').textContent.includes('Choose image 0'));
        if((await state()).calls.cancel.length||cards().length)throw Error('Hide cancelled a save or resurrected candidate previews');
        checks.push('localized candidate failure retry, one-click save, duplicate lock and next-review advance');
        click('retry');find('retry')?.click();await wait(()=>find('stop'));
        if((await state()).calls.retry.length!==1)throw Error('Retry duplicated the task');
        click('stop');find('stop')?.click();await wait(()=>find('undo')&&!find('undo').disabled);
        if((await state()).calls.cancel.length!==1)throw Error('Explicit stop was not sent once');
        click('undo');find('undo')?.click();await wait(()=>find('undo-result'));
        if(!find('undo-result').textContent.includes('Restored 2')||!find('undo-result').textContent.includes('1 later changes kept')||(await state()).calls.undo.length!==1)throw Error('Undo must report restored and protected counts once');
        checks.push('failed-only retry, explicit stop and protected undo count');
        click('hide');document.querySelector('[data-fixture-nav]').click();await wait(()=>find('start'));
        find('scopes').click();await wait(()=>find('scope-filtered'));click('scope-filtered');await wait(()=>find('stop'));
        let request=(await state()).calls.start.at(-1);
        if(request.scope!=='filtered'||request.filter.collectionId!=='wardrobe'||request.filter.search!=='silver'||request.filter.limit||request.assetIds)throw Error('Filtered scope must send complete query, never loaded-card IDs or pagination');
        click('stop');await wait(()=>!find('stop'));document.querySelector('[data-fixture-select]').click();await delay(50);
        find('scopes').click();await wait(()=>find('scope-selected')&&!find('scope-selected').disabled);click('scope-selected');await wait(()=>find('stop'));
        request=(await state()).calls.start.at(-1);
        if(JSON.stringify(request)!==JSON.stringify({scope:'ids',assetIds:['selected-a','selected-b']}))throw Error('Selected scope did not capture selection');
        click('stop');await wait(()=>!find('stop'));await window.fixture.control({startError:'controlled-start-failure'});click('start');await wait(()=>find('error'));
        if(!find('error').textContent.includes('try again')||find('error').querySelector('details')?.open)throw Error('Request error needs localized recovery and collapsed technical details');
        checks.push('filtered query, selected IDs and localized request failure');
        await window.fixture.control({startError:''});click('start');await wait(()=>find('stop'));
        await window.fixture.control({complete:true});await wait(()=>find('summary').textContent.includes('Updated 2'));
        click('reopen');await wait(ready);
        return {checks,count:checks.length};
      })()`);
      await win.webContents.capturePage().then(picture => fs.writeFileSync(path.join(evidenceDir, 'cover-tasks.png'), picture.toPNG()));
      fs.writeFileSync(path.join(evidenceDir, 'electron-cover-tasks-evidence.json'), JSON.stringify({ method: 'Production AssetGrid + CoverTasks + store/locales/styles; real React/Electron/IPC; isolated task boundary', fixture, ...result, calls }, null, 2));
      console.log('[ATRIUM_COVER_TASKS_UI] PASS ' + result.count + ' scenario groups'); app.quit();
    } catch (error) {
      const ui = await win.webContents.executeJavaScript('({text:document.body.textContent.slice(-6500)})');
      fs.writeFileSync(path.join(evidenceDir, 'electron-cover-tasks-failure.json'), JSON.stringify({ error: error.stack, calls, ui }, null, 2));
      console.error(error.stack); console.error(JSON.stringify({ calls, ui }, null, 2)); app.exit(1);
    }
  });
}
