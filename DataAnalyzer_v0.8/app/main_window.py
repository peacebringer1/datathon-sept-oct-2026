from dataclasses import dataclass, field, replace
import os
import shutil

import pandas as pd

from PyQt6.QtCore import (
    QAbstractTableModel,
    QModelIndex,
    Qt,
    QThread,
)
from PyQt6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
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
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.workers import (
    CoalesceColumnsWorker,
    CombineColumnsWorker,
    DatasetLoadWorker,
    MergeWorker,
    SaveWorker,
)
from core.cleaner import CleaningOptions, CleaningReport, clean_dataset
from core.decodings import (
    DecodingRule,
    MATCH_EXACT,
    MATCH_RANGE,
    unique_value_counts,
    unique_value_counts_csv,
)
from core.duplicates import DuplicateReport
from core.loader import Dataset
from core.merger import (
    ColumnOverlap,
    JoinRelation,
    MergeReport,
    column_pair_overlap,
    common_columns,
    merge_datasets,
)
from core.profiler import DatasetProfile, profile_dataset
from core.transformations import (
    CoalesceRule,
    coalesce_columns,
    combine_columns,
    combine_columns_csv,
)
from core.version import APP_VERSION


@dataclass
class DatasetRecord:
    dataset: Dataset
    cleaned_dataframe: pd.DataFrame
    profile: DatasetProfile
    cleaning_report: CleaningReport
    large_output_path: str | None = None
    column_type_overrides: dict[str, str] | None = None
    cleaning_options: CleaningOptions = field(default_factory=CleaningOptions)
    decoding_rules: list[DecodingRule] = field(default_factory=list)
    source_column_types: dict[str, str] = field(default_factory=dict)
    column_rename_map: dict[str, str] = field(default_factory=dict)
    absolute_duplicate_count: int = 0

    @property
    def is_large(self) -> bool:
        return self.large_output_path is not None or self.dataset.is_large


class DataFrameModel(QAbstractTableModel):
    """Ленивая Qt-модель поверх DataFrame: таблица не копирует данные."""

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


class ColumnRenameDialog(QDialog):
    """Небольшой редактор имён итоговых столбцов перед сохранением."""

    def __init__(
        self,
        columns,
        existing_mapping: dict[str, str] | None = None,
        parent=None,
    ):
        super().__init__(parent)
        self.setWindowTitle("Переименование итоговых столбцов")
        self.resize(760, 520)

        existing_mapping = existing_mapping or {}

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Укажи новые имена только для тех столбцов, которые нужно "
                "переименовать. Изменения применяются только к сохраняемому файлу."
            )
        )

        self.table = QTableWidget(len(columns), 2)
        self.table.setHorizontalHeaderLabels(["Текущее имя", "Имя в сохранённом файле"])
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.table.setColumnWidth(0, 330)
        self.table.setColumnWidth(1, 330)

        for row, column in enumerate(columns):
            original = str(column)
            current = str(existing_mapping.get(original, original))

            original_item = QTableWidgetItem(original)
            original_item.setFlags(
                original_item.flags() & ~Qt.ItemFlag.ItemIsEditable
            )
            self.table.setItem(row, 0, original_item)
            self.table.setItem(row, 1, QTableWidgetItem(current))

        layout.addWidget(self.table, stretch=1)

        layout.addWidget(
            QLabel(
                "Имена должны быть непустыми и уникальными. "
                "Оставь текущее имя, чтобы столбец не переименовывать."
            )
        )

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._validate_and_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def rename_mapping(self) -> dict[str, str]:
        mapping = {}
        for row in range(self.table.rowCount()):
            original = self.table.item(row, 0).text().strip()
            renamed = self.table.item(row, 1).text().strip()
            if renamed != original:
                mapping[original] = renamed
        return mapping

    def _validate_and_accept(self):
        names = []
        for row in range(self.table.rowCount()):
            item = self.table.item(row, 1)
            name = item.text().strip() if item is not None else ""
            if not name:
                QMessageBox.warning(
                    self,
                    "Пустое имя",
                    f"У столбца №{row + 1} указано пустое имя.",
                )
                return
            names.append(name)

        if len(names) != len(set(names)):
            QMessageBox.warning(
                self,
                "Дублирующиеся имена",
                "После переименования имена столбцов должны быть уникальными.",
            )
            return

        self.accept()



class ColumnCombineDialog(QDialog):
    """Настройка объединения нескольких столбцов одного датасета в один."""

    def __init__(self, columns, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Объединение столбцов внутри датасета")
        self.resize(820, 650)
        self.setMinimumSize(700, 520)

        layout = QVBoxLayout(self)
        hint = QLabel(
            "Выбери минимум 2 столбца. Они будут объединены в указанном порядке, "
            "а исходные столбцы удалены. Пустые части можно пропускать."
        )
        hint.setWordWrap(True)
        layout.addWidget(hint)

        layout.addWidget(QLabel("Столбцы и их порядок:"))
        self.columns_list = QListWidget()
        self.columns_list.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        for column in columns:
            item = QListWidgetItem(str(column))
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Unchecked)
            self.columns_list.addItem(item)
        layout.addWidget(self.columns_list, stretch=1)

        order_row = QHBoxLayout()
        self.up_button = QPushButton("↑ Выше")
        self.down_button = QPushButton("↓ Ниже")
        self.up_button.clicked.connect(lambda: self._move_selected(-1))
        self.down_button.clicked.connect(lambda: self._move_selected(1))
        order_row.addWidget(self.up_button)
        order_row.addWidget(self.down_button)
        order_row.addStretch()
        layout.addLayout(order_row)

        form = QVBoxLayout()
        name_row = QHBoxLayout()
        name_row.addWidget(QLabel("Имя нового столбца:"))
        self.new_name = QLineEdit()
        self.new_name.setPlaceholderText("Например: ФИО")
        name_row.addWidget(self.new_name, stretch=1)
        form.addLayout(name_row)

        separator_row = QHBoxLayout()
        separator_row.addWidget(QLabel("Разделитель:"))
        self.separator = QLineEdit(" ")
        self.separator.setMaximumWidth(180)
        self.separator.setToolTip("Например: пробел, /, -, _ или любой другой текст.")
        separator_row.addWidget(self.separator)
        separator_row.addStretch()
        form.addLayout(separator_row)

        self.skip_empty = QCheckBox("Пропускать пустые значения")
        self.skip_empty.setChecked(True)
        form.addWidget(self.skip_empty)
        layout.addLayout(form)

        self.status = QLabel("")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._validate_and_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self._refresh_status()

    def _move_selected(self, delta: int):
        row = self.columns_list.currentRow()
        target = row + delta
        if row < 0 or target < 0 or target >= self.columns_list.count():
            return
        current = self.columns_list.takeItem(row)
        self.columns_list.insertItem(target, current)
        self.columns_list.setCurrentRow(target)
        self._refresh_status()

    def _selected_columns(self) -> list[str]:
        result = []
        for row in range(self.columns_list.count()):
            item = self.columns_list.item(row)
            if item.checkState() == Qt.CheckState.Checked:
                result.append(item.text())
        return result

    def _refresh_status(self):
        selected = self._selected_columns()
        self.status.setText(
            f"Выбрано: {len(selected)} столбцов. "
            "Отмеченные столбцы будут заменены одним итоговым столбцом."
        )

    def _validate_and_accept(self):
        columns = self._selected_columns()
        new_name = self.new_name.text().strip()
        if len(columns) < 2:
            QMessageBox.warning(
                self, "Недостаточно столбцов", "Выбери минимум 2 столбца."
            )
            return
        if not new_name:
            QMessageBox.warning(
                self, "Нет имени", "Укажи имя нового столбца."
            )
            return
        remaining = [
            self.columns_list.item(row).text()
            for row in range(self.columns_list.count())
            if self.columns_list.item(row).checkState() != Qt.CheckState.Checked
        ]
        if new_name in remaining:
            QMessageBox.warning(
                self,
                "Имя уже используется",
                f"Столбец «{new_name}» уже существует среди сохраняемых столбцов.",
            )
            return
        self.accept()

    def values(self):
        return (
            self._selected_columns(),
            self.new_name.text().strip(),
            self.separator.text(),
            self.skip_empty.isChecked(),
        )


