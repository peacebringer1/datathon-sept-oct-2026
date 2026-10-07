from flask import Flask, request, jsonify
from flask_cors import CORS
sqlite3 = __import__('sqlite3')
import os
import json
from pathlib import Path
import math
import time
import urllib.error
import urllib.request
import pandas as pd

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

DB_FILE = os.path.abspath(os.path.join(FRONTEND_DIR, '..', 'database.sqlite'))
DATA_DIR = Path(FRONTEND_DIR).parent / 'data' / 'sinte'
ACTIVE_DEMOGRAPHICS = None
ACTIVE_DATASET_NAME = None
ACTIVE_DATASET_MODE = None
_D004_CACHE_KEY = None
_D004_CACHE_FRAME = None
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash').strip()
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '').strip()
if GEMINI_MODEL.startswith('models/'):
    GEMINI_MODEL = GEMINI_MODEL[len('models/'):]

print(f"[Flask DB]: Используется база данных по пути -> {DB_FILE}")


class GeminiAPIError(RuntimeError):
    def __init__(self, message, status=None, content_type=None):
        super().__init__(message)
        self.status = status
        self.content_type = content_type


def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.create_function('casefold', 1, lambda value: str(value).casefold() if value is not None else '')
    
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='demographics';")
    if not cursor.fetchone():
        print("[Flask DB]: Таблица 'demographics' не найдена. Создаем дефолтную таблицу...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS demographics (
                indicator TEXT,
                year INTEGER,
                province TEXT,
                value REAL
            )
        ''')
        cursor.executemany('INSERT INTO demographics VALUES (?, ?, ?, ?)', [
            ("Естественный прирост населения", 2021, "г. Алматы", 15000.0),
            ("Естественный прирост населения", 2021, "г. Астана", 12000.0),
            ("Число зарегистрированных браков", 2021, "г. Алматы", 8000.0),
            ("Число зарегистрированных браков", 2021, "г. Астана", 6500.0),
            ("Число зарегистрированных разводов", 2021, "г. Алматы", 3000.0),
            ("Число умерших", 2021, "г. Алматы", 9000.0)
        ])
        conn.commit()
    
    return conn


D004_MODULES = {
    0: 'Сведения о домохозяйстве',
    1: 'Непродовольственные товары',
    2: 'Жилищные услуги, вода, энергия и топливо',
    3: 'Связь',
    4: 'Образование',
    5: 'Здравоохранение',
    6: 'Отдых, культура и прочие услуги',
    7: 'Транспорт',
    9: 'Производство и услуги домохозяйства, часть 1',
    10: 'Производство и услуги домохозяйства, часть 2',
    11: 'Доходы',
    12: 'Заемные средства'
}


def get_d004_path(year, quarter, module):
    if year not in {'2021', '2022', '2023', '2024'}:
        return None
    if quarter not in {'1kv', '2kv', '3kv', '4kv'}:
        return None
    if not module.isdigit() or int(module) not in D004_MODULES:
        return None
    csv_path = DATA_DIR / 'd004' / year / quarter / f'kv_vopr{int(module)}.csv'
    return csv_path if csv_path.is_file() else None


def read_d004_csv(csv_path):
    global _D004_CACHE_KEY, _D004_CACHE_FRAME
    cache_key = (str(csv_path), csv_path.stat().st_mtime_ns)
    if _D004_CACHE_KEY != cache_key:
        try:
            frame = pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='utf-8-sig', low_memory=False)
        except UnicodeDecodeError:
            frame = pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='cp1251', low_memory=False)
        _D004_CACHE_KEY = cache_key
        _D004_CACHE_FRAME = frame
    return _D004_CACHE_FRAME


@app.route('/api/d004/options', methods=['GET'])
def d004_options():
    d004_dir = DATA_DIR / 'd004'
    years = sorted((path.name for path in d004_dir.iterdir() if path.is_dir()), reverse=True) if d004_dir.is_dir() else []
    quarters = ['1kv', '2kv', '3kv', '4kv']
    modules = [{'id': module, 'label': label} for module, label in D004_MODULES.items()]
    return jsonify({'years': years, 'quarters': quarters, 'modules': modules})


@app.route('/api/d004/data', methods=['GET'])
def d004_data():
    year = request.args.get('year', '2024')
    quarter = request.args.get('quarter', '4kv')
    module = request.args.get('module', '1')
    if year != 'all' and year not in {'2021', '2022', '2023', '2024'}:
        return jsonify({'error': 'Выбранный год не поддерживается.'}), 400
    if quarter != 'all' and quarter not in {'1kv', '2kv', '3kv', '4kv'}:
        return jsonify({'error': 'Выбранный квартал не поддерживается.'}), 400
    if not module.isdigit() or int(module) not in D004_MODULES:
        return jsonify({'error': 'Выбранный раздел анкеты не поддерживается.'}), 400

    d004_dir = DATA_DIR / 'd004'
    years = sorted((path.name for path in d004_dir.iterdir() if path.is_dir()), reverse=True) if d004_dir.is_dir() else []
    selected_years = years if year == 'all' else [year]
    selected_quarters = ['1kv', '2kv', '3kv', '4kv'] if quarter == 'all' else [quarter]
    paths = [path for selected_year in selected_years for selected_quarter in selected_quarters
             if (path := get_d004_path(selected_year, selected_quarter, module)) is not None]
    if not paths:
        return jsonify({'error': 'Для выбранного года, квартала и раздела файл не найден.'}), 404

    page = max(1, request.args.get('page', default=1, type=int))
    page_size = min(100, max(10, request.args.get('page_size', default=50, type=int)))
    start = (page - 1) * page_size
    rows, columns, total_rows = [], [], 0
    territory_counts, territory_amounts, households, territory_households = {}, {}, set(), {}
    has_amount = False
    try:
        for csv_path in paths:
            try:
                chunks = pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='utf-8-sig', chunksize=50000, low_memory=False)
                for chunk in chunks:
                    if not columns:
                        columns = [str(column) for column in chunk.columns]
                    chunk_size = len(chunk)
                    left, right = max(start - total_rows, 0), min(start + page_size - total_rows, chunk_size)
                    if left < right:
                        selected = chunk.iloc[left:right].copy()
                        selected['ГОД'] = csv_path.parents[1].name
                        selected['КВАРТАЛ'] = csv_path.parent.name.upper()
                        rows.extend(selected.to_dict(orient='records'))
                    total_rows += chunk_size
                    territory_column = next((column for column in ('TE', 'Te', 'territory') if column in chunk.columns), None)
                    if territory_column:
                        codes = chunk[territory_column].replace('', 'Не указан')
                        counts = codes.value_counts()
                        for code, count in counts.items():
                            territory_counts[str(code)] = territory_counts.get(str(code), 0) + int(count)
                        if 'STOIMK' in chunk.columns:
                            has_amount = True
                            amounts = pd.to_numeric(chunk['STOIMK'], errors='coerce').fillna(0).groupby(codes).sum()
                            for code, amount in amounts.items():
                                territory_amounts[str(code)] = territory_amounts.get(str(code), 0) + float(amount)
                        id_columns = [column for column in ('TE', 'K', 'NOMER') if column in chunk.columns]
                        if id_columns:
                            ids = chunk[id_columns].astype(str).agg('|'.join, axis=1)
                            households.update(ids.tolist())
                            for code, group in ids.groupby(codes):
                                territory_households.setdefault(str(code), set()).update(group.tolist())
            except UnicodeDecodeError:
                for chunk in pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='cp1251', chunksize=50000, low_memory=False):
                    if not columns:
                        columns = [str(column) for column in chunk.columns]
                    chunk_size = len(chunk)
                    left, right = max(start - total_rows, 0), min(start + page_size - total_rows, chunk_size)
                    if left < right:
                        selected = chunk.iloc[left:right].copy()
                        selected['ГОД'] = csv_path.parents[1].name
                        selected['КВАРТАЛ'] = csv_path.parent.name.upper()
                        rows.extend(selected.to_dict(orient='records'))
                    total_rows += chunk_size
                    territory_column = next((column for column in ('TE', 'Te', 'territory') if column in chunk.columns), None)
                    if territory_column:
                        codes = chunk[territory_column].replace('', 'Не указан')
                        for code, count in codes.value_counts().items():
                            territory_counts[str(code)] = territory_counts.get(str(code), 0) + int(count)
                        id_columns = [column for column in ('TE', 'K', 'NOMER') if column in chunk.columns]
                        if id_columns:
                            households.update(chunk[id_columns].astype(str).agg('|'.join, axis=1).tolist())
        # Keep origin fields visible in both single-file and combined views.
        columns = columns + [field for field in ('ГОД', 'КВАРТАЛ') if field not in columns]
    except (OSError, pd.errors.ParserError, UnicodeError) as error:
        print(f'[D004]: Не удалось прочитать {paths}: {error}')
        return jsonify({'error': 'Не удалось прочитать CSV-файл D004.'}), 500

    territory_names = {
        '10': 'Область Абай', '11': 'Акмолинская область', '15': 'Актюбинская область', '19': 'Алматинская область',
        '23': 'Атырауская область', '27': 'Западно-Казахстанская область', '31': 'Жамбылская область',
        '33': 'Область Жетысу', '35': 'Карагандинская область', '39': 'Костанайская область',
        '43': 'Кызылординская область', '47': 'Мангистауская область', '51': 'Туркестанская область',
        '55': 'Павлодарская область', '59': 'Северо-Казахстанская область', '61': 'Туркестанская область',
        '62': 'Область Улытау', '63': 'Восточно-Казахстанская область', '71': 'г. Астана',
        '75': 'г. Алматы', '79': 'г. Шымкент'
    }
    labels = list(territory_counts)
    chart_metric = 'Сумма значений STOIMK в строках выборки' if has_amount else 'Количество записей'
    chart_values = [territory_amounts.get(code, 0) for code in labels] if has_amount else [territory_counts[code] for code in labels]
    summary = [{'code': code, 'territory': territory_names.get(code, 'Неизвестная территория'),
                'records': territory_counts[code], 'households': len(territory_households.get(code, set())),
                'amount': round(territory_amounts.get(code, 0), 2) if has_amount else None}
               for code in labels]
    summary.sort(key=lambda item: item['records'], reverse=True)
    for row in rows:
        row['ГОД'] = row.get('ГОД', '')
        row['КВАРТАЛ'] = row.get('КВАРТАЛ', '')

    return jsonify({
        'dataset': 'd004',
        'year': 'Все годы' if year == 'all' else year,
        'quarter': 'Все кварталы' if quarter == 'all' else quarter,
        'module': int(module),
        'module_label': D004_MODULES[int(module)],
        'columns': columns,
        'rows': rows,
        'page': page,
        'page_size': page_size,
        'total_rows': total_rows,
        'households': len(households),
        'territories': len(territory_counts),
        'chart_metric': chart_metric,
        'chart': {'labels': labels, 'values': chart_values},
        'territory_summary': summary
    })

@app.route('/api/settings/gemini-key', methods=['GET', 'POST', 'DELETE'])
def gemini_key_settings():
    global GEMINI_API_KEY

    if request.method == 'GET':
        return jsonify({'configured': bool(GEMINI_API_KEY)})

    if request.method == 'DELETE':
        GEMINI_API_KEY = ''
        return jsonify({'configured': False})

    payload = request.get_json(silent=True)
    api_key = payload.get('api_key') if isinstance(payload, dict) else None
    if not isinstance(api_key, str):
        return jsonify({'error': 'Введите API-ключ Gemini.'}), 400

    api_key = api_key.strip()
    if len(api_key) < 20:
        return jsonify({'error': 'Ключ выглядит слишком коротким. Вставьте полный API-ключ из Google AI Studio.'}), 400
    try:
        api_key.encode('ascii')
    except UnicodeEncodeError:
        return jsonify({'error': 'API-ключ должен содержать только ASCII-символы.'}), 400

    GEMINI_API_KEY = api_key
    return jsonify({'configured': True})



@app.route('/api/household-radar', methods=['GET'])
def household_radar():
    print("[API Request]: /api/household-radar -> читаем из таблицы 'household_survey'")
    conn = get_db_connection()
    
    def get_score_distribution(col_name):
        try:
            query = f'''
                SELECT {col_name} as score, COUNT(*) as count 
                FROM household_survey 
                WHERE {col_name} BETWEEN 1 AND 10 
                GROUP BY {col_name}
            '''
            rows = conn.execute(query).fetchall()
            counts = {str(r['score']): r['count'] for r in rows}
            return {f"score_{score}": counts.get(str(score), 0) for score in range(10, 0, -1)}
        except sqlite3.Error:
            return {f"score_{score}": 0 for score in range(10, 0, -1)}

    data = {
        'block1': get_score_distribution('GR1'),
        'block2': get_score_distribution('GR4'),
        'block3': get_score_distribution('GR7'),
        'block4': get_score_distribution('GR101'),
        'block5': get_score_distribution('GR13')
    }
    
    conn.close()
    return jsonify(data)


@app.route('/api/indicators', methods=['GET'])
def get_indicators():
    print("[API Request]: /api/indicators -> отдаем список показателей")
    indicators_list = [
        "Естественный прирост населения",
        "Число зарегистрированных браков",
        "Число зарегистрированных разводов",
        "Число умерших"
    ]
    return jsonify(indicators_list)


@app.route('/api/active-dataset', methods=['POST', 'DELETE'])
def active_dataset():
    global ACTIVE_DEMOGRAPHICS, ACTIVE_DATASET_NAME, ACTIVE_DATASET_MODE

    if request.method == 'DELETE':
        ACTIVE_DEMOGRAPHICS = None
        ACTIVE_DATASET_NAME = None
        ACTIVE_DATASET_MODE = None
        return jsonify({'active': False})

    payload = request.get_json(silent=True)
    rows = payload.get('rows') if isinstance(payload, dict) else None
    name = payload.get('name') if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        return jsonify({'error': 'Выбранный датасет не содержит данных.'}), 400
    if len(rows) > 50000:
        return jsonify({'error': 'Для графиков можно передать не более 50 000 строк.'}), 413

    normalized_rows = []
    for row in rows:
        if not isinstance(row, dict):
            return jsonify({'error': 'Неверный формат строк датасета.'}), 400
        try:
            year = int(float(row['year']))
            value = float(row['value'])
            indicator = str(row['indicator']).strip()
            province = str(row['province']).strip()
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
        if not indicator or not province or not math.isfinite(value):
            continue
        normalized_rows.append({
            'indicator': indicator,
            'year': year,
            'province': province,
            'value': value
        })

    if not normalized_rows:
        return jsonify({'error': 'В датасете нет корректных строк для построения графиков.'}), 400

    ACTIVE_DEMOGRAPHICS = normalized_rows
    ACTIVE_DATASET_NAME = str(name or 'Выбранный датасет')[:200]
    mode = payload.get('mode')
    ACTIVE_DATASET_MODE = mode if mode in {'regional', 'distribution'} else 'regional'
    return jsonify({
        'active': True,
        'name': ACTIVE_DATASET_NAME,
        'mode': ACTIVE_DATASET_MODE,
        'rows': len(normalized_rows),
        'indicators': len({row['indicator'] for row in normalized_rows}),
        'years': len({row['year'] for row in normalized_rows})
    })


def active_dataset_rows():
    return ACTIVE_DEMOGRAPHICS


AI_TOOLS = [{
    'functionDeclarations': [
        {
            'name': 'get_dataset_overview',
            'description': 'Получить каталог таблицы demographics: показатели, годы, регионы и количество записей.',
            'parameters': {'type': 'OBJECT', 'properties': {}}
        },
        {
            'name': 'query_demographics',
            'description': 'Прочитать агрегированные данные по показателям Казахстана. Вызывай для вычислений, сравнений, трендов и любых числовых выводов.',
            'parameters': {
                'type': 'OBJECT',
                'properties': {
                    'indicator': {'type': 'STRING', 'description': 'Название показателя или его уникальная часть.'},
                    'province': {'type': 'STRING', 'description': 'Название области/города или его уникальная часть.'},
                    'start_year': {'type': 'INTEGER', 'description': 'Начальный год включительно.'},
                    'end_year': {'type': 'INTEGER', 'description': 'Конечный год включительно.'},
                    'group_by': {
                        'type': 'STRING',
                        'enum': ['none', 'indicator', 'year', 'province', 'province_year'],
                        'description': 'Группировка результата.'
                    },
                    'limit': {'type': 'INTEGER', 'description': 'Максимум строк результата, от 1 до 200.'}
                }
            }
        }
    ]
}]

AI_SYSTEM_INSTRUCTION = '''Ты аналитический помощник дашборда статистики Казахстана.
Отвечай на русском языке, ясно и по существу. Для фактов, чисел, сравнений, рейтингов и трендов из базы обязательно вызывай query_demographics; не придумывай значения и не делай выводы по памяти.
Если не знаешь точное название показателя или региона, сначала вызови get_dataset_overview. Учитывай, что база содержит агрегированные записи demographics: indicator, year, province, value. Объясняй, какие фильтры и годы использованы. Если запрос нельзя подтвердить данными, прямо скажи об этом.
Оформляй ответ простым текстом: не используй Markdown-заголовки с #, выделение через * или ** и кодовые блоки. Не добавляй нумерацию разделов, если она не нужна; вместо маркеров Markdown используй короткие абзацы или тире.
Контекст выбранных фильтров дашборда и история сообщений помогают понять вопрос, но не заменяют проверку базы.'''


def _escape_like(value):
    return str(value).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def get_dataset_overview():
    print("[DB Query]: get_dataset_overview() -> таблица 'demographics'")
    conn = get_db_connection()
    try:
        row_count = conn.execute('SELECT COUNT(*) FROM demographics').fetchone()[0]
        indicators = [row[0] for row in conn.execute(
            'SELECT DISTINCT indicator FROM demographics ORDER BY indicator'
        ).fetchall()]
        years = [row[0] for row in conn.execute(
            'SELECT DISTINCT year FROM demographics WHERE year > 0 ORDER BY year'
        ).fetchall()]
        provinces = [row[0] for row in conn.execute(
            'SELECT DISTINCT province FROM demographics ORDER BY province'
        ).fetchall()]
        return {
            'table': 'demographics',
            'columns': ['indicator', 'year', 'province', 'value'],
            'record_count': row_count,
            'indicators': indicators,
            'years': years,
            'provinces': provinces
        }
    finally:
        conn.close()


def query_demographics(arguments):
    print(f"[DB Query]: query_demographics() с аргументами -> {arguments}")
    group_by = arguments.get('group_by', 'none')
    group_columns = {
        'none': [],
        'indicator': ['indicator'],
        'year': ['year'],
        'province': ['province'],
        'province_year': ['province', 'year']
    }
    if group_by not in group_columns:
        return {'error': 'Недопустимая группировка.'}

    conditions = []
    params = []
    for field, column in [('indicator', 'indicator'), ('province', 'province')]:
        value = arguments.get(field)
        if value:
            value = str(value).strip()[:120]
            conditions.append(f"casefold({column}) LIKE ? ESCAPE '\\'")
            params.append(f"%{_escape_like(value).casefold()}%")

    start_year = arguments.get('start_year')
    end_year = arguments.get('end_year')
    if start_year is not None:
        start_year = int(start_year)
        if start_year < 1900 or start_year > 2100:
            return {'error': 'Начальный год вне допустимого диапазона.'}
        conditions.append('year >= ?')
        params.append(start_year)
    if end_year is not None:
        end_year = int(end_year)
        if end_year < 1900 or end_year > 2100:
            return {'error': 'Конечный год вне допустимого диапазона.'}
        conditions.append('year <= ?')
        params.append(end_year)
    if start_year is not None and end_year is not None and start_year > end_year:
        return {'error': 'Начальный год больше конечного.'}

    limit = max(1, min(int(arguments.get('limit', 100)), 200))
    columns = group_columns[group_by]
    select_columns = ', '.join(columns)
    group_clause = f' GROUP BY {select_columns}' if columns else ''
    order_clause = ' ORDER BY ' + ', '.join(
        f'{column} ASC' for column in columns
    ) if columns else ''
    where_clause = ' WHERE ' + ' AND '.join(conditions) if conditions else ''

    if columns:
        query = (
            f'SELECT {select_columns}, SUM(value) AS total, COUNT(*) AS records '
            f'FROM demographics{where_clause}{group_clause}{order_clause} LIMIT ?'
        )
    else:
        query = (
            f'SELECT SUM(value) AS total, COUNT(*) AS records '
            f'FROM demographics{where_clause}'
        )

    conn = get_db_connection()
    try:
        rows = [dict(row) for row in conn.execute(query, [*params, *([limit] if columns else [])]).fetchall()]
        return {
            'filters': {
                'indicator': arguments.get('indicator'),
                'province': arguments.get('province'),
                'start_year': start_year,
                'end_year': end_year,
                'group_by': group_by
            },
            'rows': rows
        }
    finally:
        conn.close()


@app.route('/api/ai-chat', methods=['POST'])
def ai_chat():
    print("[API Request]: /api/ai-chat -> запрос к ИИ")
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({'error': 'Ожидался JSON-объект.'}), 400
    messages = payload.get('messages')
    if not isinstance(messages, list) or not messages:
        return jsonify({'error': 'Добавьте сообщение для анализа.'}), 400

    contents = []
    for message in messages[-10:]:
        if not isinstance(message, dict) or message.get('role') not in ('user', 'model'):
            return jsonify({'error': 'Некорректная история чата.'}), 400
        text = message.get('text')
        if not isinstance(text, str) or not text.strip():
            return jsonify({'error': 'Сообщения должны содержать текст.'}), 400
        contents.append({
            'role': message['role'],
            'parts': [{'text': text.strip()[:3000]}]
        })

    if contents[-1]['role'] != 'user':
        return jsonify({'error': 'Последнее сообщение должно быть вопросом пользователя.'}), 400

    dashboard_context = payload.get('dashboard_context') or {}
    if not isinstance(dashboard_context, dict):
        dashboard_context = {}
    dashboard_context = {
        str(key)[:50]: value[:1000] if isinstance(value, str) else value
        for key, value in list(dashboard_context.items())[:12]
    }
    if len(json.dumps(dashboard_context, ensure_ascii=False)) > 12000:
        return jsonify({'error': 'Контекст дашборда слишком большой.'}), 400

    try:
        dataset_overview = get_dataset_overview()
        answer = call_gemini(contents, dataset_overview, dashboard_context)
        return jsonify({'answer': answer})
    except GeminiAPIError as error:
        upstream = {}
        if error.status is not None:
            upstream['status'] = error.status
        if error.content_type:
            upstream['content_type'] = error.content_type
        return jsonify({
            'error': {
                'code': 'gemini_api_error',
                'message': str(error),
                'upstream': upstream
            }
        }), 503
    except RuntimeError as error:
        return jsonify({
            'error': {
                'code': 'ai_service_error',
                'message': str(error)
            }
        }), 503
    except (sqlite3.Error, OSError) as error:
        app.logger.exception('Не удалось прочитать аналитическую базу данных')
        return jsonify({'error': f'Не удалось прочитать базу данных: {error}'}), 503


@app.route('/api/chart-analysis', methods=['POST'])
def chart_analysis():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({'error': 'Ожидался JSON-объект с данными графика.'}), 400

    indicator = payload.get('indicator')
    category = payload.get('category', 'Общие данные')
    year = payload.get('year', '')
    chart = payload.get('chart')
    if not isinstance(indicator, str) or not indicator.strip():
        return jsonify({'error': 'Не указан показатель графика.'}), 400
    if not isinstance(category, str) or not isinstance(year, str):
        return jsonify({'error': 'Некорректные фильтры графика.'}), 400
    if not isinstance(chart, dict):
        return jsonify({'error': 'Не переданы данные графика.'}), 400

    labels = chart.get('labels', [])
    series = chart.get('series')
    if not isinstance(labels, list) or len(labels) > 100:
        return jsonify({'error': 'График содержит слишком много подписей.'}), 400
    if any(not isinstance(label, str) or len(label) > 200 for label in labels):
        return jsonify({'error': 'Некорректные подписи графика.'}), 400
    if not isinstance(series, list) or not series or len(series) > 10:
        return jsonify({'error': 'Некорректные ряды данных графика.'}), 400
    for item in series:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get('name', ''), str)
            or len(item.get('name', '')) > 120
            or not isinstance(item.get('type', ''), str)
            or len(item.get('type', '')) > 40
            or not isinstance(item.get('points'), list)
            or len(item['points']) > 100
        ):
            return jsonify({'error': 'Некорректный ряд данных графика.'}), 400
        for point in item['points']:
            if not isinstance(point, dict) or not isinstance(point.get('label', ''), str):
                return jsonify({'error': 'Некорректная точка данных графика.'}), 400
            value = point.get('value')
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, (int, float, str))
                or (isinstance(value, str) and len(value) > 120)
                or (isinstance(value, float) and not math.isfinite(value))
            ):
                return jsonify({'error': 'Некорректное значение на графике.'}), 400

    chart_context = {
        'indicator': indicator.strip()[:200],
        'category': category.strip()[:120],
        'year': year.strip()[:20],
        'chart': chart
    }
    if len(json.dumps(chart_context, ensure_ascii=False)) > 8000:
        return jsonify({'error': 'Данные графика слишком большие для анализа.'}), 400

    prompt = (
        'Проанализируй только переданные фактические данные графика. Верни строго один '
        'JSON-объект без Markdown и пояснений по схеме: '
        '{"trend":"подробное описание динамики в 2–3 предложениях: направление, '
        'этапы, резкие изменения и последние значения, если они есть в данных",'
        '"observations":["конкретное наблюдение с периодом и значением из данных",'
        '"сравнение этапов или групп с числовым подтверждением",'
        '"ещё одно важное изменение или особенность ряда"],'
        '"hypotheses":["развёрнутая гипотеза из 2–3 предложений: возможное объяснение, '
        'на какие особенности графика оно опирается и что следует проверить",'
        '"вторая независимая гипотеза в таком же формате",'
        '"третья гипотеза, если она уместна для этих данных"]}. '
        'Дай содержательный анализ, а не общие фразы. Используй значения графика как '
        'доказательства наблюдений; не придумывай причины и события. Гипотезы явно '
        'обозначай как предположения, указывай, каких данных не хватает для проверки. '
        'Верни 2–3 гипотезы, каждая примерно по 30–60 слов, и до 3 наблюдений. '
        'Не повторяй одну мысль разными словами. Показатель и график: '
        f'{json.dumps(chart_context, ensure_ascii=False)}'
    )

    try:
        raw_analysis = call_gemini(
            [{'role': 'user', 'parts': [{'text': prompt}]}],
            get_dataset_overview(),
            {
                'indicator': chart_context['indicator'],
                'category': chart_context['category'],
                'year': chart_context['year']
            },
            max_output_tokens=1800
        )
        cleaned_analysis = raw_analysis.strip()
        if cleaned_analysis.startswith('```'):
            cleaned_analysis = cleaned_analysis.split('\n', 1)[-1]
            if cleaned_analysis.rstrip().endswith('```'):
                cleaned_analysis = cleaned_analysis.rstrip()[:-3].strip()
        try:
            analysis = json.loads(cleaned_analysis)
        except json.JSONDecodeError as error:
            raise RuntimeError('ИИ вернул анализ в некорректном формате. Повторите запрос.') from error
        if (
            not isinstance(analysis, dict)
            or not isinstance(analysis.get('trend'), str)
            or not analysis['trend'].strip()
            or not isinstance(analysis.get('observations'), list)
            or not analysis['observations']
            or any(not isinstance(item, str) or not item.strip() for item in analysis['observations'])
            or not isinstance(analysis.get('hypotheses'), list)
            or len(analysis['hypotheses']) < 2
            or any(not isinstance(item, str) or not item.strip() for item in analysis['hypotheses'])
        ):
            raise RuntimeError('ИИ вернул неполный анализ графика. Повторите запрос.')
        return jsonify({
            'analysis': {
                'trend': analysis['trend'].strip()[:1200],
                'observations': [item.strip()[:600] for item in analysis['observations'][:3]],
                'hypotheses': [item.strip()[:800] for item in analysis['hypotheses'][:3]]
            }
        })
    except GeminiAPIError as error:
        return jsonify({'error': str(error)}), 503
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 503
    except (sqlite3.Error, OSError) as error:
        app.logger.exception('Не удалось подготовить ИИ-анализ графика')
        return jsonify({'error': f'Не удалось подготовить анализ графика: {error}'}), 503


def call_gemini(contents, dataset_overview, dashboard_context, max_output_tokens=1200):
    api_key = GEMINI_API_KEY
    if not api_key:
        raise RuntimeError('Не задан GEMINI_API_KEY. Добавьте ключ Gemini в переменные окружения и перезапустите приложение.')
    try:
        api_key.encode('ascii')
    except UnicodeEncodeError as error:
        raise RuntimeError(
            'GEMINI_API_KEY содержит недопустимые символы. Скопируйте только ASCII-ключ Gemini '
            'и перезапустите приложение.'
        ) from error

    model = GEMINI_MODEL
    context_text = json.dumps({
        'dataset': dataset_overview,
        'dashboard_filters': dashboard_context
    }, ensure_ascii=False)
    system_instruction = f'{AI_SYSTEM_INSTRUCTION}\n\nФактический каталог базы и выбранные фильтры: {context_text}'

    for _ in range(4):
        body = {
            'systemInstruction': {'parts': [{'text': system_instruction}]},
            'contents': contents,
            'tools': AI_TOOLS,
            'generationConfig': {'temperature': 0.2, 'maxOutputTokens': max_output_tokens}
        }
        retry = 0
        while retry < 3:
            endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
            req = urllib.request.Request(
                endpoint,
                data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'x-goog-api-key': api_key
                },
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=45) as response:
                    result = json.loads(response.read().decode('utf-8'))
                break
            except urllib.error.HTTPError as error:
                response_body = error.read().decode('utf-8', errors='replace')
                try:
                    error_payload = json.loads(response_body)
                except json.JSONDecodeError:
                    error_payload = None

                api_error = error_payload.get('error') if isinstance(error_payload, dict) else None
                if isinstance(api_error, dict) and isinstance(api_error.get('message'), str):
                    details = api_error['message']
                elif isinstance(api_error, str):
                    details = api_error
                else:
                    details = (
                        f'Gemini вернул HTTP {error.code} без JSON-описания '
                        f'(Content-Type: {error.headers.get_content_type()}). '
                        f'Диагностика backend: GEMINI_API_KEY получен, длина после удаления '
                        f'внешних пробелов — {len(api_key)} символов; модель — {model}. '
                        'Сам ключ не отображается. Если длина не совпадает с полным ключом, '
                        'полностью закройте приложение и запустите его из PowerShell, '
                        'в котором задан GEMINI_API_KEY. Если длина верная, проверьте '
                        'ограничения ключа и сетевой доступ к generativelanguage.googleapis.com.'
                    )
                if error.code == 503 and retry < 2:
                    time.sleep(2 ** (retry + 1))
                    retry += 1
                    continue
                raise GeminiAPIError(
                    f'Gemini API ({error.code}): {details}',
                    status=error.code,
                    content_type=error.headers.get_content_type()
                ) from error
            except urllib.error.URLError as error:
                raise GeminiAPIError(
                    f'Не удалось подключиться к Gemini API: {error.reason}'
                ) from error

        candidate = (result.get('candidates') or [{}])[0]
        model_content = candidate.get('content', {})
        parts = model_content.get('parts', [])
        function_calls = [part['functionCall'] for part in parts if 'functionCall' in part]
        if not function_calls:
            answer = '\n'.join(part.get('text', '') for part in parts if part.get('text'))
            if answer:
                return answer
            raise RuntimeError('Gemini вернул пустой ответ.')

        contents.append(model_content)
        for function_call in function_calls:
            name = function_call.get('name')
            arguments = function_call.get('args') or {}
            try:
                if name == 'get_dataset_overview':
                    tool_result = dataset_overview
                elif name == 'query_demographics' and isinstance(arguments, dict):
                    tool_result = query_demographics(arguments)
                else:
                    tool_result = {'error': 'Запрошена неизвестная функция или переданы неверные параметры.'}
            except (AttributeError, TypeError, ValueError, sqlite3.Error):
                tool_result = {'error': 'Переданы некорректные параметры фильтрации.'}
            function_response = {'name': name, 'response': tool_result}
            if function_call.get('id'):
                function_response['id'] = function_call['id']
            contents.append({'role': 'user', 'parts': [{'functionResponse': function_response}]})

    raise RuntimeError('ИИ не завершил анализ после нескольких запросов к базе. Попробуйте уточнить вопрос.')


@app.route('/api/init-filters', methods=['GET'])
def init_filters():
    print("[API Request]: /api/init-filters -> читаем списки из таблицы 'demographics'")
    active_rows = active_dataset_rows()
    if active_rows is not None:
        indicators = sorted({row['indicator'] for row in active_rows}, key=str.casefold)
        years = sorted({row['year'] for row in active_rows if row['year'] > 0}, reverse=True)
        if not years:
            years = [0]
        return jsonify({
            'indicators': indicators,
            'years': years,
            'dataset': ACTIVE_DATASET_NAME,
            'mode': ACTIVE_DATASET_MODE
        })

    conn = get_db_connection()
    indicators = [r[0] for r in conn.execute('SELECT DISTINCT indicator FROM demographics ORDER BY indicator').fetchall()]
    years = [r[0] for r in conn.execute('SELECT DISTINCT year FROM demographics WHERE year > 0 ORDER BY year DESC').fetchall()]
    conn.close()
    return jsonify({'indicators': indicators, 'years': years})


@app.route('/api/chart-year', methods=['GET'])
def chart_year():
    indicator = request.args.get('indicator')
    year = request.args.get('year')
    print(f"[API Request]: /api/chart-year -> indicator='{indicator}', year='{year}' (таблица 'demographics')")

    active_rows = active_dataset_rows()
    if active_rows is not None:
        try:
            selected_year = int(year)
        except (TypeError, ValueError):
            return jsonify({'labels': [], 'values': []})
        totals = {}
        for row in active_rows:
            if row['indicator'] == indicator and (selected_year == 0 or row['year'] == selected_year):
                totals[row['province']] = totals.get(row['province'], 0) + row['value']
        labels = sorted(totals, key=str.casefold)
        return jsonify({'labels': labels, 'values': [totals[label] for label in labels]})
    
    conn = get_db_connection()
    query = '''
        SELECT province, SUM(value) as total 
        FROM demographics 
        WHERE indicator = ? AND year = ? 
        GROUP BY province
    '''
    rows = conn.execute(query, (indicator, year)).fetchall()
    conn.close()
    
    return jsonify({
        'labels': [r['province'] for r in rows],
        'values': [r['total'] for r in rows]
    })


@app.route('/api/chart-summary', methods=['GET'])
def chart_summary():
    indicator = request.args.get('indicator')
    print(f"[API Request]: /api/chart-summary -> indicator='{indicator}' (таблица 'demographics')")

    active_rows = active_dataset_rows()
    if active_rows is not None:
        totals = {}
        has_real_years = any(row['year'] > 0 for row in active_rows)
        for row in active_rows:
            if row['indicator'] == indicator and (row['year'] > 0 or not has_real_years):
                totals[row['year']] = totals.get(row['year'], 0) + row['value']
        years = sorted(totals)
        return jsonify({
            'labels': [f"{year} год" if year > 0 else "Все годы" for year in years],
            'values': [totals[year] for year in years]
        })
    
    conn = get_db_connection()
    query = '''
        SELECT year, SUM(value) as total 
        FROM demographics 
        WHERE indicator = ? AND year > 0 
        GROUP BY year 
        ORDER BY year ASC
    '''
    rows = conn.execute(query, (indicator,)).fetchall()
    conn.close()
    
    return jsonify({
        'labels': [f"{r['year']} год" for r in rows],
        'values': [r['total'] for r in rows]
    })


@app.route('/api/table-data', methods=['GET'])
def table_data():
    page = int(request.args.get('page', 1))
    limit = int(request.args.get('limit', 5000))
    search = request.args.get('search', '').strip().casefold()
    indicator = request.args.get('indicator', '')
    print(f"[API Request]: /api/table-data -> страница {page}, лимит {limit}, поиск='{search}', индикатор='{indicator}' (таблица 'demographics')")

    offset = (page - 1) * limit
    active_rows = active_dataset_rows()
    if active_rows is not None:
        filtered = [
            row for row in active_rows
            if (not indicator or row['indicator'] == indicator)
            and (not search or search in row['province'].casefold())
        ]
        page_rows = filtered[offset:offset + limit]
        return jsonify({
            'total': len(filtered),
            'page': page,
            'columns': ['Показатель', 'Год', 'Область', 'Значение'],
            'data': page_rows
        })

    conn = get_db_connection()

    where_clauses = ["1=1"]
    params = []

    if indicator:
        where_clauses.append("indicator = ?")
        params.append(indicator)
    if search:
        where_clauses.append("casefold(province) LIKE ?")
        params.append(f"%{search}%")

    where_str = " WHERE " + " AND ".join(where_clauses)

    count_query = f"SELECT COUNT(*) FROM demographics {where_str}"
    total_count = conn.execute(count_query, params).fetchone()[0]

    data_query = f"SELECT indicator, year, province, value FROM demographics {where_str} LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = conn.execute(data_query, params).fetchall()
    conn.close()

    return jsonify({
        'total': total_count,
        'page': page,
        'columns': ['Показатель', 'Год', 'Область', 'Значение'],
        'data': [dict(r) for r in rows]
    })


@app.route('/api/ai-insights', methods=['GET'])
def ai_insights():
    indicator = request.args.get('indicator')
    print(f"[API Request]: /api/ai-insights -> indicator='{indicator}' (таблица 'demographics')")
    active_rows = active_dataset_rows()
    if active_rows is not None:
        totals = {}
        for row in active_rows:
            if row['indicator'] == indicator and row['year'] > 0:
                key = (row['province'], row['year'])
                totals[key] = totals.get(key, 0) + row['value']
        leaders = sorted(totals.items(), key=lambda item: item[1], reverse=True)[:5]
        return jsonify({'insights': [{
            'type': 'positive',
            'title': province,
            'badge': f'{year} г.',
            'text': f'Максимум: {int(total):,}'
        } for (province, year), total in leaders]})

    conn = get_db_connection()
    
    query = '''
        SELECT province, year, SUM(value) as total 
        FROM demographics 
        WHERE indicator = ? AND year > 0 
        GROUP BY province, year 
        ORDER BY total DESC LIMIT 5
    '''
    rows = conn.execute(query, (indicator,)).fetchall()
    conn.close()

    insights = []
    for r in rows:
        insights.append({
            'type': 'positive',
            'title': f"{r['province']}",
            'badge': f"{r['year']} г.",
            'text': f"Максимум: {int(r['total']):,} чел."
        })

    return jsonify({'insights': insights})


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('FLASK_PORT', '5000')))
