#!/usr/bin/env node
// Offline reference verifier: no installation, model calls, imports of vendor tools or archive traversal.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fail=s=>{throw Error(s)};
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function file(name,currentOnly=true){
 if(typeof name!=='string'||name.includes('\\')||name.split('/').some(x=>x===''||x==='..'||x==='.')||path.isAbsolute(name))fail('Invalid reference path');
 if(currentOnly&&!name.startsWith('current/'))fail('Active reference escapes current/: '+name);
 const p=path.resolve(root,name);if(!p.startsWith(root+path.sep)||!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())fail('Expected a regular reference file: '+name);
 const real=fs.realpathSync(p);if(!real.startsWith(root+path.sep))fail('Reference resolves outside repository: '+name);return p;
}
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())fail('Symlink in current tree');const p=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(p));else if(e.isFile())out.push(path.relative(root,p).split(path.sep).join('/'));else fail('Non-regular current entry')}return out}
try{
 const args=process.argv.slice(2);let runtime;
 for(let i=0;i<args.length;i++){if(args[i]==='--dsh-version'&&args[i+1]){runtime=args[++i];continue}fail('Usage: node tools/verify-current.mjs [--dsh-version VERSION]')}
 const [major,minor]=process.versions.node.split('.').map(Number);if(!(major>=24||(major===22&&minor>=19)))fail('Use Node 22.19+ in the 22 line, or Node 24+');
 const m=JSON.parse(fs.readFileSync(file('CURRENT.json',false),'utf8'));
 if(m.schemaVersion!==1||m.contentRoot!=='current/'||m.autoApply!==false||m.exportMode!=='reference-only')fail('Unsupported latest-reference contract');
 if(m.compatibility.nativeDsh!=='0.2.1-rc.5')fail('Unexpected native DSH target; update the verifier with a new qualified release');
 const paths=Object.keys(m.fileChecks);if(!paths.length||!Array.isArray(m.entryPoints)||!m.entryPoints.length)fail('Missing active file inventory');
 for(const [name,sha] of Object.entries(m.fileChecks)){if(!/^[a-f0-9]{64}$/.test(sha)||digest(file(name))!==sha)fail('Current hash mismatch: '+name)}
 const readerNames=['AGENTS.md','README.md','THIRD-PARTY-NOTICES.md','tools/verify-current.mjs'];
 if(!m.readerChecks||JSON.stringify(Object.keys(m.readerChecks).sort())!==JSON.stringify(readerNames.sort()))fail('Reader inventory must contain exactly the four root entry files; archive readers are forbidden');
 for(const [name,sha] of Object.entries(m.readerChecks)){if(!/^[a-f0-9]{64}$/.test(sha)||digest(file(name,false))!==sha)fail('Reader hash mismatch: '+name)}
 const actual=walk(path.join(root,'current')).sort();if(JSON.stringify(actual)!==JSON.stringify(paths.sort()))fail('Current tree contains a missing or unlisted file');
 for(const name of m.entryPoints)if(!Object.hasOwn(m.fileChecks,name))fail('Entry point not in active inventory: '+name);
 for(const dir of ['current/vendor/live-compact/','current/vendor/taskboard/','current/vendor/session-toolkit/']){
  const pkg=JSON.parse(fs.readFileSync(file(dir+'package.json'),'utf8'));
  const targets=[];if(pkg.main)targets.push(pkg.main);if(pkg.types)targets.push(pkg.types);
  function exportsOf(v){if(typeof v==='string')targets.push(v);else if(v&&typeof v==='object')for(const x of Object.values(v))exportsOf(x)}
  exportsOf(pkg.exports);
  for(const target of targets){const rel=dir+target.replace(/^\.\//,'');if(!Object.hasOwn(m.fileChecks,rel))fail('Dangling package entry: '+rel);file(rel)}
 }
 const lc=JSON.parse(fs.readFileSync(file('current/vendor/live-compact/package.json'),'utf8'));
 if(lc.version!==m.components.liveCompact||lc.engines.dsh!==m.compatibility.nativeDsh||Object.values(lc.peerDependencies).some(v=>v!==m.compatibility.nativeDsh))fail('Live Compact runtime version mismatch');
 const board=JSON.parse(fs.readFileSync(file('current/vendor/taskboard/package.json'),'utf8'));
 if(board.engines.dsh!==m.compatibility.nativeDsh||board.dependencies.schemastery!=='3.18.0')fail('TaskBoard dependency version mismatch');
 for(const kind of ['web','tui']){
  const base='current/profiles/rc5-'+kind+'/',p=JSON.parse(fs.readFileSync(file(base+'package.reference.json'),'utf8'));
  if(p.dependencies['@deepseek-ai/dsh-base']!==m.compatibility.nativeDsh||p.dependencies['@deepseek-ai/dsh-web-app']!==m.compatibility.nativeDsh||p.dependencies['dsh-context']!==m.components.context||p.dependencies['dsh-ops']!==m.components.ops)fail('Profile version mismatch: '+kind);
  if(kind==='tui'&&p.dependencies['@deepseek-harness-tui/dsh-tui']!==m.components.tui)fail('TUI version mismatch');
  for(const [dep,spec] of Object.entries(p.dependencies))if(spec.startsWith('file:')){const target=path.resolve(root,base,spec.slice(5),'package.json');const rel=path.relative(root,target).split(path.sep).join('/');if(!Object.hasOwn(m.fileChecks,rel))fail('Missing local reference dependency: '+dep);file(rel)}
 }
 console.log('Latest reference verified: '+m.id+'; '+paths.length+' current files; archive not loaded.');
 if(runtime&&runtime!==m.compatibility.nativeDsh){console.error('adaptation_required: source reading is valid, but native rc.5 patches/profiles cannot be applied directly to DSH '+runtime+'. Read current/docs/MACHINE-HANDOFF.md.');process.exitCode=2}
 else console.log('Reference-only: this does not install DSH or establish runtime/Windows qualification.');
}catch(e){console.error('reference_invalid: '+e.message);process.exitCode=1}
