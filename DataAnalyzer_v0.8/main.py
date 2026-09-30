import multiprocessing
import sys

from PyQt6.QtWidgets import QApplication

from app.main_window import MainWindow


def main():
    app = QApplication(sys.argv)

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    # Нужно для ProcessPoolExecutor в core/large_file.py: на Windows
    # (и при сборке в exe через PyInstaller) дочерний процесс повторно
    # импортирует этот файл, и без freeze_support() это может привести
    # к рекурсивному запуску всего приложения вместо запуска функции
    # обработки chunk'а.
    multiprocessing.freeze_support()
    main()