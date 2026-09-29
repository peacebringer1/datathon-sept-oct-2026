import shutil

from PyQt6.QtCore import QObject, pyqtSignal, pyqtSlot

from core.cleaner import CleaningOptions, clean_dataset
from core.large_file import process_large_csv, should_use_large_mode
from core.loader import load_dataset
from core.merger import JoinRelation, merge_large_base


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
    ):
        super().__init__()
        self.base_csv_path = base_csv_path
        self.base_name = base_name
        self.base_preview = base_preview
        self.other_dataframes = other_dataframes
        self.other_names = other_names
        self.relations = relations
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



class SaveWorker(QObject):
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(
        self,
        *,
        target_path: str,
        source_path: str | None = None,
        dataframe=None,
    ):
        super().__init__()
        self.target_path = target_path
        self.source_path = source_path
        self.dataframe = dataframe

    @pyqtSlot()
    def run(self):
        try:
            if self.source_path is not None:
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
