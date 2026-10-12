import unittest

from flask import Flask, jsonify
from unittest.mock import patch

from DataHackathon.frontend.web_auth import configure_web_auth, create_analyzer_token
from DataHackathon.frontend import app as app_module


class WebAuthTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.app.add_url_rule(
            "/api/private",
            view_func=lambda: jsonify({"ok": True}),
            endpoint="private_api",
        )
        self.app.add_url_rule(
            "/analyzer-api/private",
            view_func=lambda: jsonify({"ok": True}),
            endpoint="private_analyzer_api",
        )
        configure_web_auth(
            self.app,
            "jury-access-code",
            "session-secret-that-is-long-enough-for-testing",
            secure_cookie=False,
        )
        self.client = self.app.test_client()

    def test_redirects_unauthenticated_pages_to_login(self):
        response = self.client.get("/private-page")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["Location"], "/web/login")

    def test_api_returns_json_401_until_login(self):
        response = self.client.get("/api/private")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json(), {"error": "Введите код доступа жюри."})

    def test_analyzer_api_requires_a_scoped_access_token(self):
        unauthorized = self.client.get("/analyzer-api/private")
        self.assertEqual(unauthorized.status_code, 401)

        token = create_analyzer_token(self.app)
        authorized = self.client.get(
            "/analyzer-api/private",
            headers={"X-Jury-Token": token},
        )
        self.assertEqual(authorized.status_code, 200)

    def test_analyzer_cors_preflight_does_not_require_session_cookie(self):
        response = self.client.options(
            "/analyzer-api/private",
            headers={
                "Origin": "null",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-jury-token",
            },
        )
        self.assertEqual(response.status_code, 200)

    def test_valid_access_code_grants_and_logout_revokes_access(self):
        login = self.client.post(
            "/web/login",
            data={"access_code": "jury-access-code"},
        )
        self.assertEqual(login.status_code, 302)
        self.assertEqual(self.client.get("/api/private").status_code, 200)

        logout = self.client.post("/web/logout")
        self.assertEqual(logout.status_code, 302)
        self.assertEqual(self.client.get("/api/private").status_code, 401)

    def test_invalid_access_code_does_not_grant_access(self):
        login = self.client.post(
            "/web/login",
            data={"access_code": "wrong-access-code"},
        )
        self.assertEqual(login.status_code, 401)
        self.assertIn("Неверный код", login.get_data(as_text=True))
        self.assertEqual(self.client.get("/api/private").status_code, 401)

    def test_rejects_weak_access_code_or_session_secret(self):
        with self.assertRaises(ValueError):
            configure_web_auth(self.app, "short", "session-secret-that-is-long-enough")
        with self.assertRaises(ValueError):
            configure_web_auth(self.app, "jury-access-code", "short")


class WebClaudeKeyTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config["TESTING"] = True
        self.client = app_module.app.test_client()

    def test_web_mode_does_not_allow_users_to_set_or_delete_server_key(self):
        with patch.multiple(
            app_module,
            APP_WEB_MODE=True,
            CLAUDE_API_KEY="sk-ant-server-secret",
        ):
            set_response = self.client.post(
                "/api/settings/claude-key",
                json={"api_key": "sk-ant-user-supplied-secret"},
            )
            delete_response = self.client.delete("/api/settings/claude-key")
            status_response = self.client.get("/api/settings/claude-key")

        self.assertEqual(set_response.status_code, 403)
        self.assertEqual(delete_response.status_code, 403)
        self.assertEqual(status_response.get_json(), {"configured": True})
        self.assertNotIn("sk-ant", status_response.get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
