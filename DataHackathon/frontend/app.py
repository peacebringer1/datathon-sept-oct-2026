from flask import Flask, request, jsonify
from flask_cors import CORS
sqlite3 = __import__('sqlite3')
import os
import json
import re
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
CLAUDE_MODEL = os.environ.get('CLAUDE_MODEL', 'claude-sonnet-5-5').strip()
CLAUDE_API_KEY = os.environ.get('CLAUDE_API_KEY', '').strip()

print(f"[Flask DB]: Используется база данных по пути -> {DB_FILE}")


class ClaudeAPIError(RuntimeError):
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

D002_FORMS = {
    'subject': {
        'label': 'Удовлетворённость и условия жизни',
        'description': 'Личные оценки жизни, здоровья, жилья, финансов и услуг, а также социальные условия и продовольственная безопасность.'
    },
    'ocenka': {
        'label': 'Материальные ограничения и дети',
        'description': 'Возможность оплачивать необходимые расходы и пользоваться услугами, а также материальные потребности и лишения детей.'
    }
}

D006_HOME_TYPES = {
    '1': 'Индивидуальный дом', '2': 'Комната в доме', '3': 'Двухквартирный дом',
    '4': 'Дом на три и более квартир', '5': 'Комната в квартире'
}
D006_OWNERSHIP = {
    '1': 'В собственности одного члена семьи', '2': 'В совместной собственности семьи',
    '3': 'Частное жильё предоставлено бесплатно', '4': 'Частное жильё арендуется',
    '5': 'Жильё организации предоставлено бесплатно', '6': 'Жильё организации арендуется',
    '7': 'Государственное жильё'
}
D006_AMENITIES = [
    'Электричество', 'Электроплита', 'Природный газ', 'Сжиженный газ', 'Центральное отопление',
    'Печное отопление на твёрдом топливе', 'Печное отопление на жидком топливе', 'Печное отопление на газу',
    'Печное отопление от электричества', 'Солнечная энергия', 'Энергия ветра', 'Энергия воды',
    'Топливо из органических отходов', 'Водопровод внутри жилья', 'Водопровод вне жилья',
    'Колодец или колонка', 'Привозная вода', 'Родник, река или озеро', 'Туалет с центральной канализацией',
    'Туалет с септиком', 'Туалет с выгребной ямой', 'Биотуалет', 'Туалет отсутствует',
    'Центральная канализация', 'Другая канализация', 'Ванна', 'Душ', 'Баня или сауна',
    'Центральное горячее водоснабжение', 'Индивидуальный водонагреватель', 'Мусоропровод',
    'Сбор и вывоз мусора', 'Стационарный телефон', 'Фиксированный интернет', 'Мобильный интернет',
    'Лифт', 'Домофон', 'Спутниковое телевидение', 'Кабельное телевидение', 'Эфирное телевидение',
    'Гараж', 'Паркинг'
]
D006_DURABLE_GOODS = [
    'Телевизор', 'Домашний кинотеатр', 'Радиоприёмник', 'Музыкальный центр', 'Спутниковая антенна',
    'Другое аудио- и видеооборудование', 'Видеокамера', 'Цифровой фотоаппарат', 'Другое фотооборудование',
    'Ноутбук', 'Другое оборудование для обработки информации', 'Холодильник', 'Морозильная камера',
    'Стиральная машина', 'Посудомоечная машина', 'Швейная машина', 'Микроволновая печь', 'Пылесос',
    'Кухонная плита', 'Кондиционер', 'Мультиварка', 'Обогреватель', 'Крупные инструменты для дома и сада',
    'Другие крупные бытовые приборы', 'Факсимильный аппарат', 'Телефонный аппарат', 'Мобильный телефон',
    'Стенка или горка', 'Мягкая мебель', 'Мебель для спальни', 'Кухонная мебель', 'Произведения искусства',
    'Ковры', 'Другая мебель и предметы обихода', 'Легковой автомобиль', 'Грузовой автомобиль',
    'Мотоцикл', 'Скутер или мопед', 'Велосипед для взрослых', 'Гужевой транспорт',
    'Клавишный музыкальный инструмент', 'Гитара', 'Домбра', 'Другие музыкальные инструменты',
    'Крупные товары для отдыха вне помещений', 'Другой товар длительного пользования'
]

D008_RELATIONSHIPS = {
    '1': 'Глава домохозяйства', '2': 'Супруг или супруга', '3': 'Сын или дочь',
    '4': 'Отец или мать', '5': 'Брат или сестра', '6': 'Дедушка или бабушка',
    '7': 'Внук или внучка', '8': 'Другая степень родства', '9': 'Не родственник'
}
D008_MARITAL_STATUS = {
    '1': 'Никогда не состоял(а) в браке', '2': 'Состоит в браке',
    '3': 'Вдовец или вдова', '4': 'Разведён(а)'
}
D008_EDUCATION = {
    '1': 'Дошкольное образование', '2': 'Начальное образование', '3': 'Основное среднее',
    '4': 'Среднее или техническое и профессиональное', '5': 'Высшее образование',
    '6': 'Послевузовское образование', '7': 'Нет достигнутого уровня образования'
}
D008_ACTIVITY = {
    '1': 'Работа по найму', '2': 'Работа не по найму или предпринимательство',
    '3': 'Ищет работу', '4': 'Неработающий пенсионер', '5': 'Учащийся или студент',
    '6': 'Домашнее хозяйство или уход', '7': 'Временно или длительно нетрудоспособен',
    '8': 'Не работает и не ищет работу по другим причинам'
}
D008_AGE_GROUPS = [
    ('0–14 лет', 0, 14), ('15–24 года', 15, 24), ('25–39 лет', 25, 39),
    ('40–59 лет', 40, 59), ('60 лет и старше', 60, 130)
]

D002_QUESTION_OVERRIDES = {
    'subject': {
        'GR1': 'Насколько Вы удовлетворены своей жизнью в целом?',
        'GR2': 'Насколько Вы удовлетворены условиями жизни?',
        'GR3': 'Насколько Вы удовлетворены состоянием здоровья?',
        'GR4': 'Насколько Вы удовлетворены финансовым положением?',
        'GR5': 'Насколько Вы удовлетворены профессиональной деятельностью?',
        'GR6_1': 'Удовлетворённость общением с родственниками',
        'GR6_2': 'Удовлетворённость общением с друзьями',
        'GR6_3': 'Удовлетворённость общением с коллегами',
        'GR7': 'Удовлетворённость экономическим положением семьи',
        'GR8': 'Удовлетворённость качеством жилья',
        'GR9_1': 'Удовлетворённость чистотой территории рядом с домом',
        'GR9_2': 'Удовлетворённость чистотой воздуха',
        'GR9_3': 'Удовлетворённость качеством питьевой воды',
        'GR10': 'Удовлетворённость уровнем внешнего шума дома',
        'GR11': 'Оценка возможности самостоятельно приобрести или улучшить жильё',
        'GR12': 'Оценка государственной поддержки при улучшении жилищных условий',
        'GR13': 'Удовлетворённость количеством свободного времени',
        'GR14_1': 'Удовлетворённость качеством государственных медицинских услуг',
        'GR14_2': 'Удовлетворённость качеством частных медицинских услуг',
        'GR15_1': 'Удовлетворённость доступностью государственных медицинских услуг',
        'GR15_2': 'Удовлетворённость доступностью частных медицинских услуг',
        'GR16_1': 'Удовлетворённость качеством дошкольного образования',
        'GR16_2': 'Удовлетворённость качеством школьного образования',
        'GR16_3': 'Удовлетворённость качеством среднего профессионального образования',
        'GR16_4': 'Удовлетворённость качеством высшего образования',
        'GR17_1': 'Удовлетворённость доступностью дошкольного образования',
        'GR17_2': 'Удовлетворённость доступностью школьного образования',
        'GR17_3': 'Удовлетворённость доступностью среднего профессионального образования',
        'GR17_4': 'Удовлетворённость доступностью высшего образования',
        'GR18_1': 'Удовлетворённость услугами «Правительства для граждан»',
        'GR18_2': 'Удовлетворённость услугами налоговых органов',
        'GR18_3': 'Удовлетворённость работой полиции',
        'GR18_4': 'Удовлетворённость работой скорой помощи',
        'GR18_5': 'Удовлетворённость работой пожарной службы',
        'GR18_6': 'Удовлетворённость другими государственными услугами',
        'GR19': 'Уверенность, что можно рассчитывать на моральную поддержку',
        'GR21': 'К какому уровню материального обеспечения Вы себя относите?',
        'GR22_1': 'Причина уровня обеспеченности: нет оплачиваемой работы',
        'GR22_2': 'Причина уровня обеспеченности: нет постоянной работы по месту жительства',
        'GR22_3': 'Причина уровня обеспеченности: недостаточная квалификация или опыт',
        'GR22_4': 'Причина уровня обеспеченности: низкая оплата труда',
        'GR22_5': 'Причина уровня обеспеченности: низкая пенсия',
        'GR22_6': 'Причина уровня обеспеченности: низкое социальное пособие',
        'GR22_7': 'Причина уровня обеспеченности: высокая долговая нагрузка',
        'GR22_8': 'Причина уровня обеспеченности: недостаточный уровень образования',
        'GR22_9': 'Причина уровня обеспеченности: необходимость ухода за членом семьи',
        'GR22_10': 'Причина уровня обеспеченности: плохое состояние здоровья',
        'GR22_11': 'Причина уровня обеспеченности: чрезвычайная ситуация или стихийное бедствие',
        'GR22_12': 'Причина уровня обеспеченности: утрата имущества',
        'GR22_13': 'Причина уровня обеспеченности: уход за дошкольным ребёнком',
        'GR22_14': 'Другая причина уровня обеспеченности',
        'GR23': 'Как изменилось Ваше благосостояние за последний год?',
        'GR24': 'Как Вы оцениваете своё благосостояние в ближайший год?',
        'GR25': 'Как часто Вы встречаетесь с друзьями, родственниками или коллегами?',
        'GR26': 'Беспокоились ли Вы о нехватке еды из-за недостатка средств?',
        'GR27': 'Могли ли Вы есть здоровую и питательную пищу?',
        'GR28_1': 'Причина отсутствия здорового питания: недостаток денег',
        'GR28_2': 'Причина отсутствия здорового питания: нет огорода или подсобного хозяйства',
        'GR28_3': 'Причина отсутствия здорового питания: недостаток знаний о питании',
        'GR28_4': 'Другая причина отсутствия здорового питания',
        'GR28_5': 'Не применимо или затрудняюсь ответить'
    },
    'ocenka': {
        'GR31_1': 'За последний год не смогли оплатить аренду жилья',
        'GR31_2': 'За последний год не смогли оплатить коммунальные услуги',
        'GR31_3': 'За последний год не смогли выплатить кредит или ипотеку',
        'GR31_4': 'За последний год не смогли оплатить рассрочку',
        'GR32': 'Может ли семья оплачивать отопление и поддерживать тепло дома?',
        'GR33': 'Может ли семья заменить изношенную или повреждённую мебель?',
        'GR34': 'Может ли семья есть горячее блюдо с белком хотя бы раз в два дня?',
        'GR35': 'Может ли семья оплатить непредвиденные расходы без займа?',
        'GR36': 'Может ли семья позволить себе недельный отдых вне дома?',
        'GR37': 'Можете ли Вы встречаться с близкими хотя бы раз в месяц?',
        'GR38': 'Может ли семья организовать обряды без тяжёлых долгов?',
        'GR39': 'Доступны ли Вам зимняя и летняя пары обуви?',
        'GR310': 'Можете ли Вы заменить изношенную одежду и обувь?',
        'GR311': 'Можете ли Вы самостоятельно потратить определённую сумму?',
        'GR312': 'Можете ли Вы регулярно посещать развлекательные мероприятия?',
        'GR313': 'Пользовались ли члены семьи интернетом в течение последнего года?',
        'GR314': 'Как часто члены семьи пользовались интернетом?',
        'GR315': 'Есть ли дома постоянный доступ к интернету?',
        'GR317': 'Есть ли дошкольник, который не посещает детский сад?',
        'GR319': 'Были ли случаи, когда Вы не смогли получить медицинскую помощь?',
        'GR40': 'Есть ли в домохозяйстве дети младше 18 лет?',
        'GR46': 'Получил ли ребёнок необходимое лечение или лекарства?'
    }
}

