import os
import sys
import threading
from pathlib import Path

if getattr(sys, "frozen", False):
    PROJECT_ROOT = Path(sys._MEIPASS)
    FRONTEND_DIR = PROJECT_ROOT
else:
    PROJECT_ROOT = Path(__file__).resolve().parent.parent
    FRONTEND_DIR = PROJECT_ROOT / "frontend"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(FRONTEND_DIR))

from waitress import serve
import uvicorn

from app import app as flask_app
import server as analyzer_server


def main():
    flask_port = int(os.environ["FLASK_PORT"])
    analyzer_port = int(os.environ["ANALYZER_PORT"])
    threading.Thread(
        target=serve,
        args=(flask_app,),
        kwargs={"host": "127.0.0.1", "port": flask_port, "threads": 8},
        daemon=True,
        name="flask-api",
    ).start()
    uvicorn.run(
        analyzer_server.app,
        host="127.0.0.1",
        port=analyzer_port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
