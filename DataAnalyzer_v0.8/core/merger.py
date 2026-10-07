"""
Объединение нескольких уже очищенных датасетов.

Модель - как связи между таблицами в конструкторе запросов 1С:
есть один БАЗОВЫЙ датасет (левая часть), и к нему по отдельности
присоединяются остальные датасеты, каждый - по СВОЕЙ паре столбцов
(имена столбцов у датасетов могут отличаться - это не обязано быть
одно и то же имя во всех файлах) и со своим типом объединения.

Отдельная причина держать этот модуль отдельно от GUI: столбцы для
связи каждый датасет получает своё имя И свой тип независимо друг от
друга (при очистке каждый файл обрабатывается сам по себе). Из-за
этого один и тот же по смыслу ключ может в одном файле остаться
текстом, а в другом стать числом - наивный pd.merge на таких столбцах
падает с ValueError. _harmonize_pair() ниже приводит такие столбцы
к сравнимому виду вместо падения, и явно фиксирует это в отчёте -
недостаточно молча всё "исправить", пользователь должен видеть, что
типы отличались.
"""

from dataclasses import dataclass, field
import os
import tempfile

import pandas as pd

from core.loader import iter_csv_chunks
from core.text_utils import to_numeric_safe


HOW_LABELS = {
    "inner": "Внутреннее (INNER JOIN)",
    "left": "Левое (LEFT JOIN)",
    "right": "Правое (RIGHT JOIN)",
    "outer": "Полное (FULL OUTER JOIN)",
}

