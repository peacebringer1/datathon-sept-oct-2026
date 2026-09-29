
from dataclasses import dataclass, field
import os
import tempfile

import pandas as pd

from core.loader import iter_csv_chunks
from core.text_utils import to_numeric_safe


HOW_LABELS = {
    "inner": "внутреннее соединение (только совпадающие)",
    "left": "левое соединение",
    "outer": "полное соединение (все строки из всех)",
}

LARGE_BASE_HOW_LABELS = {
    k: v for k, v in HOW_LABELS.items() if k != "outer"
}

PREVIEW_ROWS = 1_000


@dataclass
class ColumnOverlap:
    column: str
    unique_per_dataset: list[int]
    common_values: int
    overlap_ratio: float  # 0..1: |пересечение| / |объединение| уникальных значений


@dataclass
class JoinRelation:
    dataset_index: int
    base_column: str
    other_column: str
    how: str = "inner"


@dataclass
class MergeReport:
    base_name: str
    dataset_names: list[str]  # присоединённые датасеты, в порядке связей
    relation_descriptions: list[str]
    row_count_before: int  # строк в базовом датасете
    row_count_after: int
    unmatched_counts: list[int] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class LargeMergeResult:
    output_path: str
    preview: pd.DataFrame
    report: MergeReport


def common_columns(dataframes: list[pd.DataFrame]) -> list[str]:
    if not dataframes:
        return []

    common = set(dataframes[0].columns)
    for df in dataframes[1:]:
        common &= set(df.columns)

    return [c for c in dataframes[0].columns if c in common]


def _decide_harmonization(left: pd.Series, right: pd.Series) -> str:
    if left.dtype == right.dtype:
        return "as_is"

    left_numeric = to_numeric_safe(left)
    right_numeric = to_numeric_safe(right)
    left_ok = (left_numeric.isna() == left.isna()).all()
    right_ok = (right_numeric.isna() == right.isna()).all()

    if left_ok and right_ok:
        return "numeric"

    return "text"


def _apply_harmonization(series: pd.Series, mode: str) -> pd.Series:
    if mode == "numeric":
        return to_numeric_safe(series)
    if mode == "text":
        return series.astype(str).str.strip().mask(series.isna())
    return series


def _harmonization_note(mode: str) -> str | None:
    if mode == "numeric":
        return "разные типы столбца - приведены к числу для сравнения"
    if mode == "text":
        return "разные типы столбца - приведены к тексту для сравнения"
    return None


def _harmonize_pair(
    left: pd.Series,
    right: pd.Series,
) -> tuple[pd.Series, pd.Series, str | None]:
    mode = _decide_harmonization(left, right)
    return (
        _apply_harmonization(left, mode),
        _apply_harmonization(right, mode),
        _harmonization_note(mode),
    )


def _join_chunk_with_other(
    left_df: pd.DataFrame,
    other_df: pd.DataFrame,
    other_name: str,
    relation: JoinRelation,
    mode: str,
) -> pd.DataFrame:
    left_key = _apply_harmonization(left_df[relation.base_column], mode)
    right_key = _apply_harmonization(other_df[relation.other_column], mode)

    left_work = left_df.copy()
    left_work["__join_key__"] = left_key
    right_work = other_df.copy()
    right_work["__join_key__"] = right_key

    suffix = f"_{other_name}"
    merged = left_work.merge(
        right_work,
        on="__join_key__",
        how=relation.how,
        suffixes=("", suffix),
    )
    return merged.drop(columns="__join_key__")


def column_pair_overlap(
    left: pd.Series,
    right: pd.Series,
) -> ColumnOverlap:
    left_h, right_h, _ = _harmonize_pair(left, right)

    left_values = set(left_h.dropna().unique())
    right_values = set(right_h.dropna().unique())

    intersection = left_values & right_values
    union = left_values | right_values
    overlap_ratio = len(intersection) / len(union) if union else 0.0

    return ColumnOverlap(
        column=f"{left.name} / {right.name}",
        unique_per_dataset=[len(left_values), len(right_values)],
        common_values=len(intersection),
        overlap_ratio=overlap_ratio,
    )


def merge_datasets(
    dataframes: list[pd.DataFrame],
    names: list[str],
    base_index: int,
    relations: list[JoinRelation],
) -> tuple[pd.DataFrame, MergeReport]:
    if not relations:
        raise ValueError("Нужна хотя бы одна связь между датасетами.")

    base_name = names[base_index]
    base = dataframes[base_index]

    missing = []
    for rel in relations:
        if rel.base_column not in base.columns:
            missing.append(f"{base_name}.{rel.base_column}")
        other = dataframes[rel.dataset_index]
        if rel.other_column not in other.columns:
            missing.append(
                f"{names[rel.dataset_index]}.{rel.other_column}"
            )
    if missing:
        raise ValueError(
            "Не найдены столбцы для связи: " + ", ".join(missing)
        )

    result = base.copy()
    dataset_names: list[str] = []
    relation_descriptions: list[str] = []
    unmatched_counts: list[int] = []
    notes: list[str] = []

    for rel in relations:
        other = dataframes[rel.dataset_index]
        other_name = names[rel.dataset_index]
        dataset_names.append(other_name)

        mode = _decide_harmonization(result[rel.base_column], other[rel.other_column])
        note = _harmonization_note(mode)
        if note:
            notes.append(
                f"{base_name}.{rel.base_column} = "
                f"{other_name}.{rel.other_column}: {note}"
            )

        base_values = set(
            _apply_harmonization(result[rel.base_column], mode).dropna().unique()
        )
        other_values = set(
            _apply_harmonization(other[rel.other_column], mode).dropna().unique()
        )
        unmatched_counts.append(len(other_values - base_values))

        result = _join_chunk_with_other(result, other, other_name, rel, mode)

        relation_descriptions.append(
            f"{base_name}.{rel.base_column} = {other_name}.{rel.other_column} "
            f"({HOW_LABELS.get(rel.how, rel.how)})"
        )

    report = MergeReport(
        base_name=base_name,
        dataset_names=dataset_names,
        relation_descriptions=relation_descriptions,
        row_count_before=len(base),
        row_count_after=len(result),
        unmatched_counts=unmatched_counts,
        notes=notes,
    )

    return result, report


