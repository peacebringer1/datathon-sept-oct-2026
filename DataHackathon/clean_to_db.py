import argparse
import json
import math
import re
import sqlite3
import sys
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_RAW_DATA_DIR = BASE_DIR / "data" / "raw"
DEFAULT_DB_FILE = BASE_DIR / "database.sqlite"
DEFAULT_REPORT_FILE = BASE_DIR / "database_import_report.json"
STAGING_TABLE = "demographics_import_staging"
UNRESOLVED_PROVINCE = "Неопределенная область"

REGION_KEYWORDS = {
    "астана": "г. Астана",
    "алматы": "г. Алматы",
    "шымкент": "г. Шымкент",
    "акмол": "Акмолинская область",
    "актюб": "Актюбинская область",
    "алматинск": "Алматинская область",
    "атырау": "Атырауская область",
    "западно-казахстан": "Западно-Казахстанская область",
    "зко": "Западно-Казахстанская область",
    "жамбыл": "Жамбылская область",
    "караганд": "Карагандинская область",
    "костанай": "Костанайская область",
    "кызылорд": "Кызылординская область",
    "мангистау": "Мангистауская область",
    "туркестан": "Туркестанская область",
    "южно-казахстан": "Туркестанская область",
    "павлодар": "Павлодарская область",
    "северо-казахстан": "Северо-Казахстанская область",
    "ско": "Северо-Казахстанская область",
    "восточно-казахстан": "Восточно-Казахстанская область",
    "вко": "Восточно-Казахстанская область",
    "абай": "Область Абай",
    "жетісу": "Область Жетісу",
    "жетысу": "Область Жетісу",
    "ұлытау": "Область Ұлытау",
    "улытау": "Область Ұлытау",
}

KATO_NUMERIC = {
    "11": "Акмолинская область",
    "15": "Актюбинская область",
    "19": "Алматинская область",
    "23": "Атырауская область",
    "27": "Западно-Казахстанская область",
    "31": "Жамбылская область",
    "35": "Карагандинская область",
    "39": "Костанайская область",
    "43": "Кызылординская область",
    "47": "Мангистауская область",
    "51": "Туркестанская область",
    "55": "Павлодарская область",
    "59": "Северо-Казахстанская область",
    "63": "Восточно-Казахстанская область",
    "10": "Область Абай",
    "33": "Область Жетісу",
    "62": "Область Ұлытау",
    "71": "г. Астана",
    "75": "г. Алматы",
    "79": "г. Шымкент",
}

REQUIRED_COLUMNS = {
    "indicator": ("nam", "показатель", "наименование"),
    "date": ("dat", "дата", "период", "год"),
    "kato": ("като", "kato", "lкато", "lkato"),
    "value": ("val", "значение", "знач"),
}
AGGREGATIONS = ("error", "sum", "mean", "min", "max", "first")


class ImportValidationError(ValueError):
    pass


class ImportRunError(ImportValidationError):
    def __init__(self, message, report):
        super().__init__(message)
        self.report = report


class DuplicateGroupsError(ImportValidationError):
    def __init__(self, message, duplicate_report):
        super().__init__(message)
        self.duplicate_report = duplicate_report


def map_kato_to_province(value):
    text = str(value).strip().lower()
    if not text or text == "nan":
        return UNRESOLVED_PROVINCE

    for keyword, region_name in REGION_KEYWORDS.items():
        if keyword in text:
            return region_name

    digits = re.sub(r"\D", "", text)
    if len(digits) >= 2:
        prefix = digits.zfill(9)[:2]
        if prefix in KATO_NUMERIC:
            return KATO_NUMERIC[prefix]

    return UNRESOLVED_PROVINCE


def find_column_by_keywords(columns, keywords):
    for column in columns:
        clean_column = str(column).lower().replace('"', "").replace("'", "").strip()
        if any(keyword.lower() in clean_column for keyword in keywords):
            return column
    return None


def get_required_columns(columns):
    selected = {}
    used_columns = set()
    for field, keywords in REQUIRED_COLUMNS.items():
        column = find_column_by_keywords(
            [candidate for candidate in columns if candidate not in used_columns],
            keywords,
        )
        selected[field] = column
        if column is not None:
            used_columns.add(column)
    return selected


