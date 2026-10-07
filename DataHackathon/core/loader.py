import csv
import io
from pathlib import Path

import pandas as pd


SUPPORTED_EXTENSIONS = {".csv", ".xlsx"}

CSV_ENCODINGS = [
    "utf-8-sig",
    "utf-8",
    "cp1251",
    "cp866",
    "koi8-r",
    "iso-8859-5",
    "latin-1",
]

CSV_SEPARATORS = [",", ";", "\t", "|"]


class Dataset:
    def __init__(
        self,
        dataframe: pd.DataFrame,
        file_path: str,
        encoding: str | None = None,
        separator: str | None = None,
        total_row_count: int | None = None,
        is_large: bool = False,
    ):
        self.dataframe = dataframe
        self.file_path = file_path
        self.encoding = encoding
        self.separator = separator
        self.total_row_count = (
            len(dataframe) if total_row_count is None else total_row_count
        )
        self.is_large = is_large

    @property
    def filename(self) -> str:
        return Path(self.file_path).name

    @property
    def row_count(self) -> int:
        return self.total_row_count

    @property
    def column_count(self) -> int:
        return len(self.dataframe.columns)

    @property
    def separator_display(self) -> str:
        names = {
            ",": "запятая",
            ";": "точка с запятой",
            "\t": "табуляция",
            "|": "вертикальная черта",
        }
        if self.separator is None:
            return "—"
        return names.get(self.separator, repr(self.separator))


def load_dataset(
    file_path: str,
    *,
    nrows: int | None = None,
) -> Dataset:
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError("Файл не найден.")

    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            "Неподдерживаемый формат файла. Используйте CSV или XLSX."
        )

    if path.suffix.lower() == ".xlsx":
        dataframe = pd.read_excel(path, nrows=nrows)
        dataframe.columns = _normalize_column_names(dataframe.columns)
        if dataframe.empty:
            raise ValueError("Файл не содержит данных.")
        return Dataset(dataframe, str(path), encoding=None, separator=None)

    dataframe, encoding, separator = _read_csv(
        path,
        nrows=nrows,
    )

    if dataframe.empty:
        raise ValueError("Файл не содержит данных.")

    dataframe.columns = _normalize_column_names(dataframe.columns)

    return Dataset(
        dataframe,
        str(path),
        encoding=encoding,
        separator=separator,
    )


def detect_csv_format(path: Path) -> tuple[str, str]:
    """Определяет кодировку и разделитель по небольшой выборке.

    Кандидаты оцениваются по фактической структуре CSV с учётом кавычек,
    а не только по количеству получившихся pandas-столбцов. Это снижает
    вероятность принять неправильный разделитель за корректный.
    """
    errors = []
    candidates = []
    raw_sample = path.read_bytes()[:512_000]

    for encoding in CSV_ENCODINGS:
        try:
            decoded = raw_sample.decode(encoding, errors="strict")
        except UnicodeError as error:
            errors.append(f"{encoding}: {error}")
            continue

        for separator in CSV_SEPARATORS:
            structure_score, row_width = _score_csv_structure(
                decoded, separator
            )
            if structure_score < 0:
                continue

            try:
                sample = pd.read_csv(
                    io.BytesIO(raw_sample),
                    encoding=encoding,
                    sep=separator,
                    engine="c",
                    nrows=2000,
                    on_bad_lines="error",
                )
            except (
                UnicodeDecodeError,
                pd.errors.ParserError,
                UnicodeError,
            ) as error:
                errors.append(f"{encoding} / {separator!r}: {error}")
                continue

            if not _looks_like_valid_dataframe(sample):
                continue

            normalized_columns = _normalize_column_names(sample.columns)
            duplicate_headers = len(set(normalized_columns)) != len(normalized_columns)
            unnamed_count = sum(
                str(c).strip().lower().startswith("unnamed")
                for c in sample.columns
            )
            non_empty_ratio = (
                float(sample.notna().mean().mean())
                if not sample.empty
                else 0.0
            )

            score = structure_score
            if row_width >= 2:
                score += 20
            score += min(len(sample.columns), 50) * 2
            score += non_empty_ratio * 10
            score -= unnamed_count * 10
            if duplicate_headers:
                score -= 25

            candidates.append(
                (score, len(sample.columns), encoding, separator)
            )

    if not candidates:
        error_details = "\n".join(errors[-10:])
        raise ValueError(
            "Не удалось определить кодировку или разделитель CSV-файла.\n\n"
            "Попробованные кодировки:\n"
            + ", ".join(CSV_ENCODINGS)
            + "\n\nПопробованные разделители: , ; TAB |\n\n"
            f"Последние ошибки:\n{error_details}"
        )

    _, _, encoding, separator = max(
        candidates,
        key=lambda c: (c[0], c[1]),
    )
    return encoding, separator

def iter_csv_chunks(
    file_path: str,
    *,
    chunksize: int = 100_000,
):
    path = Path(file_path)
    encoding, separator = detect_csv_format(path)

    reader = pd.read_csv(
        path,
        encoding=encoding,
        sep=separator,
        engine="c",
        chunksize=chunksize,
    )

    for chunk in reader:
        chunk.columns = _normalize_column_names(chunk.columns)
        yield chunk, encoding, separator


def _read_csv(
    path: Path,
    *,
    nrows: int | None = None,
) -> tuple[pd.DataFrame, str, str]:
    encoding, separator = detect_csv_format(path)

    dataframe = pd.read_csv(
        path,
        encoding=encoding,
        sep=separator,
        engine="c",
        nrows=nrows,
    )
    return dataframe, encoding, separator



def _score_csv_structure(text: str, separator: str) -> tuple[float, int]:
    """Оценивает разделитель по фактической структуре CSV-строк."""
    try:
        reader = csv.reader(
            io.StringIO(text),
            delimiter=separator,
            quotechar='"',
        )
        rows = []
        for index, row in enumerate(reader):
            rows.append(row)
            if index >= 499:
                break
    except csv.Error:
        return -1.0, 0

    if len(rows) < 2:
        return -1.0, 0

    widths = [len(row) for row in rows]
    mode_width = max(set(widths), key=widths.count)
    consistency = widths.count(mode_width) / len(widths)

    if mode_width == 1:
        has_real_separator = any(
            separator in field
            for row in rows[1:]
            for field in row
        )
        if has_real_separator:
            return -1.0, 1
        return consistency * 10, 1

    score = consistency * 100
    score += min(mode_width, 50)
    if consistency < 0.85:
        score -= 40

    return score, mode_width

def _looks_like_valid_dataframe(dataframe: pd.DataFrame) -> bool:
    if dataframe.empty:
        return False

    if len(dataframe.columns) == 1:
        column_name = str(dataframe.columns[0])
        suspicious_separators = (";", "\t", "|")

        if any(
            separator in column_name
            for separator in suspicious_separators
        ):
            return False

    return True


def _normalize_column_names(columns) -> list[str]:
    """Обрезает пробелы и делает имена столбцов уникальными."""
    result: list[str] = []
    used: set[str] = set()
    counters: dict[str, int] = {}

    for raw in columns:
        base = str(raw).strip() or "Unnamed"
        count = counters.get(base, 0) + 1
        candidate = base if count == 1 else f"{base}.{count}"
        while candidate in used:
            count += 1
            candidate = f"{base}.{count}"
        counters[base] = count
        used.add(candidate)
        result.append(candidate)

    return result
