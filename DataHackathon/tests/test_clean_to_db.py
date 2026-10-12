import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from DataHackathon.clean_to_db import (
    ImportRunError,
    aggregate_records,
    main,
    parse_args,
    process_file,
    run_import,
)


class ProcessFileTests(unittest.TestCase):
    def test_discards_bad_rows_and_reports_each_reason_without_zero_filling(self):
        with tempfile.TemporaryDirectory() as directory:
            csv_path = Path(directory) / "sample.csv"
            csv_path.write_text(
                "NAM;DAT;KATO;VAL\n"
                "Population;2024;710000000;1 234,5\n"
                "Population;2024;990000000;25\n"
                "Population;bad;710000000;2\n"
                "Population;2023;710000000;not-a-number\n"
                ";2024;710000000;3\n",
                encoding="utf-8",
            )

            data, report = process_file(csv_path)

        self.assertEqual(len(data), 1)
        self.assertEqual(data.iloc[0]["value"], 1234.5)
        self.assertEqual(report["rows_read"], 5)
        self.assertEqual(report["rows_accepted"], 1)
        self.assertEqual(report["rows_discarded"], 4)
        self.assertEqual(report["discard_reasons"]["unrecognized_region"], 1)
        self.assertEqual(report["discard_reasons"]["invalid_year"], 1)
        self.assertEqual(report["discard_reasons"]["invalid_or_non_finite_value"], 1)
        self.assertEqual(report["discard_reasons"]["empty_indicator"], 1)


class AggregationTests(unittest.TestCase):
    def setUp(self):
        self.rows = pd.DataFrame([
            {"indicator": "Population", "year": 2024, "province": "Астана", "value": 10.0},
            {"indicator": "Population", "year": 2024, "province": "Астана", "value": 20.0},
        ])

    def test_duplicate_rows_require_an_explicit_policy(self):
        with self.assertRaisesRegex(ValueError, "повторяющиеся группы"):
            aggregate_records(self.rows, "error")

    def test_explicit_sum_policy_combines_duplicate_rows(self):
        result, report = aggregate_records(self.rows, "sum")
        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["value"], 30.0)
        self.assertEqual(report["duplicate_groups"], 1)
        self.assertEqual(report["duplicate_rows"], 1)

    def test_per_indicator_policy_applies_only_to_duplicate_groups(self):
        rows = pd.concat([
            self.rows,
            pd.DataFrame([
                {"indicator": "Average size", "year": 2024, "province": "Астана", "value": 2.0},
                {"indicator": "Average size", "year": 2024, "province": "Астана", "value": 4.0},
                {"indicator": "Unique", "year": 2024, "province": "Алматы", "value": 7.0},
            ]),
        ], ignore_index=True)

        result, report = aggregate_records(
            rows,
            aggregation_map={"Population": "sum", "Average size": "mean"},
        )

        values = result.set_index("indicator")["value"]
        self.assertEqual(values["Population"], 30.0)
        self.assertEqual(values["Average size"], 3.0)
        self.assertEqual(values["Unique"], 7.0)
        self.assertEqual(report["policies"], {"Population": "sum", "Average size": "mean"})

    def test_successful_import_writes_the_validated_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            (raw_dir / "sample.csv").write_text(
                "NAM;DAT;KATO;VAL\nPopulation;2024;710000000;10\n",
                encoding="utf-8",
            )
            database = root / "database.sqlite"
            arguments = parse_args([
                "--raw-data-dir", str(raw_dir),
                "--db-file", str(database),
                "--report-file", str(root / "report.json"),
            ])

            report = run_import(arguments)

            self.assertEqual(report["status"], "success")
            self.assertEqual(report["totals"]["rows_written"], 1)
            with sqlite3.connect(database) as connection:
                rows = connection.execute(
                    "SELECT indicator, year, province, value FROM demographics"
                ).fetchall()
            self.assertEqual(rows, [("Population", 2024, "г. Астана", 10.0)])

    def test_cli_persists_a_report_with_discarded_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            (raw_dir / "sample.csv").write_text(
                "NAM;DAT;KATO;VAL\n"
                "Population;2024;710000000;10\n"
                "Population;2024;710000000;not-a-number\n",
                encoding="utf-8",
            )
            report_path = root / "report.json"

            exit_code = main([
                "--raw-data-dir", str(raw_dir),
                "--db-file", str(root / "database.sqlite"),
                "--report-file", str(report_path),
            ])

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(exit_code, 0)
            self.assertEqual(report["status"], "success")
            self.assertEqual(report["totals"]["rows_discarded"], 1)
            self.assertEqual(
                report["totals"]["discard_reasons"]["invalid_or_non_finite_value"],
                1,
            )

    def test_duplicate_error_keeps_existing_database_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            source = "NAM;DAT;KATO;VAL\nPopulation;2024;710000000;10\n"
            (raw_dir / "first.csv").write_text(source, encoding="utf-8")
            (raw_dir / "second.csv").write_text(source, encoding="utf-8")
            database = root / "database.sqlite"
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "CREATE TABLE demographics (indicator TEXT, year INTEGER, "
                    "province TEXT, value REAL)"
                )
                connection.execute(
                    "INSERT INTO demographics VALUES ('sentinel', 2020, 'existing', 99)"
                )

            arguments = parse_args([
                "--raw-data-dir", str(raw_dir),
                "--db-file", str(database),
                "--report-file", str(root / "report.json"),
            ])
            with self.assertRaises(ImportRunError) as caught:
                run_import(arguments)

            self.assertEqual(caught.exception.report["totals"]["duplicate_groups"], 1)
            self.assertEqual(caught.exception.report["totals"]["duplicate_rows"], 1)
            with sqlite3.connect(database) as connection:
                existing = connection.execute(
                    "SELECT indicator, value FROM demographics"
                ).fetchall()
            self.assertEqual(existing, [("sentinel", 99.0)])


if __name__ == "__main__":
    unittest.main()
