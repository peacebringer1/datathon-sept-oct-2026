from dataclasses import dataclass
from typing import Iterable

import pandas as pd


@dataclass
class DuplicateReport:
    mode: str = "none"
    columns: list[str] | None = None
    found: int = 0
    removed: int = 0

    def __post_init__(self):
        if self.columns is None:
            self.columns = []


@dataclass
class ColumnDuplicateProfile:
    """Предварительная статистика дубликатов для одного столбца."""

    name: str
    non_empty_count: int
    duplicate_count: int
    duplicate_percent: float
    unique_count: int


def analyze_column_duplicates(
    dataframe: pd.DataFrame,
) -> list[ColumnDuplicateProfile]:
    """Считает повторные значения отдельно по каждому столбцу.

    Пустые значения не считаются дубликатами. Для значения, встретившегося
    один раз, duplicate_count = 0; для трёх одинаковых значений - 2.
    """
    result = []

    for column in dataframe.columns:
        series = dataframe[column]
        non_empty = series.dropna()
        non_empty_count = len(non_empty)
        unique_count = int(non_empty.nunique(dropna=True))
        duplicate_count = max(0, non_empty_count - unique_count)
        duplicate_percent = (
            duplicate_count / non_empty_count * 100
            if non_empty_count
            else 0.0
        )

        result.append(
            ColumnDuplicateProfile(
                name=str(column),
                non_empty_count=non_empty_count,
                duplicate_count=duplicate_count,
                duplicate_percent=duplicate_percent,
                unique_count=unique_count,
            )
        )

    return result


def remove_duplicates(
    dataframe: pd.DataFrame,
    mode: str = "none",
    columns: Iterable[str] | None = None,
) -> tuple[pd.DataFrame, DuplicateReport]:
    """Удаляет дубликаты из DataFrame.

    mode:
      - none: ничего не делать;
      - all: сравнивать все столбцы;
      - selected: сравнивать только выбранные столбцы.

    Сохраняется первое вхождение каждой строки.
    """
    if mode == "none":
        return dataframe, DuplicateReport(mode="none")

    if mode == "all":
        subset = None
        selected = list(dataframe.columns)
    elif mode == "selected":
        selected = list(columns or [])
        missing = [c for c in selected if c not in dataframe.columns]
        if missing:
            raise ValueError(
                "Не найдены столбцы для поиска дубликатов: "
                + ", ".join(map(str, missing))
            )
        if not selected:
            raise ValueError(
                "Для поиска дубликатов по выбранным столбцам "
                "нужно выбрать хотя бы один столбец."
            )
        subset = selected
    else:
        raise ValueError(f"Неизвестный режим дубликатов: {mode}")

    mask = dataframe.duplicated(subset=subset, keep="first")
    found = int(mask.sum())

    if found == 0:
        return dataframe, DuplicateReport(
            mode=mode,
            columns=selected,
            found=0,
            removed=0,
        )

    result = dataframe.loc[~mask].copy()
    return result, DuplicateReport(
        mode=mode,
        columns=selected,
        found=found,
        removed=found,
    )
