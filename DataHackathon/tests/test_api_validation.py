import unittest
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from DataHackathon.frontend import app as app_module


class TableDataValidationTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()

    def test_rejects_non_integer_pagination_without_querying_database(self):
        with patch.object(app_module, 'get_db_connection') as get_connection:
            response = self.client.get('/api/table-data?page=abc')

        self.assertEqual(response.status_code, 400)
        self.assertIn('целыми числами', response.get_json()['error'])
        get_connection.assert_not_called()

    def test_rejects_page_and_limit_outside_allowed_ranges(self):
        invalid_queries = [
            'page=0',
            'page=100001',
            'limit=0',
            'limit=5001',
            'limit=-1'
        ]
        for query in invalid_queries:
            with self.subTest(query=query), patch.object(
                app_module, 'get_db_connection'
            ) as get_connection:
                response = self.client.get(f'/api/table-data?{query}')

            self.assertEqual(response.status_code, 400)
            get_connection.assert_not_called()

    def test_accepts_valid_pagination_within_bounds(self):
        connection = MagicMock()
        count_result = MagicMock()
        count_result.fetchone.return_value = (0,)
        data_result = MagicMock()
        data_result.fetchall.return_value = []
        connection.execute.side_effect = [count_result, data_result]

        with patch.object(app_module, 'get_db_connection', return_value=connection):
            response = self.client.get('/api/table-data?page=2&limit=2000')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['page'], 2)
        self.assertEqual(connection.execute.call_args.args[1][-2:], [2000, 2000])

    def test_packaged_app_reads_existing_database(self):
        with tempfile.TemporaryDirectory() as directory, patch.multiple(
            app_module,
            DB_FILE=str(Path(directory) / 'database.sqlite'),
            APP_PACKAGED=True
        ):
            import sqlite3
            database_path = Path(directory) / 'database.sqlite'
            with sqlite3.connect(database_path) as setup_connection:
                setup_connection.execute(
                    'CREATE TABLE demographics (indicator TEXT, year INTEGER, province TEXT, value REAL)'
                )
                setup_connection.execute(
                    'INSERT INTO demographics VALUES (?, ?, ?, ?)',
                    ('Population', 2024, 'Astana', 100.0)
                )

            connection = app_module.get_db_connection()
            try:
                rows = connection.execute(
                    'SELECT indicator, year, province, value FROM demographics'
                ).fetchall()
            finally:
                connection.close()

        self.assertEqual(
            [tuple(row) for row in rows],
            [('Population', 2024, 'Astana', 100.0)]
        )

    def test_packaged_app_creates_an_empty_database_instead_of_fake_data(self):
        with tempfile.TemporaryDirectory() as directory, patch.multiple(
            app_module,
            DB_FILE=str(Path(directory) / 'database.sqlite'),
            APP_PACKAGED=True
        ):
            connection = app_module.get_db_connection()
            try:
                rows = connection.execute(
                    'SELECT indicator, year, province, value FROM demographics'
                ).fetchall()
            finally:
                connection.close()

        self.assertEqual(rows, [])


class PackagedDatabaseTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()

    def _create_packaged_database(self, path):
        import sqlite3

        with sqlite3.connect(path) as connection:
            connection.execute('CREATE TABLE sinte_import_manifest (form TEXT)')
            connection.executemany(
                'INSERT INTO sinte_import_manifest VALUES (?)',
                [('d002',), ('d004',), ('d006',), ('d008',)]
            )

    def test_seeds_missing_user_database_from_packaged_database(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as directory:
            bundled = Path(directory) / 'resources' / 'database.sqlite'
            target = Path(directory) / 'user-data' / 'database.sqlite'
            bundled.parent.mkdir()
            self._create_packaged_database(bundled)

            app_module.prepare_packaged_database(target, bundled)

            with sqlite3.connect(target) as connection:
                forms = {
                    row[0] for row in connection.execute(
                        'SELECT DISTINCT form FROM sinte_import_manifest'
                    )
                }
            self.assertEqual(forms, {'d002', 'd004', 'd006', 'd008'})

    def test_preserves_old_user_database_before_seeding_imported_data(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as directory:
            bundled = Path(directory) / 'resources' / 'database.sqlite'
            target = Path(directory) / 'user-data' / 'database.sqlite'
            bundled.parent.mkdir()
            target.parent.mkdir()
            self._create_packaged_database(bundled)
            with sqlite3.connect(target) as connection:
                connection.execute('CREATE TABLE saved_data (value TEXT)')
                connection.execute('INSERT INTO saved_data VALUES (?)', ('keep me',))

            app_module.prepare_packaged_database(target, bundled)

            backups = list(target.parent.glob('database.legacy-*.sqlite'))
            self.assertEqual(len(backups), 1)
            with sqlite3.connect(backups[0]) as connection:
                self.assertEqual(
                    connection.execute('SELECT value FROM saved_data').fetchone()[0],
                    'keep me'
                )
            with sqlite3.connect(target) as connection:
                forms = {
                    row[0] for row in connection.execute(
                        'SELECT DISTINCT form FROM sinte_import_manifest'
                    )
                }
            self.assertEqual(forms, {'d002', 'd004', 'd006', 'd008'})

    def test_keeps_existing_database_that_already_has_imported_datasets(self):
        with tempfile.TemporaryDirectory() as directory:
            bundled = Path(directory) / 'resources' / 'database.sqlite'
            target = Path(directory) / 'user-data' / 'database.sqlite'
            bundled.parent.mkdir()
            target.parent.mkdir()
            self._create_packaged_database(bundled)
            self._create_packaged_database(target)
            before = target.read_bytes()

            app_module.prepare_packaged_database(target, bundled)

            self.assertEqual(target.read_bytes(), before)

    def test_d004_api_reads_imported_sqlite_table_without_sinte_files(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as directory, patch.multiple(
            app_module,
            DB_FILE=str(Path(directory) / 'database.sqlite'),
            DATA_DIR=Path(directory) / 'missing-sinte'
        ):
            with sqlite3.connect(app_module.DB_FILE) as connection:
                connection.execute(
                    'CREATE TABLE sinte_import_manifest '
                    '(source_path TEXT, form TEXT, sql_table TEXT, row_count INTEGER)'
                )
                connection.execute(
                    'CREATE TABLE sinte_d004_2024_4kv_kv_vopr1 '
                    '(TE TEXT, K TEXT, NOMER TEXT, STOIMK TEXT)'
                )
                connection.executemany(
                    'INSERT INTO sinte_d004_2024_4kv_kv_vopr1 VALUES (?, ?, ?, ?)',
                    [('71', '1', '1', '100'), ('71', '1', '2', '250')]
                )
                connection.execute(
                    'INSERT INTO sinte_import_manifest VALUES (?, ?, ?, ?)',
                    ('d004/2024/4kv/kv_vopr1.csv', 'd004', 'sinte_d004_2024_4kv_kv_vopr1', 2)
                )

            response = self.client.get(
                '/api/d004/data?year=2024&quarter=4kv&module=1&page=1&page_size=10'
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['total_rows'], 2)
        self.assertEqual(len(payload['rows']), 2)
        self.assertEqual(payload['source'], 'database.sqlite · импорт из data/sinte')


class LocalCorsTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()

    def test_allows_electron_file_origin_and_loopback_origins(self):
        for origin in ('null', 'http://127.0.0.1:43123', 'http://localhost:5000'):
            with self.subTest(origin=origin):
                response = self.client.get(
                    '/api/settings/claude-key',
                    headers={'Origin': origin}
                )
                self.assertEqual(
                    response.headers.get('Access-Control-Allow-Origin'),
                    origin
                )

    def test_does_not_grant_cors_access_to_external_origins(self):
        response = self.client.get(
            '/api/settings/claude-key',
            headers={'Origin': 'https://attacker.example'}
        )

        self.assertNotIn('Access-Control-Allow-Origin', response.headers)


if __name__ == '__main__':
    unittest.main()
