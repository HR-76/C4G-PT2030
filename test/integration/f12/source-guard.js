'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE = path.resolve(__dirname, '../../..');
const MANIFEST_PATH = path.join(__dirname, 'gate-programs.json');
const POWERSHELL_PATH = path.join(__dirname, 'migration-gate.ps1');
const CATEGORIES = Object.freeze(new Set(['functional-entrypoint','runner-harness','setup-authorized','migration-contract-probe','probe','benchmark']));
const OPERATIONS = Object.freeze(new Set(['migration-read','runner-invocation','runner-ddl','runner-ledger','contract-ledger-mutation','contract-fixture-ddl','administrative-ddl','identity-fixture-ddl','identity-ddl','external-dynamic-import']));
const INTERNAL_OPERATION_ALLOWLIST = Object.freeze([
  {path:'backend/src/security/centralMigrationManifest.js',operation:'migration-read',reason:'Canonical Central manifest loader.'},
  {path:'backend/src/security/tenantMigrationManifest.js',operation:'migration-read',reason:'Canonical tenant manifest loader.'},
  {path:'backend/src/security/localTenantIdentityProvisioner.js',operation:'identity-ddl',reason:'Disposable local role and ACL harness.'},
  {path:'backend/src/opportunities/migrationRunner.js',operation:'runner-invocation',reason:'Canonical opportunity preflight contract.'},
  {path:'backend/src/security/tenantMigrationManifest.js',operation:'runner-invocation',reason:'Canonical tenant manifest loader.'},
  {path:'backend/src/security/tenantMigrationRunner.js',operation:'runner-invocation',reason:'Canonical tenant migration runner.'},
  {path:'backend/scripts/runCentralMigrations.js',operation:'runner-invocation',reason:'Canonical Central migration runner.'},
  {path:'backend/scripts/runCentralMigrations.js',operation:'runner-ddl',reason:'Canonical Central runner transaction.'},
  {path:'backend/scripts/runCentralMigrations.js',operation:'runner-ledger',reason:'Canonical Central ledger writer.'},
  {path:'backend/src/security/tenantMigrationRunner.js',operation:'runner-ledger',reason:'Canonical tenant ledger writer.'},
  {path:'backend/src/audit/partitionMaintenance.js',operation:'administrative-ddl',reason:'Monthly audit partition rotation, run by the audit migrator at provisioning and migration time.'}
]);

