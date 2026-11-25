"""Compile against the verified official 26.8.0 distribution; no Maven/downloads.

Run from repository root: python -B dev/keycloak/email-templates/build.py
Only creates .tmp/email-templates-build and the JAR reported on stdout.
"""
import hashlib
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).resolve().parent
ZIP = ROOT / '.tmp/email-authentication-download/keycloak-26.8.0.zip'
SHA256 = '7ed1de3fda2598369262613bf682aab7e233d80a38c405e91588f7a7454370a1'
JDK = Path('C:/Program Files/Java/jdk-23/bin')
BUILD = ROOT / '.tmp/email-templates-build'

with ZIP.open('rb') as archive:
    if hashlib.file_digest(archive, 'sha256').hexdigest() != SHA256:
        raise SystemExit('Official Keycloak distribution checksum mismatch')
libraries = BUILD / 'libraries'
classes = BUILD / 'classes'
libraries.mkdir(parents=True, exist_ok=True)
classes.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ZIP) as archive:
    for name in archive.namelist():
        if '/lib/lib/main/' in name and name.endswith('.jar'):
            target = libraries / Path(name).name
            if not target.exists():
                target.write_bytes(archive.read(name))
sources = sorted(str(path) for path in (SOURCE / 'src/main/java').rglob('*.java'))
result = subprocess.run([str(JDK / 'javac.exe'), '--release', '21', '-encoding', 'UTF-8',
                         '-classpath', str(libraries / '*'), '-d', str(classes), *sources],
                        cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=90)
if result.returncode:
    print(result.stderr)
    raise SystemExit(result.returncode)
for path in (SOURCE / 'src/main/resources').rglob('*'):
    if path.is_file():
        target = classes / path.relative_to(SOURCE / 'src/main/resources')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(path.read_bytes())
jar = BUILD / 'c4g-email-templates-26.8.0.jar'
subprocess.run([str(JDK / 'jar.exe'), '--create', '--file', str(jar), '-C', str(classes), '.'],
               cwd=ROOT, check=True, capture_output=True, timeout=30)
print(str(jar))
