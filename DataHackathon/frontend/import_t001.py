import os
from pathlib import Path
import pandas as pd
import sqlite3

# Пути относительно расположения скрипта
CURRENT_DIR = Path(__file__).resolve().parent
DB_PATH = CURRENT_DIR.parent / 'database.sqlite'
SINTE_DIR = CURRENT_DIR.parent / 'data' / 'sinte'

def import_all_datasets():
    if not SINTE_DIR.exists():
        print(f"[Ошибка]: Папка с данными не найдена по пути -> {SINTE_DIR}")
        return

    print(f"[БД]: Подключаемся к базе данных: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    
    # Ищем абсолютно все CSV файлы во всех подпапках (form/year/.../table.csv)
    csv_files = list(SINTE_DIR.glob("**/*.csv"))
    print(f"Всего найдено CSV-файлов для импорта: {len(csv_files)}")

    for file_path in csv_files:
        if file_path.name == "MANIFEST.csv":
            continue

        # Формируем красивое и понятное имя таблицы на основе структуры папок
        # Например: t001_2021, d008_2022, 1t_god_2023 и т.д.
        relative_path = file_path.relative_to(SINTE_DIR)
        table_name = "_".join(relative_path.parts).replace(".csv", "").lower()

        print(f"Импорт: {relative_path} -> таблица [{table_name}]...")

        try:
            # Читаем частями по 100 000 строк, чтобы память на Mac не перегружалась
            for chunk in pd.read_csv(file_path, encoding='utf-8', low_memory=False, chunksize=100_000):
                chunk.to_sql(table_name, conn, if_exists='append', index=False)
            print(f"Таблица [{table_name}] успешно записана.")
        except Exception as e:
            print(f"Ошибка при импорте {file_path.name}: {e}")

    conn.close()
    print("Импорт всех датасетов в database.sqlite полностью завершен!")

if __name__ == '__main__':
    import_all_datasets()