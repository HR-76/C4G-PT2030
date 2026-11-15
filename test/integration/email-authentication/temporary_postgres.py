"""Owned PostgreSQL 18 cluster for the explicitly authorized disposable gate.

No imports start a process. Credentials travel only through anonymous stdin or
process environments; no console, password file, service registration or log.
The caller must stop Keycloak before close(). This does not model staging's 17.
"""
import os
import json
from concurrent.futures import Future, TimeoutError as FutureTimeout
from pathlib import Path
import re
import queue
import secrets
import shutil
import socket
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[3]
BIN = Path(os.environ.get('C4G_EMAIL_POSTGRES_BIN', 'C:/Program Files/PostgreSQL/18/bin'))
HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


class TemporaryPostgresFailure(Exception):
    """Fixed diagnostic code only, never command output or credentials."""


def require(condition, code):
    if not condition:
        raise TemporaryPostgresFailure(code)


def owned_base(base, root=ROOT):
    """Pure guard, shared by setup and every stop/delete path."""
    base, parent = Path(base).resolve(), (Path(root) / '.tmp').resolve()
    require(base.parent == parent and re.fullmatch(r'email-keycloak-[0-9a-f]{16}', base.name), 'POSTGRES_OWNED_PATH_REQUIRED')
    require(base.is_dir(), 'POSTGRES_GATE_DIRECTORY_REQUIRED')
    return base


