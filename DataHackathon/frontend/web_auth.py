import hmac

from flask import Flask, jsonify, redirect, request, session
from itsdangerous import BadSignature, URLSafeTimedSerializer


LOGIN_PAGE = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Вход — Аналитика Казахстана</title>
  <style>
    :root { color-scheme: light; font: 16px system-ui, sans-serif; color: #342c38; background: #f4efeb; }
    body { display: grid; min-height: 100vh; place-items: center; margin: 0; padding: 20px; box-sizing: border-box; }
    main { width: min(100%, 400px); padding: 32px; border: 1px solid #e8dfe7; border-radius: 20px; background: #fffdfc; box-shadow: 0 18px 50px #342c381a; }
    h1 { margin: 0 0 8px; font-size: 1.4rem; }
    p { color: #6f6472; line-height: 1.5; }
    label { display: block; margin: 22px 0 8px; font-weight: 650; }
    input, button { width: 100%; min-height: 46px; box-sizing: border-box; border-radius: 10px; font: inherit; }
    input { padding: 9px 12px; border: 1px solid #c9aace; background: #fff; color: inherit; }
    button { margin-top: 14px; border: 0; background: linear-gradient(110deg, #f5ad86, #c9aace); color: #342c38; font-weight: 750; cursor: pointer; }
    .error { color: #a32b36; }
  </style>
</head>
<body>
  <main>
    <h1>Аналитика данных Казахстана</h1>
    <p>Введите код доступа, предоставленный организаторами.</p>
    {error}
    <form method="post" action="/web/login">
      <label for="access-code">Код доступа</label>
      <input id="access-code" name="access_code" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Открыть приложение</button>
    </form>
  </main>
</body>
</html>"""


def configure_web_auth(
    app: Flask,
    access_code: str,
    session_secret: str,
    *,
    secure_cookie: bool = True,
) -> None:
    if len(access_code) < 12:
        raise ValueError("JURY_ACCESS_CODE must contain at least 12 characters.")
    if len(session_secret) < 32:
        raise ValueError("WEB_SESSION_SECRET must contain at least 32 characters.")

    app.secret_key = session_secret
    analyzer_serializer = URLSafeTimedSerializer(
        session_secret,
        salt="jury-analyzer-access",
    )
    app.extensions["jury_analyzer_serializer"] = analyzer_serializer
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=secure_cookie,
        PERMANENT_SESSION_LIFETIME=60 * 60 * 8,
    )

    @app.before_request
    def require_jury_login():
        if request.endpoint in {"web_login", "web_health"}:
            return None
        if session.get("jury_authenticated") is True:
            return None
        if request.path.startswith("/analyzer-api/"):
            if request.method == "OPTIONS":
                return None
            token = request.headers.get("X-Jury-Token") or request.args.get("daToken", "")
            try:
                claims = analyzer_serializer.loads(token, max_age=8 * 60 * 60)
            except BadSignature:
                claims = None
            if claims == {"scope": "analyzer"}:
                return None
        if request.path.startswith(("/api/", "/analyzer-api/")):
            return jsonify({"error": "Введите код доступа жюри."}), 401
        return redirect("/web/login")

    @app.route("/web/login", methods=["GET", "POST"], endpoint="web_login")
    def web_login():
        if session.get("jury_authenticated") is True:
            return redirect("/")
        if request.method == "GET":
            return LOGIN_PAGE.replace("{error}", "")

        submitted = request.form.get("access_code", "")
        if not hmac.compare_digest(submitted, access_code):
            return LOGIN_PAGE.replace(
                "{error}",
                '<p class="error" role="alert">Неверный код. Попробуйте ещё раз.</p>',
            ), 401

        session.clear()
        session["jury_authenticated"] = True
        session.permanent = True
        return redirect("/")

    @app.post("/web/logout", endpoint="web_logout")
    def web_logout():
        session.clear()
        return redirect("/web/login")

    @app.get("/healthz", endpoint="web_health")
    def web_health():
        return jsonify({"ok": True})


def create_analyzer_token(app: Flask) -> str:
    serializer = app.extensions["jury_analyzer_serializer"]
    return serializer.dumps({"scope": "analyzer"})
