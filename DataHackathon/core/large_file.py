from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
import gc
import csv
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time

import numpy as np
import pandas as pd

from core.cleaner import CleaningOptions, clean_dataset
from core.decodings import apply_decoding_rules
from core.loader import detect_csv_format, _normalize_column_names
from core.profiler import ColumnProfile


LARGE_FILE_BYTES = 128 * 1024 * 1024
CHUNK_SIZE = 100_000
PREVIEW_ROWS = 1_000
# Раньше ограничивала ещё и анализ дубликатов по столбцам - теперь
# дубликаты по столбцам считаются точно по всему файлу (см.
# disk-backed hash files в process_large_csv), а эта константа используется
# только для сэмпла, по которому дёшево определяется ТИП столбца и
# числовая статистика (min/max/среднее/медиана).
TYPE_SAMPLE_ROWS = 200_000
DEFAULT_WORKERS = max(2, min(4, os.cpu_count() or 2))


@dataclass
class LargeFileResult:
    source_path: str
    output_path: str
    encoding: str
    separator: str
    row_count: int
    duplicate_count: int
    missing_count: int
    preview: pd.DataFrame
    column_profiles: list[ColumnProfile]
    duplicate_analysis_scope: str
    profile_row_count: int
    decoding_changes: dict[str, int]
    source_column_types: dict[str, str]
    absolute_duplicate_count: int


def should_use_large_mode(file_path: str) -> bool:
    path = Path(file_path)
    return path.suffix.lower() == ".csv" and path.stat().st_size >= LARGE_FILE_BYTES


def _process_chunk(
    chunk: pd.DataFrame,
    options: CleaningOptions,
    column_type_overrides: dict[str, str] | None = None,
):
    """Выполняется в отдельном ПРОЦЕССЕ (см. process_large_csv).

    compute_profile=False: полный DatasetProfile чанка вызывающему коду
    не нужен (он использует только очищенный DataFrame - см. распаковку
    `cleaned, _, _ = future.result()` ниже), а раньше он на каждый chunk
    считался трижды и выбрасывался. Само по себе это не зависело от
    количества потоков/процессов и одинаково замедляло обработку что
    в 1, что в 4 воркера.
    """
    cleaned, _, _ = clean_dataset(
        chunk,
        CleaningOptions(
            missing_mode=options.missing_mode,
            fill_value=options.fill_value,
            duplicate_mode="none",
            duplicate_columns=[],
            drop_empty_columns=False,
        ),
        compute_profile=False,
        column_type_overrides=column_type_overrides,
    )
    return cleaned


def _build_large_column_profiles(
    sample: pd.DataFrame,
    full_row_count: int,
    full_missing_by_column: dict,
    full_duplicate_by_column: dict,
    type_by_column: dict[str, str] | None = None,
) -> list[ColumnProfile]:
    """Строит профиль столбцов.

    Количество строк, пропусков и ДУБЛИКАТОВ считается по всему
    обработанному файлу (full_duplicate_by_column - точный подсчёт,
    см. process_large_csv). Тип столбца и числовая статистика
    (min/max/среднее/медиана) по-прежнему берутся из ограниченной
    выборки - для них точный проход по многогигабайтному файлу не
    нужен и стоил бы намного дороже.
    """
    profiles = []
    for column in sample.columns:
        series = sample[column]
        missing_count = int(full_missing_by_column.get(column, 0))
        non_empty_count = max(0, full_row_count - missing_count)
        duplicate_count = int(full_duplicate_by_column.get(str(column), 0))
        unique_count = max(0, non_empty_count - duplicate_count)
        duplicate_percent = (
            duplicate_count / non_empty_count * 100
            if non_empty_count
            else 0.0
        )

        # Тип и числовая статистика берутся из выборки. Полные row/missing
        # значения при этом рассчитаны по всему файлу.
        from core.profiler import _detect_column_type
        data_type = (
            type_by_column.get(str(column))
            if type_by_column is not None
            else _detect_column_type(series)
        ) or _detect_column_type(series)

        min_value = max_value = mean_value = median_value = None
        if data_type == "Числовой":
            from core.text_utils import to_numeric_safe
            numeric = to_numeric_safe(series).dropna()
            if not numeric.empty:
                min_value = numeric.min()
                max_value = numeric.max()
                mean_value = float(numeric.mean())
                median_value = float(numeric.median())

        profiles.append(
            ColumnProfile(
                name=str(column),
                data_type=data_type,
                total_count=full_row_count,
                missing_count=missing_count,
                missing_percent=(
                    missing_count / full_row_count * 100
                    if full_row_count else 0.0
                ),
                non_empty_count=non_empty_count,
                unique_count=unique_count,
                duplicate_count=duplicate_count,
                duplicate_percent=duplicate_percent,
                min_value=min_value,
                max_value=max_value,
                mean_value=mean_value,
                median_value=median_value,
            )
        )

    return profiles