def read_source_csv(file_path):
    failures = []
    for separator in ("\t", ",", ";"):
        for encoding in ("utf-8", "utf-8-sig", "cp1251"):
            try:
                sample = pd.read_csv(
                    file_path,
                    sep=separator,
                    encoding=encoding,
                    low_memory=False,
                    nrows=20,
                )
                sample.columns = [
                    str(column).replace('"', "").replace("'", "").strip()
                    for column in sample.columns
                ]
                columns = get_required_columns(sample.columns)
                if any(column is None for column in columns.values()):
                    continue

                dataframe = pd.read_csv(
                    file_path,
                    sep=separator,
                    encoding=encoding,
                    low_memory=False,
                )
                dataframe.columns = [
                    str(column).replace('"', "").replace("'", "").strip()
                    for column in dataframe.columns
                ]
                return dataframe, get_required_columns(dataframe.columns)
            except (UnicodeDecodeError, pd.errors.ParserError, ValueError) as error:
                failures.append(str(error))

    if failures:
        detail = failures[-1]
        raise ImportValidationError(f"Не удалось разобрать CSV: {detail}")
    raise ImportValidationError(
        "Не найдена ожидаемая схема: нужны столбцы показателя, даты/года, КАТО и значения."
    )


def process_file(file_path):
    path = Path(file_path)
    file_report = {
        "file": path.name,
        "rows_read": 0,
        "rows_accepted": 0,
        "rows_discarded": 0,
        "discard_reasons": {},
        "status": "ok",
    }

    try:
        dataframe, columns = read_source_csv(path)
    except (ImportValidationError, OSError) as error:
        file_report["status"] = "skipped"
        file_report["error"] = str(error)
        return pd.DataFrame(columns=["indicator", "year", "province", "value"]), file_report

    file_report["rows_read"] = len(dataframe)
    if dataframe.empty:
        file_report["status"] = "skipped"
        file_report["error"] = "CSV не содержит строк данных."
        return pd.DataFrame(columns=["indicator", "year", "province", "value"]), file_report

    indicators = dataframe[columns["indicator"]].astype("string").str.strip()
    dates = dataframe[columns["date"]].astype("string")
    years = pd.to_numeric(dates.str.extract(r"(\d{4})", expand=False), errors="coerce")
    provinces = dataframe[columns["kato"]].map(map_kato_to_province)

    raw_values = (
        dataframe[columns["value"]]
        .astype("string")
        .str.replace(r"\s+", "", regex=True)
        .str.replace(",", ".", regex=False)
    )
    values = pd.to_numeric(raw_values, errors="coerce")
    finite_values = values.map(
        lambda value: math.isfinite(value) if pd.notna(value) else False
    )

    invalid_reasons = {
        "empty_indicator": indicators.isna() | indicators.eq(""),
        "invalid_year": years.isna() | years.le(0),
        "invalid_or_non_finite_value": ~finite_values,
        "unrecognized_region": provinces.eq(UNRESOLVED_PROVINCE),
    }
    invalid_rows = pd.Series(False, index=dataframe.index)
    for reason, invalid_mask in invalid_reasons.items():
        file_report["discard_reasons"][reason] = int(invalid_mask.sum())
        invalid_rows |= invalid_mask

    valid = ~invalid_rows
    file_report["rows_accepted"] = int(valid.sum())
    file_report["rows_discarded"] = int(invalid_rows.sum())

    clean_dataframe = pd.DataFrame({
        "indicator": indicators[valid].astype(str).str.strip(),
        "year": years[valid].astype(int),
        "province": provinces[valid],
        "value": values[valid].astype(float),
    })
    return clean_dataframe.reset_index(drop=True), file_report


def aggregate_records(dataframe, aggregation=None, aggregation_map=None):
    if aggregation is not None and aggregation not in AGGREGATIONS:
        raise ValueError(f"Неизвестная политика агрегации: {aggregation}")
    aggregation_map = aggregation_map or {}
    if any(policy not in AGGREGATIONS for policy in aggregation_map.values()):
        raise ValueError("В карте агрегации указана неизвестная политика.")
    keys = ["indicator", "year", "province"]
    group_sizes = dataframe.groupby(keys, sort=False, dropna=False).size()
    duplicate_groups = group_sizes[group_sizes > 1]
    duplicate_rows = int((duplicate_groups - 1).sum())
    duplicate_indicators = {}
    selected_policies = {}
    for index in duplicate_groups.index:
        indicator = index[0]
        duplicate_indicators[indicator] = duplicate_indicators.get(indicator, 0) + 1
        selected_policies[indicator] = aggregation_map.get(
            indicator, aggregation or "error"
        )
    duplicate_report = {
        "duplicate_groups": int(len(duplicate_groups)),
        "duplicate_rows": duplicate_rows,
        "duplicate_indicators": duplicate_indicators,
        "policies": selected_policies,
    }

    if not duplicate_rows:
        return dataframe.reset_index(drop=True), duplicate_report
    unresolved = [
        indicator
        for indicator, policy in selected_policies.items()
        if policy == "error"
    ]
    if unresolved:
        raise DuplicateGroupsError(
            f"Найдены повторяющиеся группы (групп: {len(duplicate_groups)}, "
            f"лишних строк: {duplicate_rows}; показатели: "
            f"{', '.join(unresolved)}). Импорт отменён. "
            "Задайте для каждого показателя политику в --aggregation-map "
            "или явно выберите общий --aggregation.",
            duplicate_report,
        )

    output = []
    for indicator in pd.unique(dataframe["indicator"]):
        indicator_rows = dataframe[dataframe["indicator"] == indicator]
        policy = selected_policies.get(indicator)
        if policy is None:
            output.append(indicator_rows)
            continue

        grouped = indicator_rows.groupby(
            keys, as_index=False, sort=False, dropna=False
        )["value"]
        if policy == "first":
            output.append(grouped.first())
        else:
            output.append(grouped.agg(policy))
    return pd.concat(output, ignore_index=True), duplicate_report