# Для потокового объединения (большой базовый датасет) поддерживаются
# только inner/left - см. docstring merge_large_base() почему outer
# сюда сознательно не включён.
LARGE_BASE_HOW_LABELS = {
    "inner": HOW_LABELS["inner"],
    "left": HOW_LABELS["left"],
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
    """Одна связь: столбец базового датасета <-> столбец другого датасета."""

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
    # Итоговый столбец -> исходный источник. Нужен для последующей
    # оптимизации дублирующихся столбцов после JOIN.
    column_origins: dict[str, str] = field(default_factory=dict)
    # unmatched_counts[i] - сколько РАЗЛИЧНЫХ значений ключа из
    # dataset_names[i] не нашлись среди значений ключа базового датасета
    unmatched_counts: list[int] = field(default_factory=list)
    # notes - предупреждения о приведении типов столбцов связи и т.п.,
    # чтобы такие решения не принимались молча (см. docstring модуля).
    notes: list[str] = field(default_factory=list)
    cardinality: list["JoinCardinalityStats"] = field(default_factory=list)


@dataclass
class JoinCardinalityStats:
    """Статистика кардинальности одной составной связи."""

    dataset_name: str
    relation_description: str
    base_rows: int
    other_rows: int
    base_unique_keys: int
    other_unique_keys: int
    base_duplicate_rows: int
    other_duplicate_rows: int
    matched_keys: int
    many_to_many_keys: int
    max_base_multiplicity: int
    max_other_multiplicity: int
    estimated_rows: int

    @property
    def cardinality(self) -> str:
        if self.many_to_many_keys > 0:
            return "N:M"
        if self.base_duplicate_rows > 0 and self.matched_keys > 0:
            return "N:1"
        if self.other_duplicate_rows > 0 and self.matched_keys > 0:
            return "1:N"
        return "1:1"


@dataclass
class LargeMergeResult:
    """Результат потокового объединения, где базовый датасет - большой
    файл. Как и в core/large_file.py, полный результат пишется во
    временный CSV на диске (output_path), а в память возвращается
    только предпросмотр и агрегированный отчёт."""

    output_path: str
    preview: pd.DataFrame
    report: MergeReport


def _update_column_origins(
    origins: dict[str, str],
    current_columns,
    other_columns,
    other_name: str,
) -> dict[str, str]:
    """Добавляет к карте происхождения столбцы очередного датасета.

    Имена строятся тем же алгоритмом, что и в `_join_chunk_with_other`,
    поэтому UI может однозначно показать источник каждого итогового столбца.
    """
    result = dict(origins)
    left_names = {str(c) for c in current_columns}
    used_names = set(left_names)
    suffix = f"_{other_name}"

    for column in other_columns:
        column = str(column)
        output = column
        if output in left_names:
            output = f"{column}{suffix}"
        if output in used_names:
            base_output = output
            counter = 2
            while f"{base_output}_{counter}" in used_names:
                counter += 1
            output = f"{base_output}_{counter}"
        used_names.add(output)
        result[output] = f"{other_name}.{column}"
    return result


def common_columns(dataframes: list[pd.DataFrame]) -> list[str]:
    """Столбцы, чьи ИМЕНА присутствуют во всех датасетах (в порядке
    первого датасета). Используется только как подсказка при выборе
    "одинаковых" пар столбцов в интерфейсе - сама связь может быть
    задана и по столбцам с разными именами.
    """
    if not dataframes:
        return []

    common = set(dataframes[0].columns)
    for df in dataframes[1:]:
        common &= set(df.columns)

    return [c for c in dataframes[0].columns if c in common]


def _decide_harmonization(left: pd.Series, right: pd.Series) -> str:
    """Решает, как сравнивать пару столбцов связи, если их типы
    отличаются: 'as_is' (типы совпадают), 'numeric' или 'text'.

    Вынесено отдельно от применения (_apply_harmonization), чтобы для
    потокового объединения (merge_large_base) решение принималось ОДИН
    раз - по предпросмотру базового датасета - и одинаково применялось
    ко всем chunks, а не пересчитывалось на каждом chunk заново.
    """
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
    """Приводит пару столбцов связи к сравнимому виду, если их типы
    отличаются (частый случай, если файлы очищались независимо и в
    одном столбец распознался как числовой, а в другом - как текст
    из-за пары "мусорных" значений).

    Сначала пробуем оба привести к числу (как это уже делает
    core.text_utils.to_numeric_safe при обычной очистке) - если это не
    теряет ни одного непустого значения ни с одной стороны, используем
    числовое сравнение. Если нет - приводим обе стороны к обрезанному
    тексту: это всегда работает и никогда не падает с ошибкой типов.
    """
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
    relations: list[JoinRelation],
    modes: list[str],
    how: str,
) -> pd.DataFrame:
    """Присоединяет один датасет по составному ключу.

    Каждая связь в relations задаёт одну пару столбцов. Несколько связей
    для одного dataset_index объединяются в один pandas merge по
    нескольким временным ключам - именно это даёт AND-семантику:
    A.x = B.x И A.y = B.y.
    """
    if len(relations) != len(modes):
        raise ValueError("Количество способов приведения типов не совпадает с условиями связи.")

    left_work = left_df.copy()
    right_work = other_df.copy()
    join_columns: list[str] = []

    for index, (rel, mode) in enumerate(zip(relations, modes)):
        temp_key = f"__join_key_{index}__"
        left_work[temp_key] = _apply_harmonization(
            left_df[rel.base_column], mode
        )
        right_work[temp_key] = _apply_harmonization(
            other_df[rel.other_column], mode
        )
        join_columns.append(temp_key)

    suffix = f"_{other_name}"
    # Явно делаем имена столбцов правой стороны уникальными до merge.
    # pandas при suffixes может оставить дублирующиеся имена, если
    # сгенерированный suffix уже существует в левой таблице. Для последующей
    # оптимизации столбцов нужен однозначный источник каждого результата.
    join_set = set(join_columns)
    left_names = {str(c) for c in left_work.columns if str(c) not in join_set}
    used_names = set(str(c) for c in left_work.columns)
    rename_map: dict[str, str] = {}
    for column in list(right_work.columns):
        column = str(column)
        if column in join_set:
            continue
        output = column
        if output in left_names:
            output = f"{column}{suffix}"
        if output in used_names or output in rename_map.values():
            base_output = output
            counter = 2
            while (
                f"{base_output}_{counter}" in used_names
                or f"{base_output}_{counter}" in rename_map.values()
            ):
                counter += 1
            output = f"{base_output}_{counter}"
        rename_map[column] = output
        used_names.add(output)

    if rename_map:
        right_work = right_work.rename(columns=rename_map)

    merged = left_work.merge(
        right_work,
        on=join_columns,
        how=how,
        suffixes=("", ""),
    )
    return merged.drop(columns=join_columns)


