from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os

app = Flask(__name__)
CORS(app)

# Путь к папке frontend/
FRONTEND_DIR = os.path.dirname(os.path.abspath(__file__))

# Путь к файлу database.sqlite в корневом каталоге DataHackathon/
DB_FILE = os.path.abspath(os.path.join(FRONTEND_DIR, '..', 'database.sqlite'))

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
    return conn

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