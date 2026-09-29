from dataclasses import dataclass
import os

import pandas as pd

from PyQt6.QtCore import (
    QAbstractTableModel,
    QModelIndex,
    Qt,
    QThread,
)
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFileDialog,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSplitter,
    QTableView,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.workers import DatasetLoadWorker, MergeWorker, SaveWorker
from core.cleaner import CleaningOptions, CleaningReport, clean_dataset
from core.duplicates import DuplicateReport
from core.loader import Dataset
from core.merger import (
    JoinRelation,
    MergeReport,
    column_pair_overlap,
    common_columns,
    merge_datasets,
)
from core.profiler import DatasetProfile, profile_dataset
from core.version import APP_VERSION


@dataclass
class DatasetRecord:
    dataset: Dataset
    cleaned_dataframe: pd.DataFrame
    profile: DatasetProfile
    cleaning_report: CleaningReport
    large_output_path: str | None = None
    column_type_overrides: dict[str, str] | None = None

    @property
    def is_large(self) -> bool:
        return self.large_output_path is not None or self.dataset.is_large


class DataFrameModel(QAbstractTableModel):
    def __init__(self, dataframe: pd.DataFrame):
        super().__init__()
        self.dataframe = dataframe

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.dataframe)

    def columnCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.dataframe.columns)

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or role != Qt.ItemDataRole.DisplayRole:
            return None

        value = self.dataframe.iloc[index.row(), index.column()]
        if pd.isna(value):
            return ""
        return str(value)

    def headerData(
        self,
        section,
        orientation,
        role=Qt.ItemDataRole.DisplayRole,
    ):
        if role != Qt.ItemDataRole.DisplayRole:
            return None

        if orientation == Qt.Orientation.Horizontal:
            return str(self.dataframe.columns[section])

        return str(section + 1)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.records: list[DatasetRecord] = []
        self.selected_index: int | None = None

        self.merged_dataframe: pd.DataFrame | None = None
        self.merge_report: MergeReport | None = None
        # Если базовый датасет для объединения был большим - результат,
        # как и очищенный большой файл, пишется на диск, а в памяти
        # держится только merged_dataframe-предпросмотр.
        self.merged_output_path: str | None = None
        # Каждый элемент: {"record_index", "other_combo", "base_combo",
        # "how_combo", "overlap_label"} - одна строка-связь в конструкторе
        # объединения (см. _rebuild_merge_relation_rows).
        self._merge_relation_rows: list[dict] = []
        self._merge_thread: QThread | None = None
        self._merge_worker: MergeWorker | None = None

        self.table_model: DataFrameModel | None = None
        self._load_thread: QThread | None = None
        self._load_worker: DatasetLoadWorker | None = None
        self._record_to_replace: int | None = None
        self._save_thread: QThread | None = None
        self._save_worker: SaveWorker | None = None

        self.setWindowTitle(
            f"Data Analyzer {APP_VERSION} - очистка и объединение датасетов"
        )
        self.resize(1400, 850)

        self._build_ui()

    def _build_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        main_layout = QVBoxLayout(central_widget)

        top_layout = QHBoxLayout()

        self.add_button = QPushButton("Добавить датасет(ы)…")
        self.add_button.clicked.connect(self._add_datasets)

        self.remove_button = QPushButton("Удалить выбранный")
        self.remove_button.clicked.connect(self._remove_selected_dataset)
        self.remove_button.setEnabled(False)

        self.save_button = QPushButton("Сохранить очищенный выбранный…")
        self.save_button.clicked.connect(self._save_cleaned_dataset)
        self.save_button.setEnabled(False)

        self.cancel_button = QPushButton("Отменить")
        self.cancel_button.clicked.connect(self._cancel_loading)
        self.cancel_button.setEnabled(False)

        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setValue(0)
        self.progress_bar.setVisible(False)

        top_layout.addWidget(self.add_button)
        top_layout.addWidget(self.remove_button)
        top_layout.addWidget(self.save_button)
        top_layout.addWidget(self.cancel_button)
        top_layout.addWidget(self.progress_bar, stretch=1)

        main_layout.addLayout(top_layout)

        self.status_label = QLabel("")
        self.status_label.setVisible(False)
        main_layout.addWidget(self.status_label)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        main_layout.addWidget(splitter, stretch=1)

        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.addWidget(QLabel("Загруженные датасеты:"))

        self.dataset_list = QListWidget()
        self.dataset_list.currentRowChanged.connect(
            self._on_dataset_selected
        )
        left_layout.addWidget(self.dataset_list)
        splitter.addWidget(left_widget)

        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)

        self.info_label = QLabel(
            "Добавь один или несколько CSV/XLSX-файлов, чтобы начать работу."
        )
        self.info_label.setWordWrap(True)
        right_layout.addWidget(self.info_label)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._create_overview_tab(), "Обзор")
        self.tabs.addTab(self._create_cleaning_tab(), "Очистка")
        self.tabs.addTab(self._create_data_tab(), "Данные")
        self.tabs.addTab(self._create_merge_tab(), "Объединение")
        self.tabs.currentChanged.connect(self._on_tab_changed)

        right_layout.addWidget(self.tabs)
        splitter.addWidget(right_widget)

        splitter.setSizes([280, 1100])

    def _create_overview_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        self.dataset_summary = QLabel("Данные ещё не загружены.")
        self.dataset_summary.setWordWrap(True)
        layout.addWidget(self.dataset_summary)

        self.profile_table = QTableView()
        self.profile_table.setAlternatingRowColors(True)
        layout.addWidget(self.profile_table)

        return widget

    def _create_cleaning_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        settings = QGroupBox("Настройки очистки")
        settings_layout = QVBoxLayout(settings)

        missing_row = QHBoxLayout()
        missing_row.addWidget(QLabel("Пустые ячейки:"))

        self.missing_combo = QComboBox()
        self.missing_combo.addItem("Оставить как есть", "keep")
        self.missing_combo.addItem(
            "Удалять строки, где есть хотя бы один пропуск", "drop_any"
        )
        self.missing_combo.addItem(
            "Удалять полностью пустые строки", "drop_all"
        )
        self.missing_combo.addItem("Заполнять числовые нулём", "fill_zero")
        self.missing_combo.addItem(
            "Заполнять числовые средним", "fill_mean"
        )
        self.missing_combo.addItem(
            "Заполнять числовые медианой", "fill_median"
        )
        self.missing_combo.addItem(
            "Заполнять модой / заданным значением", "fill_mode"
        )
        self.missing_combo.addItem(
            "Заполнять заданным значением", "fill_value"
        )
        self.missing_combo.setCurrentIndex(2)
        missing_row.addWidget(self.missing_combo, stretch=1)

        missing_row.addWidget(QLabel("Значение:"))
        self.fill_value_edit = QLineEdit("Не указано")
        self.fill_value_edit.setMaximumWidth(180)
        missing_row.addWidget(self.fill_value_edit)

        settings_layout.addLayout(missing_row)

        duplicate_row = QHBoxLayout()
        duplicate_row.addWidget(QLabel("Дубликаты:"))

        self.duplicate_combo = QComboBox()
        self.duplicate_combo.addItem("Не удалять", "none")
        self.duplicate_combo.addItem(
            "По всем столбцам", "all"
        )
        self.duplicate_combo.addItem(
            "По выбранным столбцам", "selected"
        )
        self.duplicate_combo.currentIndexChanged.connect(
            self._update_duplicate_columns_enabled
        )
        duplicate_row.addWidget(self.duplicate_combo, stretch=1)
        settings_layout.addLayout(duplicate_row)

        settings_layout.addWidget(
            QLabel("Столбцы для поиска дубликатов:")
        )
        self.duplicate_columns_list = QListWidget()
        self.duplicate_columns_list.setMaximumHeight(150)
        self.duplicate_columns_list.setSelectionMode(
            QAbstractItemView.SelectionMode.NoSelection
        )
        settings_layout.addWidget(self.duplicate_columns_list)

        settings_layout.addWidget(
            QLabel("Категориальные столбцы (вручную):")
        )
        self.categorical_columns_list = QListWidget()
        self.categorical_columns_list.setMaximumHeight(170)
        self.categorical_columns_list.setSelectionMode(
            QAbstractItemView.SelectionMode.NoSelection
        )
        settings_layout.addWidget(self.categorical_columns_list)
        settings_layout.addWidget(
            QLabel(
                "Можно отметить любой столбец, даже если программа автоматически "
                "определила его как числовой, дату/время или текст."
            )
        )

        self.apply_cleaning_button = QPushButton(
            "Применить настройки к выбранному датасету"
        )
        self.apply_cleaning_button.clicked.connect(self._apply_cleaning)
        self.apply_cleaning_button.setEnabled(False)
        settings_layout.addWidget(self.apply_cleaning_button)

        layout.addWidget(settings)

        self.cleaning_summary = QLabel(
            "Отчёт об очистке появится после выбора датасета."
        )
        self.cleaning_summary.setWordWrap(True)
        layout.addWidget(self.cleaning_summary)

        self.cleaning_table = QTableView()
        self.cleaning_table.setAlternatingRowColors(True)
        layout.addWidget(self.cleaning_table)

        return widget

    def _create_data_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        self.table = QTableView()
        self.table.setAlternatingRowColors(True)
        self.table.setSortingEnabled(False)
        self.table.setHorizontalScrollMode(
            QTableView.ScrollMode.ScrollPerPixel
        )
        self.table.setVerticalScrollMode(
            QTableView.ScrollMode.ScrollPerPixel
        )
        layout.addWidget(self.table)

        return widget

    def _create_merge_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        self.merge_hint = QLabel(
            "Загрузи минимум 2 обычных датасета, чтобы настроить объединение."
        )
        self.merge_hint.setWordWrap(True)
        layout.addWidget(self.merge_hint)

        layout.addWidget(QLabel("Источники (отметь датасеты для объединения):"))
        self.merge_sources_list = QListWidget()
        self.merge_sources_list.setMaximumHeight(120)
        self.merge_sources_list.setSelectionMode(
            QAbstractItemView.SelectionMode.NoSelection
        )
        self.merge_sources_list.itemChanged.connect(
            self._on_merge_sources_changed
        )
        layout.addWidget(self.merge_sources_list)

        base_row = QHBoxLayout()
        base_row.addWidget(QLabel("Базовый датасет (левая часть связей):"))
        self.merge_base_combo = QComboBox()
        self.merge_base_combo.currentIndexChanged.connect(
            self._rebuild_merge_relation_rows
        )
        base_row.addWidget(self.merge_base_combo, stretch=1)
        layout.addLayout(base_row)

        layout.addWidget(QLabel(
            "Связи (столбец базового датасета = столбец присоединяемого):"
        ))
        relations_scroll = QScrollArea()
        relations_scroll.setWidgetResizable(True)
        relations_scroll.setMinimumHeight(160)
        self.merge_relations_container = QWidget()
        self.merge_relations_layout = QVBoxLayout(self.merge_relations_container)
        self.merge_relations_layout.addStretch()
        relations_scroll.setWidget(self.merge_relations_container)
        layout.addWidget(relations_scroll)

        self.merge_button = QPushButton("Объединить")
        self.merge_button.clicked.connect(self._run_merge)
        self.merge_button.setEnabled(False)
        layout.addWidget(self.merge_button)

        self.merge_report_label = QLabel("")
        self.merge_report_label.setWordWrap(True)
        layout.addWidget(self.merge_report_label)

        self.merge_result_table = QTableView()
        self.merge_result_table.setAlternatingRowColors(True)
        layout.addWidget(self.merge_result_table, stretch=1)

        self.save_merged_button = QPushButton(
            "Сохранить объединённый датасет…"
        )
        self.save_merged_button.clicked.connect(self._save_merged_dataset)
        self.save_merged_button.setEnabled(False)
        layout.addWidget(self.save_merged_button)

        return widget

    def _add_datasets(self):
        file_paths, _ = QFileDialog.getOpenFileNames(
            self,
            "Добавить датасеты",
            "",
            "Данные (*.csv *.xlsx);;CSV (*.csv);;Excel (*.xlsx)",
        )

        if not file_paths:
            return

        self._start_worker(
            file_paths,
            self._current_options(),
            column_type_overrides={},
        )

    def _start_worker(
        self,
        file_paths,
        options,
        replace_index=None,
        column_type_overrides: dict[str, str] | None = None,
    ):
        if self._load_thread is not None:
            return

        self.add_button.setEnabled(False)
        self.remove_button.setEnabled(False)
        self.save_button.setEnabled(False)
        self.apply_cleaning_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.status_label.setVisible(True)

        thread = QThread(self)
        worker = DatasetLoadWorker(
            file_paths,
            options,
            column_type_overrides=column_type_overrides,
        )
        worker.moveToThread(thread)

        thread.started.connect(worker.run)
        worker.progress.connect(self._on_worker_progress)
        worker.finished.connect(self._on_worker_finished)
        worker.error.connect(self._on_worker_error)

        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)

        self._load_thread = thread
        self._load_worker = worker
        self._record_to_replace = replace_index

        thread.finished.connect(self._worker_thread_finished)
        thread.start()

    def _on_worker_progress(self, value, text):
        if value < 0:
            self.progress_bar.setRange(0, 0)
        else:
            if self.progress_bar.minimum() == self.progress_bar.maximum():
                self.progress_bar.setRange(0, 100)
            self.progress_bar.setValue(value)
        self.status_label.setText(text)

    def _on_worker_error(self, message):
        QMessageBox.critical(self, "Ошибка обработки", message)

    def _on_worker_finished(self, payload):
        results, errors, cancelled = payload

        replacement_index = self._record_to_replace
        pending_overrides = getattr(
            self._load_worker,
            "column_type_overrides",
            {},
        ) if self._load_worker is not None else {}

        for result in results:
            if result[0] == "normal":
                _, dataset, cleaned, profile, report = result
                record = DatasetRecord(
                    dataset=dataset,
                    cleaned_dataframe=cleaned,
                    profile=profile,
                    cleaning_report=report,
                    column_type_overrides=dict(pending_overrides),
                )
            else:
                _, large_result = result
                profile = DatasetProfile(
                    row_count=large_result.profile_row_count,
                    column_count=len(large_result.column_profiles),
                    duplicate_count=large_result.duplicate_count,
                    numeric_columns=sum(c.data_type == "Числовой" for c in large_result.column_profiles),
                    categorical_columns=sum(c.data_type == "Категориальный" for c in large_result.column_profiles),
                    datetime_columns=sum(c.data_type == "Дата/время" for c in large_result.column_profiles),
                    text_columns=sum(c.data_type == "Текст" for c in large_result.column_profiles),
                    missing_values=large_result.missing_count,
                    columns=large_result.column_profiles,
                    duplicate_analysis_scope=large_result.duplicate_analysis_scope,
                    profile_scope="данные после очистки, до удаления дубликатов",
                )
                duplicate_report = DuplicateReport(
                    mode=self._current_options().duplicate_mode,
                    columns=self._current_options().duplicate_columns,
                    found=large_result.duplicate_count,
                    removed=large_result.duplicate_count,
                )
                report = CleaningReport(
                    empty_rows_removed=0,
                    empty_columns_removed=[],
                    columns=[],
                    pre_duplicate_profile=profile,
                    duplicate_report=duplicate_report,
                    missing_mode=self._current_options().missing_mode,
                )
                dataset = Dataset(
                    large_result.preview,
                    large_result.source_path,
                    encoding=large_result.encoding,
                    separator=large_result.separator,
                    total_row_count=large_result.row_count,
                    is_large=True,
                )
                record = DatasetRecord(
                    dataset=dataset,
                    cleaned_dataframe=large_result.preview,
                    profile=profile,
                    cleaning_report=report,
                    large_output_path=large_result.output_path,
                    column_type_overrides=dict(pending_overrides),
                )

            if (
                replacement_index is not None
                and 0 <= replacement_index < len(self.records)
            ):
                old_record = self.records[replacement_index]
                if (
                    old_record.large_output_path
                    and old_record.large_output_path != record.large_output_path
                ):
                    try:
                        import os
                        os.unlink(old_record.large_output_path)
                    except OSError:
                        pass
                self.records[replacement_index] = record
                self.dataset_list.item(replacement_index).setText(
                    self._list_item_text(record)
                )
                self.dataset_list.setCurrentRow(replacement_index)
            else:
                self.records.append(record)
                self.dataset_list.addItem(
                    QListWidgetItem(self._list_item_text(record))
                )

        if errors:
            QMessageBox.warning(
                self,
                "Не все файлы обработаны",
                "Не удалось обработать:\n" + "\n".join(errors),
            )

        empty_results = [
            record.dataset.filename
            for record in self.records
            if len(record.cleaned_dataframe) == 0
        ]
        if empty_results:
            QMessageBox.warning(
                self,
                "После очистки нет строк",
                "Следующие датасеты после выбранной очистки не содержат строк:\n"
                + "\n".join(empty_results),
            )

        if cancelled:
            self.status_label.setText("Операция отменена.")

        self._record_to_replace = None

        if self.records:
            self.dataset_list.setCurrentRow(len(self.records) - 1)

        self._reset_merge_result()
        self._refresh_merge_sources()

    def _worker_thread_finished(self):
        self._load_thread = None
        self._load_worker = None
        self.add_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.status_label.setVisible(False)

        self._update_selection_buttons()

    def _cancel_loading(self):
        if self._load_worker is not None:
            self._load_worker.cancel()
            self.status_label.setText("Остановка после текущего блока…")
            self.cancel_button.setEnabled(False)
        if self._merge_worker is not None:
            self._merge_worker.cancel()
            self.status_label.setText(
                "Остановка объединения после текущего блока…"
            )
            self.cancel_button.setEnabled(False)

    def _remove_selected_dataset(self):
        row = self.dataset_list.currentRow()
        if row < 0:
            return

        record = self.records[row]
        if record.large_output_path:
            try:
                import os
                os.unlink(record.large_output_path)
            except OSError:
                pass

        del self.records[row]
        self.dataset_list.takeItem(row)

        self._reset_merge_result()
        self._refresh_merge_sources()
        self._update_selection_buttons()

    def _update_selection_buttons(self):
        has_selection = (
            self.dataset_list.currentRow() >= 0
            and self.dataset_list.currentRow() < len(self.records)
        )
        self.remove_button.setEnabled(has_selection)
        self.save_button.setEnabled(has_selection)
        self.apply_cleaning_button.setEnabled(has_selection)

    @staticmethod
    def _list_item_text(record: DatasetRecord) -> str:
        suffix = " [большой файл]" if record.is_large else ""
        return (
            f"{record.dataset.filename}{suffix}  "
            f"({record.dataset.row_count:,} стр.)"
        ).replace(",", " ")

    def _on_dataset_selected(self, row: int):
        if row < 0 or row >= len(self.records):
            self.selected_index = None
            self._update_selection_buttons()
            return

        self.selected_index = row
        record = self.records[row]

        self._show_dataset_info(record)
        self._show_preview(record)
        self._show_profile(record)
        self._show_cleaning_report(record)
        self._populate_duplicate_columns(record.cleaned_dataframe.columns)
        self._populate_categorical_columns(
            record.cleaned_dataframe.columns,
            record.column_type_overrides or {},
        )
        self._update_selection_buttons()

    def _on_tab_changed(self, index: int):
        if self.tabs.tabText(index) == "Объединение":
            self._refresh_merge_sources()

    def _current_options(self) -> CleaningOptions:
        selected = []
        for i in range(self.duplicate_columns_list.count()):
            item = self.duplicate_columns_list.item(i)
            if item.checkState() == Qt.CheckState.Checked:
                selected.append(item.data(Qt.ItemDataRole.UserRole))

        return CleaningOptions(
            missing_mode=self.missing_combo.currentData(),
            fill_value=self.fill_value_edit.text(),
            duplicate_mode=self.duplicate_combo.currentData(),
            duplicate_columns=selected,
        )

    def _populate_duplicate_columns(self, columns):
        self.duplicate_columns_list.clear()

        for column in columns:
            item = QListWidgetItem(str(column))
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Unchecked)
            item.setData(Qt.ItemDataRole.UserRole, column)
            self.duplicate_columns_list.addItem(item)

        self._update_duplicate_columns_enabled()

    def _update_duplicate_columns_enabled(self):
        enabled = self.duplicate_combo.currentData() == "selected"
        self.duplicate_columns_list.setEnabled(enabled)

    def _populate_categorical_columns(self, columns, selected_overrides):
        self.categorical_columns_list.clear()

        selected = set(selected_overrides)
        for column in columns:
            item = QListWidgetItem(str(column))
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(
                Qt.CheckState.Checked
                if str(column) in selected
                else Qt.CheckState.Unchecked
            )
            item.setData(Qt.ItemDataRole.UserRole, str(column))
            self.categorical_columns_list.addItem(item)

    def _current_column_type_overrides(self) -> dict[str, str]:
        overrides = {}
        for i in range(self.categorical_columns_list.count()):
            item = self.categorical_columns_list.item(i)
            if item.checkState() == Qt.CheckState.Checked:
                overrides[str(item.data(Qt.ItemDataRole.UserRole))] = (
                    "Категориальный"
                )
        return overrides

    def _apply_cleaning(self):
        if self.selected_index is None:
            return

        record = self.records[self.selected_index]
        options = self._current_options()

        # И обычный, и большой файл обрабатываются в worker, чтобы
        # тяжёлая очистка никогда не блокировала Qt GUI.
        self._start_worker(
            [record.dataset.file_path],
            options,
            replace_index=self.selected_index,
            column_type_overrides=self._current_column_type_overrides(),
        )

    def _save_cleaned_dataset(self):
        if self.selected_index is None:
            return

        record = self.records[self.selected_index]
        stem = record.dataset.filename.rsplit(".", 1)[0]

        if record.large_output_path:
            self._save_large_file(record.large_output_path, f"{stem}_cleaned")
            return

        self._save_dataframe(
            record.cleaned_dataframe,
            suggested_name=f"{stem}_cleaned",
            dialog_title="Сохранить очищенный датасет",
        )

    def _save_large_file(self, source_path, suggested_name):
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Сохранить очищенный большой датасет",
            suggested_name + ".csv",
            "CSV (*.csv)",
        )
        if not file_path:
            return

        if not file_path.lower().endswith(".csv"):
            file_path += ".csv"

        self._start_save_worker(target_path=file_path, source_path=source_path)

    def _save_merged_dataset(self):
        if self.merged_output_path:
            self._save_large_file(self.merged_output_path, "merged")
            return

        if self.merged_dataframe is None:
            return

        self._save_dataframe(
            self.merged_dataframe,
            suggested_name="merged",
            dialog_title="Сохранить объединённый датасет",
        )

    def _save_dataframe(self, dataframe: pd.DataFrame, suggested_name: str, dialog_title: str):
        file_path, chosen_filter = QFileDialog.getSaveFileName(
            self,
            dialog_title,
            suggested_name,
            "CSV (*.csv);;Excel (*.xlsx)",
        )

        if not file_path:
            return

        wants_xlsx = "xlsx" in chosen_filter.lower()
        if wants_xlsx and not file_path.lower().endswith(".xlsx"):
            file_path += ".xlsx"
        elif not wants_xlsx and not file_path.lower().endswith(".csv"):
            file_path += ".csv"

        self._start_save_worker(target_path=file_path, dataframe=dataframe)

    def _start_save_worker(self, *, target_path: str, source_path: str | None = None, dataframe: pd.DataFrame | None = None):
        if self._save_thread is not None:
            QMessageBox.information(self, "Сохранение", "Другое сохранение уже выполняется.")
            return

        thread = QThread(self)
        worker = SaveWorker(
            target_path=target_path,
            source_path=source_path,
            dataframe=dataframe,
        )
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.finished.connect(self._on_save_finished)
        worker.error.connect(self._on_save_error)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(self._save_thread_finished)

        self._save_thread = thread
        self._save_worker = worker
        self.add_button.setEnabled(False)
        self.remove_button.setEnabled(False)
        self.apply_cleaning_button.setEnabled(False)
        self.save_button.setEnabled(False)
        self.save_merged_button.setEnabled(False)
        self.status_label.setVisible(True)
        self.status_label.setText("Сохранение файла…")
        self.progress_bar.setVisible(True)
        self.progress_bar.setRange(0, 0)
        thread.start()

    def _on_save_finished(self, path):
        QMessageBox.information(self, "Готово", f"Файл сохранён:\n{path}")

    def _on_save_error(self, message):
        QMessageBox.critical(self, "Ошибка сохранения", f"Не удалось сохранить файл:\n{message}")

    def _save_thread_finished(self):
        self._save_thread = None
        self._save_worker = None
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setVisible(False)
        self.status_label.setVisible(False)
        self.add_button.setEnabled(True)
        self.save_merged_button.setEnabled(
            self.merged_dataframe is not None or self.merged_output_path is not None
        )
        self._update_selection_buttons()

    def _show_dataset_info(self, record: DatasetRecord):
        dataframe = record.cleaned_dataframe
        mode = (
            "Большой файл: данные обрабатываются чанками; в таблице показан "
            "предпросмотр первых строк."
            if record.is_large
            else "Обычный режим."
        )
        self.info_label.setText(
            f"Файл: {record.dataset.filename}  "
            f"(кодировка: {record.dataset.encoding or '—'}, "
            f"разделитель: {record.dataset.separator_display})<br>"
            f"Строк в результате: {record.dataset.row_count:,}    "
            f"Столбцов: {len(dataframe.columns)}<br>"
            f"{mode}"
        )

    def _show_preview(self, record: DatasetRecord):
        self.table_model = DataFrameModel(record.cleaned_dataframe)
        self.table.setModel(self.table_model)

        # Не вызываем resizeColumnsToContents для миллионов строк.
        self.table.resizeColumnsToContents()

    def _show_profile(self, record: DatasetRecord):
        profile = record.profile

        self.dataset_summary.setText(
            f"<b>Профиль:</b> {profile.profile_scope}<br>"
            f"<b>Строк в профиле:</b> {profile.row_count:,}<br>"
            f"<b>Итоговых строк:</b> {record.dataset.row_count:,}<br>"
            f"<b>Столбцов:</b> {profile.column_count}<br>"
            f"<b>Дубликатов удалено:</b> "
            f"{record.cleaning_report.duplicate_report.removed:,}<br>"
            f"<b>Пропусков:</b> {profile.missing_values:,}<br>"
            f"<b>Анализ дубликатов по столбцам:</b> {profile.duplicate_analysis_scope}<br><br>"
            f"<b>Числовых:</b> {profile.numeric_columns}<br>"
            f"<b>Категориальных:</b> {profile.categorical_columns}<br>"
            f"<b>Дата/время:</b> {profile.datetime_columns}<br>"
            f"<b>Текстовых:</b> {profile.text_columns}"
        )

        profile_model = DataFrameModel(
            self._profile_to_dataframe(profile)
        )
        self.profile_table.setModel(profile_model)
        self.profile_table.resizeColumnsToContents()

    def _show_cleaning_report(self, record: DatasetRecord):
        report = record.cleaning_report
        duplicate = report.duplicate_report

        removed_columns = (
            ", ".join(map(str, report.empty_columns_removed))
            if report.empty_columns_removed
            else "нет"
        )

        duplicate_mode = {
            "none": "не выполнялся",
            "all": "по всем столбцам",
            "selected": "по выбранным столбцам",
            "large-file": "в потоковом режиме",
        }.get(duplicate.mode, duplicate.mode)

        duplicate_columns = (
            ", ".join(map(str, duplicate.columns))
            if duplicate.columns
            else "все столбцы"
        )

        manual_categories = (
            ", ".join(sorted(record.column_type_overrides or {}))
            if record.column_type_overrides
            else "нет"
        )

        self.cleaning_summary.setText(
            f"<b>Удалено полностью пустых строк:</b> "
            f"{report.empty_rows_removed:,}<br>"
            f"<b>Удалено полностью пустых столбцов:</b> "
            f"{removed_columns}<br>"
            f"<b>Дубликатов удалено:</b> {duplicate.removed:,}<br>"
            f"<b>Режим дубликатов:</b> {duplicate_mode}<br>"
            f"<b>Столбцы дубликатов:</b> {duplicate_columns}<br>"
            f"<b>Стратегия пустых ячеек:</b> {report.missing_mode}<br>"
            f"<b>Категориальные вручную:</b> {manual_categories}<br>"
            f"<b>Изменено столбцов:</b> "
            f"{len(report.changed_columns)} из {len(report.columns)}"
        )

        report_model = DataFrameModel(
            self._cleaning_report_to_dataframe(report)
        )
        self.cleaning_table.setModel(report_model)
        self.cleaning_table.resizeColumnsToContents()

    def _reset_merge_result(self):
        self.merged_dataframe = None
        self.merge_report = None
        if self.merged_output_path:
            try:
                os.unlink(self.merged_output_path)
            except OSError:
                pass
        self.merged_output_path = None
        self.save_merged_button.setEnabled(False)
        self.merge_report_label.setText("")
        self.merge_result_table.setModel(
            DataFrameModel(pd.DataFrame())
        )

    def _checked_source_indices(self) -> list[int]:
        indices = []
        for i in range(self.merge_sources_list.count()):
            item = self.merge_sources_list.item(i)
            if item.checkState() == Qt.CheckState.Checked:
                indices.append(item.data(Qt.ItemDataRole.UserRole))
        return indices

    def _refresh_merge_sources(self):

        self.merge_sources_list.blockSignals(True)
        self.merge_sources_list.clear()

        for i, record in enumerate(self.records):
            suffix = "  [большой файл]" if record.is_large else ""
            item = QListWidgetItem(f"{record.dataset.filename}{suffix}")
            item.setData(Qt.ItemDataRole.UserRole, i)
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Unchecked)
            self.merge_sources_list.addItem(item)

        self.merge_sources_list.blockSignals(False)
        self._on_merge_sources_changed()

    def _on_merge_sources_changed(self, *_args):
        checked = self._checked_source_indices()

        if not self.records:
            self.merge_hint.setText(
                "Загрузи минимум 2 датасета, чтобы настроить объединение."
            )
        elif len(checked) < 2:
            self.merge_hint.setText(
                f"Отмечено датасетов: {len(checked)} из {len(self.records)}. "
                "Отметь минимум 2, чтобы задать связи."
            )
        else:
            large_checked = sum(1 for i in checked if self.records[i].is_large)
            extra = (
                " Среди отмеченных есть большой файл - выбери его "
                "базовым, чтобы он потоково обрабатывался целиком "
                "(присоединяемым датасетом большой файл быть не может)."
                if large_checked
                else ""
            )
            self.merge_hint.setText(
                f"Отмечено датасетов: {len(checked)}. "
                "Выбери базовый датасет и настрой связи ниже - "
                f"как таблицы и связи в конструкторе запросов.{extra}"
            )

        previous_base = self.merge_base_combo.currentData()
        self.merge_base_combo.blockSignals(True)
        self.merge_base_combo.clear()
        for i in checked:
            self.merge_base_combo.addItem(self.records[i].dataset.filename, i)
        if previous_base in checked:
            self.merge_base_combo.setCurrentIndex(checked.index(previous_base))
        self.merge_base_combo.blockSignals(False)

        self._rebuild_merge_relation_rows()

    def _rebuild_merge_relation_rows(self, *_args):
        # В layout всегда есть один addStretch() в самом конце - чистим
        # всё, что было до него, и добавляем строки связей заново.
        while self.merge_relations_layout.count() > 1:
            child = self.merge_relations_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        self._merge_relation_rows = []

        checked = self._checked_source_indices()
        base_index = self.merge_base_combo.currentData()

        if base_index is None or len(checked) < 2:
            self.merge_button.setEnabled(False)
            return

        base_record = self.records[base_index]
        base_is_large = base_record.is_large
        base_columns = [str(c) for c in base_record.cleaned_dataframe.columns]

        others = [i for i in checked if i != base_index]
        usable_others = [i for i in others if not self.records[i].is_large]
        blocked_others = [i for i in others if self.records[i].is_large]

        # Большой файл нельзя использовать как присоединяемый (см.
        # docstring core.merger.merge_large_base) - показываем его как
        # неактивную строку с объяснением.
        for other_index in blocked_others:
            row_widget = QFrame()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 4, 0, 4)
            note = QLabel(
                f"{self.records[other_index].dataset.filename} - "
                "недоступно как связь: большой файл можно использовать "
                "только как базовый датасет."
            )
            note.setWordWrap(True)
            note.setStyleSheet("color: gray;")
            row_layout.addWidget(note)
            self.merge_relations_layout.insertWidget(
                self.merge_relations_layout.count() - 1, row_widget
            )

        for other_index in usable_others:
            other_columns = [
                str(c)
                for c in self.records[other_index].cleaned_dataframe.columns
            ]

            row_widget = QFrame()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 4, 0, 4)

            row_layout.addWidget(
                QLabel(self.records[other_index].dataset.filename)
            )

            base_combo = QComboBox()
            base_combo.addItems(base_columns)
            row_layout.addWidget(base_combo)

            row_layout.addWidget(QLabel("="))

            other_combo = QComboBox()
            other_combo.addItems(other_columns)
            row_layout.addWidget(other_combo)

            common = set(base_columns) & set(other_columns)
            if common:
                guess = next(c for c in base_columns if c in common)
                base_combo.setCurrentText(guess)
                other_combo.setCurrentText(guess)

            how_combo = QComboBox()
            how_combo.addItem("только совпадающие", "inner")
            how_combo.addItem("все строки базового", "left")
            if not base_is_large:

                how_combo.addItem("все строки из обоих", "outer")
            row_layout.addWidget(how_combo)

            overlap_label = QLabel("")
            overlap_label.setWordWrap(True)
            row_layout.addWidget(overlap_label, stretch=1)

            self.merge_relations_layout.insertWidget(
                self.merge_relations_layout.count() - 1, row_widget
            )

            row_info = {
                "dataset_index": other_index,
                "base_combo": base_combo,
                "other_combo": other_combo,
                "how_combo": how_combo,
                "overlap_label": overlap_label,
            }
            self._merge_relation_rows.append(row_info)

            def make_updater(info=row_info, base_idx=base_index):
                def _update(*_unused):
                    self._update_relation_overlap_label(info, base_idx)
                return _update

            updater = make_updater()
            base_combo.currentIndexChanged.connect(updater)
            other_combo.currentIndexChanged.connect(updater)
            updater()

        self.merge_button.setEnabled(bool(usable_others))

    def _update_relation_overlap_label(self, row_info, base_index):
        base_column = row_info["base_combo"].currentText()
        other_column = row_info["other_combo"].currentText()
        if not base_column or not other_column:
            row_info["overlap_label"].setText("")
            return

        base_record = self.records[base_index]
        base_series = base_record.cleaned_dataframe[base_column]
        other_series = self.records[row_info["dataset_index"]].cleaned_dataframe[
            other_column
        ]

        overlap = column_pair_overlap(base_series, other_series)
        approx_note = (
            " (по предпросмотру - базовый датасет большой)"
            if base_record.is_large
            else ""
        )
        row_info["overlap_label"].setText(
            f"пересечение {overlap.overlap_ratio:.0%} "
            f"(общих значений: {overlap.common_values}){approx_note}"
        )

    def _render_merge_report(self, report: MergeReport):
        relations_text = "<br>".join(report.relation_descriptions)
        unmatched_text = "; ".join(
            f"{name}: {count} значений без пары"
            for name, count in zip(
                report.dataset_names, report.unmatched_counts
            )
        ) or "нет"
        notes_text = (
            "<br><b>Внимание:</b> " + "; ".join(report.notes)
            if report.notes
            else ""
        )

        self.merge_report_label.setText(
            f"<b>Базовый датасет:</b> {report.base_name}<br>"
            f"<b>Связи:</b><br>{relations_text}<br>"
            f"<b>Строк в базовом датасете:</b> {report.row_count_before:,}<br>"
            f"<b>Строк в результате:</b> {report.row_count_after:,}<br>"
            f"<b>Не найдено пары:</b> {unmatched_text}"
            f"{notes_text}"
        )

    def _run_merge(self):
        checked = self._checked_source_indices()
        base_index = self.merge_base_combo.currentData()

        if (
            base_index is None
            or len(checked) < 2
            or not self._merge_relation_rows
        ):
            QMessageBox.information(
                self,
                "Недостаточно данных",
                "Отметь минимум 2 датасета и настрой хотя бы одну связь.",
            )
            return

        base_record = self.records[base_index]

        if base_record.is_large:
            used_indices = sorted(
                {row["dataset_index"] for row in self._merge_relation_rows}
            )
            local_index_of = {orig: i for i, orig in enumerate(used_indices)}
            other_dataframes = [
                self.records[i].cleaned_dataframe for i in used_indices
            ]
            other_names = [
                self.records[i].dataset.filename for i in used_indices
            ]
            relations = [
                JoinRelation(
                    dataset_index=local_index_of[row["dataset_index"]],
                    base_column=row["base_combo"].currentText(),
                    other_column=row["other_combo"].currentText(),
                    how=row["how_combo"].currentData(),
                )
                for row in self._merge_relation_rows
            ]
            self._start_merge_worker(base_record, other_dataframes, other_names, relations)
            return

        dataframes = [r.cleaned_dataframe for r in self.records]
        names = [r.dataset.filename for r in self.records]

        relations = [
            JoinRelation(
                dataset_index=row["dataset_index"],
                base_column=row["base_combo"].currentText(),
                other_column=row["other_combo"].currentText(),
                how=row["how_combo"].currentData(),
            )
            for row in self._merge_relation_rows
        ]

        try:
            merged, report = merge_datasets(
                dataframes,
                names,
                base_index=base_index,
                relations=relations,
            )
        except Exception as error:
            QMessageBox.critical(
                self,
                "Ошибка объединения",
                str(error),
            )
            return

        if self.merged_output_path:
            try:
                os.unlink(self.merged_output_path)
            except OSError:
                pass
        self.merged_output_path = None
        self.merged_dataframe = merged
        self.merge_report = report

        self.merge_result_table.setModel(DataFrameModel(merged))
        self.merge_result_table.resizeColumnsToContents()
        self._render_merge_report(report)

        self.save_merged_button.setEnabled(True)

    def _start_merge_worker(self, base_record, other_dataframes, other_names, relations):
        if self._merge_thread is not None or self._load_thread is not None:
            return

        self.merge_button.setEnabled(False)
        self.add_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.status_label.setVisible(True)

        thread = QThread(self)
        worker = MergeWorker(
            base_record.large_output_path,
            base_record.dataset.filename,
            base_record.cleaned_dataframe,
            other_dataframes,
            other_names,
            relations,
        )
        worker.moveToThread(thread)

        thread.started.connect(worker.run)
        worker.progress.connect(self._on_worker_progress)
        worker.finished.connect(self._on_merge_worker_finished)
        worker.error.connect(self._on_worker_error)

        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)

        self._merge_thread = thread
        self._merge_worker = worker
        thread.finished.connect(self._merge_thread_finished)
        thread.start()

    def _merge_thread_finished(self):
        self._merge_thread = None
        self._merge_worker = None
        self.add_button.setEnabled(True)
        self.cancel_button.setEnabled(False)
        self.progress_bar.setVisible(False)
        self.status_label.setVisible(False)
        self.merge_button.setEnabled(True)

    def _on_merge_worker_finished(self, payload):
        if payload is None:
            self.status_label.setText("Объединение отменено.")
            return

        output_path, preview, report = payload

        if self.merged_output_path:
            try:
                os.unlink(self.merged_output_path)
            except OSError:
                pass

        self.merged_output_path = output_path
        self.merged_dataframe = preview
        self.merge_report = report

        self.merge_result_table.setModel(DataFrameModel(preview))
        self.merge_result_table.resizeColumnsToContents()
        self._render_merge_report(report)

        self.save_merged_button.setEnabled(True)

    @staticmethod
    def _profile_to_dataframe(profile: DatasetProfile):
        rows = []

        for column in profile.columns:
            rows.append(
                {
                    "Столбец": column.name,
                    "Тип": column.data_type,
                    "Пустых": column.missing_count,
                    "% пустых": round(column.missing_percent, 2),
                    "Непустых": column.non_empty_count,
                    "Дубликатов": column.duplicate_count,
                    "% дубликатов": round(column.duplicate_percent, 2),
                    "Уникальных": column.unique_count,
                    "Минимум": _format_profile_value(
                        column.min_value
                    ),
                    "Максимум": _format_profile_value(
                        column.max_value
                    ),
                    "Среднее": _format_number(
                        column.mean_value
                    ),
                    "Медиана": _format_number(
                        column.median_value
                    ),
                }
            )

        return pd.DataFrame(rows)

    @staticmethod
    def _cleaning_report_to_dataframe(
        report: CleaningReport,
    ):
        action_labels = {
            "converted_numeric": "Приведён к числу",
            "converted_datetime": "Приведён к дате",
            "trimmed_text": "Обрезаны пробелы",
            "no_change": "Без изменений",
        }

        rows = []

        for column in report.columns:
            rows.append(
                {
                    "Столбец": column.name,
                    "Определённый тип": column.original_type,
                    "Действие": action_labels.get(
                        column.action,
                        column.action,
                    ),
                    "Подробности": column.details,
                }
            )

        if not rows:
            rows.append(
                {
                    "Столбец": "-",
                    "Определённый тип": "-",
                    "Действие": "Потоковая обработка",
                    "Подробности": (
                        "Для большого файла подробный профиль "
                        "полного датасета не строится."
                    ),
                }
            )

        return pd.DataFrame(rows)


def _format_profile_value(value) -> str:
    if value is None:
        return ""

    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d %H:%M:%S")

    return str(value)


def _format_number(value) -> str:
    if value is None:
        return ""

    return f"{value:.2f}"