def merge_large_base(
    base_csv_path: str,
    base_name: str,
    base_preview: pd.DataFrame,
    other_dataframes: list[pd.DataFrame],
    other_names: list[str],
    relations: list[JoinRelation],
    *,
    chunksize: int = 100_000,
    progress_callback=None,
    is_cancelled=None,
) -> LargeMergeResult:
    for rel in relations:
        if rel.how == "outer":
            raise ValueError(
                "Для большого базового датасета поддерживаются только "
                "типы объединения 'внутреннее' и 'левое соединение', "
                "'полное соединение' недоступен, "
                "когда базовый датасет обрабатывается потоково."
            )

    missing = []
    for rel in relations:
        other = other_dataframes[rel.dataset_index]
        other_name = other_names[rel.dataset_index]
        if rel.base_column not in base_preview.columns:
            missing.append(f"{base_name}.{rel.base_column}")
        if rel.other_column not in other.columns:
            missing.append(f"{other_name}.{rel.other_column}")
    if missing:
        raise ValueError(
            "Не найдены столбцы для связи: " + ", ".join(missing)
        )

    # Решаем способ сравнения ОДИН раз, по предпросмотру базового
    # датасета - и применяем его одинаково ко всем блокам файла.
    modes = [
        _decide_harmonization(
            base_preview[rel.base_column],
            other_dataframes[rel.dataset_index][rel.other_column],
        )
        for rel in relations
    ]

    notes: list[str] = []
    for rel, mode in zip(relations, modes):
        note = _harmonization_note(mode)
        if note:
            other_name = other_names[rel.dataset_index]
            notes.append(
                f"{base_name}.{rel.base_column} = "
                f"{other_name}.{rel.other_column}: {note}"
            )
    other_key_sets = [
        set(
            _apply_harmonization(
                other_dataframes[rel.dataset_index][rel.other_column], mode
            ).dropna().unique()
        )
        for rel, mode in zip(relations, modes)
    ]
    matched_other_keys = [set() for _ in relations]

    fd, output_path = tempfile.mkstemp(suffix="_merged.csv")
    os.close(fd)

    row_count_before = 0
    row_count_after = 0
    first_write = True
    preview_parts: list[pd.DataFrame] = []
    preview_rows = 0
    chunks_processed = 0

    try:
        for chunk, _encoding, _separator in iter_csv_chunks(
            base_csv_path, chunksize=chunksize
        ):
            if is_cancelled is not None and is_cancelled():
                raise InterruptedError("Операция отменена пользователем.")

            row_count_before += len(chunk)
            result_chunk = chunk

            for rel, mode, other_keys_all, matched in zip(
                relations, modes, other_key_sets, matched_other_keys
            ):
                other_df = other_dataframes[rel.dataset_index]
                other_name = other_names[rel.dataset_index]

                left_key = _apply_harmonization(
                    result_chunk[rel.base_column], mode
                )
                matched.update(other_keys_all & set(left_key.dropna().unique()))

                result_chunk = _join_chunk_with_other(
                    result_chunk, other_df, other_name, rel, mode
                )

            row_count_after += len(result_chunk)

            result_chunk.to_csv(
                output_path,
                mode="w" if first_write else "a",
                header=first_write,
                index=False,
                encoding="utf-8-sig",
            )
            first_write = False

            if preview_rows < PREVIEW_ROWS:
                part = result_chunk.head(PREVIEW_ROWS - preview_rows)
                preview_parts.append(part)
                preview_rows += len(part)

            chunks_processed += 1
            if progress_callback is not None:
                percent = min(99, 5 + chunks_processed % 95)
                progress_callback(
                    percent,
                    f"Объединение: обработано блоков {chunks_processed}, "
                    f"строк {row_count_before:,}",
                )
    except Exception:
        try:
            os.remove(output_path)
        except OSError:
            pass
        raise

    unmatched_counts = [
        len(all_keys - matched)
        for all_keys, matched in zip(other_key_sets, matched_other_keys)
    ]

    relation_descriptions = [
        f"{base_name}.{rel.base_column} = "
        f"{other_names[rel.dataset_index]}.{rel.other_column} "
        f"({HOW_LABELS.get(rel.how, rel.how)})"
        for rel in relations
    ]

    preview = (
        pd.concat(preview_parts, ignore_index=True)
        if preview_parts
        else pd.DataFrame()
    )

    report = MergeReport(
        base_name=base_name,
        dataset_names=[other_names[rel.dataset_index] for rel in relations],
        relation_descriptions=relation_descriptions,
        row_count_before=row_count_before,
        row_count_after=row_count_after,
        unmatched_counts=unmatched_counts,
        notes=notes,
    )

    return LargeMergeResult(output_path=output_path, preview=preview, report=report)
