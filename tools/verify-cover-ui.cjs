const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
// Requires a disposable Unity fixture running AtriumPreviewVerification.Serve.
// Never points Electron discovery or database writes at the user's real home.
const root=path.resolve(__dirname,'..');
const evidenceDir=path.join(root,'tmp','cover-verification');
fs.mkdirSync(evidenceDir,{recursive:true});
const project=path.resolve(process.env.AVCA_COVER_TEST_PROJECT||path.join(evidenceDir,'unity-sandbox'));
if(!/sandbox|avca/i.test(project)||!fs.existsSync(path.join(project,'Assets/Editor/AtriumPreviewVerification.cs')))
  throw Error('Use an isolated Unity sandbox with the preview verification fixture installed');
const image=path.join(project,'PreviewEvidence/cube-1.png');
const evidence=path.join(evidenceDir,'electron-cover-evidence.json');
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
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron cover verification timed out'));},90000);
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Electron stage failed: '+code));});
    });
  }
  run('first').then(()=>run('restart')).catch(error=>{console.error(error.stack);process.exitCode=1;});
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
  const {app,BrowserWindow,dialog,nativeImage}=require('electron');
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
      if(process.env.ATRIUM_COVER_STAGE==='first'){
        const insert=db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,cover_image,created_at,updated_at) VALUES(?,?,?,'props','classified','index',1,'none',?,?)");
        for(const [id,name] of [['cover-one','Chocolate Cover'],['cover-two','Manual Cover']])insert.run(id,name,name,Date.now(),Date.now());
      }
      db.close();
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
        click('搜索');await wait(()=>dialog().querySelectorAll('select')[1].options.length>2);
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