D002_LABELS_FILE = Path(FRONTEND_DIR) / 'src' / 'components' / 'd002QuestionLabels.json'
try:
    with D002_LABELS_FILE.open('r', encoding='utf-8') as labels_file:
        D002_QUESTION_LABELS = json.load(labels_file)
except (OSError, json.JSONDecodeError):
    D002_QUESTION_LABELS = {}


def get_d004_path(year, quarter, module):
    if year not in {'2021', '2022', '2023', '2024'}:
        return None
    if quarter not in {'1kv', '2kv', '3kv', '4kv'}:
        return None
    if not module.isdigit() or int(module) not in D004_MODULES:
        return None
    csv_path = DATA_DIR / 'd004' / year / quarter / f'kv_vopr{int(module)}.csv'
    return csv_path if csv_path.is_file() else None


def get_d002_db_catalog():
    if not Path(DB_FILE).is_file():
        return {}
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sinte_import_manifest'"
        ).fetchone():
            return {}
        catalog = {}
        for source_path, table, row_count in conn.execute(
            "SELECT source_path, sql_table, row_count FROM sinte_import_manifest WHERE form='d002'"
        ):
            parts = Path(source_path).parts
            if len(parts) == 3 and parts[2].lower().endswith('.csv'):
                form = Path(parts[2]).stem.lower()
                if form in D002_FORMS:
                    catalog[(parts[1], form)] = {'table': table, 'rows': int(row_count)}
        return catalog
    except sqlite3.Error as error:
        print(f'[D002]: Не удалось прочитать каталог SQLite: {error}')
        return {}
    finally:
        if conn:
            conn.close()


def get_d002_frame(year, form, catalog):
    csv_path = DATA_DIR / 'd002' / year / f'{form}.csv'
    if csv_path.is_file():
        try:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='utf-8-sig'), 'data/sinte CSV'
        except UnicodeDecodeError:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='cp1251'), 'data/sinte CSV'

    spec = catalog.get((year, form))
    if not spec or not Path(DB_FILE).is_file():
        return None, None
    table = '"' + spec['table'].replace('"', '""') + '"'
    conn = sqlite3.connect(DB_FILE)
    try:
        frame = pd.read_sql_query(f'SELECT * FROM {table}', conn, dtype=str).fillna('')
        return frame, 'database.sqlite'
    finally:
        conn.close()


def normalize_d002_question(column):
    return re.sub(r'[^A-Z0-9]+', '_', str(column).upper()).strip('_')


def d002_question_label(year, form, column):
    normalized = normalize_d002_question(column)
    compact = normalized.replace('_', '')
    overrides = D002_QUESTION_OVERRIDES.get(form, {})
    override = overrides.get(normalized) or next(
        (label for key, label in overrides.items() if normalize_d002_question(key).replace('_', '') == compact),
        None
    )
    if override:
        return override
    labels = D002_QUESTION_LABELS.get(str(year), {}).get(form, {})
    label = labels.get(normalized) or labels.get(compact)
    inherited = False
    if not label and '_' in normalized:
        parent = normalized.rsplit('_', 1)[0]
        label = labels.get(parent) or labels.get(parent.replace('_', ''))
        inherited = bool(label)
    if not label:
        label = f'Вопрос {column} анкеты · формулировка не указана в справочнике'
    legacy_label = re.match(r'^(\d+)\s+часть\s+вопрос(?:а)?\s+(\d+(?:\.\d+)*)\s*[.:]?\s*(.*)$', label, flags=re.IGNORECASE)
    if legacy_label:
        part, number, description = legacy_label.groups()
        if description.strip():
            label = description.strip()[0].upper() + description.strip()[1:]
        else:
            label = f'Раздел {part} · вопрос {number}'
    if inherited:
        label = f'{label} · вариант {normalized.rsplit("_", 1)[-1]}'
    return label


def d002_answer_label(form, question, value):
    """Return a respondent-facing label for documented D002 response codes."""
    normalized = normalize_d002_question(question)
    binary = {'1': 'Да', '2': 'Нет'}
    food_security = {'1': 'Да', '2': 'Нет', '3': 'Затрудняюсь ответить', '4': 'Отказ от ответа'}
    if form == 'subject':
        if normalized == 'GR21':
            return {
                '1': 'Низкий уровень обеспеченности', '2': 'Обеспеченность ниже среднего',
                '3': 'Средний уровень обеспеченности', '4': 'Обеспеченность выше среднего',
                '5': 'Достаточный уровень обеспеченности', '6': 'Высокий уровень обеспеченности'
            }.get(value, f'Код ответа {value}')
        if normalized == 'GR23':
            return {'1': 'Не изменилось', '2': 'Улучшилось', '3': 'Ухудшилось'}.get(value, f'Код ответа {value}')
        if normalized == 'GR24':
            return {
                '1': 'Уверены, что будем жить лучше', '2': 'Предполагаем улучшение',
                '3': 'Останемся на достигнутом уровне', '4': 'Возможно некоторое ухудшение',
                '5': 'Будем жить хуже'
            }.get(value, f'Код ответа {value}')
        if normalized == 'GR25':
            return {
                '1': 'Никогда', '2': 'Реже раза в месяц', '3': 'Раз в месяц или чаще',
                '4': 'Раз в неделю', '5': 'Несколько раз в неделю', '6': 'Каждый день'
            }.get(value, f'Код ответа {value}')
        if normalized.startswith(('GR22_', 'GR28_')):
            return 'Отмечено'
        if normalized in {'GR26', 'GR27', 'GR29', 'GR210', 'GR211', 'GR212', 'GR213', 'GR214'}:
            return food_security.get(value, f'Код ответа {value}')
    if form == 'ocenka':
        if normalized.startswith('GR31_'):
            return {'1': 'Да, один раз', '2': 'Да, два раза или чаще', '3': 'Нет', '4': 'Не актуально'}.get(value, f'Код ответа {value}')
        if normalized in {'GR32', 'GR35', 'GR36', 'GR38', 'GR40', 'GR41', 'GR313', 'GR315', 'GR317'}:
            return binary.get(value, f'Код ответа {value}')
        if normalized == 'GR314':
            return {
                '1': 'Несколько раз в день', '2': 'Не менее раза в день',
                '3': 'Не менее раза в неделю', '4': 'Не менее раза в месяц',
                '5': 'Реже раза в месяц'
            }.get(value, f'Код ответа {value}')
        if normalized in {'GR33', 'GR34', 'GR37', 'GR39', 'GR310', 'GR311', 'GR312'}:
            return {'1': 'Да', '2': 'Нет, не хватает средств', '3': 'Нет, по другой причине'}.get(value, f'Код ответа {value}')
    return f'Код ответа {value}'


D002_TERRITORY_NAMES = {
    '10': 'Область Абай', '11': 'Акмолинская область', '15': 'Актюбинская область',
    '19': 'Алматинская область', '23': 'Атырауская область', '27': 'Западно-Казахстанская область',
    '31': 'Жамбылская область', '33': 'Область Жетысу', '35': 'Карагандинская область',
    '39': 'Костанайская область', '43': 'Кызылординская область', '47': 'Мангистауская область',
    '51': 'Туркестанская область', '55': 'Павлодарская область', '59': 'Северо-Казахстанская область',
    '61': 'Туркестанская область', '62': 'Область Улытау', '63': 'Восточно-Казахстанская область',
    '71': 'г. Астана', '75': 'г. Алматы', '79': 'г. Шымкент'
}


def rounded_shares(counts, precision=1):
    """Round a distribution while keeping its displayed percentages at 100%."""
    values = [max(0, int(value)) for value in counts]
    total = sum(values)
    if not total:
        return [0 for _ in values]
    scale = 10 ** precision
    target = 100 * scale
    exact = [value * target / total for value in values]
    rounded = [math.floor(value) for value in exact]
    remainder = target - sum(rounded)
    order = sorted(range(len(values)), key=lambda index: (exact[index] - rounded[index], values[index]), reverse=True)
    for index in order[:remainder]:
        rounded[index] += 1
    return [value / scale for value in rounded]


@app.route('/api/d002/options', methods=['GET'])
def d002_options():
    d002_dir = DATA_DIR / 'd002'
    years = {path.name for path in d002_dir.iterdir() if path.is_dir()} if d002_dir.is_dir() else set()
    catalog = get_d002_db_catalog()
    years.update(year for year, _ in catalog)
    available_forms = {
        form for form in D002_FORMS
        if any((year, form) in catalog or (DATA_DIR / 'd002' / year / f'{form}.csv').is_file() for year in years)
    }
    return jsonify({
        'years': sorted(years, reverse=True),
        'forms': [{'id': form, **D002_FORMS[form]} for form in D002_FORMS if form in available_forms],
        'source_available': bool(years)
    })


