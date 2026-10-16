const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'tmp', 'unity-connection-ui');

// Compile the real renderer components and locales. Only the external API and
// store actions are controlled: no SQLite/native ABI, user library or Unity.
if (!process.versions.electron) {
  (async () => {
    fs.mkdirSync(evidenceDir, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(evidenceDir, 'component-'));
    const source = file => JSON.stringify(path.join(root, file).replaceAll('\\', '/'));
    fs.writeFileSync(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="./entry.tsx"></script>');
    fs.writeFileSync(path.join(fixture, 'entry.tsx'), `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {TopBar} from ${source('src/renderer/components/chrome.tsx')};
      import {Project} from ${source('src/renderer/pages/Project.tsx')};
      import {FirstRunWizard} from ${source('src/renderer/components/FirstRunWizard.tsx')};
      import {ImportFlow} from ${source('src/renderer/components/ImportFlow.tsx')};
      import {Settings} from ${source('src/renderer/pages/Settings.tsx')};
      import {DetailPanel} from ${source('src/renderer/components/DetailPanel.tsx')};
      import {AssetGrid} from ${source('src/renderer/components/AssetGrid.tsx')};
      import {MemberPicker} from ${source('src/renderer/components/MemberPicker.tsx')};
      import {App} from ${source('src/renderer/App.tsx')};
      import {ImportTargetPicker} from ${source('src/renderer/components/ImportTargetPicker.tsx')};
      import {TooltipProvider} from ${source('src/renderer/components/ui.tsx')};
      import {useUi} from ${source('src/renderer/stores/ui.ts')};
      import {initI18n} from ${source('src/renderer/i18n/index.ts')};
      import ${source('src/renderer/styles.css')};
      await initI18n('en');
      const initial=useUi.getState(); const calls={selected:[],retry:[],cancel:0,patch:[],import:[]};
      const a={id:'a',name:'Avatar One',path:'C:/Fixture/One',running:true,unityVersion:'2022.3.22f1',bridgeInstalled:true};
      const b={id:'b',name:'Avatar Two',path:'C:/Fixture/Two',running:true,unityVersion:'2022.3.22f1',bridgeInstalled:false};
      const closed={id:'closed',name:'Closed Project',path:'C:/Fixture/Closed',running:false,unityVersion:'2022.3.22f1',bridgeInstalled:false};
      const connection=(p,phase)=>({projectId:p.id,name:p.name,projectPath:p.path,phase,reasonKey:null,detail:null});
      const base={...initial,booted:true,wizardStartedHere:false,nav:'project',settings:{...initial.settings,libraryRoot:'C:/Fixture/Library',onboardingDone:true,autoLaunchAsked:true,unityAutoConnect:true},
        projects:[a,b,closed],connection:{projects:[connection(a,'ready'),connection(b,'connecting'),connection(closed,'closed')],targetProjectId:'a',targetMode:'auto',ambiguous:false},
        unity:{...initial.unity,running:true,targetProjectId:'a',bridgeReady:true},targetPicker:{open:false,projectIds:[]},
        refreshProjects:async()=>{},setUnityTarget:async id=>{calls.selected.push(id);useUi.setState(s=>({connection:{...s.connection,targetProjectId:id,targetMode:'manual'},unity:{...s.unity,targetProjectId:id}}));},
        chooseImportTarget:async id=>{calls.selected.push(id);useUi.setState({targetPicker:{open:false,projectIds:[]}});},
        retryUnityConnection:async id=>{calls.retry.push(id);},cancelImportPreparation:()=>{calls.cancel++;useUi.setState(s=>({importFlow:{...s.importFlow,busy:false,busyReason:null}}));},
        patchSettings:async patch=>{calls.patch.push(patch);useUi.setState(s=>({settings:{...s.settings,...patch}}));},
        importAsset:async id=>{calls.import.push(id);},wizardStep:3,wizardSetStep:step=>useUi.setState({wizardStep:step}),
        bridgeAsk:[{projectId:'b',name:b.name,projectPath:b.path}],autoLaunchAsk:false};
      const reactRoot=createRoot(document.getElementById('root'));
      let generation=0;
      window.uiFixture={calls,a,b,closed,connection,base,
        set:patch=>useUi.setState(patch),get:()=>useUi.getState(),
        render:(name,patch={})=>{useUi.setState({...base,...patch},true);const Component={topbar:TopBar,project:Project,wizard:FirstRunWizard,flow:ImportFlow,settings:Settings,detail:DetailPanel,grid:AssetGrid,member:MemberPicker,app:App,picker:ImportTargetPicker}[name];reactRoot.render(<TooltipProvider><React.Fragment key={++generation}>{Component?<Component/>:null}</React.Fragment></TooltipProvider>);}};
      window.uiFixture.render('topbar');
    `);
    fs.writeFileSync(path.join(fixture, 'preload.cjs'), `
      const {contextBridge,ipcRenderer}=require('electron');const call=(name,...args)=>ipcRenderer.invoke('fixture:'+name,...args);
      contextBridge.exposeInMainWorld('a',{unity:{listProjects:()=>call('listProjects'),installBridge:id=>call('installBridge',id),uninstallBridge:id=>call('uninstallBridge',id)},integration:{shellMenuState:async()=>({installed:false,current:'fixture',target:null}),watcherState:async()=>({watching:[]})}});
    `);
    const {build} = await import('vite');
    await build({root:fixture,base:'./',logLevel:'error',build:{target:'esnext',outDir:path.join(fixture,'dist'),emptyOutDir:true,rollupOptions:{onwarn:(warning,warn)=>{if(warning.code!=='MODULE_LEVEL_DIRECTIVE')warn(warning);}}}});
    const env={...process.env,ATRIUM_UNITY_CONNECTION_UI_FIXTURE:fixture};delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve,reject)=>{
      const child=require('node:child_process').spawn(path.join(root,'node_modules/electron/dist/electron.exe'),[__filename],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
      const timer=setTimeout(()=>{child.kill();reject(Error('Unity connection UI verification timed out'));},90000);
      child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Unity connection UI failed: '+code));});
    });
  })().catch(error=>{console.error(error.stack);process.exitCode=1;});
} else {
  const {app,BrowserWindow,ipcMain}=require('electron');
  const fixture=process.env.ATRIUM_UNITY_CONNECTION_UI_FIXTURE;
  assert.ok(fixture&&path.resolve(fixture).startsWith(evidenceDir+path.sep));
  app.setPath('userData',path.join(fixture,'user-data'));
  const apiCalls={install:[],uninstall:[]};
  ipcMain.handle('fixture:listProjects',()=>[]);
  ipcMain.handle('fixture:installBridge',(_event,id)=>{apiCalls.install.push(id);return {ok:true,copied:1};});
  ipcMain.handle('fixture:uninstallBridge',(_event,id)=>{apiCalls.uninstall.push(id);return {ok:true};});
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:path.join(fixture,'preload.cjs'),contextIsolation:true,backgroundThrottling:false}});
    try {
      await win.loadFile(path.join(fixture,'dist/index.html'));
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const delay=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
        const wait=async(fn,reason)=>{for(let i=0;i<80;i++){if(await fn())return;await delay();}throw Error(reason||'UI condition timed out');};
        await wait(()=>window.uiFixture);
        const f=window.uiFixture;const checks=[],failures=[];
        const body=()=>document.body.textContent;
        const button=text=>[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
        const click=text=>{const el=button(text);if(!el||el.disabled)throw Error('Unavailable button: '+text);el.click();};
        const render=async(name,patch)=>{f.render(name,patch);await delay(150);};
        const check=async(name,run)=>{try{await run();checks.push(name);}catch(error){failures.push(name+': '+error.message);}};
        await check('topbar shows real ready phase and only running targets',async()=>{
          await render('topbar',{connection:{...f.base.connection,projects:[f.connection(f.a,'ready'),f.connection(f.b,'connecting'),f.connection(f.closed,'disabled')]}});if(!body().includes('Connected'))throw Error('real connection phase is absent');
          document.querySelector('[data-project-picker] button').click();await delay();
          if(body().includes('Closed Project'))throw Error('closed project was offered as import target');
          if(!body().includes('Connecting'))throw Error('installed/connecting was reported as ready');
          document.querySelector('[data-project-target="b"]').click();await delay();if(f.calls.selected.at(-1)!=='b')throw Error('explicit selection did not reach store');
        });
        await check('ambiguous import offers eligible targets and cancel',async()=>{
          await render('picker',{targetPicker:{open:true,projectIds:['a','b']}});
          if(!document.querySelector('[role="dialog"]'))throw Error('target choice dialog is missing');
          if(body().includes('Closed Project'))throw Error('picker offered a closed project');
          document.querySelector('[data-import-target="b"]').click();await delay();
          if(f.calls.selected.at(-1)!=='b'||document.querySelector('[role="dialog"]'))throw Error('choice was not resolved exactly once');
          await render('picker',{targetPicker:{open:true,projectIds:['a','b']}});click('Cancel');await delay();
          if(f.calls.selected.at(-1)!==null)throw Error('cancel did not resolve null');
        });
        await check('connection preparation shows fixed target and cancellation',async()=>{
          await render('flow',{importFlow:{...f.base.importFlow,busy:true,busyReason:'connecting',projectId:'a',projectName:'Avatar One',packageName:'Outfit'}});
          if(!body().includes('Connecting to Avatar One'))throw Error('preparation target/status missing');
          if(body().includes('Queued'))throw Error('connection preparation used busy queue wording');
          click('Cancel waiting');await delay();if(f.calls.cancel!==1||body().includes('Connecting to Avatar One'))throw Error('cancel action did not end waiting');
        });
        await check('project status separates installing, connecting, failure and retry',async()=>{
          for(const [phase,label]of [['installing','Setting up connection'],['connecting','Connecting'],['ready','Connected'],['failed','Connection failed'],['unsupported','Unity version not supported'],['disabled','Auto connection disabled'],['closed','Unity is closed']]){
            await render('project',{connection:{...f.base.connection,projects:[{...f.connection(f.a,phase),reasonKey:phase==='failed'?'project.connectionFailed':null,detail:phase==='failed'?'Fixture error':null}]}});
            const row=document.querySelector('[data-project-connection="a"]');if(!row?.textContent.includes(label))throw Error('missing phase '+phase);
            if(phase==='failed'){row.querySelector('[data-connection-retry]').click();await delay();if(f.calls.retry.at(-1)!=='a')throw Error('retry did not reach controller');if(!row.textContent.includes('Fixture error'))throw Error('error details are missing');}
            if(phase==='closed'&&row.querySelector('[data-connection-retry]'))throw Error('closed project offered setup');
          }
        });
        await check('wizard automatic connection step preserves four steps',async()=>{
          await render('wizard');if(document.querySelector('input[type="checkbox"]'))throw Error('manual project install selection remains');
          if(!body().includes('Connects automatically')||!body().includes('Connected'))throw Error('automatic connection status missing');
          click('Next');await delay();if(!body().includes('Start with Windows'))throw Error('fourth onboarding step missing');
        });
        await check('advanced settings uses independent auto connection default',async()=>{
          await render('settings');click('Unity');await delay();
          document.querySelector('details').open=true;
          if(body().includes('Install bridge automatically for new projects'))throw Error('legacy installation preference remains visible');
          const label=[...document.querySelectorAll('.label')].find(el=>el.textContent==='Connect to Unity automatically');
          const toggle=label?.parentElement.parentElement.querySelector('[role="switch"]');if(!toggle||toggle.getAttribute('aria-checked')!=='true')throw Error('new default switch missing');
          toggle.click();await delay();if(f.calls.patch.at(-1)?.unityAutoConnect!==false)throw Error('new switch wrote old preference');
        });
        await check('import CTA identifies resolved target and allows unresolved choice',async()=>{
          const asset={id:'outfit',name:'Outfit',raw_name:'Outfit',category:'clothing',subcategory:null,status:'archived',size_bytes:20,updated_at:1,confidence:1};
          const detail={asset,pathExists:true,variants:[],tags:[],dependencies:{external:0},installedAcross:[]};
          await render('detail',{detail});if(!button('Import to Avatar One'))throw Error('resolved single-import target is absent');
          button('Import to Avatar One').click();await delay();if(f.calls.import.at(-1)!=='outfit')throw Error('single import action changed');
          await render('detail',{detail,connection:{...f.base.connection,targetProjectId:null,ambiguous:true},unity:{...f.base.unity,targetProjectId:null}});
          const unresolved=button('Import to Unity');if(!unresolved||unresolved.disabled)throw Error('unresolved target blocked target resolution');
          await render('grid',{selection:['one','two']});if(!button('Import 2 items to Avatar One'))throw Error('batch CTA target is absent');
          await render('member',{memberPicker:{...f.base.memberPicker,open:true,projectId:'a',picked:['Outfit.unitypackage']},connection:{...f.base.connection,targetProjectId:'b'}});
          if(!button('Import 1 selected to Avatar One'))throw Error('member CTA switched away from its captured target');
        });
        await check('normal app does not ask to install bridge',async()=>{
          await render('app');await wait(()=>document.querySelector('[data-project-connection="a"]'),'normal project page was not mounted');if(document.querySelector('[role="dialog"]'))throw Error('ordinary bridge installation prompt remains mounted');
        });
        return {checks,failures};
      })()`);
      assert.equal(apiCalls.install.length,0,'UI must not directly install any bridge');
      fs.writeFileSync(path.join(evidenceDir,'result.json'),JSON.stringify({...result,apiCalls},null,2));
      console.log(JSON.stringify({...result,apiCalls},null,2));
      assert.deepEqual(result.failures,[]);
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await win.webContents.capturePage().then(image=>fs.writeFileSync(path.join(evidenceDir,'final.png'),image.toPNG()));
      app.exit(0);
    } catch(error) { console.error(error.stack);app.exit(1); }
  });
}
