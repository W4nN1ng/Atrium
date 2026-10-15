// Actual standalone Unity worker verification. Only copied, licensed sample
// sources under the ignored repository tmp directory are allowed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..'), evidenceDir = path.join(root, 'tmp', 'package-cover-preview');
fs.mkdirSync(evidenceDir, { recursive: true });
const sampleFile = path.resolve(process.env.ATRIUM_PACKAGE_SAMPLES || path.join(root, 'tmp/cover-verification/actual-sample-clones.json'));
assert.ok(sampleFile.startsWith(path.join(root, 'tmp') + path.sep), 'Use copied licensed samples in ignored tmp');
const samples = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
const dependency = path.resolve(process.env.ATRIUM_PACKAGE_DEPENDENCY || path.join(root, 'tmp/cover-verification/unity-sandbox'));
assert.ok(dependency.startsWith(path.join(root, 'tmp') + path.sep), 'Dependency must be a legal isolated fixture');
assert.ok(fs.existsSync(path.join(dependency, 'Packages/jp.lilxyzw.liltoon/package.json')));
const editor = process.env.ATRIUM_PACKAGE_EDITOR;
assert.ok(editor && fs.existsSync(editor), 'Set ATRIUM_PACKAGE_EDITOR to an installed Unity 2022.3 editor');
const run = fs.realpathSync(fs.mkdtempSync(path.join(evidenceDir, 'avca-sandbox-real-')));
const bundle = path.join(run, 'production.cjs');
require('esbuild').buildSync({ stdin: { contents: `
  export { PackageCoverProvider } from './src/main/covers/packageProvider';
  export { BridgeManager } from './src/main/bridge/manager';
  export { migrate } from './src/main/db';
  export { setAppPathsForTest } from './src/main/services/paths';
  `, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, packages: 'external', platform: 'node', format: 'cjs' });
const { PackageCoverProvider, BridgeManager, migrate, setAppPathsForTest } = require(bundle);
setAppPathsForTest(run);
const db = new (require('better-sqlite3'))(path.join(run, 'library.db')); migrate(db);
db.prepare('INSERT INTO project(id,path,name) VALUES(?,?,?)').run('dependency', dependency, 'Owned shader fixture');
const manager = new BridgeManager();
const provider = new PackageCoverProvider({ db, manager, editorPath: () => editor });
function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const before = samples.map(sample => ({ file: sample.source || sample.file || sample.library, hash: hash(sample.source || sample.file || sample.library) }));
let lastStage = '';
const progress = value => { if (value.stage !== lastStage) { lastStage = value.stage; console.log('[PACKAGE_REAL] ' + value.stage); } };
async function main() {
  const results = [];
  try {
    for (const [index, sample] of samples.entries()) {
      const id = 'real-source-' + index;
      for (const file of [sample.library, sample.source].filter(Boolean)) assert.ok(path.resolve(file).startsWith(path.join(root, 'tmp') + path.sep));
      db.prepare("INSERT INTO asset(id,name,raw_name,category,status,storage_mode,confidence,source_path,library_path,cover_image,created_at,updated_at) VALUES(?,?,?,'props','classified','index',1,?,?,'none',?,?)")
        .run(id, sample.name, sample.name, sample.source, sample.library, Date.now(), Date.now());
      const controller = new AbortController();
      console.log('[PACKAGE_REAL] source ' + sample.name);
      const discovered = await provider.discover(id, 'find-' + index, 'dependency', controller.signal, progress);
      assert.ok(discovered.targets.length >= 1, 'No actual package model candidates: ' + JSON.stringify(discovered));
      const priorFixturePath = /百奇|pocky/i.test(sample.name) ? 'Assets/Stick/stick_choco_game_MA.prefab' : 'Assets/Valentines/Valentines.prefab';
      const expectedGuid = fs.readFileSync(path.join(dependency, priorFixturePath + '.meta'), 'utf8').match(/^guid:\s*([a-f0-9]{32})\s*$/m)?.[1];
      assert.ok(expectedGuid, 'Licensed reference GUID missing');
      const target = discovered.targets.find(target => target.sourceGuid === expectedGuid && target.path.endsWith('.prefab'));
      assert.ok(target, 'Expected actual prefab missing: ' + JSON.stringify(discovered));
      const expected = target.path;
      assert.equal(target.id, 'package:' + target.sourceGuid);
      assert.ok(target.memberPaths.length > 0);
      const rendered = await provider.preview({ assetId: id, projectId: '', provider: 'package', dependencyProjectId: 'dependency',
        target, options: { direction: /Valentines/.test(expected) ? 'bottom' : 'auto', background: 'dark' }, requestId: 'image-' + index }, controller.signal, progress);
      assert.equal(rendered.width, 640); assert.equal(rendered.height, 480); assert.ok(rendered.bytes.length > 1000);
      const file = path.join(evidenceDir, 'real-package-' + index + '.png'); fs.writeFileSync(file, rendered.bytes);
      provider.assertCurrent(id, rendered.fingerprint);
      const prepared = provider.prepared.get(id);
      const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
      assert.ok(!walk(path.join(prepared.project, 'Assets')).some(file => /\.(cs|dll|exe|asmdef|asmref)$/i.test(file)), 'Supplier code reached preview Assets');
      results.push({ name: sample.name, discovered, target, project: prepared.project, file, width: rendered.width, height: rendered.height, rendererCount: rendered.rendererCount });
      console.log('[PACKAGE_REAL] rendered ' + expected);
    }
    for (const source of before) assert.equal(hash(source.file), source.hash, 'Original source archive changed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM import_log').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project').get().n, 1, 'Internal worker projects registered as user projects');
    fs.writeFileSync(path.join(evidenceDir, 'real-package-evidence.json'), JSON.stringify({ method: 'Real production preparer, owned fresh Unity projects, scriptless render dependencies, bridge GUID matching and GPU rendering', run, originalsUnchanged: true, importLogEmpty: true, results }, null, 2));
    console.log('[ATRIUM_PACKAGE_PREVIEW_REAL] PASS');
  } finally { await provider.dispose(); manager.dispose(); db.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
