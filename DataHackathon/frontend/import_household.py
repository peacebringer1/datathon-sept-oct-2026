import sqlite3
import os
import pandas as pd

# Определяем пути к файлам относительно директории скрипта
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Путь к CSV файлу с учетом папки data/raw/
possible_csv_paths = [
    os.path.join(BASE_DIR, 'data', 'raw', 'subject_cleaned_cleaned2.csv'),
    os.path.join(BASE_DIR, '..', 'data', 'raw', 'subject_cleaned_cleaned2.csv'),
    os.path.join(BASE_DIR, 'subject_cleaned_cleaned2.csv'),
    os.path.join(BASE_DIR, '..', 'subject_cleaned_cleaned2.csv')
]

CSV_FILE = None
for path in possible_csv_paths:
    if os.path.exists(path):
        CSV_FILE = os.path.abspath(path)
        break

# Путь к базе данных (в корне проекта DataHackathon/database.sqlite)
DB_FILE = os.path.abspath(os.path.join(BASE_DIR, '..', 'database.sqlite'))

def import_data():
    if not CSV_FILE:
        print("Ошибка: файл subject_cleaned_cleaned2.csv не найден в data/raw/!")
        return

    print(f"Найден CSV: {CSV_FILE}")
    print(f"Используется база данных: {DB_FILE}")

    df = pd.read_csv(CSV_FILE)
    
    conn = sqlite3.connect(DB_FILE)
    df.to_sql('household_survey', conn, if_exists='replace', index=False)
    conn.commit()
    conn.close()
    
    print(f"Успешно импортировано {len(df)} строк в таблицу 'household_survey'!")

if __name__ == '__main__':
    import_data()