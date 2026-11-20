"""Explicit VPS operation: native listener + narrow read role; never sends mail."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
from configureKeycloakResend import request, REALM

CLIENT = 'c4g-email-templates'
ROLE = 'read-delivery-history'
LISTENER = 'c4g-email-delivery'


def configure(credentials, backup, apply=False, api=request):
    token = api('/realms/master/protocol/openid-connect/token', 'POST', {
        'client_id': 'admin-cli', 'grant_type': 'password',
        'username': credentials['KC_BOOTSTRAP_ADMIN_USERNAME'],
        'password': credentials['KC_BOOTSTRAP_ADMIN_PASSWORD'],
    }, form=True)['access_token']

    def admin(path='', method='GET', body=None):
        return api(REALM + path, method, body, token=token)

    before = admin()
    clients = admin('/clients?clientId=' + CLIENT)
    if before.get('realm') != 'c4g-staging' or len(clients) != 1:
        raise ValueError('EMAIL_HISTORY_PREFLIGHT_REFUSED')
    client = clients[0]
    if client.get('fullScopeAllowed') is not False or client.get('publicClient') is not False or not client.get('serviceAccountsEnabled'):
        raise ValueError('EMAIL_HISTORY_CLIENT_NOT_RESTRICTED')
    cid = client['id']
    service = admin('/clients/' + cid + '/service-account-user')
    mappings = '/users/' + service['id'] + '/role-mappings/clients/' + cid
    scopes = '/clients/' + cid + '/scope-mappings/clients/' + cid
    if not apply:
        return 'EMAIL_HISTORY_CONFIGURATION_READY'
    backup = Path(backup).resolve()
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    saved = backup / 'keycloak-before.json'
    with os.fdopen(os.open(saved, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
        json.dump({'realm': before, 'client': client, 'roles': admin(mappings), 'scopes': admin(scopes)}, file)
    roles = admin('/clients/' + cid + '/roles')
    if not any(role['name'] == ROLE for role in roles):
        admin('/clients/' + cid + '/roles', 'POST', {'name': ROLE})
    role = admin('/clients/' + cid + '/roles/' + ROLE)
    for path in (mappings, scopes):
        if not any(value['id'] == role['id'] for value in admin(path)):
            admin(path, 'POST', [role])
    listeners = list(before.get('eventsListeners') or [])
    if LISTENER not in listeners:
        listeners.append(LISTENER)
    patch = {'eventsListeners': listeners}
    # If native event storage is already enabled, it must not retain a second
    # recipient copy without a deadline. Do not enable native event storage.
    if before.get('eventsEnabled') and (not before.get('eventsExpiration') or before['eventsExpiration'] > 90 * 86400):
        patch['eventsExpiration'] = 90 * 86400
    admin('', 'PUT', patch)
    after = admin()
    for field in ('smtpServer', 'resetPasswordAllowed', 'browserFlow', 'resetCredentialsFlow', 'loginTheme', 'emailTheme'):
        if before.get(field) != after.get(field):
            raise ValueError('EMAIL_HISTORY_CONFIGURATION_DRIFT')
    if set(after.get('eventsListeners') or []) != set(listeners):
        raise ValueError('EMAIL_HISTORY_VERIFY_FAILED')
    secret = admin('/clients/' + cid + '/client-secret')['value']
    service_token = api('/realms/c4g-staging/protocol/openid-connect/token', 'POST', {
        'client_id': CLIENT, 'client_secret': secret, 'grant_type': 'client_credentials',
    }, form=True)['access_token']
    result = api('/realms/c4g-staging/c4g-email-templates/delivery-history/search', 'POST', {
        'before': int(time.time() * 1000) + 1000, 'id': 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'status': '',
    }, token=service_token)
    if not isinstance(result.get('items'), list):
        raise ValueError('EMAIL_HISTORY_VERIFY_FAILED')
    api('/realms/c4g-staging/c4g-email-templates/delivery-history/retention', 'POST', token=service_token)
    return 'KEYCLOAK_EMAIL_HISTORY_READY'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup-directory')
    args = parser.parse_args()
    if args.apply and not args.backup_directory:
        parser.error('--apply requires a new private --backup-directory')
    try:
        result = subprocess.run(['docker', 'inspect', '--format', '{{json .Config.Env}}',
                                 'c4g-staging-keycloak-keycloak-1'], capture_output=True, text=True, check=True, timeout=15)
        credentials = dict(item.split('=', 1) for item in json.loads(result.stdout) if '=' in item)
        print(configure(credentials, args.backup_directory, args.apply))
    except Exception:
        # No exception body: it can carry provider data or a URL.
        print('EMAIL_HISTORY_CONFIGURATION_NOT_CONFIRMED; conservar o backup e diagnosticar antes de repetir.')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