def _group_relations(relations: list[JoinRelation]):
    """Группирует условия по присоединяемому датасету, сохраняя порядок."""
    groups: list[list[JoinRelation]] = []
    positions: dict[int, int] = {}
    for relation in relations:
        position = positions.get(relation.dataset_index)
        if position is None:
            positions[relation.dataset_index] = len(groups)
            groups.append([relation])
        else:
            groups[position].append(relation)
    return groups


def _composite_key_counts(
    series_list: list[pd.Series],
    modes: list[str],
) -> dict[tuple, int]:
    """Возвращает количество строк для каждого составного ключа без NaN."""
    if not series_list or len(series_list) != len(modes):
        return {}

    key_frame = pd.DataFrame({
        f"k{i}": _apply_harmonization(series, mode)
        for i, (series, mode) in enumerate(zip(series_list, modes))
    })
    key_frame = key_frame.dropna(how="any")
    if key_frame.empty:
        return {}

    return {
        tuple(key): int(count)
        for key, count in key_frame.value_counts(sort=False).items()
    }


def _composite_key_set(
    series_list: list[pd.Series],
    modes: list[str],
) -> set[tuple]:
    return set(_composite_key_counts(series_list, modes))


def _format_cardinality_error(stats: JoinCardinalityStats) -> str:
    return (
        f"Для датасета '{stats.dataset_name}' обнаружено многократное соединение N:M.\n\n"
        f"Тип соединения: {stats.relation_description}\n"
        f"Строк базового датасета: {stats.base_rows:,}\n"
        f"Строк присоединяемого датасета: {stats.other_rows:,}\n"
        f"Уникальных ключей: {stats.base_unique_keys:,} / {stats.other_unique_keys:,}\n"
        f"Повторных строк ключа: {stats.base_duplicate_rows:,} / {stats.other_duplicate_rows:,}\n"
        f"Ключей с N:M: {stats.many_to_many_keys:,}\n"
        f"Максимальная кратность: {stats.max_base_multiplicity} × {stats.max_other_multiplicity}\n"
        f"Оценка строк после этого JOIN: {stats.estimated_rows:,}\n\n"
        "Это не декартово произведение всего набора: размножение происходит только "
        "для ключей, которые повторяются в обеих таблицах. Однако результат действительно "
        "может резко вырасти. Чтобы выполнить такой JOIN намеренно, включи разрешение N:M."
    )


def _build_cardinality_stats(
    base_df: pd.DataFrame,
    other_df: pd.DataFrame,
    base_columns: list[str],
    other_columns: list[str],
    modes: list[str],
    other_name: str,
    relation_description: str,
    how: str,
) -> JoinCardinalityStats:
    base_counts = _composite_key_counts(
        [base_df[column] for column in base_columns], modes
    )
    other_counts = _composite_key_counts(
        [other_df[column] for column in other_columns], modes
    )
    matched = set(base_counts) & set(other_counts)
    many_keys = {
        key for key in matched
        if base_counts[key] > 1 and other_counts[key] > 1
    }
    max_base = max((base_counts[key] for key in matched), default=1)
    max_other = max((other_counts[key] for key in matched), default=1)
    inner_rows = sum(base_counts[key] * other_counts[key] for key in matched)

    if how == "inner":
        estimated = inner_rows
    elif how == "left":
        estimated = len(base_df) + sum(
            base_counts[key] * (other_counts[key] - 1)
            for key in matched
        )
    elif how == "right":
        unmatched_base_rows = sum(
            count for key, count in base_counts.items() if key not in other_counts
        )
        estimated = (
            len(other_df)
            + unmatched_base_rows
            + sum(
                other_counts[key] * (base_counts[key] - 1)
                for key in matched
            )
        )
    else:
        unmatched_other_rows = sum(
            count for key, count in other_counts.items() if key not in base_counts
        )
        estimated = (
            len(base_df)
            + unmatched_other_rows
            + sum(
                base_counts[key] * (other_counts[key] - 1)
                for key in matched
            )
        )

    return JoinCardinalityStats(
        dataset_name=other_name,
        relation_description=relation_description,
        base_rows=len(base_df),
        other_rows=len(other_df),
        base_unique_keys=len(base_counts),
        other_unique_keys=len(other_counts),
        base_duplicate_rows=max(0, sum(base_counts.values()) - len(base_counts)),
        other_duplicate_rows=max(0, sum(other_counts.values()) - len(other_counts)),
        matched_keys=len(matched),
        many_to_many_keys=len(many_keys),
        max_base_multiplicity=max_base,
        max_other_multiplicity=max_other,
        estimated_rows=int(estimated),
    )



