"""Guard tests only: these tests never launch PostgreSQL or contact a DB."""
import secrets
import unittest
from unittest.mock import patch

from temporary_postgres import ROOT, TemporaryPostgres, TemporaryPostgresFailure, owned_base


class Guards(unittest.TestCase):
    def setUp(self):
        self.base = ROOT / '.tmp' / ('email-keycloak-' + secrets.token_hex(8))
        self.base.mkdir()

    def tearDown(self):
        for path in self.base.iterdir():
            if path.is_file():
                path.unlink()
        self.base.rmdir()

    def test_requires_exact_owned_base(self):
        self.assertEqual(owned_base(self.base), self.base.resolve())
        for path in (ROOT, ROOT / '.tmp', self.base / 'postgres-data', ROOT / '.tmp/email-keycloak-other'):
            with self.assertRaises(TemporaryPostgresFailure):
                owned_base(path)

    def test_existing_database_refused_without_modification(self):
        data = self.base / 'postgres-data'
        data.mkdir()
        try:
            with self.assertRaises(TemporaryPostgresFailure):
                TemporaryPostgres(self.base)
            self.assertTrue(data.is_dir())
        finally:
            data.rmdir()

    def test_environment_discards_habitual_configuration(self):
        with patch.dict('os.environ', {'PGDATA': 'habitual', 'PGSERVICE': 'habitual', 'PGPASSWORD': 'habitual', 'KC_DB_PASSWORD': 'habitual'}):
            cluster = TemporaryPostgres(self.base)
            environment = cluster._environment()
            self.assertNotIn('PGDATA', environment)
            self.assertNotIn('PGSERVICE', environment)
            self.assertNotIn('KC_DB_PASSWORD', environment)
            self.assertNotEqual(environment['PGPASSWORD'], 'habitual')
            self.assertEqual(environment['PGHOST'], '127.0.0.1')
            self.assertEqual(cluster.close(), {'servicesStopped': True, 'databaseRemoved': True})

    def test_keycloak_config_requires_started_cluster(self):
        cluster = TemporaryPostgres(self.base)
        with self.assertRaises(TemporaryPostgresFailure):
            cluster.keycloak_environment()
        cluster.close()

    def test_cleanup_refuses_changed_owner(self):
        cluster = TemporaryPostgres(self.base)
        cluster.marker.write_text('different', encoding='ascii')
        with self.assertRaises(TemporaryPostgresFailure):
            cluster.close()
        cluster.marker.write_text(cluster.nonce, encoding='ascii')
        cluster.close()

    def test_no_process_on_import_constructor_or_empty_cleanup(self):
        with patch('subprocess.run', side_effect=AssertionError('unexpected process')):
            cluster = TemporaryPostgres(self.base)
            cluster.close()

    def test_forced_failure_constraint_always_removed(self):
        cluster = TemporaryPostgres(self.base)
        cluster.started = True
        try:
            with patch.object(cluster, 'verify_restricted_state', return_value={'heads': 1, 'versions': 3, 'headRevisionThree': True}), \
                 patch.object(cluster, '_run') as run:
                def rejected():
                    raise RuntimeError('callback failure')
                with self.assertRaises(RuntimeError):
                    cluster.with_forced_version_failure(rejected)
                self.assertEqual(run.call_count, 2)
                self.assertIn('ADD CONSTRAINT c4g_email_probe_force_failure', run.call_args_list[0].kwargs['input'])
                self.assertIn('DROP CONSTRAINT c4g_email_probe_force_failure', run.call_args_list[1].kwargs['input'])
        finally:
            cluster.close()

    def test_forced_failure_refuses_other_baseline(self):
        cluster = TemporaryPostgres(self.base)
        cluster.started = True
        try:
            with patch.object(cluster, 'verify_restricted_state', return_value={'heads': 1, 'versions': 4, 'headRevisionThree': False}), \
                 patch.object(cluster, '_run', side_effect=AssertionError('unexpected database operation')):
                with self.assertRaises(TemporaryPostgresFailure):
                    cluster.with_forced_version_failure(lambda: None)
        finally:
            cluster.close()


if __name__ == '__main__':
    unittest.main()
