from dataclasses import dataclass
from typing import Any

import pandas as pd

from core.text_utils import to_datetime_safe, to_numeric_safe
from core.duplicates import ColumnDuplicateProfile, analyze_column_duplicates


@dataclass
class ColumnProfile:
    name: str
    data_type: str
    total_count: int
    missing_count: int
    missing_percent: float
    non_empty_count: int
    unique_count: int
    duplicate_count: int
    duplicate_percent: float
    min_value: Any = None
    max_value: Any = None
    mean_value: float | None = None
    median_value: float | None = None
    top_values: list[tuple[str, int]] | None = None


@dataclass
class DatasetProfile:
    row_count: int
    column_count: int
    duplicate_count: int
    numeric_columns: int
    categorical_columns: int
    datetime_columns: int
    text_columns: int
    missing_values: int
    columns: list[ColumnProfile]
    duplicate_analysis_scope: str = "весь датасет"
    profile_scope: str = "итоговые данные"


def profile_dataset(
    dataframe: pd.DataFrame,
    type_overrides: dict[str, str] | None = None,
) -> DatasetProfile:
    column_profiles = []

    duplicate_stats = {
        item.name: item
        for item in analyze_column_duplicates(dataframe)
    }

    for column in dataframe.columns:
        series = dataframe[column]

        column_profile = _profile_column(
            series,
            str(column),
            duplicate_stats.get(str(column)),
            type_override=(
                type_overrides.get(str(column))
                if type_overrides is not None
                else None
            ),
        )

        column_profiles.append(column_profile)

    return DatasetProfile(
        row_count=len(dataframe),
        column_count=len(dataframe.columns),
        duplicate_count=int(dataframe.duplicated().sum()),
        numeric_columns=sum(
            profile.data_type == "Числовой"
            for profile in column_profiles
        ),
        categorical_columns=sum(
            profile.data_type == "Категориальный"
            for profile in column_profiles
        ),
        datetime_columns=sum(
            profile.data_type == "Дата/время"
            for profile in column_profiles
        ),
        text_columns=sum(
            profile.data_type == "Текст"
            for profile in column_profiles
        ),
        missing_values=int(
            dataframe.isna().sum().sum()
        ),
        columns=column_profiles,
        duplicate_analysis_scope="весь датасет",
    )


def _profile_column(
    series: pd.Series,
    column_name: str,
    duplicate_stats: ColumnDuplicateProfile | None = None,
    type_override: str | None = None,
) -> ColumnProfile:
    total_count = len(series)
    missing_count = int(series.isna().sum())

    if total_count > 0:
        missing_percent = (
            missing_count / total_count * 100
        )
    else:
        missing_percent = 0.0

    unique_count = int(series.nunique(dropna=True))
    non_empty_count = total_count - missing_count
    duplicate_count = (
        duplicate_stats.duplicate_count
        if duplicate_stats is not None
        else max(0, non_empty_count - unique_count)
    )
    duplicate_percent = (
        duplicate_count / non_empty_count * 100
        if non_empty_count
        else 0.0
    )

    data_type = type_override or _detect_column_type(series)

    profile = ColumnProfile(
        name=column_name,
        data_type=data_type,
        total_count=total_count,
        missing_count=missing_count,
        missing_percent=missing_percent,
        non_empty_count=non_empty_count,
        unique_count=unique_count,
        duplicate_count=duplicate_count,
        duplicate_percent=duplicate_percent,
    )

    if data_type == "Числовой":
        numeric_series = to_numeric_safe(series).dropna()

        if not numeric_series.empty:
            profile.min_value = numeric_series.min()
            profile.max_value = numeric_series.max()
            profile.mean_value = float(
                numeric_series.mean()
            )
            profile.median_value = float(
                numeric_series.median()
            )

    elif data_type == "Дата/время":
        datetime_series = to_datetime_safe(series).dropna()

        if not datetime_series.empty:
            profile.min_value = datetime_series.min()
            profile.max_value = datetime_series.max()

    elif data_type == "Категориальный":
        profile.top_values = _get_top_values(
            series,
            limit=5,
        )

    return profile


def _detect_column_type(
    series: pd.Series,
) -> str:
    non_null = series.dropna()

    if non_null.empty:
        return "Текст"

    if pd.api.types.is_numeric_dtype(series):
        return "Числовой"

    if pd.api.types.is_datetime64_any_dtype(series):
        return "Дата/время"

    if _looks_like_datetime(non_null):
        return "Дата/время"

    if _looks_like_numeric(non_null):
        return "Числовой"

    unique_count = non_null.nunique()

    # Небольшое количество повторяющихся значений
    # обычно указывает на категориальный признак.
    if unique_count <= min(
        50,
        max(10, int(len(non_null) * 0.05)),
    ):
        return "Категориальный"

    return "Текст"


def _looks_like_datetime(
    series: pd.Series,
) -> bool:
    if series.empty:
        return False

    # Проверяем только ограниченную выборку,
    # чтобы не выполнять дорогое преобразование
    # для каждого значения огромного столбца.
    sample = series.astype(str).head(1000)

    converted = to_datetime_safe(sample)

    valid_ratio = converted.notna().mean()

    return valid_ratio >= 0.8


def _looks_like_numeric(
    series: pd.Series,
) -> bool:
    """Текстовый столбец с числами, записанными как строки (например,
    "1000,5" с запятой вместо точки, или "12 345" с пробелом как
    разделителем тысяч). Без этой проверки такие столбцы при небольшом
    количестве уникальных значений ошибочно попадали в "Категориальный"
    вместо "Числовой", и дальше не проходили приведение типов.
    """
    if series.empty:
        return False

    converted = to_numeric_safe(series.head(1000))

    valid_ratio = converted.notna().mean()

    return valid_ratio >= 0.8


def _get_top_values(
    series: pd.Series,
    limit: int = 5,
) -> list[tuple[str, int]]:
    counts = (
        series
        .dropna()
        .astype(str)
        .value_counts()
        .head(limit)
    )

    return [
        (str(value), int(count))
        for value, count in counts.items()
    ]