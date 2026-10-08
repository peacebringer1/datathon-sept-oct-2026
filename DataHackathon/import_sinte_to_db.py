"""Import the selected synthetic SINTE CSV collections into database.sqlite.

Each source CSV becomes its own TEXT-only SQLite table so code values and
leading zeroes are preserved. Re-running this importer refreshes only tables
whose names start with ``sinte_`` for d002, d004, d006, and d008.
"""

import csv
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / 'data' / 'sinte'
DB_PATH = PROJECT_DIR / 'database.sqlite'
FORMS = {'d002', 'd004', 'd006', 'd008'}
CHUNK_SIZE = 5000


def quote_identifier(value):
    return '"' + str(value).replace('"', '""') + '"'


def table_name(csv_path):
    relative = csv_path.relative_to(DATA_DIR).with_suffix('')
    words = [re.sub(r'[^a-zA-Z0-9]+', '_', part).strip('_').lower() for part in relative.parts]
    return 'sinte_' + '_'.join(word for word in words if word)


def unique_headers(headers):
    result = []
    used = set()
    for index, raw in enumerate(headers, start=1):
        base = raw.strip() or f'column_{index}'
        candidate = base
        suffix = 2
        while candidate.casefold() in used:
            candidate = f'{base}__{suffix}'
            suffix += 1
        used.add(candidate.casefold())
        result.append(candidate)
    return result


def import_file(connection, csv_path):
    name = table_name(csv_path)
    with csv_path.open('r', encoding='utf-8-sig', newline='') as source:
        reader = csv.reader(source)
        try:
            original_headers = next(reader)
        except StopIteration:
            raise ValueError(f'CSV is empty: {csv_path}')
        headers = unique_headers(original_headers)
        columns_sql = ', '.join(f'{quote_identifier(column)} TEXT' for column in headers)
        placeholders = ', '.join('?' for _ in headers)
        table = quote_identifier(name)
        connection.execute(f'DROP TABLE IF EXISTS {table}')
        connection.execute(f'CREATE TABLE {table} ({columns_sql})')
        insert = f'INSERT INTO {table} VALUES ({placeholders})'
        count = 0
        batch = []
        for line_number, row in enumerate(reader, start=2):
            if not row:
                continue
            if len(row) != len(headers):
                raise ValueError(
                    f'{csv_path}:{line_number}: expected {len(headers)} fields, got {len(row)}'
                )
            batch.append(row)
            if len(batch) >= CHUNK_SIZE:
                connection.executemany(insert, batch)
                count += len(batch)
                batch.clear()
        if batch:
            connection.executemany(insert, batch)
            count += len(batch)

    return name, original_headers, count


def main():
    files = sorted(
        path for form in FORMS
        for path in (DATA_DIR / form).rglob('*.csv')
    )
    if not files:
        raise SystemExit(f'No selected CSV files found under {DATA_DIR}')

    connection = sqlite3.connect(DB_PATH)
    connection.execute('PRAGMA journal_mode = WAL')
    connection.execute('PRAGMA synchronous = NORMAL')
    connection.execute('PRAGMA cache_size = -64000')
    connection.execute('''
        CREATE TABLE IF NOT EXISTS sinte_import_manifest (
            source_path TEXT PRIMARY KEY,
            form TEXT NOT NULL,
            sql_table TEXT NOT NULL UNIQUE,
            row_count INTEGER NOT NULL,
            columns_json TEXT NOT NULL,
            source_bytes INTEGER NOT NULL,
            imported_at_utc TEXT NOT NULL
        )
    ''')
    connection.commit()

    total_rows = 0
    try:
        for index, path in enumerate(files, start=1):
            try:
                with connection:
                    name, headers, rows = import_file(connection, path)
                    relative = path.relative_to(DATA_DIR).as_posix()
                    connection.execute('''
                        INSERT INTO sinte_import_manifest
                            (source_path, form, sql_table, row_count, columns_json, source_bytes, imported_at_utc)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(source_path) DO UPDATE SET
                            form=excluded.form,
                            sql_table=excluded.sql_table,
                            row_count=excluded.row_count,
                            columns_json=excluded.columns_json,
                            source_bytes=excluded.source_bytes,
                            imported_at_utc=excluded.imported_at_utc
                    ''', (
                        relative, path.relative_to(DATA_DIR).parts[0], name, rows,
                        json.dumps(headers, ensure_ascii=False), path.stat().st_size,
                        datetime.now(timezone.utc).isoformat()
                    ))
                total_rows += rows
                print(f'[{index}/{len(files)}] {relative}: {rows:,} rows → {name}', flush=True)
            except Exception:
                print(f'Import stopped at {path.relative_to(DATA_DIR)}; earlier tables remain imported.', flush=True)
                raise
    finally:
        connection.close()

    print(f'Imported {len(files)} CSV tables and {total_rows:,} rows into {DB_PATH}', flush=True)


if __name__ == '__main__':
    main()