def column_pair_overlap(
    left: pd.Series,
    right: pd.Series,
) -> ColumnOverlap:
    """Насколько реально пересекаются значения кандидатов в столбцы
    связи между базовым и присоединяемым датасетом - живой предпросмотр
    для интерфейса, до самого объединения.
    """
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
    *,
    allow_many_to_many: bool = False,
) -> tuple[pd.DataFrame, MergeReport]:
    """Присоединяет остальные датасеты по составным связям.

    Для одного присоединяемого датасета можно задать несколько условий
    одновременно. Все условия внутри группы работают по AND.
    """
    if not relations:
        raise ValueError("Нужна хотя бы одна связь между датасетами.")

    base_name = names[base_index]
    base = dataframes[base_index]
    groups = _group_relations(relations)

    result = base.copy()
    column_origins = {str(c): f"{base_name}.{c}" for c in base.columns}
    dataset_names: list[str] = []
    relation_descriptions: list[str] = []
    unmatched_counts: list[int] = []
    notes: list[str] = []
    cardinality_stats: list[JoinCardinalityStats] = []

    for group in groups:
        rel0 = group[0]
        other = dataframes[rel0.dataset_index]
        other_name = names[rel0.dataset_index]
        how = rel0.how
        if any(rel.how != how for rel in group):
            raise ValueError(
                f"Для датасета '{other_name}' у всех условий составной связи "
                "должен быть одинаковый тип объединения."
            )

        missing = []
        for rel in group:
            if rel.base_column not in base.columns:
                missing.append(f"{base_name}.{rel.base_column}")
            if rel.other_column not in other.columns:
                missing.append(f"{other_name}.{rel.other_column}")
        if missing:
            raise ValueError(
                "Не найдены столбцы для связи: " + ", ".join(missing)
            )

        modes = []
        conditions = []
        for rel in group:
            mode = _decide_harmonization(
                result[rel.base_column], other[rel.other_column]
            )
            modes.append(mode)
            note = _harmonization_note(mode)
            if note:
                notes.append(
                    f"{base_name}.{rel.base_column} = "
                    f"{other_name}.{rel.other_column}: {note}"
                )
            conditions.append(
                f"{base_name}.{rel.base_column} = "
                f"{other_name}.{rel.other_column}"
            )

        conditions_text = " И ".join(conditions)
        stats = _build_cardinality_stats(
            result,
            other,
            [rel.base_column for rel in group],
            [rel.other_column for rel in group],
            modes,
            other_name,
            conditions_text,
            how,
        )
        cardinality_stats.append(stats)
        if stats.many_to_many_keys > 0 and not allow_many_to_many:
            raise ValueError(_format_cardinality_error(stats))
        if stats.many_to_many_keys > 0:
            notes.append(
                f"{other_name}: разрешено N:M JOIN; оценка результата "
                f"для этого шага - {stats.estimated_rows:,} строк."
            )

        base_keys = set(_composite_key_counts(
            [result[rel.base_column] for rel in group],
            modes,
        ))
        other_keys = set(_composite_key_counts(
            [other[rel.other_column] for rel in group],
            modes,
        ))
        unmatched_counts.append(len(other_keys - base_keys))

        previous_columns = list(result.columns)
        result = _join_chunk_with_other(
            result, other, other_name, group, modes, how
        )
        column_origins = _update_column_origins(
            column_origins, previous_columns, other.columns, other_name
        )

        dataset_names.append(other_name)
        relation_descriptions.append(
            " И ".join(conditions) + f" ({HOW_LABELS.get(how, how)})"
        )

    report = MergeReport(
        base_name=base_name,
        dataset_names=dataset_names,
        relation_descriptions=relation_descriptions,
        row_count_before=len(base),
        row_count_after=len(result),
        column_origins={str(k): str(v) for k, v in column_origins.items()},
        unmatched_counts=unmatched_counts,
        notes=notes,
        cardinality=cardinality_stats,
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
    allow_many_to_many: bool = False,
) -> LargeMergeResult:
    """Потоковое объединение большого базового CSV по составным связям.

    Внутреннее/Левое (inner/left) поддерживаются. Для каждого присоединяемого датасета можно
    задать несколько условий, которые объединяются через AND.
    """
    groups = _group_relations(relations)

    for group in groups:
        unsupported = {rel.how for rel in group if rel.how not in {"inner", "left"}}
        if unsupported:
            labels = ", ".join(HOW_LABELS.get(value, value) for value in sorted(unsupported))
            raise ValueError(
                "Для большого базового датасета потоково поддерживаются только "
                "Внутреннее (INNER JOIN) и Левое (LEFT JOIN). "
                f"Недоступные типы: {labels}."
            )

        other = other_dataframes[group[0].dataset_index]
        other_name = other_names[group[0].dataset_index]
        missing = []
        for rel in group:
            if rel.base_column not in base_preview.columns:
                missing.append(f"{base_name}.{rel.base_column}")
            if rel.other_column not in other.columns:
                missing.append(f"{other_name}.{rel.other_column}")
        if missing:
            raise ValueError(
                "Не найдены столбцы для связи: " + ", ".join(missing)
            )
        how = group[0].how
        if any(rel.how != how for rel in group):
            raise ValueError(
                f"Для датасета '{other_name}' у всех условий составной связи "
                "должен быть одинаковый тип объединения."
            )

    modes_by_group: list[list[str]] = []
    notes: list[str] = []
    other_key_sets: list[set[tuple]] = []
    other_key_counts: list[dict[tuple, int]] = []
    cardinality_stats: list[JoinCardinalityStats] = []

    for group in groups:
        other = other_dataframes[group[0].dataset_index]
        modes = []
        conditions = []
        for rel in group:
            mode = _decide_harmonization(
                base_preview[rel.base_column],
                other[rel.other_column],
            )
            modes.append(mode)
            condition = (
                f"{base_name}.{rel.base_column} = "
                f"{other_names[rel.dataset_index]}.{rel.other_column}"
            )
            conditions.append(condition)
            note = _harmonization_note(mode)
            if note:
                notes.append(f"{condition}: {note}")

        modes_by_group.append(modes)
        counts = _composite_key_counts(
            [other[rel.other_column] for rel in group],
            modes,
        )
        other_key_counts.append(counts)
        other_key_sets.append(set(counts))

    # Один проход по большому базовому файлу - только по ключам, которые
    # вообще могут совпасть с присоединяемыми датасетами. Это позволяет
    # определить N:M до запуска настоящего JOIN без хранения всех ключей
    # огромного базового файла.
    base_key_counts: list[dict[tuple, int]] = [{} for _ in groups]
    base_total_rows = 0
    for chunk, _encoding, _separator in iter_csv_chunks(
        base_csv_path, chunksize=chunksize
    ):
        if is_cancelled is not None and is_cancelled():
            raise InterruptedError("Операция отменена пользователем.")
        base_total_rows += len(chunk)
        for group_index, (group, modes, other_counts) in enumerate(
            zip(groups, modes_by_group, other_key_counts)
        ):
            if not other_counts:
                continue
            key_frame = pd.DataFrame({
                f"k{i}": _apply_harmonization(
                    chunk[rel.base_column], mode
                )
                for i, (rel, mode) in enumerate(zip(group, modes))
            }).dropna(how="any")
            if key_frame.empty:
                continue
            target = base_key_counts[group_index]
            for key in map(tuple, key_frame.itertuples(index=False, name=None)):
                if key in other_counts:
                    target[key] = target.get(key, 0) + 1
        if progress_callback:
            progress_callback(
                -1,
                f"Проверка кардинальности: просмотрено строк {base_total_rows:,}",
            )

    for group_index, (group, other_counts) in enumerate(
        zip(groups, other_key_counts)
    ):
        base_counts = base_key_counts[group_index]
        matched = set(base_counts)
        many_keys = {
            key for key in matched
            if base_counts[key] > 1 and other_counts[key] > 1
        }
        max_base = max((base_counts[key] for key in matched), default=1)
        max_other = max((other_counts[key] for key in matched), default=1)
        inner_rows = sum(
            base_counts[key] * other_counts[key] for key in matched
        )
        how = group[0].how
        if how == "inner":
            estimated = inner_rows
        else:
            estimated = base_total_rows + sum(
                base_counts[key] * (other_counts[key] - 1)
                for key in matched
            )
        conditions_text = " И ".join(
            f"{base_name}.{rel.base_column} = "
            f"{other_names[rel.dataset_index]}.{rel.other_column}"
            for rel in group
        )
        stats = JoinCardinalityStats(
            dataset_name=other_names[group[0].dataset_index],
            relation_description=conditions_text,
            base_rows=base_total_rows,
            other_rows=len(other_dataframes[group[0].dataset_index]),
            base_unique_keys=len(base_counts),
            other_unique_keys=len(other_counts),
            base_duplicate_rows=max(0, sum(base_counts.values()) - len(base_counts)),
            other_duplicate_rows=max(0, sum(other_counts.values()) - len(other_counts)),
            matched_keys=len(matched),
            many_to_many_keys=len(many_keys),
            max_base_multiplicity=max_base,
            max_other_multiplicity=max_other,
            estimated_rows=int(estimated),
        )
        cardinality_stats.append(stats)
        if stats.many_to_many_keys > 0 and not allow_many_to_many:
            raise ValueError(_format_cardinality_error(stats))
        if stats.many_to_many_keys > 0:
            notes.append(
                f"{stats.dataset_name}: разрешено N:M JOIN; оценка результата "
                f"для этого шага - {stats.estimated_rows:,} строк."
            )

    matched_other_keys = [set() for _ in groups]
    column_origins = {str(c): f"{base_name}.{c}" for c in base_preview.columns}
    current_columns = list(base_preview.columns)

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

            for group_index, (group, modes, other_keys_all, matched) in enumerate(
                zip(groups, modes_by_group, other_key_sets, matched_other_keys)
            ):
                other_df = other_dataframes[group[0].dataset_index]
                other_name = other_names[group[0].dataset_index]

                base_key_frame = pd.DataFrame({
                    f"k{i}": _apply_harmonization(
                        result_chunk[rel.base_column], mode
                    )
                    for i, (rel, mode) in enumerate(zip(group, modes))
                })
                base_key_frame = base_key_frame.dropna(how="any")
                if not base_key_frame.empty:
                    matched.update(
                        other_keys_all
                        & set(map(tuple, base_key_frame.itertuples(index=False, name=None)))
                    )

                previous_columns = list(result_chunk.columns)
                result_chunk = _join_chunk_with_other(
                    result_chunk, other_df, other_name, group, modes, group[0].how
                )
                if chunks_processed == 0:
                    column_origins = _update_column_origins(
                        column_origins, current_columns, other_df.columns, other_name
                    )
                    current_columns = list(result_chunk.columns)

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
                percent = min(99, 5 + min(94, chunks_processed))
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

    relation_descriptions = []
    for group in groups:
        conditions = [
            f"{base_name}.{rel.base_column} = "
            f"{other_names[rel.dataset_index]}.{rel.other_column}"
            for rel in group
        ]
        relation_descriptions.append(
            " И ".join(conditions)
            + f" ({HOW_LABELS.get(group[0].how, group[0].how)})"
        )

    preview = (
        pd.concat(preview_parts, ignore_index=True)
        if preview_parts
        else pd.DataFrame()
    )

    report = MergeReport(
        base_name=base_name,
        dataset_names=[other_names[group[0].dataset_index] for group in groups],
        relation_descriptions=relation_descriptions,
        row_count_before=row_count_before,
        row_count_after=row_count_after,
        column_origins={str(k): str(v) for k, v in column_origins.items()},
        unmatched_counts=unmatched_counts,
        notes=notes,
        cardinality=cardinality_stats,
    )

    return LargeMergeResult(
        output_path=output_path,
        preview=preview,
        report=report,
    )

