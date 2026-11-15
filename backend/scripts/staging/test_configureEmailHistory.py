import tempfile
import unittest
from pathlib import Path
from configureEmailHistory import configure, REALM


class ConfigurationTests(unittest.TestCase):
    def fixture(self):
        realm = {'realm': 'c4g-staging', 'smtpServer': {'host': 'synthetic.invalid'},
                 'resetPasswordAllowed': True, 'eventsListeners': ['existing'], 'eventsEnabled': True,
                 'eventsExpiration': 0}
        roles, grants, scopes, writes = [], [], [], []
        client = {'id': 'client-id', 'fullScopeAllowed': False, 'publicClient': False, 'serviceAccountsEnabled': True}

        def api(path, method='GET', body=None, **_):
            if method != 'GET':
                writes.append(path)
            if path.endswith('/token'):
                return {'access_token': 'synthetic-token'}
            if path == REALM:
                if method == 'PUT':
                    realm.update(body)
                return dict(realm)
            if '?clientId=' in path:
                return [client]
            if path.endswith('/service-account-user'):
                return {'id': 'service-id'}
            if '/scope-mappings/' in path or '/role-mappings/' in path:
                values = scopes if '/scope-mappings/' in path else grants
                if method == 'POST':
                    values.extend(body)
                return list(values)
            if path.endswith('/roles'):
                if method == 'POST':
                    roles.append({'id': 'role-id', 'name': body['name']})
                return list(roles)
            if path.endswith('/roles/read-delivery-history'):
                return roles[0]
            if path.endswith('/client-secret'):
                return {'value': 'synthetic-secret'}
            if path.endswith('/search'):
                return {'items': []}
            if path.endswith('/retention'):
                return {'anonymized': 0}
            raise AssertionError('Unexpected API path')

        return api, realm, client, writes

    def test_preflight_does_not_mutate_configuration(self):
        api, realm, _, writes = self.fixture()
        self.assertEqual(configure({'KC_BOOTSTRAP_ADMIN_USERNAME': 'test', 'KC_BOOTSTRAP_ADMIN_PASSWORD': 'test'}, None, api=api), 'EMAIL_HISTORY_CONFIGURATION_READY')
        self.assertEqual(realm['eventsListeners'], ['existing'])
        self.assertTrue(all(path.endswith('/token') for path in writes))

    def test_apply_preserves_smtp_flow_and_existing_listener(self):
        api, realm, _, _ = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            result = configure({'KC_BOOTSTRAP_ADMIN_USERNAME': 'test', 'KC_BOOTSTRAP_ADMIN_PASSWORD': 'test'}, Path(directory) / 'backup', True, api)
            self.assertEqual(result, 'KEYCLOAK_EMAIL_HISTORY_READY')
            self.assertTrue((Path(directory) / 'backup/keycloak-before.json').is_file())
        self.assertEqual(realm['smtpServer'], {'host': 'synthetic.invalid'})
        self.assertTrue(realm['resetPasswordAllowed'])
        self.assertEqual(realm['eventsListeners'], ['existing', 'c4g-email-delivery'])
        self.assertEqual(realm['eventsExpiration'], 90 * 86400)

    def test_unrestricted_client_refused_before_configuration(self):
        api, _, client, writes = self.fixture()
        client['fullScopeAllowed'] = True
        with self.assertRaisesRegex(ValueError, 'NOT_RESTRICTED'):
            configure({'KC_BOOTSTRAP_ADMIN_USERNAME': 'test', 'KC_BOOTSTRAP_ADMIN_PASSWORD': 'test'}, None, api=api)
        self.assertTrue(all(path.endswith('/token') for path in writes))


if __name__ == '__main__':
    unittest.main()