class _DiskHashStore:
    """Глобальное множество hash-ключей на диске, а не в RAM."""

    def __init__(self):
        self._tmp = tempfile.NamedTemporaryFile(
            prefix="data_analyzer_seen_",
            suffix=".sqlite3",
            delete=False,
        )
        self.path = self._tmp.name
        self._tmp.close()
        self.conn = sqlite3.connect(self.path)
        self.conn.execute("PRAGMA journal_mode=OFF")
        self.conn.execute("PRAGMA synchronous=OFF")
        self.conn.execute("CREATE TABLE seen (hash BLOB PRIMARY KEY)")
        self.conn.commit()

    def filter_new(self, hashes) -> np.ndarray:
        values = [int(value).to_bytes(8, "little", signed=False) for value in hashes]
        unique_values = list(dict.fromkeys(values))
        existing: set[bytes] = set()
        for start in range(0, len(unique_values), 500):
            batch = unique_values[start:start + 500]
            placeholders = ",".join("?" for _ in batch)
            rows = self.conn.execute(
                f"SELECT hash FROM seen WHERE hash IN ({placeholders})",
                batch,
            )
            existing.update(row[0] for row in rows)

        keep = np.zeros(len(values), dtype=bool)
        local_seen = set(existing)
        to_insert = []
        for index, value in enumerate(values):
            if value not in local_seen:
                keep[index] = True
                local_seen.add(value)
                to_insert.append((value,))

        if to_insert:
            self.conn.executemany(
                "INSERT OR IGNORE INTO seen(hash) VALUES (?)",
                to_insert,
            )
            self.conn.commit()
        return keep

    def close(self):
        try:
            self.conn.close()
        finally:
            try:
                os.unlink(self.path)
            except OSError:
                pass

def _count_csv_data_rows(file_path: str, encoding: str, separator: str) -> int:
    """Точно считает CSV-записи без загрузки DataFrame в память.

    Заголовок не учитывается. csv.reader корректно обрабатывает поля в кавычках
    и переводы строк внутри одного CSV-поля.
    """
    count = 0
    with open(file_path, "r", encoding=encoding, newline="") as csv_file:
        reader = csv.reader(csv_file, delimiter=separator, quotechar='"')
        try:
            next(reader)  # заголовок
        except StopIteration:
            return 0
        for _ in reader:
            count += 1
    return count