@app.route('/api/d002/data', methods=['GET'])
def d002_data():
    year = request.args.get('year', '2024')
    form = request.args.get('form', 'subject').lower()
    if year not in {'2021', '2022', '2023', '2024'}:
        return jsonify({'error': 'Выбранный год обследования D002 не поддерживается.'}), 400
    if form not in D002_FORMS:
        return jsonify({'error': 'Выберите раздел анкеты D002 из списка.'}), 400

    catalog = get_d002_db_catalog()
    frame, source = get_d002_frame(year, form, catalog)
    if frame is None:
        return jsonify({'error': f'Данные D002 за {year} не найдены ни в data/sinte, ни в database.sqlite.'}), 404

    questions = [str(column) for column in frame.columns if re.match(r'^GR', str(column), flags=re.IGNORECASE)]
    if request.args.get('preview') == '1':
        questions = questions[:1]
    if not questions:
        return jsonify({'error': 'В таблице D002 не найдены вопросы анкеты.'}), 500
    question_items = []
    for question in questions:
        values = frame[question].fillna('').astype(str).str.strip()
        missing_count = int(values.eq('').sum())
        answer_values = values[values.ne('')]
        response_counts = answer_values.value_counts().to_dict()
        normalized_question = normalize_d002_question(question)
        match = re.match(r'^GR(\d+)', normalized_question)
        is_satisfaction_scale = form == 'subject' and bool(match) and int(match.group(1)) <= 19

        if is_satisfaction_scale:
            scale_groups = [
                ('1–3', 'Низкая удовлетворённость', {'1', '2', '3'}),
                ('4–7', 'Частичная удовлетворённость', {'4', '5', '6', '7'}),
                ('8–10', 'Высокая удовлетворённость', {'8', '9', '10'}),
                ('89', 'Не применимо / затруднились ответить', {'89'})
            ]
            distribution = [{'code': code, 'label': label,
                             'count': sum(int(response_counts.get(value, 0)) for value in group)}
                            for code, label, group in scale_groups]
            distribution = [item for item in distribution if item['count'] > 0]
            chart_note = 'Оценки 1–3 объединены в низкую удовлетворённость, 4–7 — в частичную, 8–10 — в высокую; 89 — «не применимо / затрудняюсь ответить».'
        else:
            def answer_sort(value):
                try:
                    return (0, float(value))
                except ValueError:
                    return (1, value.casefold())
            distribution = [{'code': value, 'label': d002_answer_label(form, question, value), 'count': int(count)}
                            for value, count in sorted(response_counts.items(), key=lambda pair: answer_sort(pair[0]))]
            chart_note = 'Подписи вариантов взяты из анкеты D-002. Если для редкого поля в документации указан только код, он показан как «Код ответа».'

        valid_count = int(len(answer_values))
        for item, share in zip(distribution, rounded_shares([item['count'] for item in distribution])):
            item['share'] = share
        question_items.append({
            'id': question,
            'label': d002_question_label(year, form, question),
            'answered': valid_count,
            'missing': missing_count,
            'distribution': distribution,
            'chart_note': chart_note,
            'is_satisfaction_scale': is_satisfaction_scale
        })

    territories = int(frame['TE'].replace('', pd.NA).nunique()) if 'TE' in frame.columns else 0
    return jsonify({
        'dataset': 'd002',
        'year': year,
        'form': form,
        'form_label': D002_FORMS[form]['label'],
        'form_description': D002_FORMS[form]['description'],
        'source': source,
        'respondents': int(len(frame)),
        'territories': territories,
        'questions': question_items,
        'question_count': len(question_items)
    })


@app.route('/api/d002/map', methods=['GET'])
def d002_map_data():
    year = request.args.get('year', '2024')
    form = request.args.get('form', 'subject').lower()
    question = request.args.get('question', '').strip()
    if year not in {'2021', '2022', '2023', '2024'} or form not in D002_FORMS:
        return jsonify({'error': 'Выберите доступный год и раздел анкеты D002.'}), 400

    frame, source = get_d002_frame(year, form, get_d002_db_catalog())
    if frame is None:
        return jsonify({'error': f'Данные D002 за {year} не найдены.'}), 404
    question_column = next((str(column) for column in frame.columns if str(column).casefold() == question.casefold()), None)
    territory_column = next((str(column) for column in frame.columns if str(column).casefold() == 'te'), None)
    if not question_column or not re.match(r'^GR', question_column, flags=re.IGNORECASE):
        return jsonify({'error': 'Выбранный вопрос D002 не найден.'}), 404
    if not territory_column:
        return jsonify({'available': False, 'reason': 'В наборе D002 нет кода территории.'}), 200

    values = frame[[territory_column, question_column]].copy()
    values[territory_column] = values[territory_column].fillna('').astype(str).str.strip()
    values[question_column] = values[question_column].fillna('').astype(str).str.strip()
    values = values[(values[territory_column] != '') & (values[question_column] != '')]
    normalized_question = normalize_d002_question(question_column)
    match = re.match(r'^GR(\d+)', normalized_question)
    is_satisfaction_scale = form == 'subject' and bool(match) and int(match.group(1)) <= 19

    if is_satisfaction_scale:
        answer_groups = {
            '1–3': {'label': 'Низкая удовлетворённость', 'values': {'1', '2', '3'}},
            '4–7': {'label': 'Частичная удовлетворённость', 'values': {'4', '5', '6', '7'}},
            '8–10': {'label': 'Высокая удовлетворённость', 'values': {'8', '9', '10'}},
            '89': {'label': 'Не применимо / затруднились ответить', 'values': {'89'}}
        }
        categories = [
            {'code': code, 'label': details['label']}
            for code, details in answer_groups.items()
            if values[question_column].isin(details['values']).any()
        ]
        values['_answer_group'] = values[question_column].map({
            raw: code for code, details in answer_groups.items() for raw in details['values']
        })
    else:
        answer_codes = sorted(values[question_column].unique(), key=lambda value: (not value.isdigit(), int(value) if value.isdigit() else value.casefold()))
        categories = [{'code': code, 'label': d002_answer_label(form, question_column, code)} for code in answer_codes]
        values['_answer_group'] = values[question_column]

    regions = []
    for code, group in values.groupby(territory_column, sort=True):
        answered = int(len(group))
        counts = group['_answer_group'].value_counts().to_dict()
        shares = rounded_shares([counts.get(category['code'], 0) for category in categories])
        regions.append({
            'code': str(code),
            'territory': D002_TERRITORY_NAMES.get(str(code), f'Код территории {code}'),
            'answered': answered,
            'distribution': [
                {
                    **category,
                    'count': int(counts.get(category['code'], 0)),
                    'share': share
                }
                for category, share in zip(categories, shares)
            ]
        })
    return jsonify({
        'year': year,
        'form': form,
        'question': question_column,
        'source': source,
        'categories': categories,
        'regions': regions
    })


def get_d006_catalog():
    if not Path(DB_FILE).is_file():
        return {}
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sinte_import_manifest'").fetchone():
            return {}
        catalog = {}
        for source_path, table, row_count in conn.execute(
            "SELECT source_path, sql_table, row_count FROM sinte_import_manifest WHERE form='d006'"
        ):
            parts = Path(source_path).parts
            if len(parts) == 3 and parts[2].lower().endswith('.csv'):
                catalog[parts[1]] = {'table': table, 'rows': int(row_count)}
        return catalog
    except sqlite3.Error as error:
        print(f'[D006]: Не удалось прочитать каталог SQLite: {error}')
        return {}
    finally:
        if conn:
            conn.close()


def get_d006_frame(year, catalog):
    csv_dir = DATA_DIR / 'd006' / year
    csv_path = next((path for path in csv_dir.glob('*.csv')), None) if csv_dir.is_dir() else None
    if csv_path:
        try:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='utf-8-sig'), 'data/sinte CSV'
        except UnicodeDecodeError:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='cp1251'), 'data/sinte CSV'
    spec = catalog.get(year)
    if not spec or not Path(DB_FILE).is_file():
        return None, None
    table = '"' + spec['table'].replace('"', '""') + '"'
    conn = sqlite3.connect(DB_FILE)
    try:
        return pd.read_sql_query(f'SELECT * FROM {table}', conn, dtype=str).fillna(''), 'database.sqlite'
    finally:
        conn.close()


@app.route('/api/d006/options', methods=['GET'])
def d006_options():
    d006_dir = DATA_DIR / 'd006'
    years = {path.name for path in d006_dir.iterdir() if path.is_dir() and path.name.isdigit()} if d006_dir.is_dir() else set()
    catalog = get_d006_catalog()
    years.update(catalog)
    return jsonify({'years': sorted(years, reverse=True), 'source_available': bool(years)})


@app.route('/api/d006/data', methods=['GET'])
def d006_data():
    year = request.args.get('year', '2024')
    if year not in {'2021', '2022', '2023', '2024'}:
        return jsonify({'error': 'Выбранный год D006 не поддерживается.'}), 400
    frame, source = get_d006_frame(year, get_d006_catalog())
    if frame is None:
        return jsonify({'error': f'Данные D006 за {year} не найдены ни в data/sinte, ни в database.sqlite.'}), 404
    frame.columns = [str(column).strip().upper() for column in frame.columns]
    territory_options = []
    if 'TE' in frame.columns:
        codes = sorted(frame['TE'].astype(str).str.strip().replace('', pd.NA).dropna().unique())
        territory_options = [{'code': code, 'label': D002_TERRITORY_NAMES.get(code, f'Код территории {code}')} for code in codes]
    selected_territory = request.args.get('territory', '').strip()
    if selected_territory:
        if 'TE' not in frame.columns or selected_territory not in set(frame['TE'].astype(str).str.strip()):
            return jsonify({'error': 'Выбранная территория отсутствует в данных D006 за этот год.'}), 400
        frame = frame[frame['TE'].astype(str).str.strip().eq(selected_territory)].copy()
    respondents = len(frame)

    def distribution(column, labels):
        if column not in frame.columns:
            return []
        counts = frame[column].astype(str).str.strip().value_counts()
        counts = counts[[code for code in counts.index if code in labels]]
        shares = rounded_shares(counts.tolist())
        return [
            {'code': code, 'label': labels[code], 'count': int(count), 'share': share}
            for (code, count), share in zip(counts.items(), shares) if code
        ]

    home_types = distribution('TIP_J', D006_HOME_TYPES)
    if request.args.get('preview') == '1':
        return jsonify({
            'dataset': 'd006', 'year': year, 'source': source,
            'respondents': respondents, 'home_types': home_types,
            'territory_options': territory_options
        })
    city_rural = distribution('K', {'1': 'Город', '2': 'Село'})
    ownership = distribution('VLAD1', D006_OWNERSHIP)
    land_access = distribution('ZEM', {'1': 'Есть доступ', '2': 'Нет доступа'})
    amenities = []
    for index, label in enumerate(D006_AMENITIES, start=1):
        column = f'U{index}'
        if column not in frame.columns:
            continue
        values = frame[column].astype(str).str.strip()
        valid = values[values.isin({'1', '2'})]
        available = int(valid.eq('1').sum())
        amenities.append({
            'code': column, 'label': label, 'count': available,
            'share': round(available / len(valid) * 100, 1) if len(valid) else 0
        })

    goods = []
    for index, label in enumerate(D006_DURABLE_GOODS, start=1):
        column = f'TDP{index}'
        if column not in frame.columns:
            continue
        values = pd.to_numeric(frame[column].astype(str).str.strip(), errors='coerce').dropna()
        goods.append({'code': column, 'label': label, 'count': round(float(values.sum()), 1), 'households_reported': int(len(values))})
    goods.sort(key=lambda item: item['count'], reverse=True)

    def mean_value(column):
        if column not in frame.columns:
            return None
        values = pd.to_numeric(frame[column].astype(str).str.strip(), errors='coerce').dropna()
        return round(float(values.mean()), 1) if len(values) else None

    territories = int(frame['TE'].replace('', pd.NA).nunique()) if 'TE' in frame.columns else 0
    return jsonify({
        'dataset': 'd006', 'year': year, 'source': source, 'respondents': respondents,
        'territories': territories, 'city_rural': city_rural, 'home_types': home_types,
        'ownership': ownership, 'land_access': land_access, 'amenities': amenities,
        # Keep every source column: the frontend can filter the visible categories,
        # but the API must not silently discard the remaining goods.
        'durable_goods': goods, 'average_total_area': mean_value('OB_PL'),
        'territory_options': territory_options,
        'average_living_area': mean_value('J_PL'), 'average_rooms': mean_value('KOL_K')
    })


