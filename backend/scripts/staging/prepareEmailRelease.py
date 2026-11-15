"""Package tested email sources and SPI for transfer; never installs or sends."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[3]
out = root / '.tmp/email-keycloak-release-v1.zip'
files = {str(p.relative_to(root)).replace('\\', '/'): p for p in (root / 'backend/src/emailTemplates').glob('*.js')}
for name in ('EmailTypes.jsx', 'EmailTemplates.jsx', 'emailTemplatePresentation.js'):
    p = root / 'frontend/src/pages/Platform' / name
    files[p.relative_to(root).as_posix()] = p
for p in (root / 'frontend/src').rglob('EmailBodyEditor.jsx'):
    files[p.relative_to(root).as_posix()] = p
files['providers/c4g-email-templates.jar'] = root / '.tmp/email-templates-build/c4g-email-templates-26.8.0.jar'
evidence = root / 'test/integration/email-authentication/evidence-restricted-postgres17-20261115.json'
proof = json.loads(evidence.read_text(encoding='utf-8'))
assert proof['passed'] and proof['database'] == 'isolated PostgreSQL 17.11'
assert hashlib.sha256(files['providers/c4g-email-templates.jar'].read_bytes()).hexdigest() == proof['restrictedProviderSha256']
files['validation.json'] = evidence
manifest = {name: hashlib.sha256(p.read_bytes()).hexdigest() for name, p in files.items()}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, p in files.items():
        archive.write(p, name)
    archive.writestr('manifest.json', json.dumps(manifest, indent=2))
    archive.writestr('README.txt', 'Transfer package only. Preserve the active API image and apply a guarded composition patch. Frontend sources require building against the active frontend release. No automatic installation. No credentials included.\n')
print(out)
print('SHA256 ' + hashlib.sha256(out.read_bytes()).hexdigest())
