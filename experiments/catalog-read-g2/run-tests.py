"""Offline test launcher; keeps application env and entrypoints out of the process."""
from pathlib import Path
import argparse, os, subprocess, shutil, sys

parser=argparse.ArgumentParser()
parser.add_argument('--deps-root',type=Path)
parser.add_argument('--report',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parent
deps=(args.deps_root or root.parents[1]/'backend').resolve()
if not (deps/'node_modules/ajv/dist/2020.js').is_file():
    raise SystemExit('Use --deps-root pointing to the GCNI backend with existing AJV dependencies; no install is performed.')
env={k:v for k,v in os.environ.items() if k.upper() in ['SYSTEMROOT','WINDIR','TEMP','TMP','PATH','PATHEXT']}
env['GCNI_SCHEMA_DEPS']=str(deps)
node=shutil.which('node')
if not node:raise SystemExit('Node is required.')
command=[node,'--permission','--allow-fs-read=*','--require',str(root/'offline-guard.cjs'),'--test','--test-isolation=none',str(root/'contract.test.cjs')]
result=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
output=result.stdout+'\n'+result.stderr
if args.report:args.report.write_text(output,encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
print(output)
raise SystemExit(result.returncode)
