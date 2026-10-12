import os
from pathlib import Path
import subprocess
import sys
import tempfile


FRONTEND_DIR = Path(__file__).resolve().parent
PROJECT_DIR = FRONTEND_DIR.parent
OUTPUT_DIR = FRONTEND_DIR / "resources" / "backend"
OUTPUT_NAME = "desktop-backend.exe" if os.name == "nt" else "desktop-backend"


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_binary = OUTPUT_DIR / OUTPUT_NAME
    output_binary.unlink(missing_ok=True)

    with tempfile.TemporaryDirectory(prefix="desktop-backend-build-") as temporary_dir:
        temporary_path = Path(temporary_dir)
        command = [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            "desktop-backend",
            "--distpath",
            str(OUTPUT_DIR),
            "--workpath",
            str(temporary_path / "work"),
            "--specpath",
            str(temporary_path / "spec"),
            "--paths",
            str(PROJECT_DIR),
            "--paths",
            str(FRONTEND_DIR),
        ]
        command.append(str(FRONTEND_DIR / "desktop_backend.py"))
        subprocess.run(command, cwd=PROJECT_DIR, check=True)

    if not output_binary.is_file():
        raise FileNotFoundError(f"PyInstaller did not create {output_binary}")
    print(f"Built embedded backend: {output_binary}")


if __name__ == "__main__":
    main()
