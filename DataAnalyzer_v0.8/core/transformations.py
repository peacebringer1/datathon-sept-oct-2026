"""Преобразования структуры датасетов."""

from dataclasses import dataclass
from pathlib import Path
import os
import tempfile

import numpy as np
import pandas as pd


@dataclass
class ColumnCombineResult:
    dataframe: pd.DataFrame
    removed_columns: list[str]
    new_column: str


def combine_columns(
    dataframe: pd.DataFrame,
    columns: list[str],
    new_column: str,
    *,
    separator: str = " ",
    skip_empty: bool = True,
) -> ColumnCombineResult:
    """Объединяет выбранные столбцы в один и удаляет исходные.

    Порядок столбцов в ``columns`` определяет порядок частей в результате.
    Новый столбец занимает позицию первого выбранного столбца.
    """
    if len(columns) < 2:
        raise ValueError("Для объединения нужно выбрать минимум 2 столбца.")

    selected = [str(column) for column in columns]
    if len(set(selected)) != len(selected):
        raise ValueError("Один и тот же столбец выбран несколько раз.")

    missing = [column for column in selected if column not in dataframe.columns]
    if missing:
        raise ValueError(
            "Не найдены выбранные столбцы: " + ", ".join(missing)
        )

    new_column = str(new_column).strip()
    if not new_column:
        raise ValueError("Имя нового столбца не может быть пустым.")

    remaining = [
        str(column)
        for column in dataframe.columns
        if str(column) not in selected
    ]
    if new_column in remaining:
        raise ValueError(
            f"Столбец с именем '{new_column}' уже существует среди остальных столбцов."
        )

    separator = str(separator)
    result = dataframe.copy()

    parts = []
    for column in selected:
        series = result[column]
        part = series.astype("string")
        if pd.api.types.is_float_dtype(series):
            integer_mask = series.notna() & series.mod(1).eq(0)
            if integer_mask.any():
                integer_text = series.round().astype("Int64").astype("string")
                part = part.mask(integer_mask, integer_text)
        part = part.fillna("").str.strip()
        parts.append(part)

    combined = parts[0]
    for part in parts[1:]:
        if skip_empty:
            combined = pd.Series(
                np.where(
                    part.eq(""),
                    combined,
                    np.where(
                        combined.eq(""),
                        part,
                        combined + separator + part,
                    ),
                ),
                index=combined.index,
                dtype="string",
            )
        else:
            combined = combined.fillna("") + separator + part.fillna("")

    combined = combined.astype("string").str.strip()
    combined = combined.mask(combined.eq(""), pd.NA)

    first_position = min(result.columns.get_loc(column) for column in selected)
    result = result.drop(columns=selected)

    # Вставляем результат на место первого выбранного столбца.
    result.insert(first_position, new_column, combined)

    return ColumnCombineResult(
        dataframe=result,
        removed_columns=selected,
        new_column=new_column,
    )


