import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import contextlib
import io

spec = importlib.util.spec_from_file_location("configure", Path(__file__).parents[1] / "scripts/staging/configureKeycloakResend.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ADMIN = {"KC_BOOTSTRAP_ADMIN_USERNAME": "admin", "KC_BOOTSTRAP_ADMIN_PASSWORD": "synthetic-private"}
KEY = "re_synthetic_test_only"


class ConfigureTest(unittest.TestCase):
    def fixture(self, realm=None):
        state = realm if realm is not None else {"realm": "c4g-staging", "resetPasswordAllowed": False, "smtpServer": {}, "other": "keep"}
        calls = []
        def api(path, method="GET", body=None, token=None, form=False):
            calls.append((path, method, copy.deepcopy(body)))
            if path.startswith("/realms/master/"):
                self.assertTrue(form)
                return {"access_token": "synthetic-token"}
            self.assertEqual(token, "synthetic-token")
            if method == "PUT":
                self.assertEqual(set(body), {"smtpServer"})
                state.update(copy.deepcopy(body))
                return None
            return copy.deepcopy(state)
        return state, calls, api

    def test_only_smtp_changes_and_token_is_renewed(self):
        state, calls, api = self.fixture()
        module.configure(ADMIN, ask=lambda prompt: KEY, api=api)
        self.assertEqual(state["other"], "keep")
        self.assertFalse(state["resetPasswordAllowed"])
        self.assertEqual(state["smtpServer"], {**module.SETTINGS, "password": KEY})
        self.assertEqual(sum(path.startswith("/realms/master/") for path, _, _ in calls), 2)
        self.assertEqual(sum(method == "PUT" for _, method, _ in calls), 1)

    def test_existing_smtp_or_wrong_realm_never_writes_or_prompts(self):
        for realm in [{"realm": "master"}, {"realm": "c4g-staging", "resetPasswordAllowed": True},
                      {"realm": "c4g-staging", "resetPasswordAllowed": False, "smtpServer": {"host": "existing"}}]:
            _, calls, api = self.fixture(realm)
            with self.assertRaises(ValueError):
                module.configure(ADMIN, ask=lambda prompt: self.fail("unexpected secret prompt"), api=api)
            self.assertFalse(any(method == "PUT" for _, method, _ in calls))

    def test_invalid_key_does_not_write(self):
        _, calls, api = self.fixture()
        with self.assertRaisesRegex(ValueError, "INVALID_RESEND_KEY"):
            module.configure(ADMIN, ask=lambda prompt: "invalid", api=api)
        self.assertFalse(any(method == "PUT" for _, method, _ in calls))

    def test_error_output_never_repeats_exception_secrets(self):
        output = io.StringIO()
        with patch.object(module.subprocess, "run", side_effect=RuntimeError(KEY)), contextlib.redirect_stdout(output):
            self.assertEqual(module.main(), 1)
        self.assertNotIn(KEY, output.getvalue())

    def test_redirects_are_refused(self):
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.invalid"))


if __name__ == "__main__":
    unittest.main()
