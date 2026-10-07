"""Пользовательские расшифровки значений датасетов.

Правило может сопоставлять одно точное значение с текстовой расшифровкой
или задавать диапазон для числового/дата-временного столбца.
"""

from dataclasses import dataclass
from typing import Iterable

import pandas as pd
from pathlib import Path

from core.text_utils import to_datetime_safe, to_numeric_safe


MATCH_EXACT = "exact"
MATCH_RANGE = "range"


@dataclass
class DecodingRule:
    column: str
    match_type: str = MATCH_EXACT
    value_from: str = ""
    value_to: str = ""
    replacement: str = ""


def _parse_scalar(value: str, series: pd.Series):
    if pd.api.types.is_numeric_dtype(series):
        converted = to_numeric_safe(pd.Series([value]))
        if converted.notna().iloc[0]:
            return converted.iloc[0]
        raise ValueError(f"Значение '{value}' не удалось распознать как число.")

    if pd.api.types.is_datetime64_any_dtype(series):
        converted = to_datetime_safe(pd.Series([value]))
        if converted.notna().iloc[0]:
            return converted.iloc[0]
        raise ValueError(f"Значение '{value}' не удалось распознать как дату/время.")

    return str(value).strip()


def _comparison_series(series: pd.Series):
    if pd.api.types.is_numeric_dtype(series):
        return to_numeric_safe(series)
    if pd.api.types.is_datetime64_any_dtype(series):
        return to_datetime_safe(series)
    return series.astype("string").str.strip()


def apply_decoding_rules(
    dataframe: pd.DataFrame,
    rules: Iterable[DecodingRule],
) -> tuple[pd.DataFrame, dict[str, int]]:
    """Применяет правила сверху вниз.

    Более позднее правило может переопределить результат предыдущего
    правила для тех же строк. Возвращает изменённый DataFrame и число
    замен по каждому столбцу.
    """
    rules = list(rules)
    if not rules:
        return dataframe.copy(), {}

    result = dataframe.copy()
    changed_by_column: dict[str, int] = {}

    grouped: dict[str, list[DecodingRule]] = {}
    for rule in rules:
        column = str(rule.column)
        if column not in result.columns:
            raise ValueError(
                f"Столбец '{column}' для расшифровки не найден."
            )
        if not str(rule.replacement).strip():
            raise ValueError(
                f"Для столбца '{column}' не указана расшифровка."
            )
        grouped.setdefault(column, []).append(rule)

    for column, column_rules in grouped.items():
        source = result[column]
        compare = _comparison_series(source)
        work = source.astype("object").copy()

        for rule in column_rules:
            match_type = str(rule.match_type)
            if match_type not in {MATCH_EXACT, MATCH_RANGE}:
                raise ValueError(
                    f"Неизвестный тип правила: {match_type}"
                )

            start = _parse_scalar(str(rule.value_from), source)
            if match_type == MATCH_EXACT:
                mask = compare.eq(start)
            else:
                if not (
                    pd.api.types.is_numeric_dtype(source)
                    or pd.api.types.is_datetime64_any_dtype(source)
                ):
                    raise ValueError(
                        f"Диапазон можно использовать только для числового "
                        f"или дата/временного столбца: '{column}'."
                    )
                if str(rule.value_to).strip() == "":
                    raise ValueError(
                        f"Для диапазона столбца '{column}' не указано значение 'до'."
                    )
                end = _parse_scalar(str(rule.value_to), source)
                if start > end:
                    start, end = end, start
                mask = compare.ge(start) & compare.le(end)

            valid_mask = mask.fillna(False)
            changed_count = int(valid_mask.sum())
            if changed_count:
                work.loc[valid_mask] = str(rule.replacement).strip()
                changed_by_column[column] = (
                    changed_by_column.get(column, 0) + changed_count
                )

        result[column] = work

    return result, changed_by_column


def unique_value_counts(
    dataframe: pd.DataFrame,
    column: str,
    *,
    limit: int = 10_000,
) -> pd.DataFrame:
    """Возвращает уникальные значения и их количество.

    При превышении limit показываются самые частые значения, чтобы GUI
    не пытался создать десятки тысяч Qt-строк одновременно.
    """
    if column not in dataframe.columns:
        raise ValueError(f"Столбец '{column}' не найден.")

    counts = (
        dataframe[column]
        .value_counts(dropna=False)
        .rename_axis("Значение")
        .reset_index(name="Количество")
    )
    counts["Значение"] = counts["Значение"].map(
        lambda value: "<ПУСТО>" if pd.isna(value) else str(value)
    )
    return counts.head(limit)


def unique_value_counts_csv(
    file_path: str,
    column: str,
    *,
    chunksize: int = 100_000,
    limit: int = 10_000,
) -> pd.DataFrame:
    """Точный список наиболее частых уникальных значений одного CSV-столбца.

    Счётчики агрегируются через SQLite, поэтому полный набор уникальных
    значений не держится одновременно в RAM.
    """
    import sqlite3
    import tempfile
    import os
    from core.loader import detect_csv_format

    encoding, separator = detect_csv_format(Path(file_path))
    fd, db_path = tempfile.mkstemp(prefix="data_analyzer_unique_", suffix=".sqlite3")
    os.close(fd)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("CREATE TABLE counts (value TEXT PRIMARY KEY, count INTEGER NOT NULL)")
        reader = pd.read_csv(
            file_path,
            encoding=encoding,
            sep=separator,
            engine="c",
            usecols=[column],
            chunksize=chunksize,
        )
        for chunk in reader:
            values = chunk[column].map(
                lambda value: "<ПУСТО>" if pd.isna(value) else str(value)
            )
            counts = values.value_counts(dropna=False)
            conn.executemany(
                """
                INSERT INTO counts(value, count) VALUES (?, ?)
                ON CONFLICT(value) DO UPDATE SET count = count + excluded.count
                """,
                [(str(value), int(count)) for value, count in counts.items()],
            )
            conn.commit()

        rows = conn.execute(
            "SELECT value, count FROM counts ORDER BY count DESC, value LIMIT ?",
            (int(limit),),
        ).fetchall()
        return pd.DataFrame(rows, columns=["Значение", "Количество"])
    finally:
        conn.close()
        try:
            os.unlink(db_path)
        except OSError:
            pass