def write_database(dataframe, database_path):
    database_path = Path(database_path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        dataframe.to_sql(STAGING_TABLE, connection, if_exists="replace", index=False)
        connection.execute("DROP TABLE IF EXISTS demographics")
        connection.execute(
            f"ALTER TABLE {STAGING_TABLE} RENAME TO demographics"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_indicator ON demographics(indicator)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_year ON demographics(year)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_province ON demographics(province)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_combo ON demographics(indicator, year)"
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def write_report(report, report_path):
    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = report_path.with_suffix(report_path.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(report_path)


def print_report(report, report_path):
    totals = report["totals"]
    print(f"Статус импорта: {report['status']}")
    print(f"Файлов обработано: {totals['files_processed']}")
    print(f"Файлов пропущено: {totals['files_skipped']}")
    print(f"Строк прочитано: {totals['rows_read']}")
    print(f"Строк импортировано: {totals['rows_accepted']}")
    print(f"Строк отброшено: {totals['rows_discarded']}")
    print(f"Отчёт качества данных: {report_path}")
    if report.get("error"):
        print(f"Ошибка: {report['error']}", file=sys.stderr)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Проверить CSV и создать локальную базу агрегатов демографии."
    )
    parser.add_argument("--raw-data-dir", type=Path, default=DEFAULT_RAW_DATA_DIR)
    parser.add_argument("--db-file", type=Path, default=DEFAULT_DB_FILE)
    parser.add_argument("--report-file", type=Path, default=DEFAULT_REPORT_FILE)
    parser.add_argument(
        "--aggregation",
        choices=AGGREGATIONS,
        default=None,
        help=(
            "Общая политика для дублей, если она одинакова для всех показателей. "
            "По умолчанию при дублях импорт останавливается."
        ),
    )
    parser.add_argument(
        "--aggregation-map",
        type=Path,
        default=None,
        help="JSON-файл с отдельной политикой для каждого показателя-дубля.",
    )
    parser.add_argument(
        "--max-discarded-fraction",
        type=float,
        default=None,
        help="Остановить импорт, если отброшенная доля строк выше порога от 0 до 1.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Отменить импорт при пропущенных файлах или отброшенных строках.",
    )
    arguments = parser.parse_args(argv)
    if (
        arguments.max_discarded_fraction is not None
        and not 0 <= arguments.max_discarded_fraction <= 1
    ):
        parser.error("--max-discarded-fraction должен быть между 0 и 1.")
    return arguments


def run_import(arguments):
    csv_files = sorted(
        path for path in arguments.raw_data_dir.iterdir()
        if path.is_file() and path.suffix.lower() == ".csv"
    ) if arguments.raw_data_dir.is_dir() else []
    report = {
        "status": "failed",
        "input_directory": str(arguments.raw_data_dir),
        "aggregation_policy": (
            "per-indicator" if arguments.aggregation_map else arguments.aggregation or "error"
        ),
        "aggregation_fallback": arguments.aggregation or "error",
        "aggregation_map_file": (
            str(arguments.aggregation_map) if arguments.aggregation_map else None
        ),
        "files": [],
        "totals": {
            "files_found": len(csv_files),
            "files_processed": 0,
            "files_skipped": 0,
            "rows_read": 0,
            "rows_accepted": 0,
            "rows_discarded": 0,
            "discard_reasons": {},
            "duplicate_groups": 0,
            "duplicate_rows": 0,
        },
    }

    if not csv_files:
        raise ImportRunError(
            f"В каталоге {arguments.raw_data_dir} не найдено CSV-файлов.",
            report,
        )

    aggregation_map = {}
    if arguments.aggregation_map:
        try:
            aggregation_map = json.loads(
                arguments.aggregation_map.read_text(encoding="utf-8")
            )
        except (OSError, json.JSONDecodeError) as error:
            raise ImportRunError(
                f"Не удалось прочитать карту агрегации: {error}",
                report,
            ) from error
        if not isinstance(aggregation_map, dict) or any(
            not isinstance(indicator, str)
            or not isinstance(policy, str)
            or policy not in AGGREGATIONS
            for indicator, policy in aggregation_map.items()
        ):
            raise ImportRunError(
                "Карта агрегации должна быть JSON-объектом вида "
                '{"название показателя": "sum|mean|min|max|first|error"}.',
                report,
            )

    dataframes = []
    for csv_file in csv_files:
        dataframe, file_report = process_file(csv_file)
        report["files"].append(file_report)
        if file_report["status"] == "ok":
            report["totals"]["files_processed"] += 1
            dataframes.append(dataframe)
        else:
            report["totals"]["files_skipped"] += 1
        report["totals"]["rows_read"] += file_report["rows_read"]
        report["totals"]["rows_accepted"] += file_report["rows_accepted"]
        report["totals"]["rows_discarded"] += file_report["rows_discarded"]
        for reason, count in file_report["discard_reasons"].items():
            report["totals"]["discard_reasons"][reason] = (
                report["totals"]["discard_reasons"].get(reason, 0) + count
            )

    if not dataframes or not any(not dataframe.empty for dataframe in dataframes):
        raise ImportRunError(
            "Не найдено ни одной строки, пригодной для импорта; "
            "существующая база не изменена.",
            report,
        )

    all_records = pd.concat(dataframes, ignore_index=True)
    try:
        clean_records, duplicate_report = aggregate_records(
            all_records, arguments.aggregation, aggregation_map
        )
    except DuplicateGroupsError as error:
        report["duplicates"] = error.duplicate_report
        report["totals"]["duplicate_groups"] = error.duplicate_report["duplicate_groups"]
        report["totals"]["duplicate_rows"] = error.duplicate_report["duplicate_rows"]
        raise ImportRunError(str(error), report) from error
    report["duplicates"] = duplicate_report
    report["totals"]["duplicate_groups"] = duplicate_report["duplicate_groups"]
    report["totals"]["duplicate_rows"] = duplicate_report["duplicate_rows"]

    rows_read = report["totals"]["rows_read"]
    discarded_fraction = (
        report["totals"]["rows_discarded"] / rows_read if rows_read else 0
    )
    report["totals"]["discarded_fraction"] = discarded_fraction
    if (
        arguments.max_discarded_fraction is not None
        and discarded_fraction > arguments.max_discarded_fraction
    ):
        raise ImportRunError(
            f"Доля отброшенных строк {discarded_fraction:.1%} превышает "
            f"порог {arguments.max_discarded_fraction:.1%}; база не изменена.",
            report,
        )
    if arguments.strict and (
        report["totals"]["rows_discarded"] or report["totals"]["files_skipped"]
    ):
        raise ImportRunError(
            "Строгая проверка не пройдена: есть отброшенные строки или пропущенные файлы; "
            "база не изменена.",
            report,
        )

    try:
        write_database(clean_records, arguments.db_file)
    except Exception as error:
        raise ImportRunError(
            f"Не удалось атомарно обновить базу; проверьте права и свободное место: {error}",
            report,
        ) from error
    report["status"] = "success"
    report["database_file"] = str(arguments.db_file)
    report["totals"]["rows_written"] = len(clean_records)
    return report


def main(argv=None):
    arguments = parse_args(argv)
    try:
        report = run_import(arguments)
    except ImportRunError as error:
        report = error.report
        report["error"] = str(error)
    except Exception as error:
        report = {
            "status": "failed",
            "error": str(error),
            "input_directory": str(arguments.raw_data_dir),
            "aggregation_policy": (
                "per-indicator"
                if arguments.aggregation_map
                else arguments.aggregation or "error"
            ),
            "aggregation_fallback": arguments.aggregation or "error",
            "files": [],
            "totals": {},
        }
        write_report(report, arguments.report_file)
        print_report(report, arguments.report_file)
        return 1

    write_report(report, arguments.report_file)
    print_report(report, arguments.report_file)
    if report["totals"]["rows_discarded"] or report["totals"]["files_skipped"]:
        print(
            "Предупреждение: часть данных пропущена или отброшена. "
            "Проверьте отчёт перед использованием результатов."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
