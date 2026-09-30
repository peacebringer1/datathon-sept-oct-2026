import csv
import io
import os
import shutil
import tempfile

from PyQt6.QtCore import QObject, pyqtSignal, pyqtSlot

from core.cleaner import CleaningOptions, clean_dataset
from core.large_file import process_large_csv, should_use_large_mode
from core.loader import load_dataset
from core.merger import JoinRelation, merge_large_base
from core.transformations import coalesce_columns_csv, combine_columns_csv


class DatasetLoadWorker(QObject):
    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(
        self,
        file_paths: list[str],
        options: CleaningOptions,
        column_type_overrides: dict[str, str] | None = None,
    ):
        super().__init__()
        self.file_paths = file_paths
        self.options = options
        self.column_type_overrides = column_type_overrides or {}
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def is_cancelled(self):
        return self._cancelled

    @pyqtSlot()
    def run(self):
        results = []
        errors = []

        for index, file_path in enumerate(self.file_paths):
            if self._cancelled:
                break

            try:
                self.progress.emit(
                    0,
                    f"Загрузка: {file_path}",
                )

                if should_use_large_mode(file_path):
                    result = process_large_csv(
                        file_path,
                        self.options,
                        column_type_overrides=self.column_type_overrides,
                        progress_callback=lambda p, text: self.progress.emit(
                            p, text
                        ),
                        is_cancelled=self.is_cancelled,
                    )
                    results.append(("large", result))
                else:
                    dataset = load_dataset(file_path)
                    self.progress.emit(
                        20,
                        f"Очистка: {dataset.filename}",
                    )
                    cleaned, profile, report = clean_dataset(
                        dataset.dataframe,
                        self.options,
                        column_type_overrides=self.column_type_overrides,
                    )
                    results.append(
                        ("normal", dataset, cleaned, profile, report)
                    )

                self.progress.emit(
                    100,
                    f"Готово: {file_path}",
                )

            except InterruptedError:
                break
            except Exception as exc:
                errors.append(f"{file_path}: {type(exc).__name__}: {exc}")

        self.finished.emit((results, errors, self._cancelled))


class MergeWorker(QObject):
    """Потоковое объединение, когда базовый датасет - большой файл (см.
    core.merger.merge_large_base). Как и DatasetLoadWorker, выполняется
    в отдельном QThread, чтобы блоки в несколько ГБ не блокировали GUI.
    """

    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(
        self,
        base_csv_path: str,
        base_name: str,
        base_preview,
        other_dataframes: list,
        other_names: list[str],
        relations: list[JoinRelation],
        allow_many_to_many: bool = False,
    ):
        super().__init__()
        self.base_csv_path = base_csv_path
        self.base_name = base_name
        self.base_preview = base_preview
        self.other_dataframes = other_dataframes
        self.other_names = other_names
        self.relations = relations
        self.allow_many_to_many = allow_many_to_many
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def is_cancelled(self):
        return self._cancelled

    @pyqtSlot()
    def run(self):
        try:
            result = merge_large_base(
                self.base_csv_path,
                self.base_name,
                self.base_preview,
                self.other_dataframes,
                self.other_names,
                self.relations,
                progress_callback=lambda p, text: self.progress.emit(p, text),
                is_cancelled=self.is_cancelled,
                allow_many_to_many=self.allow_many_to_many,
            )
        except InterruptedError:
            self.finished.emit(None)
            return
        except Exception as exc:
            self.error.emit(f"{type(exc).__name__}: {exc}")
            return

        self.finished.emit(
            (result.output_path, result.preview, result.report)
        )



class CoalesceColumnsWorker(QObject):
    """Потоковое схлопывание дублирующейся информации в большом merge-результате."""

    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(self, source_path: str, rules):
        super().__init__()
        self.source_path = source_path
        self.rules = rules
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def is_cancelled(self):
        return self._cancelled

    @pyqtSlot()
    def run(self):
        try:
            result = coalesce_columns_csv(
                self.source_path,
                self.rules,
                progress_callback=lambda p, text: self.progress.emit(p, text),
                is_cancelled=self.is_cancelled,
            )
        except InterruptedError:
            self.finished.emit(None)
            return
        except Exception as exc:
            self.error.emit(f"{type(exc).__name__}: {exc}")
            return

        self.finished.emit(result)


