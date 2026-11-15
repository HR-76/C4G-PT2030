"""Explicitly authorized local-only Keycloak/SMTP proof. No habitual configuration.

python test/integration/email-authentication/keycloak_gate.py --authorized-local
Requires the verified official ZIP in .tmp/email-authentication-download and JDK.
Only synthetic users; captured messages and credentials are never written or printed.
"""
import argparse
import base64
import hashlib
import http.cookiejar
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import socketserver
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from email import policy
from email.parser import BytesParser

ROOT = Path(__file__).resolve().parents[3]
ZIP = ROOT / '.tmp/email-authentication-download/keycloak-26.8.0.zip'
SHA256 = '7ed1de3fda2598369262613bf682aab7e233d80a38c405e91588f7a7454370a1'
JAVA = Path('C:/Program Files/Java/jdk-23/bin/java.exe')


class GateFailure(Exception):
    pass


def require(condition, name):
    if not condition:
        raise GateFailure(name)


def response_code(label, status, raw):
    # Closed diagnostic vocabulary; never emit a page, URL or session token.
    hints = [name for name in ('cookie', 'https', 'invalid', 'expired', 'forbidden',
                              'missing', 'restart', 'inválid', 'expirad', 'internal server')
             if name in raw.lower()]
    return label + '_' + str(status) + '_' + '_'.join(hints)


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.forms, self.links, self.text = [], [], []
        self.current = None
        self.hidden_text = 0
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.hidden_text += 1
        if tag == 'form':
            self.current = {'action': attrs.get('action'), 'id': attrs.get('id'), 'fields': {}}
            self.forms.append(self.current)
        if tag == 'input' and self.current and attrs.get('name') and attrs.get('type') == 'hidden':
            self.current['fields'][attrs['name']] = attrs.get('value', '')
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden_text = max(0, self.hidden_text - 1)
        if tag == 'form':
            self.current = None

    def handle_data(self, value):
        if not self.hidden_text:
            self.text.append(value)

    def form(self, name):
        result = next((form for form in self.forms if form['id'] == name), None)
        require(result is not None, 'FORM_MISSING_' + name)
        return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LoopbackCookiePolicy(http.cookiejar.DefaultCookiePolicy):
    def return_ok_secure(self, cookie, request):
        # Keycloak treats loopback as a secure context, as browsers do. Python's
        # default jar does not. Keep every other domain/path/expiry check intact.
        if request.type == 'http' and urllib.parse.urlsplit(request.full_url).hostname == '127.0.0.1':
            return True
        return super().return_ok_secure(cookie, request)


