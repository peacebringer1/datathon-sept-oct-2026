import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import json
from pathlib import Path

from flask import Response, abort, jsonify, request, send_from_directory, session
from waitress import serve
import uvicorn


PROJECT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_DIR))
os.environ.setdefault("APP_WEB_MODE", "1")
os.environ.setdefault("APP_PACKAGED", "1")
os.environ.setdefault("DATASETS_DIR", str(PROJECT_DIR / "data" / "sinte"))
os.environ.setdefault("APP_DATA_DIR", "/tmp/datahackathon-web")
os.environ.setdefault(
    "DATABASE_FILE",
    str(Path(os.environ["APP_DATA_DIR"]) / "database.sqlite"),
)

from app import app  # noqa: E402
import server as analyzer_server  # noqa: E402
from web_auth import configure_web_auth, create_analyzer_token  # noqa: E402


DATASETS_DIR = Path(os.environ["DATASETS_DIR"]).resolve()
ANALYZER_HOST = "127.0.0.1"
ANALYZER_PORT = int(os.environ.get("ANALYZER_INTERNAL_PORT", "8765"))
DATASET_NAMES = ("d002", "d004", "d006", "d008")
STATIC_FILE_NAMES = {"style.css", "aidana.css", "renderer.js"}
STATIC_PREFIXES = ("src/", "img/", "node_modules/echarts/dist/", "node_modules/exceljs/dist/")
PROXY_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
PROXY_RESPONSE_HEADERS = {
    "content-type",
    "content-disposition",
    "cache-control",
    "accept-ranges",
    "content-range",
}

access_code = os.environ.get("JURY_ACCESS_CODE", "")
session_secret = os.environ.get("WEB_SESSION_SECRET", "")
if not access_code or not session_secret:
    raise RuntimeError(
        "Set JURY_ACCESS_CODE and WEB_SESSION_SECRET before starting the web app."
    )

configure_web_auth(
    app,
    access_code,
    session_secret,
    secure_cookie=os.environ.get("WEB_COOKIE_SECURE", "1") != "0",
)


def validate_datasets() -> None:
    for dataset_name in DATASET_NAMES:
        dataset_dir = DATASETS_DIR / dataset_name
        if not dataset_dir.is_dir() or not any(dataset_dir.rglob("*.csv")):
            raise FileNotFoundError(
                f"Required dataset {dataset_name} is missing or contains no CSV files: {dataset_dir}"
            )


@app.get("/")
def web_index():
    if session.get("jury_authenticated") is not True:
        return Response(status=302, headers={"Location": "/web/login"})
    index_path = FRONTEND_DIR / "index.html"
    html = index_path.read_text(encoding="utf-8")
    html = html.replace(
        "<head>",
        '<head>\n  <script>window.APP_MODE = "web"; '
        f'window.ANALYZER_ACCESS_TOKEN = {json.dumps(create_analyzer_token(app))};</script>',
        1,
    )
    return Response(html, content_type="text/html; charset=utf-8")


@app.get("/<path:asset_path>")
def web_assets(asset_path: str):
    if asset_path not in STATIC_FILE_NAMES and not asset_path.startswith(STATIC_PREFIXES):
        abort(404)
    return send_from_directory(FRONTEND_DIR, asset_path)


@app.route("/analyzer-api/<path:analyzer_path>", methods=PROXY_METHODS)
def proxy_analyzer(analyzer_path: str):
    destination = f"http://{ANALYZER_HOST}:{ANALYZER_PORT}/{analyzer_path}"
    if request.query_string:
        destination += f"?{request.query_string.decode('ascii')}"

    headers = {}
    for name in (
        "Accept",
        "Content-Type",
        "Range",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
    ):
        if value := request.headers.get(name):
            headers[name] = value

    proxy_request = urllib.request.Request(
        destination,
        data=request.get_data() if request.method not in ("GET", "HEAD") else None,
        headers=headers,
        method=request.method,
    )
    try:
        with urllib.request.urlopen(proxy_request, timeout=120) as upstream:
            body = upstream.read()
            response_headers = {
                name: value
                for name, value in upstream.headers.items()
                if name.lower() in PROXY_RESPONSE_HEADERS
            }
            return Response(body, status=upstream.status, headers=response_headers)
    except urllib.error.HTTPError as error:
        body = error.read()
        response_headers = {
            name: value
            for name, value in error.headers.items()
            if name.lower() in PROXY_RESPONSE_HEADERS
        }
        return Response(body, status=error.code, headers=response_headers)
    except (OSError, urllib.error.URLError) as error:
        app.logger.exception("Data Analyzer proxy request failed")
        return jsonify({"detail": f"Сервис анализа данных недоступен: {error}"}), 502


def start_analyzer() -> None:
    config = uvicorn.Config(
        analyzer_server.app,
        host=ANALYZER_HOST,
        port=ANALYZER_PORT,
        log_level=os.environ.get("ANALYZER_LOG_LEVEL", "warning"),
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="data-analyzer")
    thread.start()

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not thread.is_alive():
            raise RuntimeError("Data Analyzer server stopped during startup.")
        try:
            with socket.create_connection((ANALYZER_HOST, ANALYZER_PORT), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Data Analyzer server did not start within 15 seconds.")


def main() -> None:
    validate_datasets()
    start_analyzer()
    host = os.environ.get("WEB_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    serve(app, host=host, port=port, threads=8)


if __name__ == "__main__":
    main()
