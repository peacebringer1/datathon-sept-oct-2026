from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os
import json
import urllib.error
import urllib.request

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 128 * 1024

# Путь к папке frontend/
FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

# Путь к файлу database.sqlite в корневом каталоге DataHackathon/
DB_FILE = os.path.abspath(os.path.join(FRONTEND_DIR, '..', 'database.sqlite'))
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.8-flash')

print(f"[Flask DB]: Используется база данных по пути -> {DB_FILE}")

from flask import jsonify


@app.route('/api/household-radar', methods=['GET'])
def household_radar():
    conn = get_db_connection()
    
    # Функция для подсчета распределения оценок от 1 до 10 для конкретной колонки
    def get_score_distribution(col_name):
        query = f'''
            SELECT {col_name} as score, COUNT(*) as count 
            FROM household_survey 
            WHERE {col_name} BETWEEN 1 AND 10 
            GROUP BY {col_name}
        '''
        rows = conn.execute(query).fetchall()
        # Превращаем в словарь вида { '10': count, '9': count, ... }
        counts = {str(r['score']): r['count'] for r in rows}
        
        # Возвращаем массив от 10 до 1 балла для радара
        return {f"score_{score}": counts.get(str(score), 0) for score in range(10, 0, -1)}

    data = {
        'block1': get_score_distribution('GR1'),
        'block2': get_score_distribution('GR4'),
        'block3': get_score_distribution('GR7'),
        'block4': get_score_distribution('GR101'),
        'block5': get_score_distribution('GR13')
    }
    
    conn.close()
    return jsonify(data)
    conn = get_db_connection()
    query = '''
        SELECT 
            AVG(GR1) as gr1, AVG(GR2) as gr2, AVG(GR3) as gr3,
            AVG(GR4) as gr4, AVG(GR5) as gr5, AVG(GR6) as gr6,
            AVG(GR7) as gr7, AVG(GR81) as gr8, AVG(GR9) as gr9,
            AVG(GR101) as gr10, AVG(GR11) as gr11, AVG(GR12) as gr12,
            AVG(GR13) as gr13, AVG(GR14) as gr14, AVG(GR151) as gr15
        FROM household_survey
    '''
    row = conn.execute(query).fetchone()
    conn.close()
    
    if not row:
        return jsonify({'error': 'No data found'})

    def safe_val(val):
        return round(val if val and val < 80 else 5.0, 2) # Исключаем коды пропусков вроде 89 и заменяем на средний балл

    return jsonify({
        'block1': {'gr1': safe_val(row['gr1']), 'gr2': safe_val(row['gr2']), 'gr3': safe_val(row['gr3'])},
        'block2': {'gr4': safe_val(row['gr4']), 'gr5': safe_val(row['gr5']), 'gr6': safe_val(row['gr6'])},
        'block3': {'gr7': safe_val(row['gr7']), 'gr8': safe_val(row['gr8']), 'gr9': safe_val(row['gr9'])},
        'block4': {'gr10': safe_val(row['gr10']), 'gr11': safe_val(row['gr11']), 'gr12': safe_val(row['gr12'])},
        'block5': {'gr13': safe_val(row['gr13']), 'gr14': safe_val(row['gr14']), 'gr15': safe_val(row['gr15'])}
    })

@app.route('/api/indicators', methods=['GET'])
def get_indicators():
    indicators_list = [
        "Естественный прирост населения",
        "Число зарегистрированных браков",
        "Число зарегистрированных разводов",
        "Число умерших"
    ]
    return jsonify(indicators_list)

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.create_function('casefold', 1, lambda value: str(value).casefold() if value is not None else '')
    return conn


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
Контекст выбранных фильтров дашборда и история сообщений помогают понять вопрос, но не заменяют проверку базы.'''


def _escape_like(value):
    return str(value).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def get_dataset_overview():
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
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 503
    except (sqlite3.Error, OSError) as error:
        app.logger.exception('Не удалось прочитать аналитическую базу данных')
        return jsonify({'error': f'Не удалось прочитать базу данных: {error}'}), 503


def call_gemini(contents, dataset_overview, dashboard_context):
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        raise RuntimeError('Не задан GEMINI_API_KEY. Добавьте ключ Gemini в переменные окружения и перезапустите приложение.')

    context_text = json.dumps({
        'dataset': dataset_overview,
        'dashboard_filters': dashboard_context
    }, ensure_ascii=False)
    system_instruction = f'{AI_SYSTEM_INSTRUCTION}\n\nФактический каталог базы и выбранные фильтры: {context_text}'
    endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'

    for _ in range(4):
        body = {
            'systemInstruction': {'parts': [{'text': system_instruction}]},
            'contents': contents,
            'tools': AI_TOOLS,
            'generationConfig': {'temperature': 0.2, 'maxOutputTokens': 1200}
        }
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'x-goog-api-key': api_key},
            method='POST'
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                result = json.loads(response.read().decode('utf-8'))
        except urllib.error.HTTPError as error:
            details = error.read().decode('utf-8', errors='replace')
            try:
                details = json.loads(details).get('error', {}).get('message', details)
            except json.JSONDecodeError:
                pass
            raise RuntimeError(f'Gemini API ({error.code}): {details}') from error
        except urllib.error.URLError as error:
            raise RuntimeError(f'Не удалось подключиться к Gemini API: {error.reason}') from error

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
            except (AttributeError, TypeError, ValueError):
                tool_result = {'error': 'Переданы некорректные параметры фильтрации.'}
            function_response = {
                'name': name,
                'response': tool_result
            }
            if function_call.get('id'):
                function_response['id'] = function_call['id']
            contents.append({'role': 'function', 'parts': [{'functionResponse': function_response}]})

    raise RuntimeError('ИИ не завершил анализ после нескольких запросов к базе. Попробуйте уточнить вопрос.')

@app.route('/api/init-filters', methods=['GET'])
def init_filters():
    conn = get_db_connection()
    indicators = [r[0] for r in conn.execute('SELECT DISTINCT indicator FROM demographics ORDER BY indicator').fetchall()]
    years = [r[0] for r in conn.execute('SELECT DISTINCT year FROM demographics WHERE year > 0 ORDER BY year DESC').fetchall()]
    conn.close()
    return jsonify({'indicators': indicators, 'years': years})

@app.route('/api/chart-year', methods=['GET'])
def chart_year():
    indicator = request.args.get('indicator')
    year = request.args.get('year')
    
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
    search = request.args.get('search', '').strip().lower()
    indicator = request.args.get('indicator', '')

    offset = (page - 1) * limit
    conn = get_db_connection()

    where_clauses = ["1=1"]
    params = []

    if indicator:
        where_clauses.append("indicator = ?")
        params.append(indicator)
    if search:
        where_clauses.append("(LOWER(province) LIKE ? OR LOWER(indicator) LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])

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
    app.run(host='127.0.0.1', port=5000)