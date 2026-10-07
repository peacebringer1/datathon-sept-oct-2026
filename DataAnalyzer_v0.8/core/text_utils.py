"""
Общие текстовые хелперы для core/profiler.py и core/cleaner.py.

Раньше нормализация "текст -> число" и "текст -> дата" была продублирована
в profiler.py (для определения ТИПА столбца) и в cleaner.py (для самого
ПРИВЕДЕНИЯ типа). Они незаметно разошлись: profiler убирал пробелы-разделители
тысяч перед проверкой, а cleaner - нет. В результате колонка правильно
определялась как "Числовой", но приведение типов проваливалось на 100%
значений вида "12 345,67" (с пробелом как разделителем тысяч).

Теперь обе стороны используют одни и те же функции - разойтись негде.
"""

import warnings

import pandas as pd


def normalize_numeric_text(series: pd.Series) -> pd.Series:
    """Нормализует распространённые локальные записи чисел."""
    text = (
        series.astype(str)
        .str.strip()
        .str.replace("\u00a0", "", regex=False)
        .str.replace(" ", "", regex=False)
    )

    def normalize_one(value) -> str:
        # Не предполагаем, что map() всегда передаст именно str.
        # В зависимости от pandas dtype/источника здесь может оказаться
        # обычный Python float/int/object. Приводим значение к строке
        # непосредственно перед строковыми операциями.
        if not isinstance(value, str):
            value = str(value)

        if value.lower() in {"nan", "none", "null", "nat"}:
            return value
        if not value:
            return value

        if value.startswith("(") and value.endswith(")"):
            value = "-" + value[1:-1]

        comma_count = value.count(",")
        dot_count = value.count(".")

        if comma_count and dot_count:
            if value.rfind(",") > value.rfind("."):
                return value.replace(".", "").replace(",", ".")
            return value.replace(",", "")

        if comma_count > 1 and dot_count == 0:
            parts = value.split(",")
            if all(part.isdigit() for part in parts):
                if len(parts[-1]) in (1, 2):
                    return "".join(parts[:-1]) + "." + parts[-1]
                return "".join(parts)
            return value

        if comma_count == 1 and dot_count == 0:
            left, right = value.split(",", 1)
            if left.lstrip("-").isdigit() and right.isdigit():
                if len(right) == 3 and len(left.lstrip("-")) <= 3:
                    return left + right
                return left + "." + right

        return value

    return text.map(normalize_one)

def to_numeric_safe(series: pd.Series) -> pd.Series:
    """normalize_numeric_text() + pd.to_numeric(errors='coerce')."""
    return pd.to_numeric(normalize_numeric_text(series), errors="coerce")


def to_datetime_safe(series: pd.Series, dayfirst: bool = True) -> pd.Series:
    """Надёжное преобразование строковых дат в datetime.

    format="mixed" корректно обрабатывает ISO YYYY-MM-DD и смешанные
    однозначно распознаваемые варианты дат в одном столбце.
    """
    text = series.astype(str).str.strip()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        try:
            return pd.to_datetime(
                text,
                errors="coerce",
                dayfirst=dayfirst,
                format="mixed",
            )
        except (TypeError, ValueError):
            return pd.to_datetime(
                text,
                errors="coerce",
                dayfirst=dayfirst,
            )
