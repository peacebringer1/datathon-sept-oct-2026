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
