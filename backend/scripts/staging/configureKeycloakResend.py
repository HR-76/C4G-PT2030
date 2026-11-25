"""Run explicitly on the staging VPS. No mail, reset activation or secret files."""
import getpass
import json
import re
import subprocess
import urllib.parse
import urllib.request
import warnings

BASE = "http://127.0.0.1:8180"
REALM = "/admin/realms/c4g-staging"
SETTINGS = {
    "host": "smtp.resend.com", "port": "587", "auth": "true",
    "user": "resend", "starttls": "true", "ssl": "false",
    "from": "no-reply@notificacoes-teste.c4g.ai", "fromDisplayName": "C4G — Testes",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(path, method="GET", body=None, token=None, form=False):
    headers = {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if body is None else (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request(BASE + path, data=data, headers=headers, method=method), timeout=20) as response:
        raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError("RESPONSE_TOO_LARGE")
        return json.loads(raw) if raw else None


def configure(admin, ask=getpass.getpass, api=request):
    def login():
        return api("/realms/master/protocol/openid-connect/token", "POST", {
            "client_id": "admin-cli", "grant_type": "password",
            "username": admin["KC_BOOTSTRAP_ADMIN_USERNAME"],
            "password": admin["KC_BOOTSTRAP_ADMIN_PASSWORD"],
        }, form=True)["access_token"]

    def check(token):
        realm = api(REALM, token=token)
        if realm.get("realm") != "c4g-staging" or realm.get("resetPasswordAllowed") is not False:
            raise ValueError("REALM_STATE_UNEXPECTED")
        if any(realm.get("smtpServer", {}).values()):
            raise ValueError("SMTP_ALREADY_CONFIGURED")
        return realm

    check(login())
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        key = ask("Cole a chave Resend e prima Enter (entrada oculta): ").strip()
    if not re.fullmatch(r"re_[A-Za-z0-9_-]{10,200}", key):
        raise ValueError("INVALID_RESEND_KEY")
    # The user may have taken longer than the lifetime of the first token.
    token = login()
    check(token)
    api(REALM, "PUT", {"smtpServer": {**SETTINGS, "password": key}}, token=token)
    after = api(REALM, token=token)
    if after.get("realm") != "c4g-staging" or after.get("resetPasswordAllowed") is not False:
        raise ValueError("VERIFY_FAILED")
    if any(after.get("smtpServer", {}).get(k) != v for k, v in SETTINGS.items()):
        raise ValueError("VERIFY_FAILED")


def main():
    try:
        result = subprocess.run([
            "docker", "inspect", "--format", "{{json .Config.Env}}",
            "c4g-staging-keycloak-keycloak-1",
        ], capture_output=True, text=True, check=True, timeout=15)
        admin = dict(item.split("=", 1) for item in json.loads(result.stdout) if "=" in item)
        configure(admin)
        print("SMTP configurado e relido. Recuperacao continua desligada. Falta testar o envio.")
    except KeyboardInterrupt:
        print("Operacao interrompida. Nenhum segredo foi apresentado.")
        return 1
    except Exception as error:
        safe = {"REALM_STATE_UNEXPECTED", "SMTP_ALREADY_CONFIGURED", "INVALID_RESEND_KEY", "VERIFY_FAILED"}
        code = str(error) if isinstance(error, ValueError) and str(error) in safe else "CONFIGURATION_NOT_CONFIRMED"
        status = getattr(error, "code", None)
        print("Resultado: " + code + (" (HTTP " + str(status) + ")" if isinstance(status, int) else ""))
        print("Nao repita com outros dados: envie apenas estas mensagens para diagnostico.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