def get_d008_catalog():
    if not Path(DB_FILE).is_file():
        return {}
    conn = None
    try:
        conn = sqlite3.connect(DB_FILE)
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sinte_import_manifest'").fetchone():
            return {}
        catalog = {}
        for source_path, table, row_count in conn.execute(
            "SELECT source_path, sql_table, row_count FROM sinte_import_manifest WHERE form='d008'"
        ):
            parts = Path(source_path).parts
            if len(parts) == 3 and parts[2].lower().endswith('.csv'):
                catalog[parts[1]] = {'table': table, 'rows': int(row_count)}
        return catalog
    except sqlite3.Error as error:
        print(f'[D008]: Не удалось прочитать каталог SQLite: {error}')
        return {}
    finally:
        if conn:
            conn.close()


def get_d008_frame(year, catalog):
    csv_dir = DATA_DIR / 'd008' / year
    csv_path = next((path for path in csv_dir.glob('*.csv')), None) if csv_dir.is_dir() else None
    if csv_path:
        try:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='utf-8-sig'), 'data/sinte CSV'
        except UnicodeDecodeError:
            return pd.read_csv(csv_path, dtype=str, keep_default_na=False, encoding='cp1251'), 'data/sinte CSV'
    spec = catalog.get(year)
    if not spec or not Path(DB_FILE).is_file():
        return None, None
    table = '"' + spec['table'].replace('"', '""') + '"'
    conn = sqlite3.connect(DB_FILE)
    try:
        return pd.read_sql_query(f'SELECT * FROM {table}', conn, dtype=str).fillna(''), 'database.sqlite'
    finally:
        conn.close()


@app.route('/api/d008/options', methods=['GET'])
def d008_options():
    d008_dir = DATA_DIR / 'd008'
    years = {path.name for path in d008_dir.iterdir() if path.is_dir() and path.name.isdigit()} if d008_dir.is_dir() else set()
    catalog = get_d008_catalog()
    years.update(catalog)
    return jsonify({'years': sorted(years, reverse=True), 'source_available': bool(years)})


@app.route('/api/d008/data', methods=['GET'])
def d008_data():
    year = request.args.get('year', '2024')
    if year not in {'2021', '2022', '2023', '2024'}:
        return jsonify({'error': 'Выбранный год D008 не поддерживается.'}), 400
    frame, source = get_d008_frame(year, get_d008_catalog())
    if frame is None:
        return jsonify({'error': f'Данные D008 за {year} не найдены ни в data/sinte, ни в database.sqlite.'}), 404
    frame.columns = [str(column).strip().upper() for column in frame.columns]
    full_frame = frame
    people_before_filters = int(len(full_frame))
    age_groups = [
        ('0-14', '0–14 лет', 0, 14), ('15-24', '15–24 года', 15, 24),
        ('25-39', '25–39 лет', 25, 39), ('40-59', '40–59 лет', 40, 59),
        ('60+', '60 лет и старше', 60, 120)
    ]

    def calculate_ages(source_frame):
        if 'GOD_ROJD' not in source_frame.columns:
            return pd.Series(index=source_frame.index, dtype='float64')
        birth_year = pd.to_numeric(source_frame['GOD_ROJD'], errors='coerce')
        ages = int(year) - birth_year
        if 'MES_ROJD' in source_frame.columns:
            birth_month = pd.to_numeric(source_frame['MES_ROJD'], errors='coerce')
            # A participant born in the survey year is already present in the
            # roster, so their age cannot be negative; keep them in age 0.
            birthday_adjustment = birth_year.lt(int(year)) & birth_month.gt(1)
            ages = ages - birthday_adjustment.astype('int64')
        return ages.where(ages.between(0, 120))

    all_ages = calculate_ages(full_frame)
    filter_columns = {
        'settlement': ('K', {'1', '2'}),
        'gender': ('POL', {'1', '2'}),
        'relationship': ('RODSTVO', set(D008_RELATIONSHIPS)),
        'education': ('UROV', set(D008_EDUCATION)),
        'marital_status': ('SEM_POL', set(D008_MARITAL_STATUS)),
        'activity': ('STATUS', set(D008_ACTIVITY))
    }
    applied_filters = {}
    keep = pd.Series(True, index=full_frame.index)
    for filter_name, (column, allowed_codes) in filter_columns.items():
        selected = str(request.args.get(filter_name, '')).strip()
        if selected and selected in allowed_codes and column in full_frame.columns:
            keep &= full_frame[column].astype(str).str.strip().eq(selected)
            applied_filters[filter_name] = selected

    selected_age_group = str(request.args.get('age_group', '')).strip()
    if selected_age_group:
        age_spec = next((item for item in age_groups if item[0] == selected_age_group), None)
        if age_spec:
            _, _, lower, upper = age_spec
            keep &= all_ages.between(lower, upper)
            applied_filters['age_group'] = selected_age_group

    frame = full_frame.loc[keep]
    ages = all_ages.loc[frame.index].dropna()
    people_count = int(len(frame))

    def distribution(column, labels):
        if column not in frame.columns:
            return []
        values = frame[column].astype(str).str.strip()
        values = values[values.ne('')]
        counts = values.value_counts()
        ordered = sorted(counts.items(), key=lambda item: (int(item[0]) if item[0].isdigit() else 999, item[0]))
        return [
            {'code': code, 'label': labels.get(code, f'Не классифицировано (код {code})'), 'count': int(count),
             'share': share}
            for (code, count), share in zip(ordered, rounded_shares([count for _, count in ordered]))
        ]

    settlement = distribution('K', {'1': 'Город', '2': 'Село'})
    if request.args.get('preview') == '1':
        return jsonify({
            'dataset': 'd008', 'year': year, 'source': source,
            'people': people_count, 'settlement': settlement
        })
    gender = distribution('POL', {'1': 'Мужчины', '2': 'Женщины'})
    relationships = distribution('RODSTVO', D008_RELATIONSHIPS)
    education = distribution('UROV', D008_EDUCATION)
    marital_status = distribution('SEM_POL', D008_MARITAL_STATUS)
    activity = distribution('STATUS', D008_ACTIVITY)

    age_counts = [int(ages.between(lower, upper).sum()) if len(ages) else 0
                  for _, _, lower, upper in age_groups]
    age_shares = rounded_shares(age_counts)
    age_structure = [
        {'code': code, 'label': label, 'count': count, 'share': share}
        for (code, label, _, _), count, share in zip(age_groups, age_counts, age_shares)
    ]

    if 'NOMER' in full_frame.columns:
        household_ids = frame['NOMER'].astype(str).str.strip()
        household_ids = set(household_ids[household_ids.ne('')])
        all_household_ids = full_frame['NOMER'].astype(str).str.strip()
        household_sizes = all_household_ids[all_household_ids.isin(household_ids)].value_counts()
    else:
        household_sizes = pd.Series(dtype='int64')
    size_counts = household_sizes.value_counts().sort_index()
    household_size_distribution = [
        {'code': str(int(size)), 'label': f'{int(size)} ' + ('человек' if int(size) % 10 == 1 and int(size) % 100 != 11 else 'человека' if int(size) % 10 in {2, 3, 4} and int(size) % 100 not in {12, 13, 14} else 'человек'),
         'count': int(count), 'share': share}
        for (size, count), share in zip(size_counts.items(), rounded_shares(size_counts.tolist()))
    ]
    territories = int(frame['TE'].replace('', pd.NA).nunique()) if 'TE' in frame.columns else 0
    average_household_size = round(float(household_sizes.mean()), 1) if len(household_sizes) else None
    average_age = round(float(ages.mean()), 1) if len(ages) else None
    under_15_share = round(float(ages.lt(15).mean()) * 100, 1) if len(ages) else None
    households = int(len(household_sizes))

    return jsonify({
        'dataset': 'd008', 'year': year, 'source': source,
        'people': people_count, 'people_before_filters': people_before_filters,
        'households': households, 'territories': territories,
        'average_household_size': average_household_size, 'average_age': average_age,
        'under_15_share': under_15_share, 'age_available': len(ages) > 0,
        'answered': {
            'settlement': sum(item['count'] for item in settlement),
            'gender': sum(item['count'] for item in gender),
            'relationships': sum(item['count'] for item in relationships),
            'education': sum(item['count'] for item in education),
            'marital_status': sum(item['count'] for item in marital_status),
            'activity': sum(item['count'] for item in activity),
            'age_structure': len(ages), 'household_sizes': households
        },
        'filters': applied_filters,
        'settlement': settlement, 'gender': gender, 'relationships': relationships,
        'education': education, 'marital_status': marital_status, 'activity': activity,
        'age_structure': age_structure, 'household_sizes': household_size_distribution
    })


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