def combine_columns_csv(
    source_path: str,
    columns: list[str],
    new_column: str,
    *,
    separator: str = " ",
    skip_empty: bool = True,
    chunksize: int = 100_000,
    preview_rows: int = 1_000,
    progress_callback=None,
    is_cancelled=None,
) -> tuple[str, pd.DataFrame, int]:
    """Потоково объединяет столбцы в уже очищенном UTF-8 CSV.

    Возвращает временный путь результата, preview и число обработанных строк.
    """
    columns = [str(column) for column in columns]
    new_column = str(new_column).strip()
    if len(columns) < 2:
        raise ValueError("Для объединения нужно выбрать минимум 2 столбца.")
    if len(set(columns)) != len(columns):
        raise ValueError("Один и тот же столбец выбран несколько раз.")
    if not new_column:
        raise ValueError("Имя нового столбца не может быть пустым.")

    reader = pd.read_csv(
        source_path,
        encoding="utf-8-sig",
        sep=",",
        engine="c",
        chunksize=chunksize,
    )

    temp_dir = tempfile.mkdtemp(prefix="data_analyzer_combine_")
    output_path = os.path.join(temp_dir, "combined.csv")

    preview_parts: list[pd.DataFrame] = []
    first_write = True
    total_rows = 0

    try:
        for chunk in reader:
            if is_cancelled and is_cancelled():
                raise InterruptedError("Операция отменена пользователем.")

            chunk.columns = [str(c).strip() for c in chunk.columns]
            combined_result = combine_columns(
                chunk,
                columns,
                new_column,
                separator=separator,
                skip_empty=skip_empty,
            )
            combined = combined_result.dataframe

            if sum(len(part) for part in preview_parts) < preview_rows:
                remaining = preview_rows - sum(len(part) for part in preview_parts)
                preview_parts.append(combined.head(remaining))

            combined.to_csv(
                output_path,
                mode="w" if first_write else "a",
                header=first_write,
                index=False,
                encoding="utf-8-sig",
            )
            first_write = False
            total_rows += len(combined)

            if progress_callback:
                progress_callback(
                    -1,
                    f"Объединение столбцов: обработано строк {total_rows:,}",
                )

        if first_write:
            # CSV может содержать заголовок, но не иметь строк.
            empty = pd.read_csv(
                source_path,
                encoding="utf-8-sig",
                sep=",",
                engine="c",
                nrows=0,
            )
            empty.columns = [str(c).strip() for c in empty.columns]
            combined_result = combine_columns(
                empty,
                columns,
                new_column,
                separator=separator,
                skip_empty=skip_empty,
            )
            combined_result.dataframe.to_csv(
                output_path,
                index=False,
                encoding="utf-8-sig",
            )

        preview = (
            pd.concat(preview_parts, ignore_index=True)
            if preview_parts
            else pd.read_csv(
                output_path,
                encoding="utf-8-sig",
                nrows=preview_rows,
            )
        )
        return output_path, preview, total_rows
    except Exception:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except OSError:
            pass
        raise


@dataclass(frozen=True)
class CoalesceRule:
    """Схлопывает несколько уже объединённых столбцов в один."""

    columns: list[str]
    new_column: str


@dataclass
class CoalesceRuleReport:
    new_column: str
    source_columns: list[str]
    conflict_column: str | None
    conflict_count: int
    fallback_count: int


@dataclass
class CoalesceResult:
    dataframe: pd.DataFrame
    rules: list[CoalesceRuleReport]


def _string_compare_series(series: pd.Series) -> pd.Series:
    """Возвращает строковое представление для сравнения и выбора значения.

    Пустые значения становятся NA. Значения сравниваются как есть после
    strip - автоматической смысловой нормализации намеренно нет: перед этой
    операцией пользователь должен при необходимости привести значения к
    стандартному виду во вкладке «Расшифровки».
    """
    result = series.astype("string").str.strip()
    return result.mask(result.eq(""), pd.NA)


def _next_free_column_name(existing, base_name: str) -> str:
    existing_set = {str(c) for c in existing}
    if base_name not in existing_set:
        return base_name
    index = 2
    while f"{base_name}_{index}" in existing_set:
        index += 1
    return f"{base_name}_{index}"