def process_large_csv(
    file_path: str,
    options: CleaningOptions,
    *,
    column_type_overrides: dict[str, str] | None = None,
    chunksize: int = CHUNK_SIZE,
    workers: int = DEFAULT_WORKERS,
    progress_callback=None,
    is_cancelled=None,
) -> LargeFileResult:
    """Потоково обрабатывает большой CSV.

    Чтение CSV выполняется одним parser-итератором в основном процессе,
    а очистка отдельных chunks выполняется параллельно в нескольких
    ОТДЕЛЬНЫХ ПРОЦЕССАХ (ProcessPoolExecutor), а не потоках. Это важно:
    сама очистка (clean_dataset) - это в основном CPU-связанный Python-код
    (например, `.map()` с обычной функцией на Python в _normalize_missing,
    поэлементные .str-операции над колонками с текстом) и из-за GIL
    в CPython несколько ПОТОКОВ на таком коде не работают параллельно -
    в любой момент времени реально исполняется только один поток,
    остальные ждут. Поэтому раньше рост числа потоков с 1 до 4 не давал
    прироста скорости. Процессы у GIL не делят и реально грузят
    несколько ядер CPU одновременно; за это платится накладными
    расходами на pickle-сериализацию chunk'а туда и обратно между
    процессами, но при chunk размером в десятки/сотни тысяч строк
    выигрыш от параллельной очистки для больших файлов существенно
    перекрывает эти расходы.
    Для самого CSV используется быстрый C parser pandas.
    """
    encoding, separator = detect_csv_format(Path(file_path))

    # Для истинного процента заранее считаем количество строк входного CSV.
    # Один блок = chunksize строк (по умолчанию 100 000).
    # На этом этапе обработка ещё не началась, поэтому прогресс остаётся 0%.
    if progress_callback:
        progress_callback(0, "Подсчёт общего количества строк датасета...")
    input_total_rows = _count_csv_data_rows(
        file_path, encoding, separator
    )
    total_blocks = (
        (input_total_rows + chunksize - 1) // chunksize
        if input_total_rows > 0
        else 0
    )

    temp = tempfile.NamedTemporaryFile(
        prefix="data_analyzer_",
        suffix="_cleaned.csv",
        delete=False,
    )
    output_path = temp.name
    temp.close()

    seen_hash_store = (
        _DiskHashStore()
        if options.duplicate_mode != "none"
        else None
    )
    absolute_seen_hash_store = _DiskHashStore()
    type_sample = pd.read_csv(
        file_path,
        encoding=encoding,
        sep=separator,
        engine="c",
        nrows=TYPE_SAMPLE_ROWS,
    )
    type_sample.columns = _normalize_column_names(type_sample.columns)
    from core.profiler import _detect_column_type
    detected_types = {
        str(column): _detect_column_type(type_sample[column])
        for column in type_sample.columns
    }
    type_by_column = {
        str(column): (
            column_type_overrides.get(str(column), detected_types[str(column)])
            if column_type_overrides is not None
            else detected_types[str(column)]
        )
        for column in type_sample.columns
    }
    total_rows = 0
    pre_duplicate_rows = 0
    duplicate_count = 0
    absolute_duplicate_count = 0
    missing_count = 0
    pre_duplicate_missing_by_column: dict = {}
    hash_temp_dir = tempfile.TemporaryDirectory(
        prefix="data_analyzer_hashes_"
    )
    column_hash_files: dict[str, tuple[str, int]] = {}
    preview_parts = []
    analysis_parts = []
    analysis_rows = 0
    first_write = True
    chunks_processed = 0
    decoding_changes_total: dict[str, int] = {}

    def submit_chunk(executor, chunk):
        if is_cancelled and is_cancelled():
            raise InterruptedError("Обработка отменена пользователем.")
        return executor.submit(
            _process_chunk, chunk, options, type_by_column
        )

    try:
        reader = pd.read_csv(
            file_path,
            encoding=encoding,
            sep=separator,
            engine="c",
            chunksize=chunksize,
        )

        # Пул ПРОЦЕССОВ: реальная параллельная загрузка нескольких ядер
        # CPU для очистки chunks. Пул потоков здесь не подходит - см.
        # docstring выше про GIL.
        with ProcessPoolExecutor(max_workers=max(1, workers)) as executor:
            pending = []
            exhausted = False

            while pending or not exhausted:
                while not exhausted and len(pending) < max(1, workers):
                    try:
                        chunk = next(reader)
                    except StopIteration:
                        exhausted = True
                        break
                    chunk.columns = [str(c).strip() for c in chunk.columns]
                    pending.append(submit_chunk(executor, chunk))

                if not pending:
                    break

                future = pending.pop(0)
                cleaned = future.result()

                if is_cancelled and is_cancelled():
                    raise InterruptedError("Обработка отменена пользователем.")

                # Статистика пустых ячеек - по полному обработанному файлу.
                missing_series = cleaned.isna().sum()
                for column, value in missing_series.items():
                    pre_duplicate_missing_by_column[column] = (
                        pre_duplicate_missing_by_column.get(column, 0) + int(value)
                    )
                missing_count += int(missing_series.sum())
                pre_duplicate_rows += len(cleaned)

                # Точный анализ дубликатов по каждому столбцу - по ВСЕМ
                # строкам файла, а не по ограниченной выборке. Храним не
                # сами значения, а их 64-битные хэши (dropna до хэширования,
                # иначе все NaN считались бы одинаковым "повторяющимся"
                # значением) - это на порядки компактнее, чем держать в
                # памяти реальные строки/числа всех строк файла, и в конце
                # даёт точное (а не оценочное) число дубликатов по столбцу.
                for column in cleaned.columns:
                    non_empty = cleaned[column].dropna()
                    if non_empty.empty:
                        continue
                    hashes = pd.util.hash_pandas_object(
                        non_empty, index=False,
                    ).to_numpy(dtype="uint64")
                    column_name = str(column)
                    if column_name not in column_hash_files:
                        hash_path = os.path.join(
                            hash_temp_dir.name,
                            f"column_{len(column_hash_files)}.bin",
                        )
                        column_hash_files[column_name] = (hash_path, 0)
                    hash_path, count = column_hash_files[column_name]
                    with open(hash_path, "ab") as hash_file:
                        hashes.tofile(hash_file)
                    column_hash_files[column_name] = (
                        hash_path, count + len(hashes)
                    )

                # Отдельная, ограниченная выборка - только для определения
                # ТИПА столбца и числовой статистики (min/max/среднее),
                # это не влияет на точность анализа дубликатов выше.
                if analysis_rows < TYPE_SAMPLE_ROWS:
                    remaining = TYPE_SAMPLE_ROWS - analysis_rows
                    sample_part = cleaned.head(remaining)
                    if not sample_part.empty:
                        analysis_parts.append(sample_part)
                        analysis_rows += len(sample_part)

                if options.duplicate_mode != "none":
                    if options.duplicate_mode == "all":
                        key_frame = cleaned
                    elif options.duplicate_mode == "selected":
                        missing_columns = [
                            c for c in options.duplicate_columns
                            if c not in cleaned.columns
                        ]
                        if missing_columns:
                            raise ValueError(
                                "Не найдены столбцы для поиска дубликатов: "
                                + ", ".join(map(str, missing_columns))
                            )
                        key_frame = cleaned[options.duplicate_columns]
                    else:
                        raise ValueError(
                            f"Неизвестный режим дубликатов: "
                            f"{options.duplicate_mode}"
                        )

                    hashes = pd.util.hash_pandas_object(
                        key_frame,
                        index=False,
                    ).astype("uint64")

                    keep_mask = seen_hash_store.filter_new(
                        hashes.to_numpy()
                    )
                    duplicate_count += int((~keep_mask).sum())
                    cleaned = cleaned.loc[keep_mask]

                # Расшифровки применяются после глобального удаления
                # дубликатов, поэтому они не меняют критерий дедупликации.
                if options.decoding_rules:
                    cleaned, changed = apply_decoding_rules(
                        cleaned, options.decoding_rules
                    )
                    for column, count in changed.items():
                        decoding_changes_total[column] = (
                            decoding_changes_total.get(column, 0) + count
                        )

                # Точный подсчёт абсолютных дубликатов по итоговому состоянию
                # каждой строки. В отличие от column-level duplicate analysis
                # здесь учитываются все столбцы сразу. Хэш-хранилище на диске
                # позволяет не держать ключи многогигабайтного файла в RAM.
                row_hashes = pd.util.hash_pandas_object(
                    cleaned,
                    index=False,
                ).astype("uint64")
                absolute_keep_mask = absolute_seen_hash_store.filter_new(
                    row_hashes.to_numpy()
                )
                absolute_duplicate_count += int((~absolute_keep_mask).sum())

                total_rows += len(cleaned)

                if sum(len(part) for part in preview_parts) < PREVIEW_ROWS:
                    remaining = PREVIEW_ROWS - sum(
                        len(part) for part in preview_parts
                    )
                    if remaining > 0:
                        preview_parts.append(cleaned.head(remaining))

                cleaned.to_csv(
                    output_path,
                    mode="w" if first_write else "a",
                    header=first_write,
                    index=False,
                    encoding="utf-8-sig",
                )
                first_write = False
                chunks_processed += 1

                if progress_callback:
                    # Истинный процент по количеству входных блоков.
                    # Последний неполный блок считается одним блоком.
                    percent = (
                        int(chunks_processed / total_blocks * 100)
                        if total_blocks
                        else 100
                    )
                    percent = min(100, max(0, percent))
                    progress_callback(
                        percent,
                        f"Обработка: блок {chunks_processed} из {total_blocks}, "
                        f"строк обработано {total_rows:,}, "
                        f"процессов {max(1, workers)}",
                    )

        if first_write:
            # Все строки могли быть удалены очисткой (например, drop_any).
            # В этом случае всё равно создаём корректный CSV с заголовком.
            pd.DataFrame(columns=type_sample.columns).to_csv(
                output_path,
                index=False,
                encoding="utf-8-sig",
            )
            first_write = False

        preview = (
            pd.concat(preview_parts, ignore_index=True)
            if preview_parts
            else pd.DataFrame(columns=type_sample.columns)
        )
        analysis_sample = (
            pd.concat(analysis_parts, ignore_index=True)
            if analysis_parts
            else preview.copy()
        )

        # Финальный точный подсчёт дубликатов по каждому столбцу - по
        # всем накопленным хэшам сразу (один проход np.unique на столбец),
        # без Python-циклов по отдельным значениям.
        full_duplicate_by_column: dict[str, int] = {}
        for column, (hash_path, hash_count) in column_hash_files.items():
            if hash_count <= 0:
                full_duplicate_by_column[column] = 0
                continue

            hashes = np.memmap(
                hash_path,
                dtype="uint64",
                mode="r+",
                shape=(hash_count,),
            )
            try:
                # На Windows np.memmap держит открытый дескриптор файла.
                # Нельзя полагаться только на del hashes: последний срез
                # `block` тоже может сохранять ссылку на mmap. Закрываем
                # отображение явно до удаления временной директории.
                hashes.sort(kind="quicksort")

                unique_count = 0
                block_size = 1_000_000
                previous = None
                block = None
                for start in range(0, hash_count, block_size):
                    block = hashes[start:start + block_size]
                    if len(block) == 0:
                        continue
                    first = int(block[0])
                    if previous is None or first != previous:
                        unique_count += 1
                    unique_count += int(
                        np.count_nonzero(block[1:] != block[:-1])
                    )
                    previous = int(block[-1])
                    del block
                    block = None

                missing = pre_duplicate_missing_by_column.get(column, 0)
                non_empty_count = max(0, pre_duplicate_rows - missing)
                full_duplicate_by_column[column] = max(
                    0, non_empty_count - unique_count
                )
            finally:
                # Явно освобождаем все views перед удалением .bin на Windows.
                try:
                    if block is not None:
                        del block
                except UnboundLocalError:
                    pass
                mmap_obj = getattr(hashes, "_mmap", None)
                if mmap_obj is not None:
                    try:
                        mmap_obj.close()
                    except (BufferError, OSError):
                        pass
                del hashes
                gc.collect()

        final_type_by_column = dict(type_by_column)
        for column in decoding_changes_total:
            final_type_by_column[column] = "Категориальный"

        if options.decoding_rules and not analysis_sample.empty:
            analysis_sample, _ = apply_decoding_rules(
                analysis_sample, options.decoding_rules
            )

        column_profiles = _build_large_column_profiles(
            analysis_sample,
            pre_duplicate_rows,
            pre_duplicate_missing_by_column,
            full_duplicate_by_column,
            final_type_by_column,
        )

        return LargeFileResult(
            source_path=str(file_path),
            output_path=output_path,
            encoding=encoding,
            separator=separator,
            row_count=total_rows,
            duplicate_count=duplicate_count,
            missing_count=missing_count,
            preview=preview,
            column_profiles=column_profiles,
            duplicate_analysis_scope=f"весь файл ({pre_duplicate_rows:,} строк)",
            profile_row_count=pre_duplicate_rows,
            decoding_changes=decoding_changes_total,
            source_column_types=dict(type_by_column),
            absolute_duplicate_count=absolute_duplicate_count,
        )

    except Exception:
        try:
            Path(output_path).unlink(missing_ok=True)
        except Exception:
            pass
        raise
    finally:
        if seen_hash_store is not None:
            seen_hash_store.close()
        absolute_seen_hash_store.close()

        # На Windows временный .bin может ещё кратковременно оставаться
        # заблокированным антивирусом или системой после закрытия mmap.
        # Очистка временных данных не должна превращать успешно обработанный
        # датасет в ошибку PermissionError. Делаем несколько попыток, а при
        # остаточной блокировке оставляем мусор для последующей очистки, но
        # не скрываем ошибку самого чтения/обработки CSV.
        temp_hash_dir_path = hash_temp_dir.name
        hash_temp_dir = None
        gc.collect()
        for attempt in range(5):
            try:
                shutil.rmtree(temp_hash_dir_path)
                break
            except FileNotFoundError:
                break
            except PermissionError:
                if attempt == 4:
                    break
                time.sleep(0.15 * (attempt + 1))
                gc.collect()
