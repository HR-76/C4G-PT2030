"""Safety checks for the local proof harness; no Keycloak or external network."""
import http.cookiejar
import importlib.util
from pathlib import Path
import smtplib
import threading
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location('email_gate', Path(__file__).with_name('keycloak_gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class GateHelpersTest(unittest.TestCase):
    def test_node_compiler_output_preserves_utf8_on_windows(self):
        result = gate.compile_template()
        self.assertEqual(result['messages']['passwordResetSubject'], "'Recupere o acesso à C4G'")

    def test_http_destination_is_strictly_bound_to_one_loopback_origin(self):
        for origin in ('https://127.0.0.1:1', 'http://example.invalid', 'http://192.168.1.1'):
            with self.assertRaises(gate.GateFailure):
                gate.Browser(origin)
        browser = gate.Browser('http://127.0.0.1:12345')
        for url in ('http://127.0.0.1:12346', 'http://example.invalid', '//example.invalid/reset'):
            with self.assertRaises(gate.GateFailure):
                browser.request(url)

    def test_secure_cookie_exception_is_only_for_loopback(self):
        cookie = http.cookiejar.Cookie(0, 'test', 'synthetic', None, False, '127.0.0.1', False,
                                       False, '/', True, True, None, True, None, None, {})
        policy = gate.LoopbackCookiePolicy()
        self.assertTrue(policy.return_ok_secure(cookie, urllib.request.Request('http://127.0.0.1:12345/')))
        self.assertFalse(policy.return_ok_secure(cookie, urllib.request.Request('http://example.invalid/')))
        self.assertTrue(policy.return_ok_secure(cookie, urllib.request.Request('https://example.invalid/')))

    def test_external_redirect_is_refused_before_any_second_request(self):
        class Reply:
            status = 302
            headers = {'Location': 'https://example.invalid/'}
            def read(self, limit):
                return b''
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        class Opener:
            calls = 0
            def open(self, request, timeout):
                self.calls += 1
                return Reply()
        browser = gate.Browser('http://127.0.0.1:12345')
        browser.opener = Opener()
        with self.assertRaises(gate.GateFailure):
            browser.request('/redirect')
        self.assertEqual(browser.opener.calls, 1)

    def test_form_parser_decodes_actions_without_exposing_hidden_data_as_text(self):
        page = gate.Page('<script>dynamic-session</script><style>hidden</style><p>Same response</p>'
                         '<form id="example" action="/reset?a=1&amp;b=2"><input type="hidden" name="token" value="synthetic"></form>')
        self.assertEqual(page.form('example')['action'], '/reset?a=1&b=2')
        self.assertEqual(page.form('example')['fields'], {'token': 'synthetic'})
        self.assertEqual(page.text, ['Same response'])

    def test_smtp_is_capture_only_and_refuses_non_synthetic_addresses(self):
        server = gate.Capture()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            self.assertEqual(server.server_address[0], '127.0.0.1')
            with smtplib.SMTP(*server.server_address, timeout=5) as client:
                with self.assertRaises(smtplib.SMTPRecipientsRefused):
                    client.sendmail('sender@capture.invalid', ['recipient@example.com'], 'Subject: Synthetic\r\n\r\nProbe')
                self.assertEqual(server.messages, [])
                client.sendmail('sender@capture.invalid', ['recipient@capture.invalid'], 'Subject: Synthetic\r\n\r\nProbe')
                self.assertEqual(len(server.messages), 1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            server.messages.clear()


if __name__ == '__main__':
    unittest.main()
