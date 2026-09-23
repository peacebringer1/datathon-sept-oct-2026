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
    limit = int(request.args.get('limit', 50))
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