def get_d004_db_catalog():
    """Return imported D004 CSV tables indexed by (year, quarter, module)."""
    if not Path(DB_FILE).is_file():
        return {}
    try:
        conn = sqlite3.connect(DB_FILE)
        has_manifest = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sinte_import_manifest'"
        ).fetchone()
        if not has_manifest:
            return {}
        catalog = {}
        for source_path, table, row_count in conn.execute(
            "SELECT source_path, sql_table, row_count FROM sinte_import_manifest WHERE form='d004'"
        ):
            parts = Path(source_path).parts
            if len(parts) != 4:
                continue
            match = re.fullmatch(r'kv_vopr(\d+)\.csv', parts[3], flags=re.IGNORECASE)
            if match:
                catalog[(parts[1], parts[2].lower(), match.group(1))] = {
                    'table': table,
                    'rows': int(row_count)
                }
        return catalog
    except sqlite3.Error as error:
        print(f'[D004]: Не удалось прочитать каталог из SQLite: {error}')
        return {}
    finally:
        if 'conn' in locals():
            conn.close()


def d004_data_from_sqlite(specs, year, quarter, module, page, page_size):
    """Build the existing D004 API response from imported SQLite tables."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    start = (page - 1) * page_size
    total_rows = sum(spec['rows'] for _, _, spec in specs)
    columns = []
    territory_counts, territory_amounts = {}, {}
    households, territory_households = set(), {}
    has_amount = False
    rows = []

    try:
        # Union columns across selected years because questionnaire schemas can change.
        for _, _, spec in specs:
            table = '"' + spec['table'].replace('"', '""') + '"'
            table_columns = [row['name'] for row in conn.execute(f'PRAGMA table_info({table})')]
            for column in table_columns:
                if column not in columns:
                    columns.append(column)
        output_columns = columns + [field for field in ('ГОД', 'КВАРТАЛ') if field not in columns]

        # Fetch only the requested raw page from the selected tables.
        remaining_start, remaining_count = start, page_size
        for source_year, source_quarter, spec in specs:
            file_rows = spec['rows']
            if remaining_count and remaining_start < file_rows:
                offset = remaining_start
                limit = min(remaining_count, file_rows - offset)
                table = '"' + spec['table'].replace('"', '""') + '"'
                for record in conn.execute(f'SELECT * FROM {table} LIMIT ? OFFSET ?', (limit, offset)):
                    item = {column: ('' if record[column] is None else str(record[column])) for column in record.keys()}
                    item['ГОД'] = source_year
                    item['КВАРТАЛ'] = source_quarter.upper()
                    rows.append(item)
                remaining_count -= limit
                remaining_start = 0
            else:
                remaining_start = max(0, remaining_start - file_rows)

        # Aggregate territories and distinct households using the table's own
        # column casing (for example, Nomer in one questionnaire year).
        for _, _, spec in specs:
            table = '"' + spec['table'].replace('"', '""') + '"'
            actual_columns = [row['name'] for row in conn.execute(f'PRAGMA table_info({table})')]
            lookup = {column.casefold(): column for column in actual_columns}
            territory_column = lookup.get('te') or lookup.get('territory')
            if not territory_column:
                continue
            quoted_territory = '"' + territory_column.replace('"', '""') + '"'
            for code, count in conn.execute(
                f'SELECT COALESCE(NULLIF({quoted_territory}, \'\'), \'Не указан\'), COUNT(*) '
                f'FROM {table} GROUP BY {quoted_territory}'
            ):
                code = str(code)
                territory_counts[code] = territory_counts.get(code, 0) + int(count)

            amount_column = lookup.get('stoimk')
            if amount_column:
                has_amount = True
                quoted_amount = '"' + amount_column.replace('"', '""') + '"'
                for code, amount in conn.execute(
                    f'SELECT COALESCE(NULLIF({quoted_territory}, \'\'), \'Не указан\'), '
                    f'SUM(CAST(REPLACE({quoted_amount}, \',\', \'.\') AS REAL)) '
                    f'FROM {table} GROUP BY {quoted_territory}'
                ):
                    code = str(code)
                    territory_amounts[code] = territory_amounts.get(code, 0) + float(amount or 0)

            household_columns = [lookup.get(key) for key in ('te', 'k', 'nomer') if lookup.get(key)]
            if household_columns:
                quoted_household_columns = [f'"{column.replace(chr(34), chr(34) * 2)}"' for column in household_columns]
                select_columns = ', '.join(quoted_household_columns)
                query = f'SELECT {select_columns} FROM {table} GROUP BY {select_columns}'
                for identity in conn.execute(query):
                    code = str(identity[0]) if identity[0] not in (None, '') else 'Не указан'
                    household_key = tuple('' if value is None else str(value) for value in identity)
                    households.add(household_key)
                    territory_households.setdefault(code, set()).add(household_key)
    finally:
        conn.close()

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
    return {
        'dataset': 'd004',
        'year': year,
        'quarter': 'Все кварталы' if quarter == 'all' else quarter,
        'module': int(module),
        'module_label': D004_MODULES[int(module)],
        'columns': output_columns,
        'rows': [{column: item.get(column, '') for column in output_columns} for item in rows],
        'page': page,
        'page_size': page_size,
        'total_rows': total_rows,
        'households': len(households),
        'territories': len(territory_counts),
        'chart_metric': chart_metric,
        'chart': {'labels': labels, 'values': chart_values},
        'territory_summary': summary,
        'source': 'database.sqlite'
    }


@app.route('/api/d004/options', methods=['GET'])
def d004_options():
    d004_dir = DATA_DIR / 'd004'
    years = sorted((path.name for path in d004_dir.iterdir() if path.is_dir()), reverse=True) if d004_dir.is_dir() else []
    db_catalog = get_d004_db_catalog()
    years = sorted(set(years) | {key[0] for key in db_catalog}, reverse=True)
    quarters = ['1kv', '2kv', '3kv', '4kv']
    available_modules = {int(key[2]) for key in db_catalog}
    if d004_dir.is_dir():
        for selected_year in years:
            for selected_quarter in quarters:
                for selected_module in D004_MODULES:
                    if get_d004_path(selected_year, selected_quarter, str(selected_module)):
                        available_modules.add(selected_module)
    modules = [{'id': module, 'label': label} for module, label in D004_MODULES.items()
               if module in available_modules] or [{'id': module, 'label': label} for module, label in D004_MODULES.items()]
    return jsonify({'years': years, 'quarters': quarters, 'modules': modules})


@app.route('/api/d004/data', methods=['GET'])
def d004_data():
    year = request.args.get('year', '2024')
    quarter = request.args.get('quarter', '4kv')
    module = request.args.get('module', '1')
    if year not in {'2021', '2022', '2023', '2024'}:
        return jsonify({'error': 'Выбранный год не поддерживается.'}), 400
    if quarter != 'all' and quarter not in {'1kv', '2kv', '3kv', '4kv'}:
        return jsonify({'error': 'Выбранный квартал не поддерживается.'}), 400
    if not module.isdigit() or int(module) not in D004_MODULES:
        return jsonify({'error': 'Выбранный раздел анкеты не поддерживается.'}), 400

    d004_dir = DATA_DIR / 'd004'
    db_catalog = get_d004_db_catalog()
    years = sorted((path.name for path in d004_dir.iterdir() if path.is_dir()), reverse=True) if d004_dir.is_dir() else []
    years = sorted(set(years) | {key[0] for key in db_catalog}, reverse=True)
    selected_years = [year]
    selected_quarters = ['1kv', '2kv', '3kv', '4kv'] if quarter == 'all' else [quarter]
    paths = [path for selected_year in selected_years for selected_quarter in selected_quarters
             if (path := get_d004_path(selected_year, selected_quarter, module)) is not None]
    selected_specs = [(selected_year, selected_quarter, db_catalog[(selected_year, selected_quarter, str(int(module)))])
                      for selected_year in selected_years for selected_quarter in selected_quarters
                      if (selected_year, selected_quarter, str(int(module))) in db_catalog]
    expected_sources = len(selected_years) * len(selected_quarters)
    if len(selected_specs) == expected_sources and len(paths) != expected_sources:
        page = max(1, request.args.get('page', default=1, type=int))
        page_size = min(100, max(10, request.args.get('page_size', default=50, type=int)))
        try:
            return jsonify(d004_data_from_sqlite(selected_specs, year, quarter, module, page, page_size))
        except sqlite3.Error as error:
            print(f'[D004]: Ошибка чтения SQLite таблиц: {error}')
            return jsonify({'error': 'Не удалось прочитать таблицы D004 из database.sqlite.'}), 500
    if not paths:
        return jsonify({'error': 'CSV D004 не найдены, а в database.sqlite нет полного набора таблиц для этого периода. Выполните import_sinte_to_db.py перед запуском.'}), 404

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
        'year': year,
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
        'territory_summary': summary,
        'source': 'data/sinte CSV'
    })

@app.route('/api/settings/claude-key', methods=['GET', 'POST', 'DELETE'])
def claude_key_settings():
    global CLAUDE_API_KEY

    if request.method == 'GET':
        return jsonify({'configured': bool(CLAUDE_API_KEY)})

    if request.method == 'DELETE':
        CLAUDE_API_KEY = ''
        return jsonify({'configured': False})

    payload = request.get_json(silent=True)
    api_key = payload.get('api_key') if isinstance(payload, dict) else None
    if not isinstance(api_key, str):
        return jsonify({'error': 'Введите API-ключ Claude из Anthropic Console.'}), 400

    api_key = api_key.strip()
    if len(api_key) < 20:
        return jsonify({'error': 'Ключ выглядит слишком коротким. Вставьте полный API-ключ из Anthropic Console.'}), 400
    if not api_key.startswith('sk-ant-'):
        return jsonify({'error': 'Ожидается ключ Anthropic, начинающийся с sk-ant-.'}), 400
    try:
        api_key.encode('ascii')
    except UnicodeEncodeError:
        return jsonify({'error': 'API-ключ должен содержать только ASCII-символы.'}), 400

    CLAUDE_API_KEY = api_key
    return jsonify({'configured': True})


@app.route('/api/ai-status', methods=['GET'])
def ai_status():
    if not CLAUDE_API_KEY:
        return jsonify({'status': 'offline', 'reason': 'missing_key'})

    status_request = urllib.request.Request(
        'https://api.anthropic.com/v1/models?limit=100',
        headers={
            'x-api-key': CLAUDE_API_KEY,
            'anthropic-version': '2023-06-01',
            'accept': 'application/json'
        }
    )
    try:
        with urllib.request.urlopen(status_request, timeout=4) as response:
            models = json.loads(response.read().decode('utf-8')).get('data', [])
        available_models = {item.get('id') for item in models if isinstance(item, dict)}
        if CLAUDE_MODEL not in available_models:
            return jsonify({'status': 'offline', 'reason': 'model_unavailable'})
        return jsonify({'status': 'online', 'reason': 'ready'})
    except urllib.error.HTTPError as error:
        reason = 'invalid_key' if error.code in (401, 403) else 'api_unavailable'
        return jsonify({'status': 'offline', 'reason': reason})
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return jsonify({'status': 'offline', 'reason': 'network_unavailable'})



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
        },
        {
            'name': 'query_d008',
            'description': 'Получить показатели демографического обследования D008 за выбранные годы отдельно, с фильтрами и абсолютными числами или долями. Никогда не суммируй разные годы.',
            'parameters': {
                'type': 'OBJECT', 'properties': {
                    'metric': {'type': 'STRING', 'enum': ['age_structure', 'settlement', 'gender', 'relationships', 'education', 'marital_status', 'activity', 'household_sizes']},
                    'years': {'type': 'ARRAY', 'items': {'type': 'STRING', 'enum': ['2022', '2023', '2024']}},
                    'value': {'type': 'STRING', 'enum': ['count', 'share']},
                    'filters': {'type': 'OBJECT', 'properties': {
                        'age_group': {'type': 'STRING'}, 'gender': {'type': 'STRING'}, 'settlement': {'type': 'STRING'},
                        'relationship': {'type': 'STRING'}, 'education': {'type': 'STRING'},
                        'marital_status': {'type': 'STRING'}, 'activity': {'type': 'STRING'}
                    }}
                }, 'required': ['metric']
            }
        }
    ]
}]

AI_SYSTEM_INSTRUCTION = '''Ты аналитический помощник дашборда статистики Казахстана.
Отвечай на русском языке, ясно и по существу. Для фактов, чисел, сравнений, рейтингов и трендов из базы обязательно вызывай query_demographics; не придумывай значения и не делай выводы по памяти.
Для вопросов о наборе D008 обязательно используй query_d008. Каждый год показывай отдельно: никогда не складывай и не усредняй значения разных лет. Учитывай datasetFilters из контекста, если пользователь не задал более точные фильтры. В сравнении годов описывай динамику показателя, а долю трактуй как процент среди заполненных ответов; абсолютное значение — как число людей/домохозяйств.
Если не знаешь точное название показателя или региона, сначала вызови get_dataset_overview. Учитывай, что база содержит агрегированные записи demographics: indicator, year, province, value. Объясняй, какие фильтры и годы использованы. Если запрос нельзя подтвердить данными, прямо скажи об этом.
Если пользователь прямо просит построить, показать или визуализировать график, вызови build_dataset_chart. Для наборов D002, D004, D006 и D008 выбирай только метрики из описания инструмента. Для D002 укажи идентификатор вопроса анкеты; если его невозможно определить из запроса, попроси уточнить вопрос, не выбирая его наугад. Для таблицы demographics обязательно укажи точный показатель и группировку. Не представляй график как готовый, если инструмент вернул ошибку. В текстовом ответе кратко укажи источник данных, период и что показано.
Не делай выводов о причинно-следственных связях только на основе графика. Отделяй наблюдаемые факты от гипотез.
Оформляй ответ простым текстом: не используй Markdown-заголовки с #, выделение через * или ** и кодовые блоки. Не добавляй нумерацию разделов, если она не нужна; вместо маркеров Markdown используй короткие абзацы или тире.
Если пользователь ссылается на «текущий/открытый набор», ориентируйся на activeDataset и datasetFilters из контекста; явные фильтры пользователя важнее выбранных на странице. Контекст и история помогают понять вопрос, но не заменяют проверку базы.'''


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
    if group_by not in {'year', 'province_year'} and (start_year is not None or end_year is not None):
        try:
            start_bound = int(start_year) if start_year is not None else None
            end_bound = int(end_year) if end_year is not None else None
        except (TypeError, ValueError):
            return {'error': 'Год должен быть целым числом.'}
        if start_bound is not None and end_bound is not None and start_bound != end_bound:
            return {'error': 'Нельзя объединять разные годы в одну сумму. Для динамики используйте группировку year или province_year.'}
        selected_year = start_bound if start_bound is not None else end_bound
        start_year = end_year = selected_year
    if start_year is None and end_year is None and group_by not in {'year', 'province_year'}:
        conn = get_db_connection()
        try:
            latest_year = conn.execute('SELECT MAX(year) FROM demographics WHERE year > 0').fetchone()[0]
        finally:
            conn.close()
        if latest_year is not None:
            start_year = end_year = int(latest_year)
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


def query_d008(arguments):
    """Return D008 survey values by year without combining years."""
    metric = arguments.get('metric')
    metric_rows = {
        'age_structure': ('Возрастные группы', 'age_structure'),
        'settlement': ('Город и село', 'settlement'),
        'gender': ('Пол', 'gender'),
        'relationships': ('Родство в семье', 'relationships'),
        'education': ('Уровень образования', 'education'),
        'marital_status': ('Семейное положение', 'marital_status'),
        'activity': ('Статус занятости', 'activity'),
        'household_sizes': ('Размер домохозяйства', 'household_sizes')
    }
    if metric not in metric_rows:
        return {'error': 'Укажите метрику D008: age_structure, settlement, gender, relationships, education, marital_status, activity или household_sizes.'}

    requested_years = arguments.get('years')
    if not isinstance(requested_years, list) or not requested_years:
        selected_year = str(arguments.get('year') or '').strip()
        requested_years = [selected_year] if selected_year in {'2022', '2023', '2024'} else ['2022', '2023', '2024']
    years = list(dict.fromkeys(str(year) for year in requested_years if str(year) in {'2022', '2023', '2024'}))
    if not years:
        return {'error': 'Для динамики D008 выберите 2022, 2023 и/или 2024 год.'}

    allowed_filters = {
        'age_group': {'0-14', '15-24', '25-39', '40-59', '60+'},
        'gender': {'1', '2'}, 'settlement': {'1', '2'},
        'relationship': set(D008_RELATIONSHIPS), 'education': set(D008_EDUCATION),
        'marital_status': set(D008_MARITAL_STATUS), 'activity': set(D008_ACTIVITY)
    }
    supplied_filters = arguments.get('filters') if isinstance(arguments.get('filters'), dict) else {}
    filter_labels = {
        'gender': {'1': 'Мужчины', '2': 'Женщины'},
        'settlement': {'1': 'Город', '2': 'Село'},
        'relationship': D008_RELATIONSHIPS, 'education': D008_EDUCATION,
        'marital_status': D008_MARITAL_STATUS, 'activity': D008_ACTIVITY,
        'age_group': {'0-14': '0–14 лет', '15-24': '15–24 года', '25-39': '25–39 лет', '40-59': '40–59 лет', '60+': '60 лет и старше'}
    }
    filter_aliases = {
        'gender': {'мужчина': '1', 'мужчины': '1', 'мужской': '1', 'женщина': '2', 'женщины': '2', 'женский': '2'},
        'settlement': {'городское': '1', 'город': '1', 'сельское': '2', 'село': '2'}
    }
    filters = {}
    for name, raw_value in supplied_filters.items():
        if name not in allowed_filters or raw_value in (None, ''):
            continue
        value = str(raw_value).strip()
        if value not in allowed_filters[name]:
            value = next((code for code, label in filter_labels.get(name, {}).items() if label.casefold() == value.casefold()), value)
            value = filter_aliases.get(name, {}).get(value.casefold(), value)
        if value in allowed_filters[name]:
            filters[name] = value
    value_key = arguments.get('value', 'count')
    if value_key not in {'count', 'share'}:
        return {'error': 'Для D008 выберите абсолютное число count или долю share.'}

    _, data_key = metric_rows[metric]
    client = app.test_client()
    yearly = []
    for year in years:
        response = client.get('/api/d008/data', query_string={'year': year, **filters})
        data = response.get_json(silent=True) or {}
        if response.status_code != 200:
            return {'error': data.get('error', f'Не удалось получить D008 за {year}.')}
        yearly.append({
            'year': year,
            'people': data.get('people', 0),
            'answered': (data.get('answered') or {}).get(data_key, 0),
            'average_age': data.get('average_age'),
            'average_household_size': data.get('average_household_size'),
            'rows': data.get(data_key, [])
        })
    return {
        'dataset': 'd008', 'metric': metric, 'value': value_key,
        'filters': filters, 'years': yearly
    }


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
        result = call_claude(contents, dataset_overview, dashboard_context, include_chart=True)
        return jsonify(result)
    except ClaudeAPIError as error:
        upstream = {}
        if error.status is not None:
            upstream['status'] = error.status
        if error.content_type:
            upstream['content_type'] = error.content_type
        return jsonify({
            'error': {
                'code': 'claude_api_error',
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
        raw_analysis = call_claude(
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
    except ClaudeAPIError as error:
        return jsonify({'error': str(error)}), 503
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 503
    except (sqlite3.Error, OSError) as error:
        app.logger.exception('Не удалось подготовить ИИ-анализ графика')
        return jsonify({'error': f'Не удалось подготовить анализ графика: {error}'}), 503


def build_dataset_chart(arguments):
    """Return a bounded chart payload computed from the app's existing data APIs."""
    dataset = arguments.get('dataset')
    metric = arguments.get('metric')
    chart_type = arguments.get('chart_type')
    if dataset not in {'demographics', 'd002', 'd004', 'd006', 'd008'}:
        return {'error': 'Выберите один из поддерживаемых наборов: demographics, D002, D004, D006 или D008.'}
    if chart_type not in {'bar', 'line', 'pie'}:
        return {'error': 'Поддерживаются столбчатый, линейный и круговой графики.'}

    client = app.test_client()
    year = str(arguments.get('year') or '2024').strip()
    title = ''
    subtitle = ''
    rows = []
    value_key = arguments.get('value', 'count')
    if value_key not in {'count', 'share', 'households', 'amount', 'records'}:
        return {'error': 'Недопустимый способ подсчёта значений.'}

    if dataset == 'demographics':
        indicator = arguments.get('indicator')
        if not isinstance(indicator, str) or not indicator.strip():
            return {'error': 'Для графика demographics укажите точное название показателя.'}
        group_by = arguments.get('group_by', 'province')
        if group_by not in {'year', 'province', 'province_year'}:
            return {'error': 'Для demographics выберите группировку year, province или province_year.'}
        query = {
            'indicator': indicator.strip()[:120],
            'group_by': group_by,
            'limit': 30
        }
        for field in ('start_year', 'end_year'):
            if arguments.get(field) is not None:
                query[field] = arguments[field]
        result = query_demographics(query)
        if result.get('error'):
            return result
        data_rows = result.get('rows') or []
        if group_by == 'year':
            labels = [str(row.get('year', '')) for row in data_rows]
        elif group_by == 'province':
            labels = [str(row.get('province', '')) for row in data_rows]
        else:
            labels = [f"{row.get('province', '')} · {row.get('year', '')}" for row in data_rows]
        values = [row.get('total') for row in data_rows]
        title = indicator.strip()[:100]
        period = ''
        if query.get('start_year') or query.get('end_year'):
            period = f"{query.get('start_year', 'все годы')}–{query.get('end_year', 'настоящее время')}"
        subtitle = f"demographics · {period or 'все доступные годы'}"
    else:
        if dataset == 'd002':
            form = arguments.get('form', 'subject')
            if form not in D002_FORMS:
                return {'error': 'Для D002 доступны разделы subject и ocenka.'}
            chart_type = 'line'
            question = arguments.get('question')
            requested_years = arguments.get('years')
            if not isinstance(requested_years, list) or not requested_years:
                if year == 'all':
                    options = client.get('/api/d002/options').get_json(silent=True) or {}
                    requested_years = options.get('years') or []
                else:
                    requested_years = [year]
            requested_years = sorted({str(item) for item in requested_years if str(item) in {'2021', '2022', '2023', '2024'}})
            if len(requested_years) > 1:
                if not isinstance(question, str) or not question.strip():
                    return {'error': 'Для динамики D002 выберите текущий вопрос или укажите его код.'}
                yearly_questions = []
                for selected_year in requested_years:
                    year_response = client.get('/api/d002/data', query_string={'year': selected_year, 'form': form})
                    year_data = year_response.get_json(silent=True) or {}
                    match = next((item for item in year_data.get('questions', [])
                                  if question.casefold() == str(item.get('id', '')).casefold()
                                  or question.casefold() in str(item.get('label', '')).casefold()), None)
                    yearly_questions.append((selected_year, match))
                available = [(selected_year, item) for selected_year, item in yearly_questions if item]
                if not available:
                    return {'error': f'Вопрос D002 «{question}» не найден в выбранных годах.'}
                categories_by_code = {}
                for _, item in available:
                    for answer in item.get('distribution', []):
                        code = str(answer.get('code', answer.get('label', '')))
                        categories_by_code[code] = str(answer.get('label', code))
                yearly_data = dict(yearly_questions)
                chart_series = [{
                    'name': label,
                    'type': 'line',
                    'data': [next((answer.get(value_key) for answer in (yearly_data.get(selected_year) or {}).get('distribution', [])
                                   if str(answer.get('code', answer.get('label', ''))) == code), None)
                             for selected_year in requested_years]
                } for code, label in categories_by_code.items()]
                return {
                    'dataset': 'd002', 'title': available[-1][1].get('label', 'Динамика ответов'),
                    'subtitle': f"D002 · {form} · {requested_years[0]}–{requested_years[-1]} · {'доля, %' if value_key == 'share' else 'число ответов'}",
                    'chart_type': 'line', 'labels': requested_years, 'series': chart_series,
                    'value_label': '%' if value_key == 'share' else ''
                }
            if not requested_years:
                return {'error': 'Для D002 не найдено доступных лет.'}
            year = requested_years[0]
            response = client.get('/api/d002/data', query_string={'year': year, 'form': form})
        elif dataset == 'd004':
            quarter = arguments.get('quarter', 'all')
            module = arguments.get('module', 1)
            if quarter not in {'1kv', '2kv', '3kv', '4kv', 'all'}:
                return {'error': 'Для D004 выберите квартал 1kv–4kv или all.'}
            response = client.get('/api/d004/data', query_string={
                'year': year, 'quarter': quarter, 'module': module, 'page': 1, 'page_size': 10
            })
        elif dataset == 'd006':
            response = client.get('/api/d006/data', query_string={'year': year})
        elif dataset == 'd008':
            d008_result = query_d008({
                'metric': metric,
                'years': arguments.get('years'),
                'year': arguments.get('year'),
                'value': value_key,
                'filters': arguments.get('filters')
            })
            if d008_result.get('error'):
                return d008_result
            yearly = d008_result['years']
            category_labels = {}
            for yearly_item in yearly:
                for row in yearly_item['rows']:
                    category_labels[str(row.get('code', row.get('label', '')))] = str(row.get('label', ''))
            selected_keys = list(category_labels)
            if len(selected_keys) > 14:
                selected_keys = selected_keys[:14]
            chart_series = [{
                'name': category_labels[key],
                'type': 'line',
                'data': [next((row.get(value_key) for row in year_item['rows'] if str(row.get('code', row.get('label', ''))) == key), 0) for year_item in yearly]
            } for key in selected_keys]
            if not chart_series:
                return {'error': 'Для выбранных фильтров нет данных D008 для графика.'}
            metric_titles = {
                'age_structure': 'Возрастная структура', 'settlement': 'Город и село', 'gender': 'Распределение по полу',
                'relationships': 'Родство в семье', 'education': 'Уровень образования', 'marital_status': 'Семейное положение',
                'activity': 'Статус занятости', 'household_sizes': 'Размер домохозяйства'
            }
            filters = d008_result.get('filters') or {}
            subtitle = f"D008 · {', '.join(item['year'] for item in yearly)} · {'доля, %' if value_key == 'share' else 'абсолютное число'}"
            if filters:
                subtitle += ' · фильтры: ' + ', '.join(f'{key}={value}' for key, value in filters.items())
            return {
                'dataset': 'd008', 'title': metric_titles.get(metric, 'Демография'), 'subtitle': subtitle,
                'chart_type': 'line', 'labels': [item['year'] for item in yearly], 'series': chart_series,
                'value_label': '%' if value_key == 'share' else ''
            }
        else:
            response = client.get('/api/d008/data', query_string={'year': year})

        data = response.get_json(silent=True) or {}
        if response.status_code != 200:
            return {'error': data.get('error', f'Не удалось получить данные {dataset.upper()} за {year}.')}

        if dataset == 'd002':
            question = arguments.get('question')
            if not isinstance(question, str) or not question.strip():
                return {
                    'error': 'Для графика D002 нужно указать идентификатор или название вопроса.',
                    'available_questions': [{'id': item['id'], 'label': item['label']}
                                            for item in data.get('questions', [])[:30]]
                }
            match = next((item for item in data.get('questions', [])
                          if question.casefold() == str(item.get('id', '')).casefold()
                          or question.casefold() in str(item.get('label', '')).casefold()), None)
            if not match:
                return {
                    'error': f'Вопрос D002 «{question}» не найден.',
                    'available_questions': [{'id': item['id'], 'label': item['label']}
                                            for item in data.get('questions', [])[:30]]
                }
            rows = match.get('distribution', [])
            title = match.get('label', 'Распределение ответов')
            value_key = 'share' if value_key == 'share' else 'count'
            subtitle = f"D002 · {data.get('form_label', form)} · {year} · {value_key}"
        elif dataset == 'd004':
            rows = data.get('territory_summary', [])
            field_titles = {
                'records': 'Количество записей',
                'households': 'Количество домохозяйств',
                'amount': 'Сумма расходов'
            }
            if value_key not in field_titles:
                value_key = 'households'
            title = field_titles[value_key]
            subtitle = f"D004 · {data.get('module_label', '')} · {data.get('year', year)} · {data.get('quarter', '')}"
        elif dataset == 'd006':
            metric_rows = {
                'city_rural': ('Город и село', data.get('city_rural')),
                'home_types': ('Тип жилья', data.get('home_types')),
                'ownership': ('Форма владения жильём', data.get('ownership')),
                'land_access': ('Доступ к земле', data.get('land_access')),
                'amenities': ('Бытовые удобства', data.get('amenities')),
                'durable_goods': ('Товары длительного пользования', data.get('durable_goods'))
            }
            selected = metric_rows.get(metric)
            if not selected:
                return {'error': 'Для D006 укажите метрику: city_rural, home_types, ownership, land_access, amenities или durable_goods.'}
            title, rows = selected
            if metric == 'durable_goods':
                value_key = 'count'
            else:
                value_key = 'share' if value_key == 'share' else 'count'
            subtitle = f"D006 · {year} · {value_key}"
        else:
            metric_rows = {
                'age_structure': ('Возрастная структура', data.get('age_structure')),
                'settlement': ('Город и село', data.get('settlement')),
                'gender': ('Распределение по полу', data.get('gender')),
                'relationships': ('Родство в домохозяйстве', data.get('relationships')),
                'education': ('Уровень образования', data.get('education')),
                'marital_status': ('Семейное положение', data.get('marital_status')),
                'activity': ('Основная деятельность', data.get('activity')),
                'household_sizes': ('Размер домохозяйства', data.get('household_sizes'))
            }
            selected = metric_rows.get(metric)
            if not selected:
                return {'error': 'Для D008 укажите одну из доступных метрик: age_structure, settlement, gender, relationships, education, marital_status, activity или household_sizes.'}
            title, rows = selected
            value_key = 'share' if value_key == 'share' else 'count'
            subtitle = f"D008 · {year} · {value_key}"

        labels = [str(item.get('label', item.get('territory', ''))) for item in (rows or [])]
        values = [item.get(value_key) for item in (rows or [])]

    points = []
    for label, value in zip(labels, values):
        try:
            numeric_value = float(value)
        except (TypeError, ValueError, OverflowError):
            continue
        if label and math.isfinite(numeric_value):
            points.append({'label': label[:100], 'value': numeric_value})
    if not points:
        return {'error': 'Для выбранных фильтров нет числовых данных для графика.'}

    points = points[:30]
    if dataset == 'd004':
        points.sort(key=lambda item: item['value'], reverse=True)
    return {
        'dataset': dataset,
        'title': title[:120],
        'subtitle': subtitle[:200],
        'chart_type': chart_type,
        'labels': [item['label'] for item in points],
        'values': [item['value'] for item in points],
        'value_label': '%' if value_key == 'share' else ''
    }


