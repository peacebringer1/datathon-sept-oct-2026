from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from core.duplicates import DuplicateReport, remove_duplicates
from core.profiler import DatasetProfile, _detect_column_type, profile_dataset
from core.text_utils import to_datetime_safe, to_numeric_safe
from core.decodings import DecodingRule, apply_decoding_rules


MISSING_MARKERS = {
    "", "nan", "none", "null", "n/a", "na", "-", "--",
    "н/д", "нд", "нет данных", "не указано", "unknown", "?",
}


@dataclass
class CleaningOptions:
    """Настройки пользовательской очистки."""

    missing_mode: str = "drop_all"
    # Пользовательские расшифровки применяются после удаления дубликатов.
    decoding_rules: list[DecodingRule] = field(default_factory=list)
    fill_value: str = "Не указано"
    duplicate_mode: str = "none"
    duplicate_columns: list[str] = field(default_factory=list)
    drop_empty_columns: bool = True


@dataclass
class ColumnCleaningResult:
    name: str
    original_type: str
    action: str
    details: str = ""


@dataclass
class CleaningReport:
    empty_rows_removed: int
    empty_columns_removed: list[str] = field(default_factory=list)
    pre_duplicate_profile: DatasetProfile | None = None
    columns: list[ColumnCleaningResult] = field(default_factory=list)
    duplicate_report: DuplicateReport = field(
        default_factory=DuplicateReport
    )
    missing_mode: str = "drop_all"
    decoding_changes: dict[str, int] = field(default_factory=dict)

    @property
    def changed_columns(self) -> list[ColumnCleaningResult]:
        return [c for c in self.columns if c.action != "no_change"]

    @property
    def has_changes(self) -> bool:
        return bool(
            self.empty_rows_removed
            or self.empty_columns_removed
            or self.changed_columns
            or self.duplicate_report.removed
            or bool(self.decoding_changes)
        )


def clean_dataset(
    dataframe: pd.DataFrame,
    options: CleaningOptions | None = None,
    *,
    compute_profile: bool = True,
    column_type_overrides: dict[str, str] | None = None,
) -> tuple[pd.DataFrame, DatasetProfile | None, CleaningReport]:
    """Очищает датафрейм.

    compute_profile=False пропускает построение полного DatasetProfile
    (уникальные значения, статистика дубликатов и т.д. по каждому столбцу)
    на промежуточных шагах и оставляет только лёгкое определение ТИПА
    столбца, нужное для приведения типов. Используется при обработке
    chunks большого CSV в core/large_file.py, где полный профиль чанка
    всё равно выбрасывается вызывающим кодом (профиль строится один раз
    по итоговой выборке в _build_large_column_profiles) - раньше он
    считался там впустую три раза на каждый chunk."""
    options = options or CleaningOptions()
    df = dataframe.copy()

    # 1. Текстовые обозначения пропусков -> настоящий NaN.
    for column in df.columns:
        if _is_textual_dtype(df[column]):
            df[column] = df[column].map(_normalize_missing)

    # 2. Полностью пустые столбцы - убираем совсем.
    empty_columns = [
        column for column in df.columns if df[column].isna().all()
    ]
    if empty_columns and options.drop_empty_columns:
        df = df.drop(columns=empty_columns)
    elif not options.drop_empty_columns:
        empty_columns = []

    # 3. Обработка пустых строк по выбранной пользователем стратегии.
    empty_rows_removed = 0
    if options.missing_mode == "drop_all":
        rows_before = len(df)
        df = df.dropna(how="all")
        empty_rows_removed = rows_before - len(df)
    elif options.missing_mode == "drop_any":
        rows_before = len(df)
        df = df.dropna(how="any")
        empty_rows_removed = rows_before - len(df)
    elif options.missing_mode == "keep":
        pass
    elif options.missing_mode in {
        "fill_zero", "fill_mean", "fill_median", "fill_mode", "fill_value"
    }:
        df = _fill_missing_values(df, options)
    else:
        raise ValueError(
            f"Неизвестный режим обработки пустых ячеек: "
            f"{options.missing_mode}"
        )

    # 4. Для приведения типов нужен только data_type каждого столбца.
    # Полный профиль (уникальные значения, дубликаты, min/max и т.д.)
    # здесь не нужен - его при необходимости считаем один раз в конце.
    if column_type_overrides is not None:
        detected = {
            str(column): _detect_column_type(df[column])
            for column in df.columns
        }
        type_by_column = {
            str(column): column_type_overrides.get(
                str(column), detected[str(column)]
            )
            for column in df.columns
        }
    elif compute_profile:
        type_profile = profile_dataset(df)
        type_by_column = {c.name: c.data_type for c in type_profile.columns}
    else:
        type_by_column = {
            str(column): _detect_column_type(df[column])
            for column in df.columns
        }

    # 5. Приведение типов.
    column_results: list[ColumnCleaningResult] = []

    for column in df.columns:
        original_type = type_by_column.get(column, "Неизвестно")

        if not _is_textual_dtype(df[column]):
            column_results.append(
                ColumnCleaningResult(column, original_type, "no_change")
            )
            continue

        if original_type == "Числовой":
            column_results.append(
                _convert_column(
                    df, column, original_type,
                    action="converted_numeric",
                    converter=to_numeric_safe,
                    failure_noun="число",
                )
            )
        elif original_type == "Дата/время":
            column_results.append(
                _convert_column(
                    df, column, original_type,
                    action="converted_datetime",
                    converter=to_datetime_safe,
                    failure_noun="дату",
                )
            )
        else:
            column_results.append(
                _trim_text_column(df, column, original_type)
            )

    # 6. Сохраняем предварительный профиль ДО удаления дубликатов.
    # Именно его GUI использует для анализа повторов по отдельным столбцам.
    pre_duplicate_profile = (
        profile_dataset(df, type_overrides=type_by_column)
        if compute_profile
        else None
    )

    # 7. Дубликаты применяются после нормализации значений.
    df, duplicate_report = remove_duplicates(
        df,
        mode=options.duplicate_mode,
        columns=options.duplicate_columns,
    )

    # 8. Пользовательские расшифровки применяются к фактическим данным
    # после удаления дубликатов, чтобы они не меняли критерий дедупликации.
    decoding_changes: dict[str, int] = {}
    if options.decoding_rules:
        df, decoding_changes = apply_decoding_rules(
            df, options.decoding_rules
        )

    final_type_by_column = dict(type_by_column)
    for column in decoding_changes:
        # После замены кодов на поясняющий текст такой столбец по смыслу
        # является категориальным, даже если до замены был числовым.
        final_type_by_column[column] = "Категориальный"

    # Итоговый профиль соответствует данным, которые пользователь видит.
    profile = (
        profile_dataset(df, type_overrides=final_type_by_column)
        if compute_profile
        else None
    )

    report = CleaningReport(
        empty_rows_removed=empty_rows_removed,
        empty_columns_removed=empty_columns,
        pre_duplicate_profile=pre_duplicate_profile,
        columns=column_results,
        duplicate_report=duplicate_report,
        missing_mode=options.missing_mode,
        decoding_changes=decoding_changes,
    )

    return df, profile, report