class TemporaryPostgres:
    def __init__(self, base):
        self.base = owned_base(base)
        self.data = self.base / 'postgres-data'
        self.marker = self.base / 'postgres-owner'
        require(not self.data.exists() and not self.marker.exists(), 'POSTGRES_EXISTING_DATA_REFUSED')
        self.nonce = secrets.token_hex(32)
        with self.marker.open('x', encoding='ascii') as marker:
            marker.write(self.nonce)
        self.username = 'email_probe_' + secrets.token_hex(8)
        self.password = secrets.token_urlsafe(40)
        self.database = 'email_probe_' + secrets.token_hex(8)
        self.port = None
        self.pid = None
        self.version = None
        self.started = False

    def _guard(self):
        require(owned_base(self.base) == self.base, 'POSTGRES_BASE_CHANGED')
        require(self.marker.is_file() and self.marker.read_text(encoding='ascii') == self.nonce, 'POSTGRES_OWNERSHIP_MISMATCH')
        require(self.data.resolve() == self.base / 'postgres-data' and not self.data.is_symlink(), 'POSTGRES_DATA_PATH_CHANGED')

    def _environment(self):
        # Do not inherit PGDATA, PGSERVICE, habitual credentials or client config.
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'PATH') if key in os.environ}
        env.update({'TEMP': str(self.base), 'TMP': str(self.base), 'OSTYPE': 'msys',
                    'PGHOST': '127.0.0.1', 'PGUSER': self.username, 'PGPASSWORD': self.password,
                    'PGDATABASE': self.database, 'PGCONNECT_TIMEOUT': '5', 'PGSSLMODE': 'disable',
                    'PGPASSFILE': str(self.base / 'no-password-file'),
                    'PGSERVICEFILE': str(self.base / 'no-service-file')})
        if self.port is not None:
            env['PGPORT'] = str(self.port)
        return env

    def _run(self, binary, arguments, *, code, input=None, timeout=35, capture=False, checked=True):
        self._guard()
        executable = BIN / (binary + '.exe')
        require(executable.is_file(), 'POSTGRES_BINARY_MISSING')
        try:
            result = subprocess.run([str(executable), *arguments], cwd=self.base, env=self._environment(),
                                    input=input, text=True, encoding='utf-8', errors='replace',
                                    stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, timeout=timeout, creationflags=HIDDEN)
        except (OSError, subprocess.TimeoutExpired):
            raise TemporaryPostgresFailure(code) from None
        if checked:
            require(result.returncode == 0, code)
        return result

    def _pid(self):
        path = self.data / 'postmaster.pid'
        if not path.is_file():
            return None
        lines = path.read_text(encoding='utf-8').splitlines()
        require(len(lines) >= 4 and lines[0].isdigit() and Path(lines[1]).resolve() == self.data.resolve(), 'POSTGRES_PID_PATH_MISMATCH')
        require(self.port is not None and lines[3] == str(self.port), 'POSTGRES_PID_PORT_MISMATCH')
        pid = int(lines[0])
        require(self.pid is None or pid == self.pid, 'POSTGRES_PID_CHANGED')
        return pid

    def start(self):
        self._guard()
        require(not self.started and not self.data.exists(), 'POSTGRES_ALREADY_INITIALIZED')
        result = self._run('postgres', ['--version'], code='POSTGRES_VERSION_UNAVAILABLE', capture=True)
        match = re.fullmatch(r'postgres \(PostgreSQL\) ((?:17|18)\.[0-9]+)\s*', result.stdout)
        require(match is not None, 'POSTGRES_17_OR_18_REQUIRED')
        self.version = match[1]
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        # CREATE_NO_WINDOW + OSTYPE=msys makes PostgreSQL's Windows simple_prompt
        # consume stdin; the random password is supplied twice without a file.
        self._run('initdb', ['--pgdata', str(self.data), '--username', self.username, '--pwprompt',
                            '--auth-host=scram-sha-256', '--auth-local=scram-sha-256',
                            '--encoding=UTF8', '--no-locale', '--no-instructions'],
                  input=self.password + '\n' + self.password + '\n', timeout=60, code='POSTGRES_INIT_FAILED')
        self._guard()
        with (self.data / 'postgresql.conf').open('a', encoding='ascii') as config:
            config.write("\n# Disposable email gate, owned loopback cluster only.\n"
                         "listen_addresses = '127.0.0.1'\n"
                         f"port = {self.port}\n"
                         "unix_socket_directories = ''\n"
                         "password_encryption = 'scram-sha-256'\n"
                         "logging_collector = off\n"
                         "log_destination = 'stderr'\n"
                         "log_statement = 'none'\n"
                         "log_min_messages = warning\n"
                         "log_min_error_statement = panic\n")
        # Explicit policy: only loopback IPv4 + password. No trust/IPv6/replication.
        (self.data / 'pg_hba.conf').write_text('host all all 127.0.0.1/32 scram-sha-256\n', encoding='ascii')
        self._run('pg_ctl', ['start', '-D', str(self.data), '-w', '-t', '30', '-s'], code='POSTGRES_START_FAILED')
        self.pid = self._pid()
        require(self.pid is not None, 'POSTGRES_PID_MISSING')
        self.started = True
        self._run('createdb', ['--no-password', '--maintenance-db=postgres', self.database], code='POSTGRES_CREATE_FAILED')
        result = self._run('psql', ['-X', '--no-password', '-At', '-v', 'ON_ERROR_STOP=1', '-c', "SELECT current_setting('data_directory')"],
                           code='POSTGRES_IDENTITY_FAILED', capture=True)
        require(Path(result.stdout.strip()).resolve() == self.data.resolve(), 'POSTGRES_SERVER_PATH_MISMATCH')
        return self

    def keycloak_environment(self):
        self._guard()
        require(self.started, 'POSTGRES_NOT_STARTED')
        return {'KC_DB_URL': f'jdbc:postgresql://127.0.0.1:{self.port}/{self.database}',
                'KC_DB_USERNAME': self.username, 'KC_DB_PASSWORD': self.password}

    def verify_restricted_state(self):
        """Fixed read-only proof; returns counts/booleans, never stored content."""
        self._guard()
        require(self.started, 'POSTGRES_NOT_STARTED')
        sql = """
BEGIN READ ONLY;
SELECT json_build_object(
 'heads', (SELECT count(*) FROM c4g_email_template_head),
 'versions', (SELECT count(*) FROM c4g_email_template_version),
 'headRevisionThree', (SELECT count(*) = 1 AND min(revision) = 3 FROM c4g_email_template_head),
 'uniqueRevisionHistory', (SELECT count(*) = 3 AND count(DISTINCT revision) = 3 AND min(revision) = 1 AND max(revision) = 3 FROM c4g_email_template_version),
 'uniqueIntentions', (SELECT count(*) = 3 AND count(DISTINCT request_id) = 3 FROM c4g_email_template_version),
 'auditActorsPresentAndSeparate', (SELECT count(*) = 3 AND bool_and(actor_id <> '' AND service_actor_id <> '' AND actor_id <> service_actor_id AND created_at > 0 AND length(request_sha256) = 64) FROM c4g_email_template_version),
 'auditServiceIsDedicatedAccount', (SELECT count(*) = 3 AND bool_and(u.service_account_client_link = c.id AND c.client_id = 'c4g-email-templates') FROM c4g_email_template_version v LEFT JOIN user_entity u ON u.id = v.service_actor_id LEFT JOIN client c ON c.id = u.service_account_client_link),
 'headReferencesMatchingVersion', (SELECT count(*) = 1 FROM c4g_email_template_head h JOIN c4g_email_template_version v ON v.id = h.version_id AND v.realm_id = h.realm_id AND v.revision = h.revision),
 'sourceAndMessagesPersisted', (SELECT count(*) = 3 AND bool_and(jsonb_typeof(payload_json::jsonb->'template') = 'object' AND length(payload_json::jsonb#>>'{template,subject}') > 0 AND length(payload_json::jsonb#>>'{template,html}') > 0 AND payload_json::jsonb->'messages' ?& ARRAY['passwordResetSubject','passwordResetBody','passwordResetBodyHtml'] AND locales_json::jsonb = '["en","pt"]'::jsonb) FROM c4g_email_template_version),
 'payloadColumnsAreText', (SELECT count(*) = 2 AND bool_and(data_type = 'text') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'c4g_email_template_version' AND column_name IN ('payload_json','locales_json')),
 'currentNativeMessagesMatch', (SELECT count(*) = 2 AND bool_and(l.texts::jsonb->>'passwordResetSubject' = v.payload_json::jsonb#>>'{messages,passwordResetSubject}' AND l.texts::jsonb->>'passwordResetBody' = v.payload_json::jsonb#>>'{messages,passwordResetBody}' AND l.texts::jsonb->>'passwordResetBodyHtml' = v.payload_json::jsonb#>>'{messages,passwordResetBodyHtml}') FROM c4g_email_template_head h JOIN c4g_email_template_version v ON v.id = h.version_id JOIN realm_localizations l ON l.realm_id = h.realm_id AND l.locale IN ('pt','en'))
);
ROLLBACK;
"""
        result = self._run('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                           code='POSTGRES_AUDIT_QUERY_FAILED', input=sql, capture=True)
        try:
            value = json.loads(result.stdout)
        except (ValueError, TypeError):
            raise TemporaryPostgresFailure('POSTGRES_AUDIT_RESPONSE_INVALID') from None
        expected = {'heads', 'versions', 'headRevisionThree', 'uniqueRevisionHistory', 'uniqueIntentions',
                    'auditActorsPresentAndSeparate', 'auditServiceIsDedicatedAccount', 'headReferencesMatchingVersion',
                    'sourceAndMessagesPersisted', 'payloadColumnsAreText', 'currentNativeMessagesMatch'}
        require(isinstance(value, dict) and set(value) == expected, 'POSTGRES_AUDIT_RESPONSE_INVALID')
        require(type(value['heads']) is int and type(value['versions']) is int
                and all(type(value[key]) is bool for key in expected - {'heads', 'versions'}), 'POSTGRES_AUDIT_RESPONSE_INVALID')
        return value

    def publish_during_native_locale_update(self, callback):
        """Regress lost unrelated keys during the gate's first publication.

        Hold only the disposable pt locale row after changing probeSentinel;
        require an actual PostgreSQL lock waiter, then commit and let the SPI
        refresh that row. No additional publication/revision is introduced.
        """
        self._guard()
        require(self.started and self._pid() == self.pid, 'POSTGRES_NOT_STARTED')
        holder, reader, worker = None, None, None
        lines = queue.Queue(maxsize=8)
        future = Future()
        try:
            holder = subprocess.Popen([str(BIN / 'psql.exe'), '-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                                      cwd=self.base, env=self._environment(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True, encoding='utf-8', creationflags=HIDDEN)

            def drain():
                for line in iter(lambda: holder.stdout.readline(256), ''):
                    try:
                        lines.put_nowait(line.strip())
                    except queue.Full:
                        pass

            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            holder.stdin.write("""
BEGIN;
WITH changed AS (
 UPDATE realm_localizations
 SET texts = jsonb_set(texts::jsonb, '{probeSentinel}', to_jsonb('concurrent-preserved'::text))::text
 WHERE realm_id = (SELECT id FROM realm WHERE name = 'email-proof') AND locale = 'pt'
 RETURNING 1
)
SELECT 'HOLDER:' || pg_backend_pid()::text FROM changed HAVING count(*) = 1;
""")
            holder.stdin.flush()
            try:
                ready = lines.get(timeout=30)
            except queue.Empty:
                raise TemporaryPostgresFailure('POSTGRES_LOCALE_HOLDER_TIMEOUT') from None
            require(re.fullmatch(r'HOLDER:[1-9][0-9]{0,9}', ready) is not None, 'POSTGRES_LOCALE_HOLDER_INVALID')
            holder_pid = int(ready.split(':')[1])

            def publish():
                try:
                    future.set_result(callback())
                except BaseException as error:
                    future.set_exception(error)

            worker = threading.Thread(target=publish, daemon=True)
            worker.start()
            proof = False
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not future.done():
                # Only a boolean is returned; query text, users and IDs stay in
                # the owned server. holder_pid came from this exact connection.
                sql = f"SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = current_database() AND a.pid <> pg_backend_pid() AND a.wait_event_type = 'Lock' AND a.query ILIKE '%realm_localizations%' AND {holder_pid} = ANY(pg_blocking_pids(a.pid)));"
                waiting = self._run('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                                    input=sql, capture=True, timeout=6, code='POSTGRES_LOCALE_WAIT_QUERY_FAILED')
                require(waiting.stdout.strip() in ('t', 'f'), 'POSTGRES_LOCALE_WAIT_INVALID')
                if waiting.stdout.strip() == 't':
                    proof = True
                    break
                time.sleep(0.1)
            holder.stdin.write('COMMIT;\n')
            holder.stdin.flush()
            try:
                result = future.result(timeout=30)
            except FutureTimeout:
                raise TemporaryPostgresFailure('POSTGRES_LOCALE_PUBLICATION_TIMEOUT') from None
            return result, proof
        finally:
            # Releasing/closing the dedicated holder rolls back on every failure;
            # never stop a process by a PID discovered outside this Popen handle.
            if holder is not None:
                if holder.poll() is None:
                    try:
                        holder.stdin.write('ROLLBACK;\n\\q\n')
                        holder.stdin.flush()
                        holder.stdin.close()
                    except (OSError, ValueError):
                        pass
                    try:
                        holder.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        holder.kill()
                        holder.wait(timeout=5)
                if reader is not None:
                    reader.join(timeout=1)
                holder.stdout.close()
            if worker is not None:
                worker.join(timeout=5)

    def with_forced_version_failure(self, callback):
        """Force the next INSERT to fail in this owned disposable schema only.

        The callback attempts revision4 and observes the ordinary API failure.
        Removing the temporary constraint never changes versions or templates.
        """
        self._guard()
        require(self.started, 'POSTGRES_NOT_STARTED')
        state = self.verify_restricted_state()
        require(state['heads'] == 1 and state['versions'] == 3 and state['headRevisionThree'], 'POSTGRES_ROLLBACK_BASELINE_INVALID')
        installed = False
        try:
            self._run('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                      input='ALTER TABLE c4g_email_template_version ADD CONSTRAINT c4g_email_probe_force_failure CHECK (revision <= 3);',
                      code='POSTGRES_FAILURE_GUARD_INSTALL_FAILED')
            installed = True
            return callback()
        finally:
            if installed:
                self._run('psql', ['-X', '--no-password', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                          input='ALTER TABLE c4g_email_template_version DROP CONSTRAINT c4g_email_probe_force_failure;',
                          code='POSTGRES_FAILURE_GUARD_REMOVE_FAILED')

    def close(self):
        """Stop this exact owned cluster; erase it only after confirmed shutdown."""
        self._guard()
        if self.data.exists():
            pid = self._pid()
            if pid is not None:
                self._run('pg_ctl', ['stop', '-D', str(self.data), '-m', 'fast', '-w', '-t', '20', '-s'],
                          code='POSTGRES_STOP_FAILED', timeout=25, checked=False)
                if self._pid() is not None:
                    self._run('pg_ctl', ['stop', '-D', str(self.data), '-m', 'immediate', '-w', '-t', '10', '-s'],
                              code='POSTGRES_STOP_FAILED', timeout=15, checked=False)
            require(self._pid() is None, 'POSTGRES_STILL_RUNNING')
            # Re-resolve immediately before recursive removal. Never pass this
            # computed path to another shell or recurse outside the owned gate.
            self._guard()
            require(self.data.resolve().parent == self.base and self.data.name == 'postgres-data', 'POSTGRES_CLEANUP_PATH')
            shutil.rmtree(self.data)
        self.started = False
        self.password = ''
        self.marker.unlink()
        return {'servicesStopped': True, 'databaseRemoved': not self.data.exists()}