class CombineColumnsWorker(QObject):
    """Потоковое объединение нескольких столбцов внутри одного большого CSV."""

    progress = pyqtSignal(int, str)
    finished = pyqtSignal(object)
    error = pyqtSignal(str)

    def __init__(self, source_path: str, columns, new_column: str, *, separator: str = " ", skip_empty: bool = True):
        super().__init__()
        self.source_path = source_path
        self.columns = list(columns)
        self.new_column = new_column
        self.separator = separator
        self.skip_empty = skip_empty
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def is_cancelled(self):
        return self._cancelled

    @pyqtSlot()
    def run(self):
        try:
            result = combine_columns_csv(
                self.source_path,
                self.columns,
                self.new_column,
                separator=self.separator,
                skip_empty=self.skip_empty,
                progress_callback=lambda p, text: self.progress.emit(p, text),
                is_cancelled=self.is_cancelled,
            )
        except InterruptedError:
            self.finished.emit(None)
            return
        except Exception as exc:
            self.error.emit(f"{type(exc).__name__}: {exc}")
            return

        self.finished.emit(result)


class SaveWorker(QObject):
    """Сохраняет DataFrame или копирует большой CSV вне GUI-потока."""

    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(
        self,
        *,
        target_path: str,
        source_path: str | None = None,
        dataframe=None,
        column_renames: dict[str, str] | None = None,
    ):
        super().__init__()
        self.target_path = target_path
        self.source_path = source_path
        self.dataframe = dataframe
        self.column_renames = {
            str(old): str(new).strip()
            for old, new in (column_renames or {}).items()
            if str(old) != str(new).strip()
        }


    def _copy_large_csv_with_renamed_header(self):
        """Копирует большой очищенный CSV, меняя только строку заголовка."""
        target_dir = os.path.dirname(os.path.abspath(self.target_path)) or "."
        fd, temp_path = tempfile.mkstemp(
            prefix="data_analyzer_save_",
            suffix=".csv",
            dir=target_dir,
        )
        os.close(fd)

        try:
            with open(self.source_path, "rb") as source, open(
                temp_path, "wb"
            ) as target:
                raw_header = source.readline()
                if not raw_header:
                    raise ValueError("Исходный CSV-файл пуст.")

                try:
                    header_text = raw_header.decode("utf-8-sig")
                except UnicodeDecodeError as exc:
                    raise ValueError(
                        "Не удалось прочитать заголовок большого CSV "
                        "в ожидаемой кодировке UTF-8."
                    ) from exc

                reader = csv.reader([header_text], delimiter=",")
                header = next(reader, None)
                if header is None:
                    raise ValueError("Не удалось прочитать заголовок CSV.")

                renamed_header = [
                    self.column_renames.get(str(column), str(column))
                    for column in header
                ]

                buffer = io.StringIO()
                writer = csv.writer(buffer, delimiter=",", lineterminator="\n")
                writer.writerow(renamed_header)

                target.write(b"\xef\xbb\xbf")
                target.write(buffer.getvalue().encode("utf-8"))
                shutil.copyfileobj(source, target, length=1024 * 1024)

            os.replace(temp_path, self.target_path)
        except Exception:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
            raise

    @pyqtSlot()
    def run(self):
        try:
            if self.source_path is not None:
                if self.column_renames:
                    self._copy_large_csv_with_renamed_header()
                else:
                    shutil.copyfile(self.source_path, self.target_path)
            elif self.dataframe is not None:
                if self.target_path.lower().endswith(".xlsx"):
                    self.dataframe.to_excel(self.target_path, index=False)
                else:
                    self.dataframe.to_csv(
                        self.target_path,
                        index=False,
                        encoding="utf-8-sig",
                    )
            else:
                raise ValueError("Нет данных для сохранения.")
        except Exception as exc:
            self.error.emit(f"{type(exc).__name__}: {exc}")
            return
        self.finished.emit(self.target_path)
