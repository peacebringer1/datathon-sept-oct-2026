import sqlite3
from pathlib import Path

# Путь к базе данных в корне проекта
DB_PATH = Path(__file__).resolve().parent.parent / 'database.sqlite'

if not DB_PATH.exists():
    print(f"База данных не найдена: {DB_PATH}")
    exit(1)

conn = sqlite3.connect(DB_PATH)
# Вместо запроса к одной несуществующей таблице demographics:
# indicators = [r[0] for r in conn.execute('SELECT DISTINCT indicator FROM demographics ORDER BY indicator').fetchall()]

# Можно собирать колонки или список таблиц динамически из базы:
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [row[0] for row in cursor.fetchall()]
# и далее сформировать список индикаторов или данных в зависимости от вашей структуры

print(f"\n========================================")
print(f"📊 ВСЕГО ТАБЛИЦ В БАЗЕ: {len(tables)}")
print(f"========================================\n")

# Проходим по каждой таблице, считаем строки и выводим по 1 первой строке
for index, table in enumerate(tables, 1):
    try:
        # Считаем количество строк в таблице
        cursor.execute(f"SELECT COUNT(*) FROM `{table}`;")
        count = cursor.fetchone()[0]
        
        # Берем пример первой строки
        cursor.execute(f"SELECT * FROM `{table}` LIMIT 1;")
        row = cursor.fetchone()
        
        print(f"[{index}] Таблица: {table}")
        print(f"    📦 Строк: {count}")
        print(f"    🔍 Пример: {row}")
    except Exception as e:
        print(f"[{index}] Таблица: {table} — Ошибка: {e}")
    print("-" * 60)

conn.close()