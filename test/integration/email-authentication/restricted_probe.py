"""Restricted SPI proof, called only inside the authorized disposable gate.

All secrets and native messages remain in memory. Only named boolean checks
are sent to the gate's evidence collector; no HTTP body or exception is logged.
"""
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import secrets
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[3]
BRIDGE = Path(__file__).with_name('restricted-publisher-client.cjs')
CLIENT = 'c4g-email-templates'
ROLE = 'publish-password-reset'
ACTOR = 'b846ff11-9542-489e-b2bb-55da6f413c5c'
KEYS = ('passwordResetSubject', 'passwordResetBody', 'passwordResetBodyHtml')


class RestrictedProbeFailure(Exception):
    pass


def run_probe(api, admin, origin, realm, check, reset, captured, captured_count, first_save=None, failed_save=None):
    """Run against the gate's fresh realm, after the native baseline proof."""
    secret = secrets.token_urlsafe(32)
    issuer = origin + '/realms/' + realm
    endpoint = '/realms/' + realm + '/c4g-email-templates/password-reset'
    initial_count = captured_count()

    def require(condition, name):
        if not condition:
            check(name, False)
            raise RestrictedProbeFailure(name)

    def decode(raw):
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            require(False, 'restricted_response_json')
        require(isinstance(value, dict), 'restricted_response_object')
        return value

    def node(operation, **values):
        request = {'operation': operation, 'issuer': issuer, 'clientSecret': secret, **values}
        result = subprocess.run(['node', str(BRIDGE)], cwd=ROOT, input=json.dumps(request),
                                text=True, encoding='utf-8', capture_output=True, timeout=25)
        require(result.returncode == 0 and not result.stderr and len(result.stdout) <= 512 * 1024,
                'restricted_node_driver')
        return decode(result.stdout)

    def succeeded(operation, **values):
        result = node(operation, **values)
        code = result.get('code')
        suffix = '_' + code if code in ('INVALID_INPUT', 'C4G_ADMIN_REQUIRED', 'STALE_REVISION', 'IDEMPOTENCY_CONFLICT',
                                        'EMAIL_PUBLICATION_DRIFT', 'EMAIL_PUBLISH_UNAVAILABLE', 'EMAIL_TEMPLATE_INVALID') else ''
        require(result.get('ok') is True, 'restricted_node_' + operation + suffix)
        return result['value']

    def client(client_id, client_secret=None, service=True, direct=False, full_scope=True):
        representation = {'clientId': client_id, 'enabled': True, 'publicClient': client_secret is None,
                          'serviceAccountsEnabled': service, 'standardFlowEnabled': False,
                          'directAccessGrantsEnabled': direct, 'fullScopeAllowed': full_scope,
                          'protocol': 'openid-connect'}
        if client_secret is not None:
            representation['secret'] = client_secret
        admin('/clients', 'POST', representation)
        rows = admin('/clients?clientId=' + client_id)
        require(len(rows) == 1, 'restricted_client_created')
        client_id_internal = rows[0]['id']
        admin('/clients/' + client_id_internal + '/protocol-mappers/models', 'POST', {
            'name': 'restricted-email-audience', 'protocol': 'openid-connect', 'protocolMapper': 'oidc-audience-mapper',
            'config': {'included.client.audience': CLIENT, 'access.token.claim': 'true', 'id.token.claim': 'false'}
        })
        return client_id_internal

    def token(client_id=CLIENT, client_secret=secret, username=None, password=None):
        data = {'client_id': client_id}
        if client_secret is not None:
            data['client_secret'] = client_secret
        if username is None:
            data['grant_type'] = 'client_credentials'
        else:
            data.update({'grant_type': 'password', 'username': username, 'password': password})
        status, raw, _ = api.request('/realms/' + realm + '/protocol/openid-connect/token', data, form=True)
        value = decode(raw)
        require(status == 200 and isinstance(value.get('access_token'), str), 'restricted_service_token')
        return value['access_token']

    def request(method='GET', payload=None, bearer=None, path=None):
        # Independent cookie jar for every call also makes the CAS race isolated.
        browser = type(api)(origin)
        status, raw, _ = browser.request(path or endpoint, payload, method, token=bearer or token())
        return status, decode(raw)

    def no_leaks(value):
        encoded = json.dumps(value)
        return secret not in encoded and all(word not in encoded for word in ('smtpServer', 'client_secret', 'access_token', 'stackTrace'))

    def state():
        status, value = request()
        require(status == 200, 'restricted_state_available')
        return value

    def prepare(subject, html=None):
        value = succeeded('prepare', template={'subject': subject, 'html': html or
            '<p>{Logotipo}</p><p><a href="{LigacaoRecuperacao}">Recuperar acesso</a></p><p>Validade: {Validade}</p>'},
            logoUrl='https://platform.invalid/logo-c4g.png')
        return value

    def intention(prepared, revision, action='SAVE', key=None):
        return {'action': action, 'expectedRevision': revision, 'idempotencyKey': key or str(uuid.uuid4()),
                'actorId': ACTOR, 'template': prepared['template'], 'messages': prepared['messages'],
                'logoUrl': 'https://platform.invalid/logo-c4g.png'}

    def from_state(value, revision, key):
        return {field: value[field] for field in ('action', 'actorId', 'template', 'messages', 'logoUrl')} | {
            'expectedRevision': revision, 'idempotencyKey': key}

    # Clear only keys owned by the forthcoming publisher. The native baseline
    # deliberately populated them; retaining them must otherwise count as drift.
    admin('', 'PUT', {'actionTokenGeneratedByUserLifespan': 300})
    realm_before = admin()
    unrelated = {}
    for locale in ('pt', 'en'):
        for key in KEYS:
            admin('/localization/' + locale + '/' + key, 'DELETE')
        unrelated[locale] = admin('/localization/' + locale)
        require(unrelated[locale].get('probeSentinel') == 'preserved', 'restricted_sentinel_setup')

    dedicated = client(CLIENT, secret, full_scope=False)
    admin('/clients/' + dedicated + '/roles', 'POST', {'name': ROLE})
    role = admin('/clients/' + dedicated + '/roles/' + ROLE)
    admin('/clients/' + dedicated + '/scope-mappings/clients/' + dedicated, 'POST', [role])
    check('restricted_dedicated_scope_is_explicit', admin('/clients/' + dedicated).get('fullScopeAllowed') is False
          and any(value['id'] == role['id'] for value in admin('/clients/' + dedicated + '/scope-mappings/clients/' + dedicated)))
    service_user = admin('/clients/' + dedicated + '/service-account-user')
    mappings = '/users/' + service_user['id'] + '/role-mappings/clients/' + dedicated

    status, raw, _ = type(api)(origin).request(endpoint)
    unauthorized = decode(raw)
    check('restricted_anonymous_refused_without_details', status == 401 and unauthorized == {'code': 'NOT_AUTHORIZED'} and no_leaks(unauthorized))
    status, value = request(bearer=token())
    check('restricted_dedicated_client_needs_current_role', status == 403 and value == {'code': 'NOT_AUTHORIZED'})
    admin(mappings, 'POST', [role])
    bearer = token()
    zero = succeeded('read')
    check('restricted_initial_revision_zero', zero == {'revision': 0, 'configured': False})
    admin('/localization/pt', 'POST', {'passwordResetSubject': 'Pre-existing native override'})
    status, value = request()
    check('restricted_initial_native_override_refused', status == 409 and value == {'code': 'EMAIL_PUBLICATION_DRIFT'})
    admin('/localization/pt/passwordResetSubject', 'DELETE')
    require(state() == zero, 'restricted_initial_override_did_not_create_revision')
    view = succeeded('service-template')
    check('restricted_application_reads_unpublished_draft', view.get('revision') == 0 and view.get('publication') == 'UNPUBLISHED'
          and view.get('capabilities') == {'test': False})
    types = succeeded('types')
    check('restricted_application_reports_capability', any(item.get('type') == 'password-reset' and item.get('configurable') is True for item in types.get('items', [])))
    denied = node('service-template', authorized=False)
    check('restricted_application_checks_c4g_administrator', denied == {'ok': False, 'code': 'C4G_ADMIN_REQUIRED'})

    status, raw, _ = api.request('/admin/realms/' + realm, token=bearer)
    check('restricted_service_has_no_native_realm_administration', status == 403 and secret not in raw)
    status, value = request(path='/realms/master/c4g-email-templates/password-reset', bearer=bearer)
    check('restricted_foreign_realm_token_refused', status in (401, 403) and value == {'code': 'NOT_AUTHORIZED'})

    wrong_secret = secrets.token_urlsafe(32)
    wrong = client('email-wrong-client', wrong_secret)
    wrong_user = admin('/clients/' + wrong + '/service-account-user')
    admin('/users/' + wrong_user['id'] + '/role-mappings/clients/' + dedicated, 'POST', [role])
    status, value = request(bearer=token('email-wrong-client', wrong_secret))
    check('restricted_wrong_client_refused_even_with_role_and_audience', status == 403 and value == {'code': 'NOT_AUTHORIZED'})

    human_password = secrets.token_urlsafe(24)
    client('email-human-client', service=False, direct=True)
    admin('/users', 'POST', {'username': 'email-human', 'email': 'human@capture.invalid', 'enabled': True, 'emailVerified': True,
                            'firstName': 'Human', 'lastName': 'Probe',
                            'credentials': [{'type': 'password', 'value': human_password, 'temporary': False}]})
    human_user = admin('/users?username=email-human&exact=true')[0]
    admin('/users/' + human_user['id'] + '/role-mappings/clients/' + dedicated, 'POST', [role])
    status, value = request(bearer=token('email-human-client', None, 'email-human', human_password))
    check('restricted_human_refused_even_with_role_and_audience', status == 403 and value == {'code': 'NOT_AUTHORIZED'})

    # The same already-issued bearer must stop working when its live role is revoked.
    bearer = token()
    admin(mappings, 'DELETE', [role])
    status, value = request(bearer=bearer)
    check('restricted_role_revocation_applies_to_existing_token', status == 403 and value == {'code': 'NOT_AUTHORIZED'})
    admin(mappings, 'POST', [role])

    source_html = '<p>{Logotipo}</p><p onclick="bad()">Publicação &amp; revisão d\'água</p>' \
                  '<p><a href="{LigacaoRecuperacao}">Recuperar acesso</a></p><p>Validade: {Validade}</p><script>alert(1)</script>'
    prepared = prepare("C4G — publicação restrita d'água", source_html)
    first_key = str(uuid.uuid4())
    def save_first():
        return succeeded('save', body={'subject': prepared['template']['subject'], 'html': source_html,
                                      'expectedRevision': 0, 'idempotencyKey': first_key})
    if first_save:
        first, blocked_on_native_write = first_save(save_first)
        unrelated['pt']['probeSentinel'] = 'concurrent-preserved'
        check('restricted_concurrent_native_locale_write_is_serialized', blocked_on_native_write)
    else:
        first = save_first()
    first_state = state()
    first_intention = from_state(first_state, 0, first_key)
    check('restricted_application_save_publishes_revision_one', first.get('revision') == 1 and first.get('publication') == 'PUBLISHED'
          and first_state['template'] == prepared['template'] and first_state['messages'] == prepared['messages'] and no_leaks(first_state))
    check('restricted_application_sanitizes_before_publication', 'script' in first.get('removed', [])
          and 'onclick' not in first_state['template']['html'] and '<script' not in first_state['template']['html'])
    replay = succeeded('publish', payload=first_intention)
    check('restricted_current_intention_replay_is_stable', replay == first_state and state() == first_state)

    for locale in ('pt', 'en'):
        values = admin('/localization/' + locale)
        check('restricted_only_owned_keys_published_' + locale, all(values.get(key) == first_state['messages'][key] for key in KEYS)
              and {key: value for key, value in values.items() if key not in KEYS} == unrelated[locale])
    realm_after = admin()
    check('restricted_smtp_and_authentication_flows_preserved', all(realm_after.get(key) == realm_before.get(key) for key in (
        'smtpServer', 'browserFlow', 'resetCredentialsFlow', 'emailTheme', 'resetPasswordAllowed', 'actionTokenGeneratedByUserLifespan')))

    next_message = captured_count()
    reset(locale='en')
    message, text, html, _ = captured(next_message)
    check('restricted_published_template_reaches_native_email', str(message['Subject']) == prepared['template']['subject']
          and 'Recuperar acesso' in text and '5 minutes' in text and 'https://platform.invalid/logo-c4g.png' in html)

    race = [intention(prepare('Concorrência A'), 1), intention(prepare('Concorrência B'), 1)]
    race_token = token()
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda payload: request('PUT', payload, race_token), race))
    check('restricted_concurrent_cas_has_one_winner', sorted(result[0] for result in responses) == [200, 409]
          and all(value.get('code') == 'STALE_REVISION' for status, value in responses if status == 409))
    winner = next((value for status, value in responses if status == 200), None)
    require(winner is not None, 'restricted_cas_winner_present')
    check('restricted_concurrent_head_is_single_revision', state() == winner and winner.get('revision') == 2)
    superseded = node('publish', payload=first_intention)
    check('restricted_superseded_replay_does_not_claim_current_success', superseded == {'ok': False, 'code': 'STALE_REVISION'} and state() == winner)
    conflicting = intention(prepare('Conteúdo diferente para a mesma intenção'), 0, key=first_key)
    status, value = request('PUT', conflicting)
    check('restricted_reused_key_with_other_content_conflicts', status == 409 and value == {'code': 'IDEMPOTENCY_CONFLICT'} and state() == winner)

    clean = intention(prepare('Template recusado'), 2)
    invalid_payloads = []
    missing_link = copy.deepcopy(clean)
    missing_link['messages']['passwordResetBody'] = 'Sem ligação'
    invalid_payloads.append(missing_link)
    mismatch = copy.deepcopy(clean)
    mismatch['messages']['passwordResetSubject'] = "'Assunto divergente'"
    invalid_payloads.append(mismatch)
    extra = copy.deepcopy(clean)
    extra['smtpServer'] = {'host': 'not-used.invalid'}
    invalid_payloads.append(extra)
    for payload in invalid_payloads:
        payload['idempotencyKey'] = str(uuid.uuid4())
        status, value = request('PUT', payload)
        require(status == 400 and value == {'code': 'INVALID_INPUT'} and no_leaks(value), 'restricted_invalid_payload_refused')
    check('restricted_invalid_payloads_leave_head_unchanged', state() == winner)
    status, value = request(path=endpoint + '?locale=en')
    check('restricted_arbitrary_query_refused', status == 400 and value == {'code': 'INVALID_INPUT'})

    reset_key = str(uuid.uuid4())
    reset_view = succeeded('reset', body={'expectedRevision': 2, 'idempotencyKey': reset_key})
    reset_state = state()
    reset_intention = from_state(reset_state, 2, reset_key)
    check('restricted_reset_appends_default_revision', reset_view.get('source') == 'DEFAULT' and reset_view.get('revision') == 3
          and reset_view.get('publication') == 'PUBLISHED' and reset_state.get('action') == 'RESET')
    replay = succeeded('publish', payload=reset_intention)
    check('restricted_reset_replay_does_not_append_history', replay == reset_state and state() == reset_state)
    next_message = captured_count()
    reset(locale='en')
    message, _, _, _ = captured(next_message)
    check('restricted_reset_template_reaches_native_email', str(message['Subject']) == reset_view['subject'])

    if failed_save:
        attempted = intention(prepare('Publicação revertida por falha da base'), 3)
        failed = failed_save(lambda: node('publish', payload=attempted))
        check('restricted_database_failure_rolls_back_publication', failed == {'ok': False, 'code': 'EMAIL_PUBLISH_UNAVAILABLE'}
              and state() == reset_state and all(admin('/localization/' + locale).get(key) == reset_state['messages'][key]
                                                for locale in ('pt', 'en') for key in KEYS))

    # Simulate an operator changing one managed key outside this restricted API.
    admin('/localization/pt', 'POST', {'passwordResetSubject': 'External drift'})
    status, value = request()
    check('restricted_external_drift_blocks_read', status == 409 and value == {'code': 'EMAIL_PUBLICATION_DRIFT'})
    drifted = node('publish', payload=intention(prepare('Não pode substituir a deriva'), 3))
    replay = node('publish', payload=reset_intention)
    check('restricted_external_drift_blocks_write_and_replay', drifted == replay == {'ok': False, 'code': 'EMAIL_PUBLICATION_DRIFT'})
    types = succeeded('types')
    check('restricted_application_hides_capability_on_drift', any(item.get('type') == 'password-reset' and item.get('configurable') is False for item in types.get('items', [])))
    require(admin('/localization/pt')['passwordResetSubject'] == 'External drift', 'restricted_drift_was_not_overwritten')
    admin('/localization/pt', 'POST', reset_state['messages'])
    check('restricted_rejected_operations_never_created_a_revision', state() == reset_state)
    check('restricted_probe_sends_only_two_capture_messages', captured_count() == initial_count + 2)
