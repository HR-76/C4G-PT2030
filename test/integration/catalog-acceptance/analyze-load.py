"""Independently recompute recorded load quantiles; never converts refusal into acceptance."""
import json,math,sys
from pathlib import Path
source=Path(sys.argv[1]);destination=Path(sys.argv[2]);data=json.loads(source.read_text(encoding="utf-8"));load=data["load"]
assert data["clusterStopped"] and len(data["checks"])==36 and all(c["status"]=="PASS" for c in data["checks"])
def quantile(values,p):
    values=sorted(values)
    return math.floor(values[math.ceil(len(values)*p)-1]*100+0.5)/100 if values else None
summary=[]
for scenario in load["scenarios"]:
    assert len(scenario["warmups"])==10 and len(scenario["runs"])==5
    successful=[]
    for run in scenario["runs"]:
        samples=run["samples"];assert len(samples)==10
        good=[s for s in samples if s["status"]==200]
        assert run["successes"]==len(good) and run["errors"]==10-len(good)
        assert all(isinstance(s["serverMs"],(int,float)) and math.isfinite(s["serverMs"]) for s in good)
        assert quantile([s["serverMs"] for s in good],.5)==run["serverP50Ms"]
        assert quantile([s["serverMs"] for s in good],.95)==run["serverP95Ms"]
        successful.extend(good)
    expected_accepted=all(s["status"]==200 for s in scenario["warmups"]) and all(r["errors"]==0 and r["serverP95Ms"] is not None and r["serverP95Ms"]<=500 for r in scenario["runs"])
    assert scenario["accepted"]==expected_accepted
    valid=[r["serverP95Ms"] for r in scenario["runs"] if r["serverP95Ms"] is not None]
    summary.append(dict(volume=scenario["volume"],endpoint=scenario["name"],measuredAttempts=50,successes=len(successful),errors=50-len(successful),warmupErrors=sum(s["status"]!=200 for s in scenario["warmups"]),serverP50Ms=quantile([s["serverMs"] for s in successful],.5),serverP95Ms=quantile([s["serverMs"] for s in successful],.95),runP95MinMs=min(valid,default=None),runP95MaxMs=max(valid,default=None),mode=scenario["mode"],accepted=scenario["accepted"]))
assert len(summary)==4
accepted=all(s["accepted"] for s in summary)
assert load["status"]==("PASS" if accepted else "NOT_ACCEPTED")
result=dict(status="PASS_ANALYSIS",loadAcceptance="PASS" if accepted else "NOT_ACCEPTED",runsRecomputed=20,measuredRequests=200,warmupRequests=40,scenarios=summary,fixtures=load["fixtures"],targetServerP95Ms=500,relativeVolumePerformance="Volume comparison is scaling, not a before/after code regression. Production SLA and external institutional federation are not certified.")
destination.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
print("20 runs independently verified; isolated load acceptance: "+result["loadAcceptance"])
