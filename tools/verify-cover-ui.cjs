const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
// The default integration flow requires a disposable Unity fixture running
// AtriumPreviewVerification.Serve. ATRIUM_COVER_CANDIDATES_ONLY exercises the
// real renderer/preload/IPC with controlled external Unity responses instead.
// Add ATRIUM_COVER_SAVE_RACE_ONLY for the pending-save renderer regression.
// ATRIUM_COVER_LIVE_CANDIDATES uses copied licensed sources named by
// ATRIUM_COVER_SAMPLE_SOURCES, a JSON array under the ignored evidence directory.
// Never points Electron discovery or database writes at the user's real home.
const root=path.resolve(__dirname,'..');
const evidenceDir=path.join(root,'tmp','cover-verification');
fs.mkdirSync(evidenceDir,{recursive:true});
const project=path.resolve(process.env.AVCA_COVER_TEST_PROJECT||path.join(evidenceDir,'unity-sandbox'));
if(!/sandbox|avca/i.test(project)||!fs.existsSync(path.join(project,'Assets/Editor/AtriumPreviewVerification.cs')))
  throw Error('Use an isolated Unity sandbox with the preview verification fixture installed');
const image=path.join(project,'PreviewEvidence/cube-1.png');
const evidence=path.join(evidenceDir,'electron-cover-evidence.json');
const liveSamples=process.env.ATRIUM_COVER_LIVE_CANDIDATES?(()=>{
  const file=path.resolve(process.env.ATRIUM_COVER_SAMPLE_SOURCES||'');
  assert.ok(file.startsWith(evidenceDir+path.sep),'Sample metadata must be in the ignored evidence directory');
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.ok(Array.isArray(rows)&&rows.length>=2,'Supply at least two copied licensed source samples');
  return rows.map((row,index)=>{
    const name=row.name||'Sample '+index;
    const source=row.source??row.file??null, library=row.library??null;
    for(const input of [source,library].filter(Boolean))assert.ok(path.resolve(input).startsWith(evidenceDir+path.sep),'Use copied sample files in the ignored evidence directory');
    assert.ok([source,library].some(input=>input&&fs.existsSync(input)),'Copied sample source is missing');
    const defaultPath=/pocky|百奇/i.test(name)?'Assets/Stick/stick_choco_game_MA.prefab':'Assets/Valentines/Valentines.prefab';
    const expectedPath=row.expectedPath?.startsWith('Assets/')?row.expectedPath:defaultPath;
    assert.ok(!row.expectedPath||expectedPath.includes(row.expectedPath),'Expected source hint must match the known imported sample');
    const expectedFile=path.resolve(project,expectedPath);
    assert.ok(expectedFile.startsWith(path.join(project,'Assets')+path.sep),'Expected object must belong to the isolated project');
    const expectedGuid=fs.readFileSync(expectedFile+'.meta','utf8').match(/^guid:\s*([a-f0-9]{32})\s*$/m)?.[1];
    assert.ok(expectedGuid,'Expected imported object metadata is missing');
    return {id:'cover-live-'+index,name:'Live '+name,source,library,expectedPath,expectedGuid};
  });
})():[];
if (!process.versions.electron) {
  const sandbox=fs.mkdtempSync(path.join(evidenceDir,'avca-sandbox-covers-'));
  fs.mkdirSync(path.join(sandbox,'Library')); fs.mkdirSync(path.join(sandbox,'temp'));
  const manifest=path.join(sandbox,'Local/VRChatCreatorCompanion/settings.json');
  fs.mkdirSync(path.dirname(manifest),{recursive:true});fs.writeFileSync(manifest,JSON.stringify({userProjects:[project]}));
  const env={...process.env, AVCA_APP_HOME:sandbox,AVCA_REQUIRE_SANDBOX_HOME:'1',APPDATA:path.join(sandbox,'Roaming'),LOCALAPPDATA:path.join(sandbox,'Local'),TEMP:path.join(sandbox,'temp'),TMP:path.join(sandbox,'temp')};
  delete env.ELECTRON_RUN_AS_NODE;
  if(!process.env.ATRIUM_COVER_DEV_URL)delete env.ELECTRON_RENDERER_URL;
  else env.ELECTRON_RENDERER_URL=process.env.ATRIUM_COVER_DEV_URL;
  async function run(stage) {
    return new Promise((resolve,reject)=>{
      const child=require('node:child_process').spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[__filename],{cwd:root,env:{...env,ATRIUM_COVER_STAGE:stage},windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron cover verification timed out'));},stage==='live-candidates'?240000:90000);
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Electron stage failed: '+code));});
    });
  }
  (process.env.ATRIUM_COVER_LIVE_CANDIDATES?run('live-candidates'):process.env.ATRIUM_COVER_CANDIDATES_ONLY?run('candidates'):run('first').then(()=>run('restart'))).catch(error=>{console.error(error.stack);process.exitCode=1;});
} else {
  // Render hidden windows offscreen so evidence includes the latest frame,
  // rather than a stale compositor surface from a background window.
  const Module=require('node:module'), originalLoad=Module._load;
  Module._load=function(request,...args){
    const api=originalLoad.call(this,request,...args);
    if(request!=='electron')return api;
    return new Proxy(api,{get(target,key){
      if(key!=='BrowserWindow')return Reflect.get(target,key);
      return new Proxy(target.BrowserWindow,{construct(Window,[options]){
        return new Window({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}});
      }});
    }});
  };
  const {app,BrowserWindow,dialog,nativeImage,ipcMain}=require('electron');
  const Database=require('better-sqlite3');
  const sandbox=process.env.AVCA_APP_HOME;
  assert.ok(sandbox.startsWith(evidenceDir+path.sep)&&sandbox.includes('avca-sandbox'));
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[image]});
  dialog.showOpenDialogSync=()=>[image];
  process.argv=[process.argv[0]];
  BrowserWindow.prototype.show=function(){};BrowserWindow.prototype.focus=function(){};
  let checked=false;
  app.on('browser-window-created',(_e,win)=>win.webContents.once('did-finish-load',async()=>{
    if(checked)return;checked=true;
    // These isolated windows stay hidden; keep timers and image loading active
    // so UI waits measure application behavior, not background throttling.
    win.webContents.setBackgroundThrottling(false);
    try {
      const setup=await win.webContents.executeJavaScript(`(async()=>{
        for(let i=0;i<100&&!document.body.textContent.includes('首次配置');i++)await new Promise(r=>setTimeout(r,100));
        await window.a.settings.setMany({libraryRoot:${JSON.stringify(path.join(sandbox,'Library'))},libraryMode:'fresh',onboardingDone:true,autoLaunchAsked:true,minimizeToTray:false});
        const projects=await window.a.unity.refreshProjects();
        for(const ask of await window.a.unity.pendingBridgeAsk())await window.a.unity.answerBridgeAsk(ask.projectId,'never');
        const chosen=projects.find(p=>p.path.replaceAll('\\\\','/').toLowerCase()===${JSON.stringify(project.replaceAll('\\','/').toLowerCase())});
        if(!chosen)throw Error('Test project missing');await window.a.unity.setTarget(chosen.id);
        return {id:chosen.id,paths:await window.a.system.paths()};
      })()`);
      assert.equal(setup.paths.appData,sandbox);
      console.log('[COVER_UI] setup complete');
      const db=new Database(setup.paths.dbPath);
      if(['first','candidates'].includes(process.env.ATRIUM_COVER_STAGE)){
        const insert=db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,cover_image,created_at,updated_at) VALUES(?,?,?,'props','classified','index',1,'none',?,?)");
        for(const [id,name] of [['cover-one','Chocolate Cover'],['cover-two','Manual Cover']])insert.run(id,name,name,Date.now(),Date.now());
      }
      if(process.env.ATRIUM_COVER_STAGE==='live-candidates'){
        const insert=db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,cover_image,source_path,library_path,created_at,updated_at) VALUES(?,?,?,'props','classified','index',1,'none',?,?,?,?)");
        for(const sample of liveSamples){
          insert.run(sample.id,sample.name,sample.name,sample.source,sample.library,Date.now(),Date.now());
          assert.equal(db.prepare('SELECT COUNT(*) AS n FROM import_log WHERE asset_id = ? OR container_asset_id = ?').get(sample.id,sample.id).n,0,'Live card must not depend on import history');
          assert.equal(db.prepare('SELECT COUNT(*) AS n FROM package_entry WHERE asset_id = ?').get(sample.id).n,0,'Live card must discover original ZIP metadata without cached entries');
        }
      }
      db.close();
      if(process.env.ATRIUM_COVER_STAGE==='live-candidates'){
        const results=[];
        win.webContents.setBackgroundThrottling(false);
        for(const [index,sample] of liveSamples.entries()){
          console.log('[COVER_LIVE] finding '+sample.name);
          const prepared=await win.webContents.executeJavaScript(`(async()=>{
            const sample=${JSON.stringify(sample)};
            const delay=()=>new Promise(resolve=>setTimeout(resolve,100));
            const wait=async fn=>{for(let i=0;i<900;i++){if(await fn())return;await delay();}throw Error('Live candidate UI timed out: '+fn.toString()+'; UI: '+document.body.textContent.slice(-3500));};
            const dialog=()=>document.querySelector('[role="dialog"]');
            const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
            const click=label=>{const item=button(label);if(!item||item.disabled)throw Error('Unavailable button: '+label);item.click();};
            await wait(async()=>{const status=await window.a.covers.status(sample.id,${JSON.stringify(setup.id)});return status.bridge==='ready'&&status.candidates;});
            const requestId=crypto.randomUUID();
            const discovered=await window.a.covers.discover(sample.id,${JSON.stringify(setup.id)},requestId);
            await window.a.covers.discard(requestId);
            if(!discovered.targets.some(target=>target.path===sample.expectedPath&&target.sourceGuid===sample.expectedGuid))throw Error('Exact expected prefab missing: '+JSON.stringify(discovered));
            if(discovered.targets.some(target=>!target.memberPaths.length))throw Error('Original ZIP member provenance missing');
            await window.a.assets.patch(sample.id,{name:sample.name});
            await wait(()=>button('全部素材'));click('全部素材');
            const card=()=>[...document.querySelectorAll('.card')].find(item=>item.textContent.includes(sample.name));
            await wait(()=>card());card().click();
            await wait(()=>[...document.querySelectorAll('aside')].some(aside=>aside.textContent.includes(sample.name)));
            await wait(()=>button('编辑封面'));click('编辑封面');
            await wait(()=>dialog()?.querySelectorAll('[data-cover-candidate]').length===Math.min(8,discovered.targets.length));
            let expected=discovered.targets.find(target=>target.path===sample.expectedPath&&target.sourceGuid===sample.expectedGuid);
            while(![...dialog().querySelectorAll('[data-cover-candidate]')].some(item=>item.dataset.coverCandidate===expected.id)){
              await wait(()=>!button('显示更多物品')?.disabled);click('显示更多物品');
              await delay();
            }
            await wait(()=>[...dialog().querySelectorAll('[data-cover-candidate]')].every(item=>item.querySelector('img')?.naturalWidth>0));
            if(!button('保存封面').disabled||dialog().querySelector('[data-cover-candidate][aria-pressed="true"]'))throw Error('Live discovery selected a candidate automatically');
            if((await window.a.assets.get(sample.id)).cover_image!=='none')throw Error('Live thumbnails changed the card before confirmation');
            const images=[...dialog().querySelectorAll('[data-cover-candidate]')].map(item=>({targetId:item.dataset.coverCandidate,url:item.querySelector('img').getAttribute('src'),text:item.textContent}));
            return {discovered,images,chosen:expected};
          })()`);
          for(const target of prepared.discovered.targets){
            const targetFile=path.resolve(project,target.path);
            assert.ok(targetFile.startsWith(path.join(project,'Assets')+path.sep),'Discovery returned a path outside isolated Assets');
            assert.equal(fs.readFileSync(targetFile+'.meta','utf8').match(/^guid:\s*([a-f0-9]{32})\s*$/m)?.[1],target.sourceGuid,'Candidate GUID must resolve the exact imported source');
          }
          const images=[];
          for(const [imageIndex,item] of prepared.images.entries()){
            assert.ok(item.url.startsWith('athumb://preview-'),'Candidate must use a temporary image');
            const source=path.join(setup.paths.thumbs,item.url.replace('athumb://',''));
            assert.equal(nativeImage.createFromPath(source).getSize().width,320,'Actual candidate image must decode');
            const output=path.join(evidenceDir,'live-candidate-'+index+'-'+imageIndex+'.jpg');
            fs.copyFileSync(source,output);images.push({...item,file:output});
          }
          let screenshot=null;
          const capture=await Promise.race([win.webContents.capturePage(),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);
          if(capture){screenshot=path.join(evidenceDir,'live-candidates-ui-'+index+'.png');fs.writeFileSync(screenshot,capture.toPNG());}
          const saved=await win.webContents.executeJavaScript(`(async()=>{
            const sample=${JSON.stringify(sample)},chosen=${JSON.stringify(prepared.chosen)};
            const delay=()=>new Promise(resolve=>setTimeout(resolve,100));
            const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await delay();}throw Error('Live candidate save timed out');};
            const dialog=()=>document.querySelector('[role="dialog"]');
            const buttons=()=>[...document.querySelectorAll('button')];
            const candidate=[...dialog().querySelectorAll('[data-cover-candidate]')].find(item=>item.dataset.coverCandidate===chosen.id);
            if(!candidate)throw Error('Chosen candidate disappeared');candidate.click();
            await wait(()=>!buttons().find(item=>item.textContent==='保存封面').disabled);
            if((await window.a.assets.get(sample.id)).cover_image!=='none')throw Error('Candidate selection changed the cover before save');
            buttons().find(item=>item.textContent==='保存封面').click();await wait(()=>!dialog());
            const status=await window.a.covers.status(sample.id,${JSON.stringify(setup.id)});
            if(status.record?.target?.id!==chosen.id||status.record?.target?.sourceGuid!==sample.expectedGuid)throw Error('Saved association did not match clicked candidate');
            const cover=(await window.a.assets.get(sample.id)).cover_image;
            const card=()=>[...document.querySelectorAll('.card')].find(item=>item.textContent.includes(sample.name));
            await wait(()=>card()?.querySelector('img')?.getAttribute('src')===cover&&card().querySelector('img')?.naturalWidth>0);
            return {cover,record:status.record};
          })()`);
          assert.equal(nativeImage.createFromPath(path.join(setup.paths.thumbs,saved.cover.replace('athumb://',''))).getSize().width,320);
          results.push({sample,discovered:prepared.discovered,images,screenshot,...saved});
          console.log('[COVER_LIVE] saved clicked candidate '+prepared.chosen.path);
        }
        const check=new Database(setup.paths.dbPath);
        assert.equal(check.prepare('SELECT COUNT(*) AS n FROM import_log').get().n,0,'Original source discovery must not create import records');check.close();
        fs.writeFileSync(path.join(evidenceDir,'electron-live-candidate-evidence.json'),JSON.stringify({method:'Real Electron renderer clicks, IPC, isolated SQLite, original licensed ZIP metadata, actual Unity GUID matching/rendering and native image decoder',sandbox,project,noImportHistory:true,explicitSave:true,results},null,2));
        console.log('[ATRIUM_LIVE_CANDIDATES_ELECTRON] PASS');app.quit();return;
      }
      if(process.env.ATRIUM_COVER_STAGE==='candidates'){
        const calls={discover:[],preview:[],discard:[],save:[]};
        const pending=new Map();
        const candidates=Array.from({length:10},(_,index)=>({id:'asset:candidate-'+index,name:'Matched Item '+index,path:'Assets/Imported/Item'+index+'.prefab',persistent:true,isScene:false,sourceGuid:String(index+1).padStart(32,'0'),memberPaths:['Assets/Original/Item'+index+'.prefab']}));
        const replace=(channel,fn)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,async(_event,...args)=>({ok:true,data:await fn(...args)}));};
        let record=null, slow=false, slowAfter=Infinity, delayedSave=false, saveContinue=null;
        replace('covers:status',()=>({record,bridge:'ready',candidates:true}));
        replace('covers:discover',async(assetId,projectId,requestId)=>{
          calls.discover.push({assetId,projectId,requestId});
          return {targets:candidates,warnings:[],truncated:false};
        });
        const imageUrl='data:image/png;base64,'+fs.readFileSync(image).toString('base64');
        replace('covers:preview',async request=>{
          calls.preview.push(request);
          if(slow||calls.preview.length>slowAfter)await new Promise(resolve=>pending.set(request.requestId,resolve));
          return {id:request.requestId,url:imageUrl,width:320,height:240,rendererCount:1};
        });
        replace('covers:discard',requestId=>{calls.discard.push(requestId);pending.get(requestId)?.();pending.delete(requestId);});
        replace('covers:save',async(assetId,id)=>{
          calls.save.push({assetId,id});
          if(delayedSave)await new Promise(resolve=>{saveContinue=resolve;});
          const chosen=calls.preview.find(request=>request.requestId===id);
          assert.ok(chosen,'Only a generated candidate may be saved');
          record={assetId,coverImage:'none',previousImage:null,source:'unity',projectId:chosen.projectId,target:chosen.target,options:chosen.options};
          return record;
        });
        if(process.env.ATRIUM_COVER_SAVE_RACE_ONLY){
          slowAfter=1;delayedSave=true;
          const race=await win.webContents.executeJavaScript(`(async()=>{
            const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
            const wait=async fn=>{for(let i=0;i<140;i++){if(await fn())return;await delay();}throw Error('Delayed save UI timed out: '+fn.toString()+'; UI: '+document.body.textContent.slice(-2500));};
            const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
            await window.a.assets.patch('cover-one',{name:'Chocolate Cover'});
            await wait(()=>button('全部素材'));button('全部素材').click();
            await wait(()=>[...document.querySelectorAll('.card')].some(card=>card.textContent.includes('Chocolate Cover')));
            [...document.querySelectorAll('.card')].find(card=>card.textContent.includes('Chocolate Cover')).click();
            await wait(()=>button('编辑封面'));button('编辑封面').click();
            await wait(()=>document.querySelector('[data-cover-candidate] img')?.naturalWidth>0&&button('取消查找'));
            document.querySelector('[data-cover-candidate]').click();await wait(()=>!button('保存封面').disabled);
            button('保存封面').click();await delay();
            if(button('取消查找')&&!button('取消查找').disabled)throw Error('Cancel search remained active while an explicit Save is in flight');
            if([...document.querySelectorAll('[role="dialog"] select')].some(select=>!select.disabled))throw Error('Options remained mutable during Save');
            if((await window.a.assets.get('cover-one')).cover_image!=='none')throw Error('Save response has not resolved, but cover changed');
            return {saveControlsLocked:true};
          })()`);
          assert.ok(saveContinue,'Save should still be pending');assert.equal(pending.size,1,'Second thumbnail should be rendering during Save');
          saveContinue();
          await win.webContents.executeJavaScript(`(async()=>{for(let i=0;i<140&&document.querySelector('[role="dialog"]');i++)await new Promise(resolve=>setTimeout(resolve,50));if(document.querySelector('[role="dialog"]'))throw Error('Saved cover editor did not close');await new Promise(resolve=>setTimeout(resolve,100));})()`);
          assert.equal(calls.save.length,1);assert.equal(pending.size,0,'Close after Save must discard the blocked thumbnail');
          fs.writeFileSync(path.join(evidenceDir,'electron-save-race-evidence.json'),JSON.stringify({method:'Real Electron renderer/preload/IPC with controlled delayed external Save and thumbnail responses',sandbox,project,...race,savedOnce:true,queuedThumbnailDiscarded:true,calls},null,2));
          console.log('[ATRIUM_COVER_SAVE_RACE_ELECTRON] PASS');app.quit();return;
        }
        const candidateResult=await win.webContents.executeJavaScript(`(async()=>{
          const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
          const wait=async fn=>{for(let i=0;i<140;i++){if(await fn())return;await delay();}throw Error('Candidate UI condition timed out: '+fn.toString()+'; UI: '+document.body.textContent.slice(-2500));};
          const dialog=()=>document.querySelector('[role="dialog"]');
          const button=label=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===label);
          const click=label=>{const item=button(label);if(!item||item.disabled)throw Error('Unavailable button: '+label);item.click();};
          const cards=()=>[...dialog().querySelectorAll('[data-cover-candidate]')];
          await window.a.assets.patch('cover-one',{name:'Chocolate Cover'});
          await wait(()=>button('全部素材'));click('全部素材');
          await wait(()=>[...document.querySelectorAll('.card')].some(card=>card.textContent.includes('Chocolate Cover')));
          [...document.querySelectorAll('.card')].find(card=>card.textContent.includes('Chocolate Cover')).click();
          await wait(()=>button('编辑封面'));click('编辑封面');
          await wait(()=>dialog()?.querySelectorAll('[data-cover-candidate]').length===8);
          await wait(()=>cards().every(card=>card.querySelector('img')?.naturalWidth>0));
          if(!button('保存封面').disabled||cards().some(card=>card.getAttribute('aria-pressed')==='true'))throw Error('Discovery automatically selected a candidate');
          if(!cards()[0].textContent.includes('Assets/Original/Item0.prefab'))throw Error('Candidate omitted package-member provenance');
          if((await window.a.assets.get('cover-one')).cover_image!=='none')throw Error('Discovery overwrote existing cover');
          cards()[1].click();await wait(()=>!button('保存封面').disabled);
          const angles=[...dialog().querySelectorAll('select')].find(select=>[...select.options].some(option=>option.value==='bottom'));
          angles.value='bottom';angles.dispatchEvent(new Event('change',{bubbles:true}));
          await delay();await wait(()=>cards().every(card=>card.querySelector('img')?.naturalWidth>0)&&!button('保存封面').disabled);
          click('保存封面');await wait(()=>!dialog());
          click('编辑封面');await wait(()=>button('重新查找物品'));
          if(dialog().querySelectorAll('[data-cover-candidate]').length)throw Error('Linked item was automatically rediscovered');
          click('重新查找物品');await wait(()=>cards().length===8);
          await wait(()=>cards().every(card=>card.querySelector('img')?.naturalWidth>0));
          click('显示更多物品');await wait(()=>cards().length===10);
          await wait(()=>cards().every(card=>card.querySelector('img')?.naturalWidth>0));
          click('取消');await wait(()=>!dialog());
          return {candidateChoice:true,explicitSave:true,boundedInitialPreviews:true,memberProvenance:true,linkedRediscovery:true,optionsRefresh:true};
        })()`);
        assert.equal(calls.save.length,1,'Discovery and thumbnail generation must never save a cover');
        assert.equal(calls.preview.find(call=>call.requestId===calls.save[0].id).target.id,'asset:candidate-1');
        assert.equal(calls.preview.find(call=>call.requestId===calls.save[0].id).options.direction,'bottom','Changed options must replace the selected preview');
        assert.equal(calls.discover.length,2,'Linked item rediscovery must be explicit');
        assert.equal(calls.preview.length,26,'Render only visible candidates, refresh changed options and reuse selected thumbnail');
        for(const request of calls.preview)assert.ok(calls.discard.includes(request.requestId),'Close must discard every candidate thumbnail');
        slow=true;
        record=null;
        await win.webContents.executeJavaScript(`(async()=>{
          const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
          const wait=async fn=>{for(let i=0;i<140;i++){if(await fn())return;await delay();}throw Error('Cancellation UI timed out');};
          [...document.querySelectorAll('button')].find(button=>button.textContent==='编辑封面').click();
          await wait(()=>document.querySelector('[data-cover-candidate]'));
          await wait(()=>[...document.querySelectorAll('[role="dialog"] button')].some(button=>button.textContent==='取消查找'));
          [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='取消查找').click();
          await delay();
          const save=[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='保存封面');
          if(!save.disabled||document.querySelector('[role="dialog"] img'))throw Error('Cancelled result became eligible for save');
          [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='取消').click();
        })()`);
        assert.equal(calls.save.length,1,'Cancelled preview must not save');
        assert.equal(pending.size,0,'Cancellation must discard in-flight candidate rendering');
        slow=false;
        const manualResult=await win.webContents.executeJavaScript(`(async()=>{
          const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
          const wait=async fn=>{for(let i=0;i<140;i++){if(await fn())return;await delay();}throw Error('Manual-cover protection UI timed out');};
          await window.a.covers.upload('cover-two',${JSON.stringify(image)});
          const original=(await window.a.assets.get('cover-two')).cover_image;
          [...document.querySelectorAll('.card')].find(card=>card.textContent.includes('Manual Cover')).click();
          await wait(()=>[...document.querySelectorAll('aside')].some(aside=>aside.textContent.includes('Manual Cover')));
          [...document.querySelectorAll('button')].find(button=>button.textContent==='编辑封面').click();
          await wait(()=>document.querySelector('[role="dialog"] [data-cover-candidate] img')?.naturalWidth>0);
          if((await window.a.assets.get('cover-two')).cover_image!==original)throw Error('Auto candidates overwrote manual cover');
          [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='取消').click();
          await delay();
          if((await window.a.assets.get('cover-two')).cover_image!==original)throw Error('Cancellation overwrote manual cover');
          return {manualCoverProtected:true};
        })()`);
        const candidateEvidence=path.join(evidenceDir,'electron-candidate-evidence.json');
        fs.writeFileSync(candidateEvidence,JSON.stringify({method:'Real Electron renderer, preload and IPC with isolated SQLite and controlled Unity responses',sandbox,project,...candidateResult,...manualResult,cancelledLatePreview:true,calls},null,2));
        console.log('[ATRIUM_CANDIDATES_ELECTRON] PASS');app.quit();return;
      }
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const phase=name=>console.log('[COVER_UI] '+name);
        const delay=()=>new Promise(r=>setTimeout(r,100));
        const wait=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await delay();}throw Error('UI condition timed out: '+fn.toString()+'; UI: '+document.body.textContent.slice(0,2000));};
        const click=label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);if(!button)throw Error('Missing button: '+label);button.click();};
        const dialog=()=>document.querySelector('[role="dialog"]');
        const cover=async()=>window.a.assets.get('cover-one');
        await window.a.assets.patch('cover-one',{name:'Chocolate Cover'});await window.a.assets.patch('cover-two',{name:'Manual Cover'});
        await wait(()=>document.body.textContent.includes('全部素材'));click('全部素材');
        await wait(()=>[...document.querySelectorAll('.card')].some(c=>c.textContent.includes('Chocolate Cover')));
        const card=()=>[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Chocolate Cover'));
        card().click();await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='编辑封面'));
        if(${JSON.stringify(process.env.ATRIUM_COVER_STAGE)}==='restart'){
          const status=await window.a.covers.status('cover-one',${JSON.stringify(setup.id)});
          if(status.record?.source!=='unity')throw Error('Association did not survive restart');
          await wait(()=>card().querySelector('img')?.naturalWidth>0);
          return {restart:true,record:status.record,cover:(await cover()).cover_image};
        }
        phase('first preview');click('编辑封面');await wait(()=>dialog()?.textContent.includes('读取 Unity 当前选中物品'));
        const projectSelect=dialog().querySelector('select');projectSelect.value=${JSON.stringify(setup.id)};projectSelect.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>![...dialog().querySelectorAll('button')].find(b=>b.textContent==='读取 Unity 当前选中物品')?.disabled);
        click('读取 Unity 当前选中物品');await wait(()=>dialog().querySelectorAll('select').length===4);
        const searchInput=dialog().querySelector('input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchInput,'Valentines');
        searchInput.dispatchEvent(new Event('input',{bubbles:true}));
        await wait(()=>![...dialog().querySelectorAll('button')].find(b=>b.textContent==='搜索')?.disabled);
        click('搜索');await wait(()=>dialog().querySelectorAll('select').length===4&&dialog().querySelectorAll('select')[1].options.length>2);
        const objectSelect=dialog().querySelectorAll('select')[1];
        if(objectSelect.value!==''||![...dialog().querySelectorAll('button')].find(b=>b.textContent==='生成预览').disabled)throw Error('Multiple targets were guessed automatically');
        const prefabOption=[...objectSelect.options].find(o=>o.textContent.includes('Valentines.prefab'));
        if(!prefabOption)throw Error('Chocolate prefab search result missing');
        objectSelect.value=prefabOption.value;objectSelect.dispatchEvent(new Event('change',{bubbles:true}));
        const angles=[...dialog().querySelectorAll('select')][2];angles.value='bottom';angles.dispatchEvent(new Event('change',{bubbles:true}));
        click('生成预览');await wait(()=>dialog()?.querySelector('img')?.naturalWidth>0);
        if((await cover()).cover_image!=='none')throw Error('Preview changed card before confirmation');
        click('保存封面');await wait(()=>!dialog());
        const first=(await cover()).cover_image;
        if(!first.startsWith('athumb://cover-'))throw Error('Generated image was not saved');
        await wait(()=>card().querySelector('img')?.naturalWidth>0);
        phase('restore');
        click('编辑封面');await wait(()=>dialog()?.textContent.includes('读取 Unity 当前选中物品'));
        click('恢复原始封面');await wait(()=>!dialog());
        if((await cover()).cover_image!=='none')throw Error('Restore did not restore original');
        phase('cancel');
        click('编辑封面');await wait(()=>dialog()?.textContent.includes('读取 Unity 当前选中物品'));
        await wait(()=>![...dialog().querySelectorAll('button')].find(b=>b.textContent==='读取 Unity 当前选中物品')?.disabled);
        click('读取 Unity 当前选中物品');await wait(()=>dialog().querySelectorAll('select').length===4);
        click('生成预览');await wait(()=>dialog()?.querySelector('img')?.naturalWidth>0);
        click('取消');await wait(()=>!dialog());
        if((await cover()).cover_image!=='none')throw Error('Cancelled preview changed card');
        phase('upload');
        // Native picker returns a fixture; all renderer and IPC actions are real.
        const manualCard=()=>[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Manual Cover'));
        manualCard().click();await wait(()=>[...document.querySelectorAll('aside')].some(a=>a.textContent.includes('Manual Cover')));
        click('编辑封面');await wait(()=>dialog()?.textContent.includes('选择本地图片'));click('选择本地图片');await wait(()=>!dialog());
        const manual=(await window.a.assets.get('cover-two')).cover_image;
        phase('batch preparation');
        const targets=await window.a.covers.targets(${JSON.stringify(setup.id)},'');
        const preview=await window.a.covers.preview({assetId:'cover-one',projectId:${JSON.stringify(setup.id)},target:targets[0],options:{direction:'bottom',background:'dark'},requestId:crypto.randomUUID()});
        await window.a.covers.save('cover-one',preview.id);
        card().click();await wait(()=>[...document.querySelectorAll('aside')].some(a=>a.textContent.includes('Chocolate Cover')));
        const other=[...document.querySelectorAll('.card')].find(c=>c.textContent.includes('Manual Cover'));
        other.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));
        await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='更新所选封面'));
        click('更新所选封面');await wait(()=>dialog()?.textContent.includes('开始更新 2 项'));click('开始更新 2 项');
        phase('batch');
        await wait(()=>dialog()?.textContent.includes('保留手动图片'));
        if((await window.a.assets.get('cover-two')).cover_image!==manual)throw Error('Batch overwrote manual image');
        if(!dialog().textContent.includes('已更新 1 / 2 项'))throw Error('Batch result did not report one success and one skip');
        const batchText=dialog().textContent;click('关闭');await wait(()=>!dialog());
        card().click();await wait(()=>[...document.querySelectorAll('aside')].some(a=>a.textContent.includes('Chocolate Cover')));
        const finalCover=(await cover()).cover_image;
        await wait(()=>card().querySelector('img')?.getAttribute('src')===finalCover&&card().querySelector('img')?.naturalWidth>0);
        await wait(()=>[...document.querySelectorAll('aside img')].some(img=>img.getAttribute('src')===finalCover&&img.naturalWidth>0));
        phase('final images loaded');
        return {saved:true,restored:true,cancelled:true,manualProtected:true,multipleCandidates:true,batchText,cover:finalCover,target:targets[0]};
      })()`);
      const savedFile=path.join(setup.paths.thumbs,result.cover.replace('athumb://',''));
      console.log('[COVER_UI] renderer flow complete');
      assert.ok(nativeImage.createFromPath(savedFile).getSize().width===320);
      if(result.restart){const prior=JSON.parse(fs.readFileSync(evidence,'utf8'));prior.restart=true;fs.writeFileSync(evidence,JSON.stringify(prior,null,2));}
      else{
        // Hidden development pages can suspend capturePage; behavioral/image
        // assertions above still run. Capture the bundled renderer separately.
        if(!process.env.ATRIUM_COVER_DEV_URL){
          win.webContents.setBackgroundThrottling(false);
          await new Promise(resolve=>setTimeout(resolve,250));
          const captured=await win.webContents.capturePage();fs.writeFileSync(path.join(evidenceDir,'covers-ui.png'),captured.toPNG());
        }
        fs.writeFileSync(evidence,JSON.stringify({method:'Real compiled Electron app, renderer clicks, IPC, SQLite, native image decoder and live Unity bridge in isolated project',sandbox,project,...result},null,2));
      }
      console.log('[ATRIUM_COVERS_ELECTRON] PASS '+process.env.ATRIUM_COVER_STAGE);
      app.quit();
    }catch(error){console.error(error.stack);app.exit(1);}
  }));
  require(path.join(root,'out/main/index.js'));
}