def coalesce_columns(
    dataframe: pd.DataFrame,
    rules: list[CoalesceRule],
) -> CoalesceResult:
    """Схлопывает дублирующуюся информацию из нескольких столбцов.

    Для каждой строки берётся первое непустое значение. Если несколько
    непустых значений различаются, они не затираются: создаётся отдельный
    столбец конфликтов с перечислением различных значений через `` | ``.
    При полном совпадении остаётся одно значение, при пустом + значении
    используется непустое значение.
    """
    if not rules:
        raise ValueError("Не задано ни одного правила объединения информации.")

    result = dataframe.copy()
    seen_sources: set[str] = set()
    reports: list[CoalesceRuleReport] = []

    for rule in rules:
        columns = [str(c) for c in rule.columns]
        new_column = str(rule.new_column).strip()

        if len(columns) < 2:
            raise ValueError("Для одного правила нужно выбрать минимум 2 столбца.")
        if len(set(columns)) != len(columns):
            raise ValueError("В одном правиле один и тот же столбец выбран несколько раз.")
        if any(column in seen_sources for column in columns):
            raise ValueError(
                "Один исходный столбец нельзя использовать в нескольких правилах "
                "одновременно."
            )
        missing = [column for column in columns if column not in result.columns]
        if missing:
            raise ValueError(
                "Не найдены столбцы для схлопывания: " + ", ".join(missing)
            )
        if not new_column:
            raise ValueError("Имя итогового столбца не может быть пустым.")

        remaining = [
            str(column) for column in result.columns if str(column) not in columns
        ]
        if new_column in remaining:
            raise ValueError(
                f"Столбец '{new_column}' уже существует среди сохраняемых столбцов."
            )

        parts = [_string_compare_series(result[column]) for column in columns]
        values = pd.concat(parts, axis=1)
        values.columns = range(len(parts))

        combined = values.bfill(axis=1).iloc[:, 0].astype("string")
        conflict_mask = values.nunique(axis=1, dropna=True).gt(1)
        conflict_values = pd.Series(pd.NA, index=result.index, dtype="string")

        if conflict_mask.any():
            conflict_values.loc[conflict_mask] = values.loc[conflict_mask].apply(
                lambda row: " | ".join(dict.fromkeys(
                    str(value) for value in row.tolist() if pd.notna(value)
                )),
                axis=1,
            )

        conflict_count = int(conflict_mask.sum())
        conflict_column = None
        if conflict_count > 0:
            conflict_column = _next_free_column_name(
                [*remaining, new_column],
                f"{new_column}_конфликт",
            )

        first_position = min(result.columns.get_loc(column) for column in columns)
        result = result.drop(columns=columns)
        result.insert(first_position, new_column, combined)
        if conflict_column is not None:
            result.insert(first_position + 1, conflict_column, conflict_values)

        fallback_count = int(
            (values.notna().sum(axis=1).eq(1)).sum()
        )
        reports.append(
            CoalesceRuleReport(
                new_column=new_column,
                source_columns=columns,
                conflict_column=conflict_column,
                conflict_count=conflict_count,
                fallback_count=fallback_count,
            )
        )
        seen_sources.update(columns)

    return CoalesceResult(dataframe=result, rules=reports)


