"""Own PostgreSQL 18 cluster; no connection string or app environment accepted."""
from pathlib import Path
import argparse,os,subprocess,secrets,socket,shutil,json,sys,uuid
parser=argparse.ArgumentParser();parser.add_argument('--isolated',action='store_true',required=True);parser.add_argument('--workspace',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);parser.add_argument('--ui-review',type=Path);parser.add_argument('--load-acceptance',action='store_true');args=parser.parse_args();assert not(args.ui_review and args.load_acceptance)
sys.stdout.reconfigure(encoding='utf-8')
workspace=args.workspace.resolve();assert workspace.is_dir()
gate_id=uuid.uuid4().hex;owned=workspace/('gcni-pg-'+gate_id);owned.mkdir();data=owned/'data';bin=Path('C:/Program Files/PostgreSQL/18/bin')
assert (bin/'initdb.exe').is_file()
owner={'gateId':gate_id,'dataDirectory':str(data)};(owned/'owner.json').write_text(json.dumps(owner))
password=secrets.token_hex(32);pw=owned/'password.txt';pw.write_text(password,encoding='ascii')
env={k:v for k,v in os.environ.items() if k.upper() in ['SYSTEMROOT','WINDIR','TEMP','TMP','PATH','PATHEXT']}
env['PGCLIENTENCODING']='UTF8'
def execute(command,timeout=60,stdin=None):
    return subprocess.run([str(x) for x in command],input=stdin,text=True,encoding='utf-8',errors='replace',capture_output=True,env=env,timeout=timeout,creationflags=0x08000000 if os.name=='nt' else 0)
def control(arguments,phase):
    # PostgreSQL background children must not inherit PIPE handles on Windows.
    log_path=owned/(phase+'.log')
    with log_path.open('w',encoding='utf-8') as log:
        r=subprocess.run([str(bin/'pg_ctl.exe'),*map(str,arguments)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=env,timeout=30,creationflags=0x08000000 if os.name=='nt' else 0)
    return r.returncode
def require(result,phase):
    if result.returncode:raise RuntimeError(phase+': '+(result.stdout+result.stderr)[-1600:])
result={'status':'FAIL','isolated':True,'gateId':gate_id,'clusterStopped':False};started=False
try:
    require(execute([bin/'initdb.exe','-D',data,'-U','c4g_f12_admin','-E','UTF8','--locale=C','--auth=scram-sha-256','--pwfile',pw]),'INITDB')
    pw.unlink()
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    assert port!=5432
    started=True
    if control(['-D',data,'-l',owned/'postgres.log','-o',f'-h 127.0.0.1 -p {port} -c max_connections=30 -c shared_buffers=32MB','-w','start'],'start')!=0:raise RuntimeError('START_FAILED_SEE_OWNED_LOG')
    config={'host':'127.0.0.1','port':port,'user':'c4g_f12_admin','password':password,'database':'gcni_catalog_'+gate_id[:12],'dataDirectory':str(data),'gateId':gate_id}
    config['loadAcceptance']=args.load_acceptance
    if args.ui_review:
        review=args.ui_review.resolve();assert review.parent==workspace and (review/'dist/catalog-isolated.html').is_file()
        config['uiReviewDirectory']=str(review)
    run=execute([shutil.which('node'),Path(__file__).with_name('durable-provider.cjs'),'--isolated'],timeout=900 if args.load_acceptance else 1000 if args.ui_review else 60,stdin=json.dumps(config))
    (owned/'gate-output.txt').write_text(run.stdout+'\n'+run.stderr,encoding='utf-8')
    lines=[line for line in run.stdout.splitlines() if line.startswith('{')]
    if lines:result.update(json.loads(lines[-1]))
    else:result['error']={'code':'NO_REPORT','message':run.stderr[-1600:]}
    if run.returncode:result['status']='FAIL'
except Exception as e:result['error']={'code':'LAUNCHER_FAILED','message':str(e)[:1800]}
finally:
    assert data.parent==owned and owned.parent==workspace and json.loads((owned/'owner.json').read_text())['gateId']==gate_id
    if started:
        if (data/'postmaster.pid').exists():
            stop=control(['-D',data,'-m','fast','-w','stop'],'stop')
            result['clusterStopped']=stop==0 and not (data/'postmaster.pid').exists()
        else:result['clusterStopped']=True
        if not result['clusterStopped']:result['status']='FAIL';result['stopError']='Owned cluster could not stop; see local log.'
    if pw.exists():pw.unlink()
    args.report.resolve().write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
raise SystemExit(0 if result['status']=='PASS' and result['clusterStopped'] else 1)
