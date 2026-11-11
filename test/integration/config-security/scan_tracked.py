"""Scan tracked working-tree files; output only paths, line numbers and pattern names."""
import json, re, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[3]
raw = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root)
patterns = {
    'private_key_marker': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'),
    'aws_access_key_pattern': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'github_token_pattern': re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{30,}\b'),
    'resend_token_pattern': re.compile(r'\bre_[A-Za-z0-9_]{30,}\b'),
}
results=[]; skipped=0; examined=0
for entry in raw.split(b'\0'):
    if not entry: continue
    name=entry.decode('utf-8','surrogateescape'); p=root/name
    # Never read actual environment files, credential stores, symlinks or binary bundles.
    if p.name.startswith('.env') and not p.name.endswith('.example'): skipped+=1; continue
    if p.is_symlink() or not p.is_file() or p.stat().st_size>2_000_000: skipped+=1; continue
    try: data=p.read_bytes(); text=data.decode('utf-8')
    except (OSError,UnicodeError): skipped+=1; continue
    if '\0' in text: skipped+=1; continue
    examined+=1
    for kind,pattern in patterns.items():
        for match in pattern.finditer(text): results.append({'path':name,'line':text.count('\n',0,match.start())+1,'type':kind})
print(json.dumps({'trackedTextFilesExamined':examined,'skipped':skipped,'findings':results},ensure_ascii=True,indent=2))