def coalesce_columns_csv(
    source_path: str,
    rules: list[CoalesceRule],
    *,
    chunksize: int = 100_000,
    preview_rows: int = 1_000,
    progress_callback=None,
    is_cancelled=None,
) -> tuple[str, pd.DataFrame, int, list[CoalesceRuleReport]]:
    """Потоковое схлопывание столбцов в большом объединённом CSV.

    Выполняет два прохода: первый определяет, есть ли реальные конфликты,
    второй записывает итоговый CSV. Поэтому пустой столбец ``*_конфликт`` не
    создаётся, если конфликтов нет ни в одной строке всего файла.
    """
    if not rules:
        raise ValueError("Не задано ни одного правила объединения информации.")

    # Сначала определяем, какие правила действительно имеют конфликты во всём файле.
    conflict_rules = [False] * len(rules)
    total_rows = 0
    reader = pd.read_csv(
        source_path,
        encoding="utf-8-sig",
        sep=",",
        engine="c",
        chunksize=chunksize,
    )
    try:
        for chunk in reader:
            if is_cancelled and is_cancelled():
                raise InterruptedError("Операция отменена пользователем.")
            for index, rule in enumerate(rules):
                columns = [str(c) for c in rule.columns]
                missing = [column for column in columns if column not in chunk.columns]
                if missing:
                    raise ValueError(
                        "Не найдены столбцы для схлопывания: " + ", ".join(missing)
                    )
                values = pd.concat(
                    [_string_compare_series(chunk[column]) for column in columns],
                    axis=1,
                )
                conflict_mask = values.nunique(axis=1, dropna=True).gt(1)
                if bool(conflict_mask.any()):
                    conflict_rules[index] = True
            total_rows += len(chunk)
            if progress_callback:
                progress_callback(
                    -1,
                    f"Проверка конфликтов: просмотрено строк {total_rows:,}",
                )
    except Exception:
        raise

    temp_dir = tempfile.mkdtemp(prefix="data_analyzer_coalesce_")
    output_path = os.path.join(temp_dir, "coalesced.csv")
    first_write = True
    total_rows = 0
    preview_parts: list[pd.DataFrame] = []
    aggregate_reports: list[CoalesceRuleReport] | None = None

    try:
        reader = pd.read_csv(
            source_path,
            encoding="utf-8-sig",
            sep=",",
            engine="c",
            chunksize=chunksize,
        )
        for chunk in reader:
            if is_cancelled and is_cancelled():
                raise InterruptedError("Операция отменена пользователем.")

            # Применяем правила вручную с заранее известными conflict-columns,
            # чтобы схема CSV была одинаковой для всех chunks.
            current = chunk
            chunk_reports: list[CoalesceRuleReport] = []
            for index, rule in enumerate(rules):
                columns = [str(c) for c in rule.columns]
                new_column = str(rule.new_column).strip()
                parts = [_string_compare_series(current[column]) for column in columns]
                values = pd.concat(parts, axis=1)
                values.columns = range(len(parts))
                combined = values.bfill(axis=1).iloc[:, 0].astype("string")
                conflict_count = int(values.nunique(axis=1, dropna=True).gt(1).sum())
                fallback_count = int(values.notna().sum(axis=1).eq(1).sum())

                remaining = [
                    str(column) for column in current.columns
                    if str(column) not in columns
                ]
                conflict_column = None
                if conflict_rules[index]:
                    conflict_column = _next_free_column_name(
                        [*remaining, new_column],
                        f"{new_column}_конфликт",
                    )
                    conflict_values = pd.Series(pd.NA, index=current.index, dtype="string")
                    conflict_mask = values.nunique(axis=1, dropna=True).gt(1)
                    if conflict_count:
                        conflict_values.loc[conflict_mask] = values.loc[conflict_mask].apply(
                            lambda row: " | ".join(dict.fromkeys(
                                str(value) for value in row.tolist() if pd.notna(value)
                            )),
                            axis=1,
                        )

                first_position = min(current.columns.get_loc(column) for column in columns)
                current = current.drop(columns=columns)
                current.insert(first_position, new_column, combined)
                if conflict_column is not None:
                    current.insert(first_position + 1, conflict_column, conflict_values)

                chunk_reports.append(
                    CoalesceRuleReport(
                        new_column=new_column,
                        source_columns=columns,
                        conflict_column=conflict_column,
                        conflict_count=conflict_count,
                        fallback_count=fallback_count,
                    )
                )

            if aggregate_reports is None:
                aggregate_reports = [
                    CoalesceRuleReport(
                        new_column=report.new_column,
                        source_columns=list(report.source_columns),
                        conflict_column=report.conflict_column,
                        conflict_count=report.conflict_count,
                        fallback_count=report.fallback_count,
                    )
                    for report in chunk_reports
                ]
            else:
                for aggregate, report in zip(aggregate_reports, chunk_reports):
                    aggregate.conflict_count += report.conflict_count
                    aggregate.fallback_count += report.fallback_count

            if sum(len(part) for part in preview_parts) < preview_rows:
                remaining_preview = preview_rows - sum(len(part) for part in preview_parts)
                preview_parts.append(current.head(remaining_preview))

            current.to_csv(
                output_path,
                mode="w" if first_write else "a",
                header=first_write,
                index=False,
                encoding="utf-8-sig",
            )
            first_write = False
            total_rows += len(current)

            if progress_callback:
                progress_callback(
                    -1,
                    f"Схлопывание столбцов: обработано строк {total_rows:,}",
                )

        if first_write:
            empty = pd.read_csv(
                source_path,
                encoding="utf-8-sig",
                sep=",",
                engine="c",
                nrows=0,
            )
            current = empty
            aggregate_reports = []
            for index, rule in enumerate(rules):
                one_result = coalesce_columns(current, [rule])
                current = one_result.dataframe
                aggregate_reports.append(one_result.rules[0])
            current.to_csv(output_path, index=False, encoding="utf-8-sig")

        preview = (
            pd.concat(preview_parts, ignore_index=True)
            if preview_parts
            else pd.read_csv(output_path, encoding="utf-8-sig", nrows=preview_rows)
        )
        return output_path, preview, total_rows, (aggregate_reports or [])
    except Exception:
        try:
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        except OSError:
            pass
        raise