def _fill_missing_values(
    df: pd.DataFrame,
    options: CleaningOptions,
) -> pd.DataFrame:
    result = df.copy()

    for column in result.columns:
        series = result[column]
        if not series.isna().any():
            continue

        if pd.api.types.is_numeric_dtype(series):
            if options.missing_mode == "fill_zero":
                value = 0
            elif options.missing_mode == "fill_mean":
                value = series.mean()
            elif options.missing_mode == "fill_median":
                value = series.median()
            elif options.missing_mode == "fill_mode":
                modes = series.mode(dropna=True)
                value = modes.iloc[0] if not modes.empty else 0
            else:
                # Для числового столбца пользовательское текстовое
                # значение обычно некорректно, поэтому не подменяем тип.
                continue
            result[column] = series.fillna(value)

        elif pd.api.types.is_datetime64_any_dtype(series):
            if options.missing_mode == "fill_value":
                converted = to_datetime_safe(
                    pd.Series([options.fill_value])
                ).iloc[0]
                if pd.notna(converted):
                    result[column] = series.fillna(converted)

        else:
            if options.missing_mode == "fill_mode":
                modes = series.mode(dropna=True)
                value = str(modes.iloc[0]) if not modes.empty else options.fill_value
            else:
                value = options.fill_value
            result[column] = series.fillna(value)

    return result


def _is_textual_dtype(series: pd.Series) -> bool:
    if pd.api.types.is_numeric_dtype(series):
        return False
    if pd.api.types.is_datetime64_any_dtype(series):
        return False
    if pd.api.types.is_bool_dtype(series):
        return False
    return True


def _normalize_missing(value):
    if pd.isna(value):
        return value

    text = str(value).strip()
    if text.lower() in MISSING_MARKERS:
        return np.nan

    return value


def _convert_column(
    df: pd.DataFrame,
    column: str,
    original_type: str,
    action: str,
    converter,
    failure_noun: str,
) -> ColumnCleaningResult:
    raw = df[column]
    converted = converter(raw)

    failed_mask = converted.isna() & raw.notna()
    failed_count = int(failed_mask.sum())

    df[column] = converted

    details = (
        f"не удалось преобразовать {failed_count} значений в {failure_noun}"
        if failed_count
        else ""
    )
    return ColumnCleaningResult(column, original_type, action, details)


def _trim_text_column(
    df: pd.DataFrame,
    column: str,
    original_type: str,
) -> ColumnCleaningResult:
    raw = df[column]
    trimmed = raw.where(raw.isna(), raw.astype(str).str.strip())

    changed_count = int(
        ((trimmed != raw) & raw.notna()).sum()
    )

    df[column] = trimmed

    details = (
        f"обрезаны пробелы в {changed_count} значениях"
        if changed_count
        else ""
    )
    return ColumnCleaningResult(column, original_type, "trimmed_text", details)