function normalized(file){return path.resolve(file).replace(/\\/g,'/');}
function insideWorkspace(file,workspace=WORKSPACE){return normalized(file).startsWith(`${normalized(workspace)}/`);}
function relativeProgram(value){return typeof value==='string'&&['.js','.cjs'].includes(path.extname(value))&&!path.isAbsolute(value)&&!value.split(/[\\/]/).includes('..');}
function loadGateManifest(manifestPath=MANIFEST_PATH,{workspace=WORKSPACE,requireFiles=true}={}){
 const parsed=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(parsed?.schemaVersion!==1||!Array.isArray(parsed.programs)||!parsed.programs.length)throw new Error('F12_GATE_MANIFEST_INVALID');
 const ids=new Set(),orders=new Set(),programs=parsed.programs.map(program=>{
  if(!program||typeof program.id!=='string'||!program.id||ids.has(program.id)||!Number.isSafeInteger(program.order)||orders.has(program.order)||typeof program.phase!=='string'||!program.phase||!relativeProgram(program.path)||!CATEGORIES.has(program.category)||!Array.isArray(program.nodeArgs)||program.nodeArgs.some(value=>value!=='--test')||!Array.isArray(program.args)||program.args.some(value=>typeof value!=='string')||typeof program.failure!=='string'||!program.failure||!program.sourceGuard||!Array.isArray(program.sourceGuard.operations))throw new Error('F12_GATE_MANIFEST_PROGRAM_INVALID');
  const absolutePath=path.resolve(workspace,program.path);
  if(!insideWorkspace(absolutePath,workspace)||(requireFiles&&!fs.existsSync(absolutePath)))throw new Error(`F12_GATE_MANIFEST_PROGRAM_MISSING:${program.id}`);
  for(const rule of program.sourceGuard.operations)if(!rule||!OPERATIONS.has(rule.name)||typeof rule.reason!=='string'||!rule.reason)throw new Error(`F12_GATE_MANIFEST_POLICY_INVALID:${program.id}`);
  ids.add(program.id);orders.add(program.order);return Object.freeze({...program,absolutePath});
 });
 return Object.freeze({schemaVersion:1,programs:Object.freeze(programs.sort((a,b)=>a.order-b.order))});
}
function operationRules(manifest,workspace=WORKSPACE){const rules=new Map();function add(file,operation,reason){const key=normalized(file);if(!rules.has(key))rules.set(key,new Map());rules.get(key).set(operation,reason);}for(const rule of INTERNAL_OPERATION_ALLOWLIST)add(path.resolve(workspace,rule.path),rule.operation,rule.reason);for(const program of manifest.programs)for(const rule of program.sourceGuard.operations)add(program.absolutePath,rule.name,rule.reason);return rules;}
function allowed(file,operation,rules=new Map()){return rules.get(normalized(file))?.has(operation)===true;}
function stripComments(source){let output='',quote=null,escaped=false;for(let index=0;index<source.length;index+=1){const char=source[index],next=source[index+1];if(quote){output+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote=null;continue;}if(char==='"'||char==="'"||char==='`'){quote=char;output+=char;continue;}if(char==='/'&&next==='/'){while(index<source.length&&source[index]!=='\n')index+=1;output+='\n';continue;}if(char==='/'&&next==='*'){index+=2;while(index<source.length&&!(source[index]==='*'&&source[index+1]==='/'))index+=1;index+=1;output+=' ';continue;}output+=char;}return output;}
function staticSpecifiers(source){const code=stripComments(source),found=[],patterns=[/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?(['"])([^'"]+)\1/g,/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g];for(const pattern of patterns)for(const match of code.matchAll(pattern))found.push(match[2]);return{code,found,dynamicNonLiteral:/\bimport\s*\(\s*(?!['"])/.test(code)};}
function resolveLocal(from,specifier,workspace=WORKSPACE){if(!specifier.startsWith('.'))return null;const base=path.resolve(path.dirname(from),specifier),candidates=[base,`${base}.js`,path.join(base,'index.js')],target=candidates.find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());if(!target||!insideWorkspace(target,workspace)||normalized(target).includes('/node_modules/'))return null;return target;}
function executedSql(code){const statements=[],pattern=/\bquery\s*\(\s*([`'"])([\s\S]*?)\1/g;for(const match of code.matchAll(pattern))statements.push(match[2]);return statements;}
function violations(file,source,rules=new Map()){
 const{code,found:specifiers,dynamicNonLiteral}=staticSpecifiers(source),found=[];
 if(normalized(file).includes('/backend/src/')&&/F12_IMPORT_FUNCTIONAL_PROOF|c4g_gate|SYNTHETIC_COMMIT_ACK_LOST/.test(code))found.push(`${normalized(file)}: gate-only identifier in productive source`);
 if(dynamicNonLiteral&&!allowed(file,'external-dynamic-import',rules))found.push(`${normalized(file)}: non-literal dynamic import`);
 if(specifiers.some(value=>/(?:migration|lineage).*(?:loader|sql)|(?:loader|sql).*(?:migration|lineage)/i.test(value))&&!allowed(file,'runner-invocation',rules))found.push(`${normalized(file)}: unapproved migration module import`);
 const reads=[...code.matchAll(/\breadFile(?:Sync)?\s*\(\s*([`'"])(.*?)\1/g)];for(const match of reads)if(!/\.json$/i.test(match[2])&&!allowed(file,'migration-read',rules))found.push(`${normalized(file)}: unapproved file read`);
 if(/\b(?:apply|load|install|repair|bootstrap)[A-Za-z0-9_]*(?:Migration|Schema|Lineage)[A-Za-z0-9_]*\s*\(/.test(code)&&!allowed(file,'runner-invocation',rules))found.push(`${normalized(file)}: migration helper call`);
 if(/\b(?:migrationSql|loadLineage)\s*\([^)]*\)\s*\.sql\b/.test(code)&&!allowed(file,'migration-read',rules))found.push(`${normalized(file)}: direct migration loader`);
 for(const sql of executedSql(code)){const ddl=/\b(?:CREATE|ALTER|DROP)\s+(?:SCHEMA|TABLE|TYPE|FUNCTION|PROCEDURE|CONSTRAINT)\b/i.test(sql);const canonicalLedgerTransition=normalized(file)===normalized(path.join(WORKSPACE,'backend/src/security/tenantMigrationRunner.js'))&&allowed(file,'runner-ledger',rules)&&/^ALTER TABLE c4g_system\.schema_migration (?:DISABLE|ENABLE) TRIGGER schema_migration_append_only$/.test(sql);if(ddl&&!canonicalLedgerTransition&&!['administrative-ddl','contract-fixture-ddl','identity-fixture-ddl','identity-ddl','runner-ddl'].some(operation=>allowed(file,operation,rules)))found.push(`${normalized(file)}: functional DDL`);if(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:c4g_system\.schema_migration|public\.c4g_schema_migration)\b/i.test(sql)&&!allowed(file,'runner-ledger',rules)&&!allowed(file,'contract-ledger-mutation',rules))found.push(`${normalized(file)}: direct ledger mutation`);}
 if(/\bapplied\s*:\s*(?:process\.|scope\b|argv\b)/.test(code))found.push(`${normalized(file)}: fabricated applied state`);
 if(/\b(?:marker|schemaFingerprint|fingerprint|checksum)\s*:\s*(?:process\.|scope\b|argv\b)/i.test(code))found.push(`${normalized(file)}: fabricated schema evidence`);
 if(/\bcatch\b[\s\S]{0,300}(?:does not exist|undefined table|undefined column|undefined object)[\s\S]{0,300}\bquery\s*\(/i.test(code))found.push(`${normalized(file)}: schema repair fallback`);
 return found;
}
function reachableGraphFromFiles(entrypoints,{workspace=WORKSPACE}={}){const queue=[...entrypoints],visited=new Set(),edges=[];while(queue.length){const file=path.resolve(queue.shift());if(visited.has(file))continue;if(!fs.existsSync(file))throw new Error(`Guard entrypoint is missing: ${normalized(file)}`);if(!insideWorkspace(file,workspace))throw new Error(`Guard entrypoint is outside workspace: ${normalized(file)}`);visited.add(file);const parsed=staticSpecifiers(fs.readFileSync(file,'utf8'));for(const specifier of parsed.found){const target=resolveLocal(file,specifier,workspace);if(target){edges.push([file,target]);queue.push(target);}}}return Object.freeze({files:Object.freeze([...visited]),edges:Object.freeze(edges)});}
function reachableGraph(root,entrypoints){const workspace=path.resolve(root);return reachableGraphFromFiles(entrypoints.map(name=>path.resolve(workspace,name)),{workspace});}
function inspectReachable(root,entrypoints,rules=new Map()){const graph=reachableGraph(root,entrypoints),findings=[];for(const file of graph.files)findings.push(...violations(file,fs.readFileSync(file,'utf8'),rules));return Object.freeze({graph,findings:Object.freeze(findings)});}
function inspectPowerShellContract(source,manifest){const findings=[],nodeCalls=[...source.matchAll(/(?:^|\n)\s*(?:&\s*)?(?:node(?:\.exe)?|Start-Process\s+node)\b[^\r\n]*/gi)].map(match=>match[0].trim());if(nodeCalls.length!==1||!/^&\s*node\s+@command\s*$/i.test(nodeCalls[0]))findings.push('PowerShell must contain exactly one canonical manifest-driven Node invocation.');if(/['"][^'"\r\n]+\.c?js['"]/i.test(source))findings.push('PowerShell contains a JavaScript path outside the manifest.');if(!/gate-programs\.json/.test(source)||!/ConvertFrom-Json/.test(source)||!/function\s+Invoke-GatePhase/.test(source))findings.push('PowerShell does not load the canonical manifest executor.');const calledPhases=[...source.matchAll(/Invoke-GatePhase\s+['"]([^'"]+)['"]/g)].map(match=>match[1]),declaredPhases=[...new Set(manifest.programs.map(program=>program.phase))],missing=declaredPhases.filter(value=>!calledPhases.includes(value)),extra=calledPhases.filter(value=>!declaredPhases.includes(value));if(missing.length||extra.length||new Set(calledPhases).size!==calledPhases.length)findings.push(`PowerShell phase mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`);return Object.freeze({findings:Object.freeze(findings),nodeCalls:Object.freeze(nodeCalls),phases:Object.freeze(calledPhases)});}
function inspectGateSource({manifestPath=MANIFEST_PATH,powershellPath=POWERSHELL_PATH,workspace=WORKSPACE}={}){const manifest=loadGateManifest(manifestPath,{workspace}),rules=operationRules(manifest,workspace),roots=[...new Set(manifest.programs.map(program=>program.absolutePath))],graph=reachableGraphFromFiles(roots,{workspace}),findings=[];for(const file of graph.files)findings.push(...violations(file,fs.readFileSync(file,'utf8'),rules));const powershell=inspectPowerShellContract(fs.readFileSync(powershellPath,'utf8'),manifest);findings.push(...powershell.findings);const analyzedRoots=new Set(roots.filter(root=>graph.files.includes(root))),declaredRoots=new Set(roots),executedButNotAnalyzed=[...declaredRoots].filter(root=>!analyzedRoots.has(root)),analyzedButNotDeclared=[...analyzedRoots].filter(root=>!declaredRoots.has(root));if(executedButNotAnalyzed.length||analyzedButNotDeclared.length)findings.push('Gate root equality failed.');return Object.freeze({manifest,roots:Object.freeze(roots),graph,powershell,executedButNotAnalyzed:Object.freeze(executedButNotAnalyzed),analyzedButNotDeclared:Object.freeze(analyzedButNotDeclared),findings:Object.freeze(findings)});}

module.exports={CATEGORIES,INTERNAL_OPERATION_ALLOWLIST,MANIFEST_PATH,OPERATIONS,POWERSHELL_PATH,inspectGateSource,inspectPowerShellContract,inspectReachable,loadGateManifest,operationRules,reachableGraph,reachableGraphFromFiles,staticSpecifiers,violations};