class Browser:
    def __init__(self, origin):
        parsed = urllib.parse.urlsplit(origin)
        require(parsed.scheme == 'http' and parsed.hostname == '127.0.0.1', 'LOOPBACK_ORIGIN_REQUIRED')
        self.origin = origin
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect(),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar(LoopbackCookiePolicy())))

    def request(self, url, body=None, method=None, token=None, form=False, follow=True):
        url = urllib.parse.urljoin(self.origin, url)
        for _ in range(12):
            parsed = urllib.parse.urlsplit(url)
            require(f'{parsed.scheme}://{parsed.netloc}' == self.origin, 'NONLOCAL_REQUEST_REFUSED')
            headers = {}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            payload = None
            if body is not None:
                headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
                payload = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
            req = urllib.request.Request(url, data=payload, method=method, headers=headers)
            try:
                response = self.opener.open(req, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read(2_000_001)
                require(len(raw) <= 2_000_000, 'RESPONSE_LIMIT')
                status, location = response.status, response.headers.get('Location')
            if follow and status in (301, 302, 303, 307, 308) and location:
                url = urllib.parse.urljoin(url, location)
                if status in (301, 302, 303):
                    body, method = None, 'GET'
                continue
            return status, raw.decode('utf-8'), url
        raise GateFailure('REDIRECT_LIMIT')

    def submit(self, form, values):
        return self.request(form['action'], {**form['fields'], **values}, form=True)


class Capture(socketserver.ThreadingTCPServer):
    allow_reuse_address = False
    daemon_threads = True

    def __init__(self):
        self.messages = []
        self.lock = threading.Lock()
        super().__init__(('127.0.0.1', 0), SMTP)


class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(20)
        self.wfile.write(b'220 capture.invalid SMTP capture only\r\n')
        recipients = []
        while True:
            line = self.rfile.readline(10000)
            if not line:
                return
            command = line.decode('ascii', errors='replace').strip()
            verb = command.split(' ', 1)[0].upper()
            if verb in ('EHLO', 'HELO'):
                self.wfile.write(b'250-capture.invalid\r\n250 SIZE 1000000\r\n')
            elif verb in ('MAIL', 'RCPT'):
                # No relay, and only explicitly synthetic addresses accepted.
                if not re.search(r'<[^<>\s@]+@[^<>\s@]+\.invalid>', command, re.I):
                    self.wfile.write(b'550 synthetic recipients only\r\n')
                else:
                    if verb == 'MAIL':
                        recipients = []
                    else:
                        recipients.append(command)
                    self.wfile.write(b'250 OK\r\n')
            elif verb == 'DATA' and recipients:
                self.wfile.write(b'354 End with dot\r\n')
                chunks, size = [], 0
                while True:
                    part = self.rfile.readline(1000001)
                    if not part:
                        return
                    if part == b'.\r\n':
                        break
                    size += len(part)
                    if size > 1000000:
                        return
                    chunks.append(part[1:] if part.startswith(b'..') else part)
                with self.server.lock:
                    self.server.messages.append(b''.join(chunks))
                self.wfile.write(b'250 Captured locally\r\n')
            elif verb == 'QUIT':
                self.wfile.write(b'221 Bye\r\n')
                return
            elif verb in ('RSET', 'NOOP'):
                if verb == 'RSET':
                    recipients = []
                self.wfile.write(b'250 OK\r\n')
            else:
                self.wfile.write(b'502 Not implemented\r\n')


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def compile_template(template=None, logo=None):
    script = "const c=require('./backend/src/emailTemplates/keycloakPasswordReset');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const i=JSON.parse(s);process.stdout.write(JSON.stringify(c.compilePasswordReset(i.template,{logoUrl:i.logo})))})"
    result = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps({'template': template, 'logo': logo}) if template else json.dumps({'logo': logo}),
                            text=True, encoding='utf-8', capture_output=True, timeout=20, check=True)
    return json.loads(result.stdout)


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--authorized-local', action='store_true')
    parser.add_argument('--restricted-publisher', action='store_true')
    parser.add_argument('--postgres-temporary', action='store_true')
    parser.add_argument('--provider-jar', type=Path, help='Owned .tmp artifact for regression comparison only')
    args = parser.parse_args()
    require(args.authorized_local, 'EXPLICIT_LOCAL_AUTHORIZATION_REQUIRED')
    require(JAVA.is_file(), 'JDK_MISSING')
    require(ZIP.is_file() and hashlib.file_digest(ZIP.open('rb'), 'sha256').hexdigest() == SHA256, 'DISTRIBUTION_CHECKSUM')
    extension_jar = (args.provider_jar or ROOT / '.tmp/email-templates-build/c4g-email-templates-26.8.0.jar').resolve()
    require(extension_jar.is_relative_to((ROOT / '.tmp').resolve()) and extension_jar.suffix == '.jar', 'OWNED_PROVIDER_PATH_REQUIRED')
    require(not args.provider_jar or args.restricted_publisher, 'PROVIDER_REQUIRES_RESTRICTED_GATE')
    if args.restricted_publisher:
        require(extension_jar.is_file(), 'RESTRICTED_PROVIDER_NOT_BUILT')
    base = ROOT / '.tmp' / ('email-keycloak-' + secrets.token_hex(8))
    base.mkdir()
    evidence = {'keycloak': '26.8.0', 'distributionSha256': SHA256, 'database': 'isolated H2 dev-file',
                'smtp': 'loopback memory capture, no relay', 'checks': [], 'failedChecks': [], 'passed': False}
    process, capture, smtp_thread, postgres = None, None, None, None
    step = 'extract'

    def check(name, condition=True):
        evidence['checks' if condition else 'failedChecks'].append(name)
        print(('PASS ' if condition else 'FAIL ') + name, flush=True)

    try:
        with zipfile.ZipFile(ZIP) as archive:
            # The ZIP is official and verified; also constrain all extraction paths.
            require(all((base / name).resolve().is_relative_to(base.resolve()) for name in archive.namelist()), 'ARCHIVE_PATH')
            archive.extractall(base)
        home = base / 'keycloak-26.8.0'
        if args.restricted_publisher:
            shutil.copyfile(extension_jar, home / 'providers/c4g-email-templates.jar')
            with extension_jar.open('rb') as artifact:
                evidence['restrictedProviderSha256'] = hashlib.file_digest(artifact, 'sha256').hexdigest()
        capture = Capture()
        smtp_thread = threading.Thread(target=capture.serve_forever, daemon=True)
        smtp_thread.start()
        port = free_port()
        origin = f'http://127.0.0.1:{port}'
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'PATH') if key in os.environ}
        password = secrets.token_urlsafe(32)
        env.update({'TEMP': str(base), 'TMP': str(base), 'KC_BOOTSTRAP_ADMIN_USERNAME': 'email-probe-admin',
                    'KC_BOOTSTRAP_ADMIN_PASSWORD': password})
        if args.postgres_temporary:
            step = 'postgres_start'
            from temporary_postgres import TemporaryPostgres
            postgres = TemporaryPostgres(base)
            postgres.start()
            env.update(postgres.keycloak_environment())
            evidence['database'] = 'isolated PostgreSQL ' + postgres.version
        command = [str(JAVA), '-Xms128m', '-Xmx768m', '-Djava.util.logging.manager=org.jboss.logmanager.LogManager',
                   '-Djava.util.concurrent.ForkJoinPool.common.threadFactory=io.quarkus.bootstrap.forkjoin.QuarkusForkJoinWorkerThreadFactory',
                   '-Duser.language=en', '-Duser.country=US', '-Dpicocli.disable.closures=true',
                   '-Dkc.home.dir=' + str(home), '-Djboss.server.config.dir=' + str(home / 'conf'),
                   '-Dkeycloak.theme.dir=' + str(home / 'themes'),
                   '--add-opens=java.base/java.lang=ALL-UNNAMED', '--add-opens=java.base/java.util=ALL-UNNAMED',
                   '--add-opens=java.base/java.util.concurrent=ALL-UNNAMED', '--enable-native-access=ALL-UNNAMED',
                   '-cp', str(home / 'lib/quarkus-run.jar'), 'io.quarkus.bootstrap.runner.QuarkusEntryPoint',
                   'start-dev', '--db=postgres' if postgres else '--db=dev-file', '--http-host=127.0.0.1', f'--http-port={port}',
                   '--hostname=' + origin, '--cache=local', '--log-level=warn']
        # Capture bounded startup diagnostics only in memory; never persist logs.
        diagnostics = []

        def launch():
            proc = subprocess.Popen(command, cwd=home, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            def drain():
                for line in proc.stdout:
                    if len(diagnostics) < 60:
                        diagnostics.append(line.decode('utf-8', errors='replace'))
            threading.Thread(target=drain, daemon=True).start()
            return proc

        process = launch()
        api = Browser(origin)
        step = 'startup'
        deadline = time.monotonic() + 180
        restarted = False
        while time.monotonic() < deadline:
            if process.poll() == 10 and not restarted:
                command.insert(1, '-Dkc.config.built=true')
                process = launch()
                restarted = True
                # Keycloak's first launch builds Quarkus and exits 10. Give the
                # actual server its own bounded startup interval after that build.
                deadline = time.monotonic() + 180
            require(process.poll() is None, 'KEYCLOAK_START_FAILED')
            try:
                if api.request('/realms/master/.well-known/openid-configuration')[0] == 200:
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        else:
            raise GateFailure('KEYCLOAK_START_TIMEOUT')
        check('isolated_keycloak_started')
        status, raw, _ = api.request('/realms/master/protocol/openid-connect/token', {
            'client_id': 'admin-cli', 'grant_type': 'password', 'username': 'email-probe-admin', 'password': password}, form=True)
        require(status == 200, 'ADMIN_LOGIN')
        token = json.loads(raw)['access_token']
        realm = 'email-proof'
        prefix = '/admin/realms/' + realm

        def admin(path='', method='GET', body=None):
            nonlocal token
            status, raw, _ = api.request(prefix + path, body, method, token=token)
            if status == 401:
                auth_status, auth_raw, _ = api.request('/realms/master/protocol/openid-connect/token', {
                    'client_id': 'admin-cli', 'grant_type': 'password', 'username': 'email-probe-admin', 'password': password}, form=True)
                require(auth_status == 200, 'ADMIN_REAUTHENTICATION')
                token = json.loads(auth_raw)['access_token']
                status, raw, _ = api.request(prefix + path, body, method, token=token)
            require(status in (200, 201, 204), 'ADMIN_OPERATION_' + str(status))
            return json.loads(raw) if raw else None

        step = 'realm_setup'
        status, _, _ = api.request('/admin/realms', {
            'realm': realm, 'enabled': True, 'sslRequired': 'none', 'registrationAllowed': False,
            'eventsListeners': ['c4g-email-delivery'] if args.restricted_publisher else ['jboss-logging'],
            'resetPasswordAllowed': True, 'internationalizationEnabled': True, 'defaultLocale': 'pt',
            'supportedLocales': ['pt', 'en'], 'emailTheme': 'keycloak', 'actionTokenGeneratedByUserLifespan': 300,
            'smtpServer': {'host': '127.0.0.1', 'port': str(capture.server_address[1]), 'from': 'sender@capture.invalid',
                           'fromDisplayName': 'C4G prova local', 'ssl': 'false', 'starttls': 'false', 'auth': 'false'}
        }, 'POST', token=token)
        require(status == 201, 'REALM_CREATE')
        original = admin()
        admin('/clients', 'POST', {'clientId': 'email-browser', 'enabled': True, 'publicClient': True,
                                  'standardFlowEnabled': True, 'directAccessGrantsEnabled': True,
                                  'redirectUris': [origin + '/callback']})
        old_password, new_password = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
        admin('/users', 'POST', {'username': 'email-probe', 'email': 'recipient@capture.invalid', 'enabled': True,
                                'emailVerified': True, 'firstName': 'Email', 'lastName': 'Probe', 'attributes': {'locale': ['pt']},
                                'credentials': [{'type': 'password', 'value': old_password, 'temporary': False}]})
        user = admin('/users?username=email-probe&exact=true')[0]

        def publish(template=None, locale='pt', logo=None):
            compiled = compile_template(template, logo)
            admin('/localization/' + locale, 'POST', {'probeSentinel': 'preserved'})
            admin('/localization/' + locale, 'POST', compiled['messages'])
            readback = admin('/localization/' + locale)
            require(readback == {**compiled['messages'], 'probeSentinel': 'preserved'}, 'LOCALIZATION_READBACK')
            after = admin()
            require(all(after.get(key) == original.get(key) for key in (
                'smtpServer', 'browserFlow', 'resetCredentialsFlow', 'emailTheme', 'resetPasswordAllowed')), 'UNRELATED_REALM_CHANGED')
            return compiled

        def reset(username='email-probe', locale='pt'):
            browser = Browser(origin)
            query = urllib.parse.urlencode({'client_id': 'email-browser', 'response_type': 'code', 'scope': 'openid',
                                             'redirect_uri': origin + '/callback', 'kc_locale': locale})
            status, raw, _ = browser.request(f'/realms/{realm}/protocol/openid-connect/auth?' + query)
            require(status == 200, 'LOGIN_FORM')
            link = next((link for link in Page(raw).links if '/login-actions/reset-credentials' in link), None)
            require(link is not None, 'RESET_OPTION')
            status, raw, _ = browser.request(link)
            require(status == 200, response_code('RESET_FORM', status, raw))
            status, raw, _ = browser.submit(Page(raw).form('kc-reset-password-form'), {'username': username})
            require(status == 200, 'RESET_SUBMIT')
            return browser, ' '.join(' '.join(Page(raw).text).split())

        def captured(index):
            limit = time.monotonic() + 10
            while len(capture.messages) <= index and time.monotonic() < limit:
                time.sleep(0.1)
            require(len(capture.messages) == index + 1, 'SMTP_CAPTURE_COUNT')
            message = BytesParser(policy=policy.default).parsebytes(capture.messages[index])
            plain, html = message.get_body(('plain',)), message.get_body(('html',))
            require(plain is not None and html is not None, 'MULTIPART_REQUIRED')
            text, markup = plain.get_content(), html.get_content()
            require(str(message['To']) == 'recipient@capture.invalid', 'SYNTHETIC_RECIPIENT')
            links = [link for link in Page(markup).links if '/login-actions/action-token?' in link]
            require(len(links) == 1 and links[0] in text and links[0].startswith(origin + '/'), 'RESET_LINK_BOTH_PARTS')
            require(all(value not in text + markup for value in ('{Validade}', '{LigacaoRecuperacao}', '{Logotipo}')), 'UNRESOLVED_VARIABLES')
            return message, text, markup, links[0]

        step = 'native_reset_message'
        publish()
        browser, known_response = reset()
        message, text, markup, link = captured(0)
        check('default_subject_and_multipart', str(message['Subject']) == 'Recupere o acesso à C4G')
        check('duration_from_keycloak', '5 minutos' in text and '5 minutos' in markup)
        _, unknown_response = reset('unknown@capture.invalid')
        time.sleep(0.5)
        check('unknown_account_same_response_no_email', known_response == unknown_response and len(capture.messages) == 1)
        status, raw, _ = browser.request(link)
        require(status == 200, 'ACTION_LINK_OPEN')
        status, raw, _ = browser.submit(Page(raw).form('kc-passwd-update-form'), {
            'password-new': new_password, 'password-confirm': new_password, 'logout-sessions': 'on'})
        # A successful action may redirect to the synthetic /callback (404).
        require(status in (200, 404), 'PASSWORD_UPDATE_RESPONSE')

        def password_login(value):
            status, raw, _ = Browser(origin).request(f'/realms/{realm}/protocol/openid-connect/token', {
                'client_id': 'email-browser', 'grant_type': 'password', 'username': 'email-probe', 'password': value}, form=True)
            payload = json.loads(raw)
            require(status != 200 or isinstance(payload.get('access_token'), str), 'TOKEN_RESPONSE_INVALID')
            require(status != 400 or payload.get('error') == 'invalid_grant', 'WRONG_GRANT_ERROR')
            return status

        new_status, old_status = password_login(new_password), password_login(old_password)
        evidence['credentialHttpStatus'] = {'new': new_status, 'old': old_status}
        check('new_password_authenticates_old_password_refused', new_status == 200 and old_status == 400)
        _, reused, _ = Browser(origin).request(link)
        check('reset_link_single_use', not any(f['id'] == 'kc-passwd-update-form' for f in Page(reused).forms)
              and re.search(r'invalid|expir|utilizad', ' '.join(Page(reused).text), re.I) is not None)

        step = 'customized_reset_message'
        custom = {'subject': "C4G d'água {0} {}", 'html': '<p>{Logotipo}</p><p>d\'água {0} {1,choice,0#x}</p>'
                  '<p><a href="{LigacaoRecuperacao}">Recuperar acesso</a></p><p>Duração: {Validade}</p>'
                  '<script>alert(1)</script><img src="https://foreign.invalid/tracker"><p onclick="bad()">Texto seguro</p>'}
        compiled = publish(custom, logo='https://logo.invalid/c4g.png')
        reset()
        message, text, markup, _ = captured(1)
        check('custom_subject_quotes_braces', str(message['Subject']) == custom['subject'])
        check('custom_body_literal_arguments', "d'água {0} {1,choice,0#x}" in text)
        check('html_sanitized_at_delivery', bool(compiled['removed']) and not any(value in markup for value in (
            '<script', 'onclick', 'foreign.invalid', 'alert(1)')))
        check('platform_logo_survives_keycloak_sanitizer', 'https://logo.invalid/c4g.png' in markup and 'logo.invalid' not in text)
        step = 'locale_selection'
        english = {'subject': 'C4G recovery EN', 'html': '<p><a href="{LigacaoRecuperacao}">Reset password</a></p><p>Valid for {Validade}</p>'}
        publish(english, locale='en')
        current_user = admin('/users/' + user['id'])
        profile_keys = ('username', 'firstName', 'lastName', 'email', 'enabled', 'emailVerified', 'requiredActions')
        profile = {key: current_user[key] for key in profile_keys if key in current_user}
        profile['attributes'] = {**current_user.get('attributes', {}), 'locale': ['en']}
        # User PUT is not a partial realm PUT: preserve profile fields explicitly.
        admin('/users/' + user['id'], 'PUT', profile)
        after_user = admin('/users/' + user['id'])
        require(all(after_user.get(key) == current_user.get(key) for key in profile_keys), 'LOCALE_PROFILE_CHANGED')
        reset(locale='en')
        message, text, markup, _ = captured(2)
        check('user_locale_selects_native_messages', str(message['Subject']) == english['subject'] and '5 minutes' in text)

        step = 'expiry'
        admin('', 'PUT', {'actionTokenGeneratedByUserLifespan': 3})
        reset(locale='en')
        _, _, _, expiring_link = captured(3)
        jwt = urllib.parse.parse_qs(urllib.parse.urlsplit(expiring_link).query)['key'][0].split('.')[1]
        expires = json.loads(base64.urlsafe_b64decode(jwt + '=' * (-len(jwt) % 4)))['exp']
        require(-30 <= expires - time.time() <= 5, 'SHORT_EXPIRY_NOT_APPLIED')
        while time.time() <= expires + 1:
            time.sleep(0.2)
        _, expired, _ = Browser(origin).request(expiring_link)
        check('expired_link_refused', not any(f['id'] == 'kc-passwd-update-form' for f in Page(expired).forms)
              and re.search(r'invalid|expir', ' '.join(Page(expired).text), re.I) is not None
              and password_login(new_password) == 200)

        step = 'restricted_service_account'
        service_secret = secrets.token_urlsafe(32)
        admin('/clients', 'POST', {'clientId': 'email-unprivileged', 'publicClient': False, 'secret': service_secret,
                                  'serviceAccountsEnabled': True, 'standardFlowEnabled': False, 'enabled': True})
        status, raw, _ = api.request(f'/realms/{realm}/protocol/openid-connect/token', {
            'grant_type': 'client_credentials', 'client_id': 'email-unprivileged', 'client_secret': service_secret}, form=True)
        require(status == 200, 'SERVICE_LOGIN')
        service_token = json.loads(raw)['access_token']
        status, _, _ = api.request(prefix + '/localization/pt', {'passwordResetSubject': 'forbidden'}, 'POST', token=service_token)
        check('unprivileged_service_cannot_publish', status == 403)
        check('failed_publication_preserves_template', admin('/localization/pt')['passwordResetSubject'] == compiled['messages']['passwordResetSubject'])
        if args.restricted_publisher:
            step = 'restricted_publisher'
            from restricted_probe import run_probe
            run_probe(api, admin, origin, realm, check, reset, captured, lambda: len(capture.messages),
                      first_save=postgres.publish_during_native_locale_update if postgres else None,
                      failed_save=postgres.with_forced_version_failure if postgres else None,
                      history_storage=postgres.verify_delivery_retention if postgres else None)
            if postgres:
                step = 'postgres_audit'
                audit = postgres.verify_restricted_state()
                evidence['restrictedStorage'] = audit
                check('restricted_postgres_audit_and_history', audit['heads'] == 1 and audit['versions'] == 3
                      and all(value is True for key, value in audit.items() if key not in ('heads', 'versions')))
        evidence['capturedMessages'] = len(capture.messages)
        evidence['passed'] = not evidence['failedChecks']
    except Exception as error:
        # Never print exception payloads, HTTP bodies, email links or credentials.
        evidence['failedStep'] = step
        evidence['failure'] = str(error) if isinstance(error, GateFailure) or type(error).__name__ == 'TemporaryPostgresFailure' else type(error).__name__
        if 'diagnostics' in locals():
            evidence['keycloakEventErrors'] = sorted(set(re.findall(
                r'\berror="?([a-z_]{3,50})"?(?=[,\s])', ''.join(diagnostics))))
        print('FAIL ' + evidence['failedStep'] + ': ' + evidence['failure'], flush=True)
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if capture:
            evidence['capturedMessages'] = len(capture.messages)
            capture.shutdown()
            capture.server_close()
            smtp_thread.join(timeout=5)
            capture.messages.clear()
        evidence['servicesStopped'] = ((process is None or process.poll() is not None)
                                       and (smtp_thread is None or not smtp_thread.is_alive()))
        # Erase the disposable database with synthetic accounts and credentials.
        data = base / 'keycloak-26.8.0/data'
        require(data.resolve().is_relative_to(base.resolve()), 'CLEANUP_PATH')
        if data.exists():
            shutil.rmtree(data)
        evidence['databaseRemoved'] = not data.exists()
        if postgres:
            try:
                cleanup = postgres.close()
                evidence['servicesStopped'] = evidence['servicesStopped'] and cleanup['servicesStopped']
                evidence['databaseRemoved'] = evidence['databaseRemoved'] and cleanup['databaseRemoved']
            except Exception:
                # Do not erase a cluster whose shutdown/ownership was not confirmed.
                evidence.update({'passed': False, 'servicesStopped': False, 'databaseRemoved': False,
                                 'cleanupFailure': 'POSTGRES_CLEANUP_NOT_CONFIRMED'})
        evidence['passed'] = evidence['passed'] and evidence['servicesStopped'] and evidence['databaseRemoved']
        (base / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Evidence: ' + str(base / 'evidence.json'), flush=True)
    return 0 if evidence['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(run())