def call_claude(contents, dataset_overview, dashboard_context, max_output_tokens=1200, include_chart=False):
    api_key = CLAUDE_API_KEY
    if not api_key:
        raise RuntimeError('Не задан CLAUDE_API_KEY. Добавьте ключ Claude в настройках приложения.')
    if not api_key.startswith('sk-ant-'):
        raise RuntimeError('CLAUDE_API_KEY должен быть ключом Anthropic, начинающимся с sk-ant-.')

    context_text = json.dumps({
        'dataset': dataset_overview,
        'dashboard_filters': dashboard_context
    }, ensure_ascii=False)
    system_instruction = f'{AI_SYSTEM_INSTRUCTION}\n\nФактический каталог базы и выбранные фильтры: {context_text}'
    messages = []
    for item in contents:
        role = 'assistant' if item.get('role') in ('assistant', 'model') else 'user'
        text = '\n'.join(
            part.get('text', '')
            for part in item.get('parts', [])
            if isinstance(part, dict) and isinstance(part.get('text'), str)
        ).strip()
        if text:
            messages.append({'role': role, 'content': text})

    claude_tools = [
        {
            'name': 'get_dataset_overview',
            'description': 'Получить каталог таблицы demographics: показатели, годы, регионы и количество записей.',
            'input_schema': {'type': 'object', 'properties': {}}
        },
        {
            'name': 'query_demographics',
            'description': 'Прочитать агрегированные данные по показателям Казахстана. Вызывай для вычислений, сравнений, трендов и любых числовых выводов.',
            'input_schema': {
                'type': 'object',
                'properties': {
                    'indicator': {'type': 'string', 'description': 'Название показателя или его уникальная часть.'},
                    'province': {'type': 'string', 'description': 'Название области/города или его уникальная часть.'},
                    'start_year': {'type': 'integer', 'description': 'Начальный год включительно.'},
                    'end_year': {'type': 'integer', 'description': 'Конечный год включительно.'},
                    'group_by': {
                        'type': 'string',
                        'enum': ['none', 'indicator', 'year', 'province', 'province_year'],
                        'description': 'Группировка результата.'
                    },
                    'limit': {'type': 'integer', 'description': 'Максимум строк результата, от 1 до 200.'}
                }
            }
        },
        {
            'name': 'query_d008',
            'description': 'Данные D008 отдельно по каждому году, с фильтрами; никогда не объединяй годы.',
            'input_schema': {'type': 'object', 'properties': {
                'metric': {'type': 'string', 'enum': ['age_structure', 'settlement', 'gender', 'relationships', 'education', 'marital_status', 'activity', 'household_sizes']},
                'years': {'type': 'array', 'items': {'type': 'string', 'enum': ['2022', '2023', '2024']}},
                'value': {'type': 'string', 'enum': ['count', 'share']},
                'filters': {'type': 'object', 'properties': {
                    'age_group': {'type': 'string'}, 'gender': {'type': 'string'}, 'settlement': {'type': 'string'},
                    'relationship': {'type': 'string'}, 'education': {'type': 'string'}, 'marital_status': {'type': 'string'}, 'activity': {'type': 'string'}
                }}
            }, 'required': ['metric']}
        },
        {
            'name': 'build_dataset_chart',
            'description': (
                'Построить реальный график только по имеющимся данным. Используй исключительно когда пользователь '
                'прямо просит график/диаграмму. dataset: demographics, d002, d004, d006, d008. '
                'Если пользователь ссылается на текущий набор, используй activeDataset и datasetFilters из контекста. '
                'Метрики D006: city_rural, home_types, ownership, land_access, amenities, durable_goods. '
                'Метрики D008: age_structure, settlement, gender, relationships, education, marital_status, activity, household_sizes. Для D008 всегда строй линейную динамику по years (2022/2023/2024), не объединяй года; передавай filters из контекста и value=count/share. '
                'Для D002 укажи question (идентификатор GR... или часть названия); value=count или share, form=subject/ocenka. '
                'Для D004 строится сравнение территорий; value=households, records или amount, quarter может быть all, module — номер раздела. '
                'Для demographics задай точный indicator, group_by=province/year/province_year и при необходимости start_year/end_year. '
                'chart_type: bar/line/pie. Не выдумывай недостающие фильтры.'
            ),
            'input_schema': {
                'type': 'object',
                'properties': {
                    'dataset': {'type': 'string', 'enum': ['demographics', 'd002', 'd004', 'd006', 'd008']},
                    'metric': {'type': 'string'},
                    'chart_type': {'type': 'string', 'enum': ['bar', 'line', 'pie']},
                    'year': {'type': 'string'},
                    'years': {'type': 'array', 'items': {'type': 'string', 'enum': ['2022', '2023', '2024']}},
                    'filters': {'type': 'object', 'properties': {
                        'age_group': {'type': 'string'}, 'gender': {'type': 'string'}, 'settlement': {'type': 'string'},
                        'relationship': {'type': 'string'}, 'education': {'type': 'string'}, 'marital_status': {'type': 'string'}, 'activity': {'type': 'string'}
                    }},
                    'value': {'type': 'string', 'enum': ['count', 'share', 'households', 'amount', 'records']},
                    'question': {'type': 'string'},
                    'form': {'type': 'string', 'enum': ['subject', 'ocenka']},
                    'quarter': {'type': 'string', 'enum': ['1kv', '2kv', '3kv', '4kv', 'all']},
                    'module': {'type': 'integer'},
                    'indicator': {'type': 'string'},
                    'group_by': {'type': 'string', 'enum': ['province', 'year', 'province_year']},
                    'start_year': {'type': 'integer'},
                    'end_year': {'type': 'integer'}
                },
                'required': ['dataset', 'chart_type']
            }
        }
    ]

    chart_result = None
    for _ in range(4):
        body = {
            'model': CLAUDE_MODEL,
            'max_tokens': max_output_tokens,
            'system': system_instruction,
            'messages': messages,
            'tools': claude_tools
        }
        retry = 0
        while True:
            req = urllib.request.Request(
                'https://api.anthropic.com/v1/messages',
                data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'x-api-key': api_key,
                    'anthropic-version': '2023-06-01'
                },
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as response:
                    result = json.loads(response.read().decode('utf-8'))
                break
            except urllib.error.HTTPError as error:
                response_body = error.read().decode('utf-8', errors='replace')
                try:
                    error_payload = json.loads(response_body)
                except json.JSONDecodeError:
                    error_payload = None

                api_error = error_payload.get('error') if isinstance(error_payload, dict) else None
                details = api_error.get('message') if isinstance(api_error, dict) else None
                if not isinstance(details, str):
                    details = (
                        f'Anthropic API вернул HTTP {error.code} без описания '
                        f'(Content-Type: {error.headers.get_content_type()}). Модель: {CLAUDE_MODEL}.'
                    )
                if error.code in (429, 500, 503, 529) and retry < 2:
                    time.sleep(2 ** (retry + 1))
                    retry += 1
                    continue
                raise ClaudeAPIError(
                    f'Claude API ({error.code}): {details}',
                    status=error.code,
                    content_type=error.headers.get_content_type()
                ) from error
            except urllib.error.URLError as error:
                raise ClaudeAPIError(
                    f'Не удалось подключиться к Anthropic API: {error.reason}'
                ) from error

        blocks = result.get('content') or []
        tool_calls = [block for block in blocks if block.get('type') == 'tool_use']
        if not tool_calls:
            answer = '\n'.join(
                block.get('text', '')
                for block in blocks
                if block.get('type') == 'text' and block.get('text')
            )
            if answer:
                return {'answer': answer, 'chart': chart_result} if include_chart else answer
            raise RuntimeError('Claude вернул пустой ответ.')

        messages.append({'role': 'assistant', 'content': blocks})
        tool_results = []
        for tool_call in tool_calls:
            name = tool_call.get('name')
            arguments = tool_call.get('input') or {}
            try:
                if name == 'get_dataset_overview':
                    tool_result = dataset_overview
                elif name == 'query_demographics' and isinstance(arguments, dict):
                    tool_result = query_demographics(arguments)
                elif name == 'query_d008' and isinstance(arguments, dict):
                    d008_arguments = dict(arguments)
                    if dashboard_context.get('activeDataset') == 'd008':
                        dataset_filters = dashboard_context.get('datasetFilters') or {}
                        selected = (dataset_filters.get('chartFilters') or {}).get(d008_arguments.get('metric')) or {}
                        supplied = d008_arguments.get('filters') if isinstance(d008_arguments.get('filters'), dict) else {}
                        d008_arguments['filters'] = {**{key: value for key, value in selected.items() if value}, **supplied}
                        if not d008_arguments.get('years') and not d008_arguments.get('year'):
                            d008_arguments['years'] = dataset_filters.get('years')
                        d008_arguments.setdefault('value', selected.get('value_mode', 'count'))
                    tool_result = query_d008(d008_arguments)
                elif name == 'build_dataset_chart' and isinstance(arguments, dict):
                    chart_arguments = dict(arguments)
                    if chart_arguments.get('dataset') == 'd002' and dashboard_context.get('activeDataset') == 'd002':
                        selected = dashboard_context.get('datasetFilters') or {}
                        if not chart_arguments.get('year'):
                            chart_arguments['year'] = selected.get('year')
                            chart_arguments.setdefault('years', selected.get('years'))
                        chart_arguments.setdefault('form', selected.get('form'))
                        chart_arguments.setdefault('question', selected.get('question'))
                        chart_arguments.setdefault('value', selected.get('value_mode', 'share'))
                    if chart_arguments.get('dataset') == 'd008' and dashboard_context.get('activeDataset') == 'd008':
                        dataset_filters = dashboard_context.get('datasetFilters') or {}
                        selected = (dataset_filters.get('chartFilters') or {}).get(chart_arguments.get('metric')) or {}
                        supplied = chart_arguments.get('filters') if isinstance(chart_arguments.get('filters'), dict) else {}
                        chart_arguments['filters'] = {**{key: value for key, value in selected.items() if value}, **supplied}
                        if not chart_arguments.get('years') and not chart_arguments.get('year'):
                            chart_arguments['years'] = dataset_filters.get('years')
                        chart_arguments.setdefault('value', selected.get('value_mode', 'count'))
                        chart_arguments['chart_type'] = 'line'
                    tool_result = build_dataset_chart(chart_arguments)
                    if ('values' in tool_result or 'series' in tool_result) and 'labels' in tool_result:
                        chart_result = tool_result
                else:
                    tool_result = {'error': 'Запрошена неизвестная функция или переданы неверные параметры.'}
            except (AttributeError, TypeError, ValueError, sqlite3.Error):
                tool_result = {'error': 'Переданы некорректные параметры фильтрации.'}
            tool_results.append({
                'type': 'tool_result',
                'tool_use_id': tool_call.get('id', ''),
                'content': json.dumps(tool_result, ensure_ascii=False)
            })
        messages.append({'role': 'user', 'content': tool_results})

    raise RuntimeError('ИИ не завершил анализ после нескольких запросов к базе. Попробуйте уточнить вопрос.')


@app.route('/api/init-filters', methods=['GET'])
def init_filters():
    print("[API Request]: /api/init-filters -> читаем списки из таблицы 'demographics'")
    active_rows = active_dataset_rows()
    if active_rows is not None:
        indicators = sorted({row['indicator'] for row in active_rows}, key=str.casefold)
        years = sorted({row['year'] for row in active_rows if row['year'] > 0}, reverse=True)
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
            if row['indicator'] == indicator and row['year'] == selected_year:
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
        if not has_real_years:
            return jsonify({'labels': [], 'values': []})
        for row in active_rows:
            if row['indicator'] == indicator and row['year'] > 0:
                totals[row['year']] = totals.get(row['year'], 0) + row['value']
        years = sorted(totals)
        return jsonify({
            'labels': [f"{year} год" for year in years],
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