class CoalesceOptimizationDialog(QDialog):
    """Настройка схлопывания нескольких столбцов в один после JOIN или внутри датасета."""

    def __init__(
        self,
        column_choices,
        parent=None,
        *,
        title="Оптимизация итоговых столбцов",
        hint_text=None,
    ):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(900, 720)
        self.setMinimumSize(760, 560)
        self._rules: list[dict] = []
        self._column_choices = list(column_choices)

        layout = QVBoxLayout(self)
        hint = QLabel(
            hint_text
            or (
                "Создай правило и добавляй в него столбцы кнопкой «Добавить». "
                "Столбцы будут схлопнуты в указанном порядке. При пустом + непустом "
                "значении останется непустое, одинаковые значения схлопнутся, "
                "а различия попадут в отдельный столбец «<имя>_конфликт»."
            )
        )
        hint.setWordWrap(True)
        layout.addWidget(hint)

        self.scroll_container = QWidget()
        self.scroll_layout = QVBoxLayout(self.scroll_container)
        self.scroll_layout.setContentsMargins(0, 0, 0, 0)
        self.scroll_layout.addStretch()

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(self.scroll_container)
        layout.addWidget(scroll, stretch=1)

        buttons_row = QHBoxLayout()
        add_rule_button = QPushButton("Добавить правило")
        add_rule_button.clicked.connect(self._add_rule)
        buttons_row.addWidget(add_rule_button)
        buttons_row.addStretch()
        layout.addLayout(buttons_row)

        self.status = QLabel("Добавь хотя бы одно правило.")
        self.status.setWordWrap(True)
        layout.addWidget(self.status)

        dialog_buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok
            | QDialogButtonBox.StandardButton.Cancel
        )
        dialog_buttons.accepted.connect(self._validate_and_accept)
        dialog_buttons.rejected.connect(self.reject)
        layout.addWidget(dialog_buttons)

        # Сразу показываем первое правило с двумя позициями - это минимально
        # необходимое количество столбцов для операции.
        self._add_rule()

    def _column_label(self, column: str) -> str:
        for value, label in self._column_choices:
            if str(value) == str(column):
                return str(label)
        return str(column)

    def _create_column_row(self, info):
        row = QWidget()
        row_layout = QHBoxLayout(row)
        row_layout.setContentsMargins(0, 0, 0, 0)

        label = QLabel()
        label.setMinimumWidth(90)

        combo = QComboBox()
        combo.setMinimumWidth(420)
        for column, display_label in self._column_choices:
            combo.addItem(str(display_label), str(column))

        remove_button = QPushButton("Удалить")
        remove_button.setMaximumWidth(90)
        remove_button.clicked.connect(lambda: self._remove_column_row(info, row))

        row_layout.addWidget(label)
        row_layout.addWidget(combo, stretch=1)
        row_layout.addWidget(remove_button)

        info["column_rows"].append({
            "widget": row,
            "label": label,
            "combo": combo,
            "remove_button": remove_button,
        })
        combo.currentIndexChanged.connect(self._refresh_status)
        return row

    def _refresh_column_rows(self, info):
        rows = info["column_rows"]
        for position, row in enumerate(rows, start=1):
            row["label"].setText(f"Столбец {position}:")
            # Нельзя удалить строку, если останется меньше двух позиций.
            row["remove_button"].setEnabled(len(rows) > 2)

    def _add_column_row(self, info):
        row = self._create_column_row(info)
        info["columns_layout"].addWidget(row)
        self._refresh_column_rows(info)
        self._refresh_status()

    def _remove_column_row(self, info, row_widget):
        rows = info["column_rows"]
        if len(rows) <= 2:
            return

        target = next((row for row in rows if row["widget"] is row_widget), None)
        if target is None:
            return

        rows.remove(target)
        target["widget"].deleteLater()
        self._refresh_column_rows(info)
        self._refresh_status()

    def _add_rule(self):
        box = QGroupBox(f"Правило {len(self._rules) + 1}")
        rule_layout = QVBoxLayout(box)
        rule_layout.addWidget(
            QLabel("Столбцы, содержащие одну и ту же информацию:")
        )

        columns_container = QWidget()
        columns_layout = QVBoxLayout(columns_container)
        columns_layout.setContentsMargins(0, 0, 0, 0)

        info = {
            "box": box,
            "columns_layout": columns_layout,
            "column_rows": [],
            "name_edit": None,
        }
        self._rules.append(info)

        # Минимум две строки выбора.
        self._add_column_row(info)
        self._add_column_row(info)
        rule_layout.addWidget(columns_container)

        add_column_button = QPushButton("Добавить")
        add_column_button.setToolTip("Добавить ещё один столбец в это правило")
        add_column_button.clicked.connect(lambda: self._add_column_row(info))
        rule_layout.addWidget(add_column_button)
        info["add_column_button"] = add_column_button

        name_row = QHBoxLayout()
        name_row.addWidget(QLabel("Итоговое имя:"))
        name_edit = QLineEdit()
        name_edit.setPlaceholderText("Например: Регион")
        name_row.addWidget(name_edit, stretch=1)
        rule_layout.addLayout(name_row)
        info["name_edit"] = name_edit

        remove_button = QPushButton("Удалить правило")
        remove_button.clicked.connect(lambda: self._remove_rule(info))
        rule_layout.addWidget(remove_button)
        info["remove_rule_button"] = remove_button

        name_edit.textChanged.connect(self._refresh_status)
        self.scroll_layout.insertWidget(self.scroll_layout.count() - 1, box)
        self._refresh_column_rows(info)
        self._refresh_status()

    def _remove_rule(self, info):
        if info in self._rules:
            self._rules.remove(info)
        info["box"].deleteLater()
        for number, current in enumerate(self._rules, start=1):
            current["box"].setTitle(f"Правило {number}")
        self._refresh_status()

    @staticmethod
    def _selected_columns(info) -> list[str]:
        return [
            str(row["combo"].currentData())
            for row in info["column_rows"]
            if row["combo"].currentIndex() >= 0
        ]

    def _refresh_status(self):
        if not self._rules:
            self.status.setText("Добавь хотя бы одно правило.")
            return

        valid_rules = 0
        duplicate_count = 0
        for info in self._rules:
            columns = self._selected_columns(info)
            if len(columns) >= 2:
                valid_rules += 1
            duplicate_count += len(columns) - len(set(columns))

        message = (
            f"Настроено правил: {len(self._rules)}. "
            f"Готовых правил: {valid_rules}."
        )
        if duplicate_count:
            message += " Есть повторно выбранные столбцы - их нужно исправить."
        else:
            message += " Проверка конфликтов выполняется после запуска оптимизации."
        self.status.setText(message)

    def _validate_and_accept(self):
        if not self._rules:
            QMessageBox.warning(
                self, "Нет правил", "Добавь хотя бы одно правило."
            )
            return

        used: set[str] = set()
        target_names: set[str] = set()
        available = {str(column) for column, _ in self._column_choices}

        for number, info in enumerate(self._rules, start=1):
            columns = self._selected_columns(info)
            name = info["name_edit"].text().strip()
            if len(columns) < 2:
                QMessageBox.warning(
                    self,
                    "Недостаточно столбцов",
                    f"Правило {number}: добавь минимум 2 столбца.",
                )
                return
            if len(columns) != len(set(columns)):
                QMessageBox.warning(
                    self,
                    "Повторный столбец",
                    f"Правило {number}: один и тот же столбец выбран несколько раз.",
                )
                return
            if not name:
                QMessageBox.warning(
                    self,
                    "Нет имени",
                    f"Правило {number}: укажи имя итогового столбца.",
                )
                return
            if any(column not in available for column in columns):
                QMessageBox.warning(
                    self,
                    "Недоступный столбец",
                    f"Правило {number}: один из выбранных столбцов отсутствует в результате.",
                )
                return
            overlap = used.intersection(columns)
            if overlap:
                QMessageBox.warning(
                    self,
                    "Повторное использование",
                    "Один столбец нельзя использовать в нескольких правилах: "
                    + ", ".join(sorted(overlap)),
                )
                return
            remaining = available.difference(columns)
            if name in remaining or name in target_names:
                QMessageBox.warning(
                    self,
                    "Повторяющееся имя",
                    f"Имя итогового столбца «{name}» уже используется.",
                )
                return
            used.update(columns)
            target_names.add(name)

        self.accept()

    def rules(self) -> list[CoalesceRule]:
        return [
            CoalesceRule(
                columns=self._selected_columns(info),
                new_column=info["name_edit"].text().strip(),
            )
            for info in self._rules
        ]


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
        self._merge_relation_groups: list[dict] = []
        self._merge_thread: QThread | None = None
        self._merge_worker: MergeWorker | None = None
        self._coalesce_thread: QThread | None = None
        self._coalesce_worker: CoalesceColumnsWorker | None = None
        self._combine_thread: QThread | None = None
        self._combine_worker: CombineColumnsWorker | None = None
        self._coalesce_rule_widgets: list[dict] = []
        self._single_coalesce_record_index: int | None = None

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

    # ---------------- UI ----------------

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

        self.rename_columns_button = QPushButton("Переименовать столбцы…")
        self.rename_columns_button.clicked.connect(self._rename_columns_for_save)
        self.rename_columns_button.setEnabled(False)

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
        top_layout.addWidget(self.rename_columns_button)
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
        self.tabs.addTab(self._create_transformations_tab(), "Преобразования")
        self.tabs.addTab(self._create_decodings_tab(), "Расшифровки")
        self.tabs.addTab(self._create_merge_tab(), "Объединение датасетов")
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

        self.data_summary = QLabel("Выбери датасет для просмотра.")
        self.data_summary.setWordWrap(True)
        layout.addWidget(self.data_summary)

        actions = QHBoxLayout()
        actions.addStretch()
        layout.addLayout(actions)

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

    def _create_transformations_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        self.transformations_dataset_label = QLabel(
            "Выбери датасет слева."
        )
        self.transformations_dataset_label.setWordWrap(True)
        layout.addWidget(self.transformations_dataset_label)

        optimize_box = QGroupBox("Оптимизация информации в одном датасете")
        optimize_layout = QVBoxLayout(optimize_box)

        self.open_single_coalesce_button = QPushButton(
            "Настроить оптимизацию…"
        )
        self.open_single_coalesce_button.clicked.connect(
            self._open_single_coalesce_dialog
        )
        self.open_single_coalesce_button.setEnabled(False)
        optimize_layout.addWidget(self.open_single_coalesce_button)

        self.single_coalesce_status_label = QLabel(
            "Выбери датасет, чтобы настроить схлопывание дублирующейся информации."
        )
        self.single_coalesce_status_label.setWordWrap(True)
        optimize_layout.addWidget(self.single_coalesce_status_label)
        layout.addWidget(optimize_box)

        combine_box = QGroupBox("Объединение значений столбцов")
        combine_layout = QVBoxLayout(combine_box)

        self.combine_columns_button = QPushButton(
            "Объединить столбцы внутри датасета…"
        )
        self.combine_columns_button.clicked.connect(
            self._open_internal_combine_dialog
        )
        self.combine_columns_button.setEnabled(False)
        combine_layout.addWidget(self.combine_columns_button)

        combine_hint = QLabel(
            "Выбранные столбцы склеиваются в один новый столбец, а исходные удаляются. "
            "Например: Фамилия + Имя + Отчество → ФИО."
        )
        combine_hint.setWordWrap(True)
        combine_layout.addWidget(combine_hint)
        layout.addWidget(combine_box)

        layout.addStretch()
        return widget

    def _create_decodings_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        selector_row = QHBoxLayout()
        selector_row.addWidget(QLabel("Датасет:"))
        self.decoding_dataset_combo = QComboBox()
        self.decoding_dataset_combo.currentIndexChanged.connect(
            self._on_decoding_dataset_changed
        )
        selector_row.addWidget(self.decoding_dataset_combo, stretch=1)

        selector_row.addWidget(QLabel("Столбец:"))
        self.decoding_column_combo = QComboBox()
        self.decoding_column_combo.currentIndexChanged.connect(
            self._on_decoding_column_changed
        )
        selector_row.addWidget(self.decoding_column_combo, stretch=1)

        self.load_unique_button = QPushButton("Обновить уникальные значения")
        self.load_unique_button.clicked.connect(self._load_unique_decoding_values)
        selector_row.addWidget(self.load_unique_button)
        layout.addLayout(selector_row)

        self.decoding_type_label = QLabel(
            "Выбери датасет и столбец."
        )
        self.decoding_type_label.setWordWrap(True)
        layout.addWidget(self.decoding_type_label)

        layout.addWidget(QLabel(
            "Уникальные значения (для больших CSV список строится по всему файлу):"
        ))
        self.decoding_unique_table = QTableView()
        self.decoding_unique_table.setAlternatingRowColors(True)
        self.decoding_unique_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.decoding_unique_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        layout.addWidget(self.decoding_unique_table, stretch=2)

        unique_buttons = QHBoxLayout()
        self.use_unique_value_button = QPushButton(
            "Подставить выбранное значение"
        )
        self.use_unique_value_button.clicked.connect(
            self._use_selected_unique_value
        )
        unique_buttons.addWidget(self.use_unique_value_button)
        unique_buttons.addStretch()
        layout.addLayout(unique_buttons)

        rules_box = QGroupBox("Правила расшифровки")
        rules_layout = QVBoxLayout(rules_box)
        rules_hint = QLabel(
            "Точное значение работает для любого типа. Диапазон доступен "
            "только для числовых и дата/временных столбцов. Диапазоны включают "
            "обе границы."
        )
        rules_hint.setWordWrap(True)
        rules_layout.addWidget(rules_hint)

        editor = QHBoxLayout()
        editor.addWidget(QLabel("Тип:"))
        self.decoding_match_combo = QComboBox()
        self.decoding_match_combo.addItem("Точное значение", MATCH_EXACT)
        self.decoding_match_combo.addItem("Диапазон", MATCH_RANGE)
        self.decoding_match_combo.currentIndexChanged.connect(
            self._update_decoding_editor_state
        )
        editor.addWidget(self.decoding_match_combo)

        editor.addWidget(QLabel("От:"))
        self.decoding_from_edit = QLineEdit()
        editor.addWidget(self.decoding_from_edit, stretch=1)

        editor.addWidget(QLabel("До:"))
        self.decoding_to_edit = QLineEdit()
        editor.addWidget(self.decoding_to_edit, stretch=1)

        editor.addWidget(QLabel("Расшифровка:"))
        self.decoding_replacement_edit = QLineEdit()
        editor.addWidget(self.decoding_replacement_edit, stretch=1)

        self.add_decoding_rule_button = QPushButton("Добавить правило")
        self.add_decoding_rule_button.clicked.connect(
            self._add_decoding_rule
        )
        editor.addWidget(self.add_decoding_rule_button)
        rules_layout.addLayout(editor)

        self.decoding_rules_table = QTableWidget(0, 5)
        self.decoding_rules_table.setHorizontalHeaderLabels(
            ["Столбец", "Тип", "От", "До", "Расшифровка"]
        )
        self.decoding_rules_table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.decoding_rules_table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection
        )
        self.decoding_rules_table.setAlternatingRowColors(True)
        rules_layout.addWidget(self.decoding_rules_table, stretch=1)

        rule_buttons = QHBoxLayout()
        self.remove_decoding_rule_button = QPushButton("Удалить выбранное правило")
        self.remove_decoding_rule_button.clicked.connect(
            self._remove_decoding_rule
        )
        rule_buttons.addWidget(self.remove_decoding_rule_button)
        rule_buttons.addStretch()

        self.apply_decoding_button = QPushButton(
            "Применить расшифровки к датасету"
        )
        self.apply_decoding_button.clicked.connect(
            self._apply_decodings
        )
        self.apply_decoding_button.setEnabled(False)
        rule_buttons.addWidget(self.apply_decoding_button)
        rules_layout.addLayout(rule_buttons)

        layout.addWidget(rules_box, stretch=2)
        return widget

    def _create_merge_tab(self):
        widget = QWidget()
        layout = QVBoxLayout(widget)

        self.merge_hint = QLabel(
            "Загрузи минимум 2 обычных датасета, чтобы настроить объединение."
        )
        self.merge_hint.setWordWrap(True)
        layout.addWidget(self.merge_hint)

        # --- Источники: как список таблиц в конструкторе запросов 1С -
        # отмечаешь, какие датасеты участвуют в объединении. Большие
        # файлы показаны, но недоступны для отметки (см. _refresh_merge_sources).
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

        # --- Базовый датасет: левая часть всех связей, как основная
        # таблица запроса в 1С, к которой присоединяются остальные.
        base_row = QHBoxLayout()
        base_row.addWidget(QLabel("Базовый датасет (левая часть связей):"))
        self.merge_base_combo = QComboBox()
        self.merge_base_combo.currentIndexChanged.connect(
            self._rebuild_merge_relation_rows
        )
        base_row.addWidget(self.merge_base_combo, stretch=1)
        layout.addLayout(base_row)

        # --- Связи: для каждого присоединяемого датасета - своя пара
        # столбцов (имена могут отличаться!) и свой тип объединения,
        # с живым индикатором пересечения значений - как таблица связей
        # в конструкторе запросов 1С.
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

        self.allow_many_to_many_checkbox = QCheckBox(
            "Разрешить многократное соединение N:M"
        )
        self.allow_many_to_many_checkbox.setToolTip(
            "Если один и тот же составной ключ встречается несколько раз "
            "в обоих датасетах, результат может содержать несколько строк "
            "на один ключ и резко увеличиться. Для таких связей разрешение "
            "нужно включить явно."
        )
        layout.addWidget(self.allow_many_to_many_checkbox)

        self.merge_report_label = QLabel("")
        self.merge_report_label.setWordWrap(True)
        layout.addWidget(self.merge_report_label)

        optimization_box = QGroupBox("Оптимизация итоговых столбцов")
        optimization_layout = QHBoxLayout(optimization_box)

        self.open_coalesce_button = QPushButton(
            "Настроить оптимизацию…"
        )
        self.open_coalesce_button.clicked.connect(self._open_coalesce_dialog)
        self.open_coalesce_button.setEnabled(False)
        optimization_layout.addWidget(self.open_coalesce_button)

        self.coalesce_status_label = QLabel(
            "Доступно после объединения датасетов."
        )
        self.coalesce_status_label.setWordWrap(True)
        optimization_layout.addWidget(self.coalesce_status_label, stretch=1)
        layout.addWidget(optimization_box)

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

    # ---------------- Загрузка ----------------

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

    def _busy_operation_name(self) -> str | None:
        if self._load_thread is not None:
            return "загрузка/очистка датасета"
        if self._merge_thread is not None:
            return "объединение датасетов"
        if self._coalesce_thread is not None:
            return "оптимизация столбцов"
        if self._combine_thread is not None:
            return "объединение столбцов"
        if self._save_thread is not None:
            return "сохранение файла"
        return None

    def _ensure_not_busy(self, operation: str) -> bool:
        current = self._busy_operation_name()
        if current is None:
            return True
        QMessageBox.information(
            self,
            "Программа занята",
            f"Невозможно запустить операцию «{operation}»: сейчас выполняется "
            f"{current}.\n\nДождись завершения текущей операции или отмени её.",
        )
        return False

    def _start_worker(
        self,
        file_paths,
        options,
        replace_index=None,
        column_type_overrides: dict[str, str] | None = None,
    ):
        if not self._ensure_not_busy("загрузка/очистка датасета"):
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
        pending_options = getattr(
            self._load_worker,
            "options",
            CleaningOptions(),
        ) if self._load_worker is not None else CleaningOptions()
        pending_rules = list(getattr(pending_options, "decoding_rules", []))
        saved_options = replace(
            pending_options,
            decoding_rules=list(pending_rules),
        )

        for result in results:
            if result[0] == "normal":
                _, dataset, cleaned, profile, report = result
                absolute_duplicate_count = int(
                    cleaned.duplicated(keep="first").sum()
                )
                record = DatasetRecord(
                    dataset=dataset,
                    cleaned_dataframe=cleaned,
                    profile=profile,
                    cleaning_report=report,
                    column_type_overrides=dict(pending_overrides),
                    cleaning_options=saved_options,
                    decoding_rules=list(pending_rules),
                    absolute_duplicate_count=absolute_duplicate_count,
                    source_column_types={
                        str(item.name): item.data_type
                        for item in (
                            report.pre_duplicate_profile.columns
                            if report.pre_duplicate_profile is not None
                            else profile.columns
                        )
                    },
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
                    missing_mode=pending_options.missing_mode,
                    decoding_changes=dict(large_result.decoding_changes),
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
                    absolute_duplicate_count=large_result.absolute_duplicate_count,
                    cleaning_options=saved_options,
                    decoding_rules=list(pending_rules),
                    source_column_types=dict(large_result.source_column_types),
                )

            if (
                replacement_index is not None
                and 0 <= replacement_index < len(self.records)
            ):
                old_record = self.records[replacement_index]
                record.column_rename_map = dict(old_record.column_rename_map)
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
        if self.tabs.tabText(self.tabs.currentIndex()) == "Расшифровки":
            self._refresh_decoding_dataset_selector()

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
        if self._coalesce_worker is not None:
            self._coalesce_worker.cancel()
            self.status_label.setText(
                "Остановка оптимизации после текущего блока…"
            )
            self.cancel_button.setEnabled(False)
        if self._combine_worker is not None:
            self._combine_worker.cancel()
            self.status_label.setText(
                "Остановка объединения столбцов после текущего блока…"
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
        self.rename_columns_button.setEnabled(has_selection)
        self.apply_cleaning_button.setEnabled(has_selection)
        if hasattr(self, "combine_columns_button"):
            self.combine_columns_button.setEnabled(has_selection)
        self._refresh_single_transform_options()

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
        if self.tabs.tabText(self.tabs.currentIndex()) == "Расшифровки":
            self._refresh_decoding_dataset_selector()
        self._update_selection_buttons()

    def _on_tab_changed(self, index: int):
        tab_name = self.tabs.tabText(index)
        if tab_name == "Объединение датасетов":
            self._refresh_merge_sources()
        elif tab_name == "Расшифровки":
            self._refresh_decoding_dataset_selector()
        elif tab_name == "Преобразования":
            self._refresh_single_transform_options()

    # ---------------- Очистка ----------------

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
        options.decoding_rules = list(record.decoding_rules)

        # И обычный, и большой файл обрабатываются в worker, чтобы
        # тяжёлая очистка никогда не блокировала Qt GUI.
        self._start_worker(
            [record.dataset.file_path],
            options,
            replace_index=self.selected_index,
            column_type_overrides=self._current_column_type_overrides(),
        )

    # ---------------- Оптимизация итоговых столбцов ----------------

    def _start_coalesce_worker(self, rules):
        if self._coalesce_thread is not None or self._load_thread is not None or self._merge_thread is not None:
            QMessageBox.information(
                self,
                "Обработка",
                "Другая тяжёлая операция уже выполняется.",
            )
            return

        if hasattr(self, "open_coalesce_button"):
            self.open_coalesce_button.setEnabled(False)
        self.add_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setRange(0, 0)
        self.status_label.setVisible(True)
        self.status_label.setText("Оптимизация большого результата…")

        thread = QThread(self)
        worker = CoalesceColumnsWorker(self.merged_output_path, rules)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.progress.connect(self._on_worker_progress)
        worker.finished.connect(self._on_coalesce_worker_finished)
        worker.error.connect(self._on_worker_error)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(self._coalesce_thread_finished)
        self._coalesce_thread = thread
        self._coalesce_worker = worker
        thread.start()

    def _on_coalesce_worker_finished(self, payload):
        if payload is None:
            self.status_label.setText("Оптимизация отменена.")
            return

        output_path, preview, total_rows, reports = payload
        old_output = self.merged_output_path
        self.merged_output_path = output_path
        self.merged_dataframe = preview
        self._update_merge_origins_after_coalesce(reports)
        if old_output and old_output != output_path:
            try:
                shutil.rmtree(os.path.dirname(old_output), ignore_errors=True)
            except OSError:
                pass

        self.merge_result_table.setModel(DataFrameModel(preview))
        self.merge_result_table.resizeColumnsToContents()
        self._render_merge_report(self.merge_report)
        self.save_merged_button.setEnabled(True)
        self._refresh_coalesce_options()
        QMessageBox.information(self, "Готово", self._coalesce_report_text(reports))

    def _coalesce_thread_finished(self):
        self._coalesce_thread = None
        self._coalesce_worker = None
        self.cancel_button.setEnabled(False)
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setVisible(False)
        self.status_label.setVisible(False)
        self.add_button.setEnabled(True)
        self._update_selection_buttons()
        self._refresh_coalesce_options()
        self._refresh_single_transform_options()

    def _refresh_coalesce_options(self):
        available = bool(
            self.merged_dataframe is not None and self.merge_report is not None
        )
        if hasattr(self, "open_coalesce_button"):
            self.open_coalesce_button.setEnabled(available)
        if hasattr(self, "coalesce_status_label"):
            self.coalesce_status_label.setText(
                "Нажми «Настроить оптимизацию…», чтобы схлопнуть дублирующуюся "
                "информацию из столбцов разных источников."
                if available
                else "Доступно после объединения датасетов."
            )

    def _refresh_single_transform_options(self):
        if not hasattr(self, "open_single_coalesce_button"):
            return

        valid = (
            self.selected_index is not None
            and 0 <= self.selected_index < len(self.records)
            and len(self.records[self.selected_index].cleaned_dataframe.columns) >= 2
        )
        self.open_single_coalesce_button.setEnabled(valid)
        self.combine_columns_button.setEnabled(valid)

        if not valid:
            self.transformations_dataset_label.setText("Выбери датасет слева.")
            self.single_coalesce_status_label.setText(
                "Выбери датасет минимум с двумя столбцами."
            )
            return

        record = self.records[self.selected_index]
        self.transformations_dataset_label.setText(
            f"Текущий датасет: <b>{record.dataset.filename}</b><br>"
            f"Столбцов: {len(record.cleaned_dataframe.columns):,}"
        )
        self.single_coalesce_status_label.setText(
            "Можно схлопнуть одну и ту же информацию из нескольких столбцов. "
            "Пустое + непустое значение даст непустое, одинаковые значения схлопнутся, "
            "а различия попадут в отдельный столбец «<имя>_конфликт»."
        )

    def _open_single_coalesce_dialog(self):
        if self.selected_index is None or not (0 <= self.selected_index < len(self.records)):
            return

        record = self.records[self.selected_index]
        if len(record.cleaned_dataframe.columns) < 2:
            QMessageBox.information(
                self,
                "Оптимизация",
                "В датасете недостаточно столбцов для оптимизации.",
            )
            return

        choices = [
            (str(column), str(column))
            for column in record.cleaned_dataframe.columns
        ]
        dialog = CoalesceOptimizationDialog(
            choices,
            parent=self,
            title="Оптимизация столбцов датасета",
            hint_text=(
                "Добавляй правила для столбцов одного датасета, содержащих одну и ту же "
                "информацию. При пустом + непустом значении останется непустое, "
                "одинаковые значения схлопнутся, а различия попадут в отдельный "
                "столбец «<имя>_конфликт»."
            ),
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        rules = dialog.rules()
        if not rules:
            return

        answer = QMessageBox.warning(
            self,
            "Проверка значений",
            "Перед схлопыванием проверь во вкладке «Расшифровки», что одинаковая "
            "по смыслу информация приведена к единому виду. Например, «Караганда» "
            "и «г. Караганда» будут считаться разными значениями.\n\n"
            "Продолжить оптимизацию выбранного датасета?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return

        if record.large_output_path:
            self._start_single_coalesce_worker(self.selected_index, rules)
            return

        try:
            result = coalesce_columns(record.cleaned_dataframe, rules)
        except Exception as error:
            QMessageBox.critical(
                self,
                "Ошибка оптимизации",
                f"{type(error).__name__}: {error}",
            )
            return

        self._apply_single_coalesce_result(record, result.dataframe, result.rules)
        self._on_dataset_selected(self.selected_index)
        QMessageBox.information(
            self,
            "Готово",
            self._coalesce_report_text(result.rules),
        )

    def _apply_single_coalesce_result(self, record, dataframe, reports):
        record.cleaned_dataframe = dataframe
        record.column_type_overrides = dict(record.column_type_overrides or {})
        record.source_column_types = dict(record.source_column_types or {})
        record.column_rename_map = dict(record.column_rename_map or {})

        for report in reports:
            for column in report.source_columns:
                record.column_type_overrides.pop(column, None)
                record.source_column_types.pop(column, None)
                record.column_rename_map.pop(column, None)
            record.column_type_overrides[report.new_column] = "Текстовый"
            record.source_column_types[report.new_column] = "Текстовый"
            if report.conflict_column:
                record.column_type_overrides[report.conflict_column] = "Текстовый"
                record.source_column_types[report.conflict_column] = "Текстовый"

            record.decoding_rules = [
                rule
                for rule in record.decoding_rules
                if rule.column not in report.source_columns
            ]

        record.profile = profile_dataset(
            dataframe,
            type_overrides=record.column_type_overrides,
        )
        if not record.is_large:
            record.absolute_duplicate_count = int(
                dataframe.duplicated(keep="first").sum()
            )

    def _start_single_coalesce_worker(self, record_index: int, rules):
        if not self._ensure_not_busy("оптимизация столбцов"):
            return

        if record_index < 0 or record_index >= len(self.records):
            return

        record = self.records[record_index]
        if not record.large_output_path:
            return

        self._single_coalesce_record_index = record_index
        old_output = record.large_output_path

        self.open_single_coalesce_button.setEnabled(False)
        self.combine_columns_button.setEnabled(False)
        self.add_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setRange(0, 0)
        self.status_label.setVisible(True)
        self.status_label.setText("Оптимизация большого датасета…")

        thread = QThread(self)
        worker = CoalesceColumnsWorker(old_output, rules)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.progress.connect(self._on_worker_progress)
        worker.finished.connect(
            lambda payload, i=record_index, old=old_output:
            self._on_single_coalesce_worker_finished(payload, i, old)
        )
        worker.error.connect(self._on_worker_error)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(self._coalesce_thread_finished)
        self._coalesce_thread = thread
        self._coalesce_worker = worker
        thread.start()

    def _on_single_coalesce_worker_finished(
        self, payload, record_index: int, old_output: str
    ):
        if payload is None:
            self.status_label.setText("Оптимизация отменена.")
            self._single_coalesce_record_index = None
            return

        output_path, preview, total_rows, reports = payload
        if record_index >= len(self.records):
            try:
                shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)
            except OSError:
                pass
            self._single_coalesce_record_index = None
            return

        record = self.records[record_index]
        record.large_output_path = output_path
        self._apply_single_coalesce_result(record, preview, reports)

        if old_output and old_output != output_path:
            try:
                shutil.rmtree(os.path.dirname(old_output), ignore_errors=True)
            except OSError:
                pass

        self._on_dataset_selected(record_index)
        self._single_coalesce_record_index = None
        self.status_label.setVisible(True)
        self.status_label.setText(
            f"Оптимизация завершена. Обработано строк: {total_rows:,}."
        )
        QMessageBox.information(
            self,
            "Готово",
            self._coalesce_report_text(reports),
        )

    def _merge_column_choices(self):
        if self.merged_dataframe is None:
            return []

        origins = {}
        if self.merge_report is not None:
            origins = dict(self.merge_report.column_origins or {})

        choices = []
        for column in self.merged_dataframe.columns:
            column_name = str(column)
            origin = origins.get(column_name, column_name)
            choices.append((column_name, f"{column_name}  [{origin}]"))
        return choices

    def _open_coalesce_dialog(self):
        if self.merged_dataframe is None or self.merge_report is None:
            QMessageBox.information(
                self,
                "Оптимизация",
                "Сначала выполни объединение датасетов.",
            )
            return

        dialog = CoalesceOptimizationDialog(
            self._merge_column_choices(),
            parent=self,
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        rules = dialog.rules()
        if not rules:
            return

        answer = QMessageBox.warning(
            self,
            "Проверка значений",
            "Перед схлопыванием проверь во вкладке «Расшифровки», что одинаковая "
            "по смыслу информация приведена к единому виду. Например, «Караганда» "
            "и «г. Караганда» будут считаться разными значениями.\n\n"
            "Продолжить схлопывание?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return

        if self.merged_output_path:
            self._start_coalesce_worker(rules)
            return

        try:
            result = coalesce_columns(self.merged_dataframe, rules)
        except Exception as error:
            QMessageBox.critical(
                self,
                "Ошибка оптимизации",
                f"{type(error).__name__}: {error}",
            )
            return

        self.merged_dataframe = result.dataframe
        self._update_merge_origins_after_coalesce(result.rules)
        self.merge_result_table.setModel(DataFrameModel(self.merged_dataframe))
        self.merge_result_table.resizeColumnsToContents()
        self._render_merge_report(self.merge_report)
        self.save_merged_button.setEnabled(True)
        self._refresh_coalesce_options()
        QMessageBox.information(
            self, "Готово", self._coalesce_report_text(result.rules)
        )

    def _update_merge_origins_after_coalesce(self, reports):
        if self.merge_report is None:
            return
        origins = dict(self.merge_report.column_origins or {})
        for report in reports:
            source_labels = [origins.get(column, column) for column in report.source_columns]
            for column in report.source_columns:
                origins.pop(str(column), None)
            origins[report.new_column] = "Схлопывание: " + " + ".join(source_labels)
            if report.conflict_column:
                origins[report.conflict_column] = "Конфликты: " + " + ".join(source_labels)
        self.merge_report.column_origins = origins

    @staticmethod
    def _coalesce_report_text(reports) -> str:
        lines = ["Оптимизация завершена."]
        for report in reports:
            lines.append(
                f"{report.new_column}: источников {len(report.source_columns)}, "
                f"конфликтов {report.conflict_count}, "
                f"строк с единственным непустым значением {report.fallback_count}."
            )
            if report.conflict_column:
                lines[-1] += f" Конфликты: {report.conflict_column}."
        return "\n".join(lines)

    # ---------------- Расшифровки ----------------

    def _source_column_type(self, record: DatasetRecord, column: str) -> str:
        if column in record.source_column_types:
            return record.source_column_types[column]
        profile = record.cleaning_report.pre_duplicate_profile
        if profile is not None:
            for item in profile.columns:
                if str(item.name) == str(column):
                    return item.data_type
        for item in record.profile.columns:
            if str(item.name) == str(column):
                return item.data_type
        return "Неизвестно"

    def _refresh_decoding_dataset_selector(self):
        if not hasattr(self, "decoding_dataset_combo"):
            return

        current = self.selected_index
        self.decoding_dataset_combo.blockSignals(True)
        self.decoding_dataset_combo.clear()
        for index, record in enumerate(self.records):
            self.decoding_dataset_combo.addItem(
                record.dataset.filename, index
            )
        if current is not None and 0 <= current < len(self.records):
            self.decoding_dataset_combo.setCurrentIndex(current)
        self.decoding_dataset_combo.blockSignals(False)
        self._on_decoding_dataset_changed()

    def _on_decoding_dataset_changed(self, *_args):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            self.decoding_column_combo.clear()
            self.decoding_rules_table.setRowCount(0)
            self.apply_decoding_button.setEnabled(False)
            return

        index = int(self.decoding_dataset_combo.currentData())
        record = self.records[index]
        previous = self.decoding_column_combo.currentText()

        self.decoding_column_combo.blockSignals(True)
        self.decoding_column_combo.clear()
        self.decoding_column_combo.addItems(
            [str(column) for column in record.cleaned_dataframe.columns]
        )
        if previous and self.decoding_column_combo.findText(previous) >= 0:
            self.decoding_column_combo.setCurrentText(previous)
        self.decoding_column_combo.blockSignals(False)

        self._render_decoding_rules(record)
        self._on_decoding_column_changed()
        self.apply_decoding_button.setEnabled(bool(record.decoding_rules))

    def _on_decoding_column_changed(self, *_args):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            return
        record = self.records[int(self.decoding_dataset_combo.currentData())]
        column = self.decoding_column_combo.currentText()
        data_type = self._source_column_type(record, column) if column else "Неизвестно"
        self.decoding_type_label.setText(
            f"Тип столбца: <b>{data_type}</b>. "
            "Точное сопоставление доступно всегда; диапазоны - только для чисел и дат/времени."
        )
        self._update_decoding_editor_state()
        self._load_unique_decoding_values()

    def _update_decoding_editor_state(self, *_args):
        match_type = self.decoding_match_combo.currentData()
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            range_allowed = False
        else:
            record = self.records[int(self.decoding_dataset_combo.currentData())]
            column = self.decoding_column_combo.currentText()
            range_allowed = self._source_column_type(record, column) in {
                "Числовой", "Дата/время"
            }
        is_range = match_type == MATCH_RANGE and range_allowed
        self.decoding_match_combo.setItemData(
            1,
            None if range_allowed else "Недоступно для этого типа",
            Qt.ItemDataRole.ToolTipRole,
        )
        self.decoding_to_edit.setEnabled(is_range)
        if match_type == MATCH_RANGE and not range_allowed:
            self.decoding_match_combo.setCurrentIndex(0)

    def _load_unique_decoding_values(self):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            self.decoding_unique_table.setModel(DataFrameModel(pd.DataFrame()))
            return

        index = int(self.decoding_dataset_combo.currentData())
        record = self.records[index]
        column = self.decoding_column_combo.currentText()
        if not column:
            return

        try:
            if record.large_output_path:
                values = unique_value_counts_csv(
                    record.large_output_path,
                    column,
                    limit=10_000,
                )
                scope = "полный большой CSV"
            else:
                values = unique_value_counts(
                    record.cleaned_dataframe,
                    column,
                    limit=10_000,
                )
                scope = "датасет целиком"
        except Exception as error:
            QMessageBox.critical(
                self,
                "Ошибка чтения уникальных значений",
                str(error),
            )
            return

        self.decoding_unique_table.setModel(DataFrameModel(values))
        self.decoding_unique_table.resizeColumnsToContents()
        self.decoding_unique_table.setToolTip(
            f"Показаны значения по области: {scope}. Максимум 10 000 строк."
        )

    def _use_selected_unique_value(self):
        selection = self.decoding_unique_table.selectionModel()
        if selection is None or not selection.hasSelection():
            return
        index = selection.currentIndex()
        value = self.decoding_unique_table.model().index(index.row(), 0).data()
        if value is None or value == "<ПУСТО>":
            return
        self.decoding_match_combo.setCurrentIndex(0)
        self.decoding_from_edit.setText(str(value))
        self.decoding_to_edit.clear()
        self.decoding_replacement_edit.setFocus()

    def _add_decoding_rule(self):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            return
        dataset_index = int(self.decoding_dataset_combo.currentData())
        record = self.records[dataset_index]
        column = self.decoding_column_combo.currentText()
        match_type = self.decoding_match_combo.currentData()
        value_from = self.decoding_from_edit.text().strip()
        value_to = self.decoding_to_edit.text().strip()
        replacement = self.decoding_replacement_edit.text().strip()

        if not column or not value_from or not replacement:
            QMessageBox.warning(
                self,
                "Неполное правило",
                "Укажи столбец, значение и расшифровку.",
            )
            return
        if match_type == MATCH_RANGE and not value_to:
            QMessageBox.warning(
                self,
                "Неполное правило",
                "Для диапазона нужно указать обе границы.",
            )
            return
        if match_type == MATCH_RANGE and self._source_column_type(record, column) not in {
            "Числовой", "Дата/время"
        }:
            QMessageBox.warning(
                self,
                "Недопустимый диапазон",
                "Диапазоны доступны только для числовых и дата/временных столбцов.",
            )
            return

        rule = DecodingRule(
            column=column,
            match_type=match_type,
            value_from=value_from,
            value_to=value_to if match_type == MATCH_RANGE else "",
            replacement=replacement,
        )
        record.decoding_rules.append(rule)
        self._render_decoding_rules(record)
        self.decoding_from_edit.clear()
        self.decoding_to_edit.clear()
        self.decoding_replacement_edit.clear()
        self.apply_decoding_button.setEnabled(True)

    def _remove_decoding_rule(self):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            return
        dataset_index = int(self.decoding_dataset_combo.currentData())
        row = self.decoding_rules_table.currentRow()
        if row < 0:
            return

        selected_column = self.decoding_rules_table.item(row, 0).data(
            Qt.ItemDataRole.UserRole
        )
        column_rules = [
            rule for rule in self.records[dataset_index].decoding_rules
            if rule.column == selected_column
        ]
        target = row
        all_rules = self.records[dataset_index].decoding_rules
        if 0 <= target < len(all_rules):
            del all_rules[target]
        else:
            for rule in column_rules:
                if rule.column == selected_column:
                    all_rules.remove(rule)
                    break
        self._render_decoding_rules(self.records[dataset_index])
        self.apply_decoding_button.setEnabled(bool(self.records[dataset_index].decoding_rules))

    def _render_decoding_rules(self, record: DatasetRecord):
        self.decoding_rules_table.setRowCount(0)
        for rule in record.decoding_rules:
            row = self.decoding_rules_table.rowCount()
            self.decoding_rules_table.insertRow(row)
            column_item = QTableWidgetItem(str(rule.column))
            column_item.setData(Qt.ItemDataRole.UserRole, rule.column)
            self.decoding_rules_table.setItem(row, 0, column_item)
            self.decoding_rules_table.setItem(
                row, 1,
                QTableWidgetItem(
                    "Точное значение"
                    if rule.match_type == MATCH_EXACT
                    else "Диапазон"
                ),
            )
            self.decoding_rules_table.setItem(
                row, 2, QTableWidgetItem(str(rule.value_from))
            )
            self.decoding_rules_table.setItem(
                row, 3, QTableWidgetItem(str(rule.value_to))
            )
            self.decoding_rules_table.setItem(
                row, 4, QTableWidgetItem(str(rule.replacement))
            )
        self.decoding_rules_table.resizeColumnsToContents()
        self.apply_decoding_button.setEnabled(bool(record.decoding_rules))

    def _apply_decodings(self):
        if not self.records or self.decoding_dataset_combo.currentData() is None:
            return
        dataset_index = int(self.decoding_dataset_combo.currentData())
        record = self.records[dataset_index]
        if not record.decoding_rules:
            QMessageBox.information(
                self, "Расшифровки", "Добавь хотя бы одно правило."
            )
            return

        options = replace(
            record.cleaning_options,
            decoding_rules=list(record.decoding_rules),
        )
        self._start_worker(
            [record.dataset.file_path],
            options,
            replace_index=dataset_index,
            column_type_overrides=dict(record.column_type_overrides or {}),
        )


    # ---------------- Объединение столбцов внутри датасета ----------------

    def _open_internal_combine_dialog(self):
        if self.selected_index is None or self.selected_index >= len(self.records):
            return

        record = self.records[self.selected_index]
        dialog = ColumnCombineDialog(
            [str(c) for c in record.cleaned_dataframe.columns],
            parent=self,
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        columns, new_column, separator, skip_empty = dialog.values()
        if record.is_large:
            self._start_combine_columns_worker(
                self.selected_index,
                columns,
                new_column,
                separator,
                skip_empty,
            )
            return

        try:
            result = combine_columns(
                record.cleaned_dataframe,
                columns,
                new_column,
                separator=separator,
                skip_empty=skip_empty,
            )
        except Exception as error:
            QMessageBox.critical(
                self,
                "Ошибка объединения столбцов",
                f"{type(error).__name__}: {error}",
            )
            return

        record.cleaned_dataframe = result.dataframe
        record.column_type_overrides = dict(record.column_type_overrides or {})
        record.source_column_types = dict(record.source_column_types or {})
        record.column_rename_map = dict(record.column_rename_map or {})
        for column in columns:
            record.column_type_overrides.pop(column, None)
            record.source_column_types.pop(column, None)
            record.column_rename_map.pop(column, None)
        record.column_type_overrides[new_column] = "Текстовый"
        record.source_column_types[new_column] = "Текстовый"
        record.profile = profile_dataset(
            record.cleaned_dataframe,
            type_overrides=record.column_type_overrides,
        )
        record.decoding_rules = [
            rule for rule in record.decoding_rules if rule.column not in columns
        ]
        self._on_dataset_selected(self.selected_index)
        self.status_label.setVisible(True)
        self.status_label.setText(
            f"Внутри датасета объединены столбцы: {', '.join(columns)} → {new_column}."
        )
        QMessageBox.information(
            self,
            "Готово",
            f"Создан столбец «{new_column}». Исходные столбцы удалены.",
        )

    def _start_combine_columns_worker(
        self,
        record_index: int,
        columns: list[str],
        new_column: str,
        separator: str,
        skip_empty: bool,
    ):
        if (
            self._combine_thread is not None
            or self._load_thread is not None
            or self._merge_thread is not None
            or self._coalesce_thread is not None
        ):
            QMessageBox.information(
                self,
                "Обработка",
                "Другая тяжёлая операция уже выполняется.",
            )
            return

        record = self.records[record_index]
        old_output = record.large_output_path

        self.add_button.setEnabled(False)
        self.save_button.setEnabled(False)
        self.rename_columns_button.setEnabled(False)
        self.cancel_button.setEnabled(True)
        self.progress_bar.setVisible(True)
        self.progress_bar.setRange(0, 0)
        self.status_label.setVisible(True)
        self.status_label.setText("Объединение столбцов большого датасета…")

        thread = QThread(self)
        worker = CombineColumnsWorker(
            old_output,
            columns,
            new_column,
            separator=separator,
            skip_empty=skip_empty,
        )
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.progress.connect(self._on_worker_progress)
        worker.finished.connect(
            lambda payload, i=record_index, old=old_output, cols=list(columns), name=new_column:
                self._on_combine_columns_worker_finished(
                    payload, i, old, cols, name
                )
        )
        worker.error.connect(self._on_worker_error)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        thread.finished.connect(self._combine_thread_finished)
        self._combine_thread = thread
        self._combine_worker = worker
        thread.start()

    def _on_combine_columns_worker_finished(
        self, payload, record_index, old_output, columns, new_column
    ):
        if payload is None:
            self.status_label.setText("Объединение столбцов отменено.")
            return

        output_path, preview, total_rows = payload
        if record_index >= len(self.records):
            try:
                shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)
            except OSError:
                pass
            return

        record = self.records[record_index]
        record.large_output_path = output_path
        record.cleaned_dataframe = preview
        record.column_type_overrides = dict(record.column_type_overrides or {})
        record.source_column_types = dict(record.source_column_types or {})
        record.column_rename_map = dict(record.column_rename_map or {})
        for column in columns:
            record.column_type_overrides.pop(column, None)
            record.source_column_types.pop(column, None)
            record.column_rename_map.pop(column, None)
        record.column_type_overrides[new_column] = "Текстовый"
        record.source_column_types[new_column] = "Текстовый"
        record.profile = profile_dataset(
            preview,
            type_overrides=record.column_type_overrides,
        )
        record.decoding_rules = [
            rule for rule in record.decoding_rules if rule.column not in columns
        ]

        if old_output and old_output != output_path:
            try:
                shutil.rmtree(os.path.dirname(old_output), ignore_errors=True)
            except OSError:
                pass

        self._on_dataset_selected(record_index)
        self.status_label.setVisible(True)
        self.status_label.setText(
            f"Внутри датасета объединены столбцы. Обработано строк: {total_rows:,}."
        )
        QMessageBox.information(
            self,
            "Готово",
            "Столбцы объединены. Исходные столбцы удалены.",
        )

    def _combine_thread_finished(self):
        self._combine_thread = None
        self._combine_worker = None
        self.cancel_button.setEnabled(False)
        self.progress_bar.setRange(0, 100)
        self.progress_bar.setVisible(False)
        self.status_label.setVisible(False)
        self.add_button.setEnabled(True)
        self._update_selection_buttons()

    # ---------------- Сохранение ----------------

    def _rename_columns_for_save(self):
        if self.selected_index is None:
            return

        record = self.records[self.selected_index]
        dialog = ColumnRenameDialog(
            record.cleaned_dataframe.columns,
            existing_mapping=record.column_rename_map,
            parent=self,
        )
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return

        record.column_rename_map = dialog.rename_mapping()
        self._show_cleaning_report(record)
        if record.column_rename_map:
            self.status_label.setVisible(True)
            self.status_label.setText(
                f"Для сохранения задано переименований: "
                f"{len(record.column_rename_map)}."
            )
        else:
            self.status_label.setVisible(False)

    def _save_cleaned_dataset(self):
        if self.selected_index is None:
            return

        record = self.records[self.selected_index]
        stem = record.dataset.filename.rsplit(".", 1)[0]
        renames = dict(record.column_rename_map)

        if record.large_output_path:
            self._save_large_file(
                record.large_output_path,
                f"{stem}_cleaned",
                column_renames=renames,
            )
            return

        dataframe = record.cleaned_dataframe
        if renames:
            dataframe = dataframe.rename(columns=renames)

        self._save_dataframe(
            dataframe,
            suggested_name=f"{stem}_cleaned",
            dialog_title="Сохранить очищенный датасет",
        )

    def _save_large_file(
        self,
        source_path,
        suggested_name,
        *,
        column_renames: dict[str, str] | None = None,
    ):
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

        self._start_save_worker(
            target_path=file_path,
            source_path=source_path,
            column_renames=column_renames,
        )

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

    def _start_save_worker(
        self,
        *,
        target_path: str,
        source_path: str | None = None,
        dataframe: pd.DataFrame | None = None,
        column_renames: dict[str, str] | None = None,
    ):
        if not self._ensure_not_busy("сохранение файла"):
            return

        thread = QThread(self)
        worker = SaveWorker(
            target_path=target_path,
            source_path=source_path,
            dataframe=dataframe,
            column_renames=column_renames,
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

    # ---------------- Просмотр ----------------

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

        scope = "по всему датасету"
        if record.is_large:
            scope = "по всему обработанному файлу"

        self.data_summary.setText(
            f"<b>Строк:</b> {record.dataset.row_count:,} &nbsp;&nbsp; "
            f"<b>Столбцов:</b> {len(record.cleaned_dataframe.columns):,}<br>"
            f"<b>Абсолютных дубликатов:</b> {record.absolute_duplicate_count:,} "
            f"({scope})<br>"
            f"Абсолютный дубликат - строка, полностью совпадающая с другой "
            f"строкой по всем столбцам; первое вхождение не считается дубликатом."
        )

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
            f"<b>Расшифровок применено:</b> "
            f"{sum(report.decoding_changes.values()):,}<br>"
            f"<b>Переименований при сохранении:</b> "
            f"{len(record.column_rename_map):,}<br>"
            f"<b>Изменено столбцов:</b> "
            f"{len(report.changed_columns)} из {len(report.columns)}"
        )

        report_model = DataFrameModel(
            self._cleaning_report_to_dataframe(report)
        )
        self.cleaning_table.setModel(report_model)
        self.cleaning_table.resizeColumnsToContents()

    # ---------------- Объединение ----------------

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
        if hasattr(self, "coalesce_status_label"):
            self._refresh_coalesce_options()
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
        """Список источников: показывает ВСЕ загруженные датасеты,
        включая большие файлы - теперь их тоже можно отметить (см.
        _rebuild_merge_relation_rows: большой файл можно использовать
        только как БАЗОВЫЙ, потоково, а не как присоединяемый).
        """
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
        # Один блок - один присоединяемый датасет. Внутри блока можно
        # задать несколько пар столбцов: условие работает как AND.
        while self.merge_relations_layout.count() > 1:
            child = self.merge_relations_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        self._merge_relation_rows = []
        self._merge_relation_groups = []

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

        for other_index in blocked_others:
            row_widget = QFrame()
            row_layout = QHBoxLayout(row_widget)
            row_layout.setContentsMargins(0, 4, 0, 4)
            note = QLabel(
                f"{self.records[other_index].dataset.filename} - "
                "недоступно как присоединяемый источник: большой файл "
                "может использоваться только как базовый датасет."
            )
            note.setWordWrap(True)
            note.setStyleSheet("color: gray;")
            row_layout.addWidget(note)
            self.merge_relations_layout.insertWidget(
                self.merge_relations_layout.count() - 1, row_widget
            )

        for other_index in usable_others:
            other_record = self.records[other_index]
            other_columns = [str(c) for c in other_record.cleaned_dataframe.columns]

            group_widget = QGroupBox(other_record.dataset.filename)
            group_layout = QVBoxLayout(group_widget)
            conditions_layout = QVBoxLayout()
            group_layout.addLayout(conditions_layout)

            how_row = QHBoxLayout()
            how_row.addWidget(QLabel("Тип объединения:"))
            how_combo = QComboBox()
            how_combo.addItem("Внутреннее (INNER JOIN)", "inner")
            how_combo.addItem("Левое (LEFT JOIN)", "left")
            if not base_is_large:
                how_combo.addItem("Правое (RIGHT JOIN)", "right")
                how_combo.addItem("Полное (FULL OUTER JOIN)", "outer")
            how_row.addWidget(how_combo)
            how_row.addStretch()
            group_layout.addLayout(how_row)

            group_info = {
                "dataset_index": other_index,
                "group_widget": group_widget,
                "conditions_layout": conditions_layout,
                "how_combo": how_combo,
                "conditions": [],
            }
            self._merge_relation_groups.append(group_info)

            add_button = QPushButton("Добавить условие связи")
            add_button.clicked.connect(
                lambda _checked=False, info=group_info, b=base_index, bc=base_columns, oc=other_columns:
                    self._add_merge_condition(info, b, bc, oc)
            )
            group_layout.addWidget(add_button)

            self._add_merge_condition(
                group_info, base_index, base_columns, other_columns
            )
            self.merge_relations_layout.insertWidget(
                self.merge_relations_layout.count() - 1, group_widget
            )

        self.merge_button.setEnabled(bool(usable_others))

    def _add_merge_condition(
        self,
        group_info,
        base_index: int,
        base_columns: list[str],
        other_columns: list[str],
    ):
        row_widget = QFrame()
        row_layout = QHBoxLayout(row_widget)
        row_layout.setContentsMargins(0, 2, 0, 2)

        base_combo = QComboBox()
        base_combo.addItems(base_columns)
        row_layout.addWidget(base_combo, stretch=1)
        row_layout.addWidget(QLabel("="))

        other_combo = QComboBox()
        other_combo.addItems(other_columns)
        row_layout.addWidget(other_combo, stretch=1)

        remove_button = QPushButton("Удалить")
        row_layout.addWidget(remove_button)

        overlap_label = QLabel("")
        overlap_label.setMinimumWidth(220)
        overlap_label.setWordWrap(True)
        row_layout.addWidget(overlap_label, stretch=1)

        common = set(base_columns) & set(other_columns)
        if common:
            guess = next(c for c in base_columns if c in common)
            base_combo.setCurrentText(guess)
            other_combo.setCurrentText(guess)

        condition = {
            "dataset_index": group_info["dataset_index"],
            "base_combo": base_combo,
            "other_combo": other_combo,
            "overlap_label": overlap_label,
            "row_widget": row_widget,
            "group_info": group_info,
            "base_index": base_index,
        }
        group_info["conditions"].append(condition)
        self._merge_relation_rows.append(condition)

        base_combo.currentIndexChanged.connect(
            lambda *_: self._update_merge_condition_overlap(condition)
        )
        other_combo.currentIndexChanged.connect(
            lambda *_: self._update_merge_condition_overlap(condition)
        )
        remove_button.clicked.connect(
            lambda _checked=False, c=condition: self._remove_merge_condition(c)
        )

        group_info["conditions_layout"].addWidget(row_widget)
        remove_button.setEnabled(len(group_info["conditions"]) > 1)
        self._update_merge_condition_overlap(condition)

    def _remove_merge_condition(self, condition):
        group_info = condition["group_info"]
        if len(group_info["conditions"]) <= 1:
            return
        if condition in group_info["conditions"]:
            group_info["conditions"].remove(condition)
        if condition in self._merge_relation_rows:
            self._merge_relation_rows.remove(condition)
        condition["row_widget"].deleteLater()
        for item in group_info["conditions"]:
            remove_buttons = item["row_widget"].findChildren(QPushButton)
            for button in remove_buttons:
                if button.text() == "Удалить":
                    button.setEnabled(len(group_info["conditions"]) > 1)
        self._update_merge_condition_overlap(
            group_info["conditions"][0]
        )

    def _update_merge_condition_overlap(self, condition):
        base_column = condition["base_combo"].currentText()
        other_column = condition["other_combo"].currentText()
        if not base_column or not other_column:
            condition["overlap_label"].setText("")
            return

        base_index = condition["base_index"]
        base_record = self.records[base_index]
        base_series = base_record.cleaned_dataframe[base_column]
        other_series = self.records[condition["dataset_index"]].cleaned_dataframe[
            other_column
        ]

        overlap = column_pair_overlap(base_series, other_series)
        approx_note = (
            " (по предпросмотру - базовый датасет большой)"
            if base_record.is_large
            else ""
        )
        condition["overlap_label"].setText(
            f"Пересечение: {overlap.common_values:,} общих уникальных "
            f"значений, {overlap.overlap_ratio * 100:.1f}%{approx_note}"
        )

    def _update_relation_overlap_label(self, row_info, base_index):
        # Совместимость со старым внутренним именем. Новая UI-логика
        # использует _update_merge_condition_overlap напрямую.
        condition = dict(row_info)
        condition["base_index"] = base_index
        self._update_merge_condition_overlap(condition)

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
        allow_many_to_many = (
            self.allow_many_to_many_checkbox.isChecked()
            if hasattr(self, "allow_many_to_many_checkbox")
            else False
        )

        if not self._ensure_not_busy("объединение датасетов"):
            return

        if base_record.is_large:
            # Потоковое объединение: большой файл читается блоками в
            # фоновом потоке, чтобы не блокировать GUI (см. app/workers.MergeWorker).
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
            relations = []
            for group in self._merge_relation_groups:
                local_index = local_index_of[group["dataset_index"]]
                how = group["how_combo"].currentData()
                for condition in group["conditions"]:
                    relations.append(
                        JoinRelation(
                            dataset_index=local_index,
                            base_column=condition["base_combo"].currentText(),
                            other_column=condition["other_combo"].currentText(),
                            how=how,
                        )
                    )
            self._start_merge_worker(
                base_record,
                other_dataframes,
                other_names,
                relations,
                allow_many_to_many=allow_many_to_many,
            )
            return

        dataframes = [r.cleaned_dataframe for r in self.records]
        names = [r.dataset.filename for r in self.records]

        relations = []
        for group in self._merge_relation_groups:
            how = group["how_combo"].currentData()
            for condition in group["conditions"]:
                relations.append(
                    JoinRelation(
                        dataset_index=condition["dataset_index"],
                        base_column=condition["base_combo"].currentText(),
                        other_column=condition["other_combo"].currentText(),
                        how=how,
                    )
                )

        try:
            merged, report = merge_datasets(
                dataframes,
                names,
                base_index=base_index,
                relations=relations,
                allow_many_to_many=allow_many_to_many,
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
        self._refresh_coalesce_options()

        self.save_merged_button.setEnabled(True)

    def _start_merge_worker(
        self,
        base_record,
        other_dataframes,
        other_names,
        relations,
        allow_many_to_many: bool = False,
    ):
        if not self._ensure_not_busy("объединение датасетов"):
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
            allow_many_to_many=allow_many_to_many,
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
        self._refresh_coalesce_options()

        self.save_merged_button.setEnabled(True)

    def _render_merge_report(self, report: MergeReport):
        """Показывает краткий отчёт после объединения датасетов.

        Сам merge выполняется отдельно. Этот метод только форматирует
        уже готовый MergeReport, поэтому ошибка в отображении отчёта
        не должна влиять на результат объединения.
        """
        if report is None:
            self.merge_report_label.setText("")
            return

        lines = [
            f"Базовый датасет: {report.base_name}",
            f"Строк: {report.row_count_before:,} → {report.row_count_after:,}",
        ]

        if report.relation_descriptions:
            lines.append("Связи: " + "; ".join(report.relation_descriptions))

        if report.unmatched_counts:
            parts = []
            for name, count in zip(report.dataset_names, report.unmatched_counts):
                parts.append(f"{name}: {count:,}")
            lines.append("Ненайденных уникальных ключей: " + "; ".join(parts))

        if report.cardinality:
            cardinality_lines = []
            for stats in report.cardinality:
                cardinality_lines.append(
                    f"{stats.dataset_name}: {stats.cardinality}; "
                    f"повторных строк ключа {stats.base_duplicate_rows:,} / "
                    f"{stats.other_duplicate_rows:,}; "
                    f"N:M ключей {stats.many_to_many_keys:,}; "
                    f"оценка строк: {stats.estimated_rows:,}"
                )
            lines.append("Кардинальность: " + " | ".join(cardinality_lines))

        if report.notes:
            lines.append("Примечания: " + " | ".join(report.notes))

        self.merge_report_label.setText("\n".join(lines))

    # ---------------- Форматирование ----------------

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
