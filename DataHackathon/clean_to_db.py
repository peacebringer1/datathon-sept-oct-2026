import pandas as pd
import sqlite3
import os
import re

# Путь к базе данных прямо в корне проекта
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'database.sqlite')

# Путь к папке с CSV файлами (data/raw/)
RAW_DATA_DIR = os.path.join(BASE_DIR, 'data', 'raw')

# Автоматически находим все CSV файлы в папке data/raw/
CSV_FILES = [
    os.path.join(RAW_DATA_DIR, f) 
    for f in os.listdir(RAW_DATA_DIR) 
    if f.endswith('.csv')
] if os.path.exists(RAW_DATA_DIR) else []

# Справочник областей по ключевым словам в названии
REGION_KEYWORDS = {
    'астана': 'г. Астана',
    'алматы': 'г. Алматы',
    'шымкент': 'г. Шымкент',
    'акмол': 'Акмолинская область',
    'актюб': 'Актюбинская область',
    'алматинск': 'Алматинская область',
    'атырау': 'Атырауская область',
    'западно-казахстан': 'Западно-Казахстанская область',
    'зко': 'Западно-Казахстанская область',
    'жамбыл': 'Жамбылская область',
    'караганд': 'Карагандинская область',
    'костанай': 'Костанайская область',
    'кызылорд': 'Кызылординская область',
    'мангистау': 'Мангистауская область',
    'туркестан': 'Туркестанская область',
    'южно-казахстан': 'Туркестанская область',
    'павлодар': 'Павлодарская область',
    'северо-казахстан': 'Северо-Казахстанская область',
    'ско': 'Северо-Казахстанская область',
    'восточно-казахстан': 'Восточно-Казахстанская область',
    'вко': 'Восточно-Казахстанская область',
    'абай': 'Область Абай',
    'жетісу': 'Область Жетісу',
    'жетысу': 'Область Жетісу',
    'ұлытау': 'Область Ұлытау',
    'улытау': 'Область Ұлытау'
}

KATO_NUMERIC = {
    '11': 'Акмолинская область', '15': 'Актюбинская область', '19': 'Алматинская область',
    '23': 'Атырауская область', '27': 'Западно-Казахстанская область', '31': 'Жамбылская область',
    '35': 'Карагандинская область', '39': 'Костанайская область', '43': 'Кызылординская область',
    '47': 'Мангистауская область', '51': 'Туркестанская область', '55': 'Павлодарская область',
    '59': 'Северо-Казахстанская область', '63': 'Восточно-Казахстанская область',
    '10': 'Область Абай', '33': 'Область Жетісу', '62': 'Область Ұлытау',
    '71': 'г. Астана', '75': 'г. Алматы', '79': 'г. Шымкент'
}

def map_kato_to_province(val):
    val_str = str(val).strip().lower()
    if not val_str or val_str == 'nan':
        return 'Неопределенная область'

    for kw, reg_name in REGION_KEYWORDS.items():
        if kw in val_str:
            return reg_name

    digits = re.sub(r'\D', '', val_str)
    if len(digits) >= 2:
        prefix = digits.zfill(9)[:2]
        if prefix in KATO_NUMERIC:
            return KATO_NUMERIC[prefix]

    return 'Неопределенная область'

def find_column_by_keywords(columns, keywords):
    for col in columns:
        col_clean = str(col).lower().replace('"', '').replace("'", '').strip()
        for kw in keywords:
            if kw.lower() in col_clean:
                return col
    return None

def process_file(file_path):
    if not os.path.exists(file_path):
        return pd.DataFrame()

    print(f"\n--- Обработка файла: {file_path} ---")
    df = None
    for sep in ['\t', ',', ';']:
        for encoding in ['utf-8', 'utf-8-sig', 'cp1251']:
            try:
                temp_df = pd.read_csv(file_path, sep=sep, encoding=encoding, low_memory=False, nrows=20)
                if len(temp_df.columns) > 1:
                    df = pd.read_csv(file_path, sep=sep, encoding=encoding, low_memory=False)
                    break
            except Exception:
                continue
        if df is not None:
            break

    if df is None:
        return pd.DataFrame()

    df.columns = [str(c).replace('"', '').replace("'", '').strip() for c in df.columns]

    col_nam = find_column_by_keywords(df.columns, ['nam', 'показатель', 'наименование'])
    col_dat = find_column_by_keywords(df.columns, ['dat', 'дата', 'период', 'год'])
    col_kato = find_column_by_keywords(df.columns, ['като', 'kato', 'lкато', 'lkato'])
    col_val = find_column_by_keywords(df.columns, ['val', 'значение', 'знач'])

    if not all([col_nam, col_dat, col_kato, col_val]):
        return pd.DataFrame()

    df['clean_val'] = df[col_val].astype(str).str.replace(' ', '', regex=False).str.replace(',', '.', regex=False)
    df['clean_val'] = pd.to_numeric(df['clean_val'], errors='coerce').fillna(0)

    df['YEAR'] = df[col_dat].astype(str).str.extract(r'(\d{4})').fillna(0).astype(int)
    df['province'] = df[col_kato].apply(map_kato_to_province)

    df_valid = df[df['province'] != 'Неопределенная область'].copy()
    if df_valid.empty:
        return pd.DataFrame()

    aggregated = df_valid.groupby(['province', 'YEAR', col_nam], as_index=False)['clean_val'].sum()

    return pd.DataFrame({
        'indicator': aggregated[col_nam].astype(str).str.strip(),
        'year': aggregated['YEAR'],
        'province': aggregated['province'],
        'value': aggregated['clean_val']
    })

all_dfs = []
for f in CSV_FILES:
    res = process_file(f)
    if not res.empty:
        all_dfs.append(res)

if not all_dfs:
    print("\nОшибка: Файлы в папке data/raw/ не содержат подходящих данных.")
    exit(1)

full_df = pd.concat(all_dfs, ignore_index=True)

conn = sqlite3.connect(DB_FILE)
full_df.to_sql('demographics', conn, if_exists='replace', index=False)

cursor = conn.cursor()
cursor.execute("CREATE INDEX IF NOT EXISTS idx_indicator ON demographics(indicator);")
cursor.execute("CREATE INDEX IF NOT EXISTS idx_year ON demographics(year);")
cursor.execute("CREATE INDEX IF NOT EXISTS idx_province ON demographics(province);")
cursor.execute("CREATE INDEX IF NOT EXISTS idx_combo ON demographics(indicator, year);")
conn.commit()
conn.close()

print(f"\n Успешно! Создан файл базы: {DB_FILE}. Всего записей: {len(full_df)}")