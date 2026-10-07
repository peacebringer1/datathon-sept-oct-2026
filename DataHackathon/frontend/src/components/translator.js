const languages = ['ru', 'kk', 'en'];
const languageStorageKey = 'app-language';
const translations = {
  'Аналитика Республики Казахстан': ['Қазақстан Республикасының аналитикасы', 'Analytics of the Republic of Kazakhstan'],
  'Атырауская область': ['Атырау облысы', 'Atyrau Region'],
  'Акмолинская область': ['Ақмола облысы', 'Akmola Region'],
  'Актюбинская область': ['Ақтөбе облысы', 'Aktobe Region'],
  'Алматинская область': ['Алматы облысы', 'Almaty Region'],
  'Абайская область': ['Абай облысы', 'Abai Region'],
  'Восточно-Казахстанская область': ['Шығыс Қазақстан облысы', 'East Kazakhstan Region'],
  'Жамбылская область': ['Жамбыл облысы', 'Zhambyl Region'],
  'Жетысуская область': ['Жетісу облысы', 'Jetisu Region'],
  'Западно-Казахстанская область': ['Батыс Қазақстан облысы', 'West Kazakhstan Region'],
  'Карагандинская область': ['Қарағанды облысы', 'Karaganda Region'],
  'Костанайская область': ['Қостанай облысы', 'Kostanay Region'],
  'Кызылординская область': ['Қызылорда облысы', 'Kyzylorda Region'],
  'Мангистауская область': ['Маңғыстау облысы', 'Mangystau Region'],
  'Павлодарская область': ['Павлодар облысы', 'Pavlodar Region'],
  'Северо-Казахстанская область': ['Солтүстік Қазақстан облысы', 'North Kazakhstan Region'],
  'Туркестанская область': ['Түркістан облысы', 'Turkistan Region'],
  'Улытауская область': ['Ұлытау облысы', 'Ulytau Region'],
  'Область Абай': ['Абай облысы', 'Abai Region'],
  'Область Жетісу': ['Жетісу облысы', 'Jetisu Region'],
  'Область Ұлытау': ['Ұлытау облысы', 'Ulytau Region'],
  'г. Алматы': ['Алматы қ.', 'Almaty'],
  'г. Астана': ['Астана қ.', 'Astana'],
  'г. Шымкент': ['Шымкент қ.', 'Shymkent'],
  'Астана': ['Астана', 'Astana'],
  'Алматы': ['Алматы', 'Almaty'],
  'Шымкент': ['Шымкент', 'Shymkent'],
  'Категории данных': ['Деректер санаттары', 'Data categories'],
  'Поиск категорий...': ['Санаттарды іздеу...', 'Search categories...'],
  'Население': ['Халық', 'Population'],
  'Экономика': ['Экономика', 'Economy'],
  'Образование': ['Білім', 'Education'],
  'Промышленность': ['Өнеркәсіп', 'Industry'],
  'Сельское хозяйство': ['Ауыл шаруашылығы', 'Agriculture'],
  'Домохозяйство': ['Үй шаруашылығы', 'Household'],
  'Анализ данных': ['Деректерді талдау', 'Data Analyzer'],
  'Естественный прирост населения': ['Халықтың табиғи өсімі', 'Natural population growth'],
  'Естественный прирост населения, человек': ['Халықтың табиғи өсімі, адам', 'Natural population growth, people'],
  'Число зарегистрированных браков, человек': ['Тіркелген некелер саны, адам', 'Registered marriages, people'],
  'Число зарегистрированных разводов, человек': ['Тіркелген ажырасулар саны, адам', 'Registered divorces, people'],
  'Число умерших, человек': ['Қайтыс болғандар саны, адам', 'Deaths, people'],
  'Рождаемость, человек': ['Туу саны, адам', 'Births, people'],
  'Городское население, человек': ['Қала халқы, адам', 'Urban population, people'],
  'ВРП, млн тенге': ['ӨӨӨ, млн теңге', 'GRP, million tenge'],
  'Средняя зарплата, тенге': ['Орташа жалақы, теңге', 'Average salary, tenge'],
  'Уровень безработицы, %': ['Жұмыссыздық деңгейі, %', 'Unemployment rate, %'],
  'Инвестиции в основной капитал': ['Негізгі капиталға инвестициялар', 'Fixed capital investment'],
  'Объем розничной торговли': ['Бөлшек сауда көлемі', 'Retail trade volume'],
  'Индекс потребительских цен': ['Тұтыну бағаларының индексі', 'Consumer price index'],
  'Люди с высшим образованием, человек': ['Жоғары білімі бар адамдар, адам', 'People with higher education'],
  'Студенты вузов, человек': ['ЖОО студенттері, адам', 'University students, people'],
  'Охват дошкольным воспитанием': ['Мектепке дейінгі тәрбиемен қамту', 'Preschool education coverage'],
  'Количество дневных общеобразовательных школ': ['Күндізгі жалпы білім беретін мектептер саны', 'Number of full-time general education schools'],
  'Численность учащихся': ['Оқушылар саны', 'Number of students'],
  'Численность учителей': ['Мұғалімдер саны', 'Number of teachers'],
  'Промышленное производство, млн тенге': ['Өнеркәсіп өндірісі, млн теңге', 'Industrial production, million tenge'],
  'Добыча полезных ископаемых': ['Пайдалы қазбаларды өндіру', 'Mineral extraction'],
  'Обрабатывающая промышленность': ['Өңдеу өнеркәсібі', 'Manufacturing industry'],
  'Производство электроэнергии': ['Электр энергиясын өндіру', 'Electricity generation'],
  'Инвестиции в промышленность': ['Өнеркәсіпке инвестициялар', 'Investment in industry'],
  'Индекс физического объема': ['Нақты көлем индексі', 'Physical volume index'],
  'Валовой выпуск продукции сельского хозяйства, млн тенге': ['Ауыл шаруашылығы өнімінің жалпы шығарылымы, млн теңге', 'Gross agricultural output, million tenge'],
  'Производство мяса, тысяч тонн': ['Ет өндіру, мың тонна', 'Meat production, thousand tonnes'],
  'Производство молока, тысяч тонн': ['Сүт өндіру, мың тонна', 'Milk production, thousand tonnes'],
  'Посевные площади сельскохозяйственных культур': ['Ауыл шаруашылығы дақылдарының егіс алқабы', 'Crop sown area'],
  'Поголовье скота': ['Мал басы', 'Livestock numbers'],
  'Инвестиции в сельское хозяйство': ['Ауыл шаруашылығына инвестициялар', 'Investment in agriculture'],
  'По областям': ['Облыстар бойынша', 'By region'],
  'Итоговый': ['Қорытынды', 'Summary'],
  'Аналитика': ['Талдау', 'Analytics'],
  'Общий показатель:': ['Жалпы көрсеткіш:', 'Overall indicator:'],
  'Общий год:': ['Жалпы жыл:', 'Overall year:'],
  'Показатель карты:': ['Карта көрсеткіші:', 'Map indicator:'],
  'Год карты:': ['Картадағы жыл:', 'Map year:'],
  'Показатель:': ['Көрсеткіш:', 'Indicator:'],
  'Открыть детальный анализ графика': ['Графикті егжей-тегжейлі талдау', 'Open detailed chart analysis'],
  'Добавить свой график': ['Өз графигіңізді қосу', 'Add your own chart'],
  'Настройка своего графика': ['Өз графигіңізді баптау', 'Configure your chart'],
  'Выберите показатель:': ['Көрсеткішті таңдаңыз:', 'Select an indicator:'],
  'Выберите год:': ['Жылды таңдаңыз:', 'Select a year:'],
  'Тип визуализации:': ['Визуализация түрі:', 'Visualization type:'],
  'Столбчатая диаграмма (Bar)': ['Бағандық диаграмма (Bar)', 'Bar chart'],
  'Линейный график (Line)': ['Сызықтық график (Line)', 'Line chart'],
  'Круговая диаграмма (Pie)': ['Дөңгелек диаграмма (Pie)', 'Pie chart'],
  'Отмена': ['Болдырмау', 'Cancel'],
  'Создать график': ['График құру', 'Create chart'],
  'Нажмите, чтобы включить карту': ['Картаны қосу үшін басыңыз', 'Click to enable the map'],
  'Показать таблицу': ['Кестені көрсету', 'Show table'],
  'Скрыть таблицу': ['Кестені жасыру', 'Hide table'],
  'Поиск по регионам...': ['Өңірлер бойынша іздеу...', 'Search regions...'],
  'Записей в базе:': ['Дерекқордағы жазбалар:', 'Records in database:'],
  'Показатель': ['Көрсеткіш', 'Indicator'],
  'Год': ['Жыл', 'Year'],
  'Область': ['Облыс', 'Region'],
  'Значение': ['Мән', 'Value'],
  'Анализ сектора «Домохозяйство»': ['«Үй шаруашылығы» секторын талдау', 'Household sector analysis'],
  'Многофакторная оценка ключевых параметров домохозяйств по шкале от 1 до 10 с помощью радарных диаграмм.': ['Үй шаруашылықтарының негізгі параметрлерін радарлық диаграммалар арқылы 1-ден 10-ға дейінгі шкала бойынша көп факторлы бағалау.', 'Multifactor assessment of key household indicators on a scale of 1 to 10 using radar charts.'],
  '1. Первый вопрос. Итоговые оценки': ['1. Бірінші сұрақ. Қорытынды бағалар', '1. First question. Final scores'],
  '2. Второй вопрос. Итоговые оценки': ['2. Екінші сұрақ. Қорытынды бағалар', '2. Second question. Final scores'],
  '3. Третий вопрос. Итоговые оценки': ['3. Үшінші сұрақ. Қорытынды бағалар', '3. Third question. Final scores'],
  '4. Четвертый вопрос. Итоговые оценки': ['4. Төртінші сұрақ. Қорытынды бағалар', '4. Fourth question. Final scores'],
  '5. Пятый вопрос. Итоговые оценки': ['5. Бесінші сұрақ. Қорытынды бағалар', '5. Fifth question. Final scores'],
  'Назад к дашборду': ['Бақылау тақтасына оралу', 'Back to dashboard'],
  'Название показателя': ['Көрсеткіш атауы', 'Indicator name'],
  '🤖 ИИ Аналитика': ['🤖 ЖИ талдауы', '🤖 AI analytics'],
  '⏳ Загрузка анализа...': ['⏳ Талдау жүктелуде...', '⏳ Loading analysis...'],
  'Привет! Я готов проанализировать демографию 📊': ['Сәлем! Демографиялық деректерді талдауға дайынмын 📊', 'Hi! I am ready to analyze demographics 📊'],
  'Открыть AI-ассистента': ['ЖИ көмекшісін ашу', 'Open AI assistant'],
  'Аналитический AI': ['Аналитикалық ЖИ', 'Analytics AI'],
  'Online': ['Желіде', 'Online'],
  'Здравствуйте! Я ваш ИИ-помощник по анализу данных Казахстана. Задайте мне вопрос по графикам или показателям.': ['Сәлеметсіз бе! Мен Қазақстан деректерін талдайтын ЖИ көмекшісімін. Графиктер немесе көрсеткіштер туралы сұраңыз.', 'Hello! I am your AI assistant for analyzing Kazakhstan data. Ask me about charts or indicators.'],
  'Спросите о данных...': ['Деректер туралы сұраңыз...', 'Ask about the data...'],
  'Отправить': ['Жіберу', 'Send'],
  'Распределение по регионам': ['Өңірлер бойынша үлестірім', 'Distribution by region'],
  'Динамика показателей': ['Көрсеткіштер динамикасы', 'Indicator trends'],
  'Доли по регионам': ['Өңірлер бойынша үлестер', 'Shares by region'],
  'Рейтинг регионов': ['Өңірлер рейтингі', 'Regional ranking'],
  'Сравнение всех показателей по годам': ['Барлық көрсеткіштерді жылдар бойынша салыстыру', 'Comparison of all indicators by year'],
  'Макс': ['Макс.', 'Max'],
  'Мин': ['Мин.', 'Min'],
  'Текущий': ['Ағымдағы', 'Current'],
  'Прошлый': ['Алдыңғы', 'Previous'],
  'Кол-во людей': ['Адам саны', 'Number of people'],
  'Таблица не найдена на странице': ['Бетте кесте табылмады', 'Table not found on page'],
  'Анализирую данные графиков и показатели...': ['Графиктер мен көрсеткіштер деректерін талдап жатырмын...', 'Analyzing chart data and indicators...'],
  'Выберите тип графика ECharts': ['ECharts график түрін таңдаңыз', 'Choose an ECharts chart type'],
  'Столбиковая (Bar)': ['Бағандық (Bar)', 'Bar'],
  'Линейная (Line)': ['Сызықтық (Line)', 'Line'],
  'Точечная (Scatter)': ['Нүктелік (Scatter)', 'Scatter'],
  'Круговая (Pie)': ['Дөңгелек (Pie)', 'Pie'],
  'Закрыть': ['Жабу', 'Close'],
  'Тип:': ['Түрі:', 'Type:'],
  'Сменить язык': ['Тілді ауыстыру', 'Change language'],
  'Настройки': ['Баптаулар', 'Settings'],
  'API-ключ Gemini': ['Gemini API кілті', 'Gemini API key'],
  'Вставьте API-ключ': ['API кілтін енгізіңіз', 'Paste API key'],
  'Подключить': ['Қосу', 'Connect'],
  'Удалить': ['Жою', 'Remove'],
  'Ключ хранится зашифрованным на этом компьютере.': ['Кілт осы компьютерде шифрланған түрде сақталады.', 'The key is stored encrypted on this computer.'],
  'Ключ подключён. Его действительность проверится при первом запросе.': ['Кілт қосылған. Оның жарамдылығы алғашқы сұрауда тексеріледі.', 'Key connected. It will be validated on the first request.'],
  'Ключ не подключён.': ['Кілт қосылмаған.', 'No key connected.'],
  'Ключ сохранён и подключён. Gemini проверит его при первом запросе.': ['Кілт сақталды және қосылды. Gemini оны алғашқы сұрауда тексереді.', 'Key saved and connected. Gemini will validate it on the first request.'],
  'Сохранённый ключ удалён.': ['Сақталған кілт жойылды.', 'Saved key removed.'],
  'Вставьте API-ключ Gemini.': ['Gemini API кілтін енгізіңіз.', 'Paste a Gemini API key.']
};

const textNodes = new WeakMap();
const attributes = new WeakMap();

function getCurrentLanguage() {
  const savedLanguage = localStorage.getItem(languageStorageKey);
  return languages.includes(savedLanguage) ? savedLanguage : 'ru';
}

function translateValue(value, language = getCurrentLanguage()) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const matchingEntry = Object.entries(translations).find(([original, translated]) =>
    original === normalized || translated.includes(normalized)
  );
  if (matchingEntry) {
    const [original, translated] = matchingEntry;
    if (language === 'ru') return original;
    return translated[language === 'kk' ? 0 : 1];
  }

  const count = normalized.match(/^(?:Записей в базе:|Дерекқордағы жазбалар:|Records in database:)\s*([\d\s.,]+)$/);
  if (count) {
    const labels = {
      ru: 'Записей в базе:',
      kk: 'Дерекқордағы жазбалар:',
      en: 'Records in database:'
    };
    return `${labels[language]} ${count[1]}`;
  }

  const year = normalized.match(/^(\d{4})(?: год| жыл)?$/);
  if (year) {
    if (language === 'ru') return `${year[1]} год`;
    return language === 'kk' ? `${year[1]} жыл` : year[1];
  }

  return value;
}

function translateElement(root, language) {
  const nodes = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    const original = textNodes.has(node) ? textNodes.get(node) : node.nodeValue;
    if (!textNodes.has(node)) textNodes.set(node, original);
    const translated = translateValue(original, language);
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }

  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
  for (const element of elements) {
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      if (!element.hasAttribute(attribute)) continue;
      let values = attributes.get(element);
      if (!values) {
        values = {};
        attributes.set(element, values);
      }
      if (!(attribute in values)) values[attribute] = element.getAttribute(attribute);
      const translated = translateValue(values[attribute], language);
      if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
    }
  }
}

function updateChartLanguage(language) {
  if (!window.echarts) return;
  const translate = value => typeof value === 'string' ? translateValue(value, language) : value;

  document.querySelectorAll('.chart-box-h330, .chart-container, .summary-chart-inner, .radar-box, #realDetailedChart')
    .forEach(element => {
      const chart = window.echarts.getInstanceByDom(element);
      if (!chart) return;
      const option = chart.getOption();
      for (const title of option.title || []) title.text = translate(title.text);
      for (const legend of option.legend || []) {
        if (Array.isArray(legend.data)) legend.data = legend.data.map(item => typeof item === 'string' ? translate(item) : item);
      }
      for (const axis of [...(option.xAxis || []), ...(option.yAxis || [])]) {
        axis.name = translate(axis.name);
        if (Array.isArray(axis.data)) axis.data = axis.data.map(translate);
      }
      for (const series of option.series || []) {
        series.name = translate(series.name);
        if (Array.isArray(series.data)) {
          series.data = series.data.map(item => item && typeof item === 'object' && item.name
            ? { ...item, name: translate(item.name) }
            : item);
        }
      }
      chart.setOption(option);
    });
}

function updateLanguageButton(language) {
  const button = document.getElementById('langToggleBtn');
  if (!button) return;
  button.textContent = language.toUpperCase();
  button.title = translateValue('Сменить язык', language);
  button.setAttribute('aria-label', button.title);
}

function applyLanguage(language) {
  localStorage.setItem(languageStorageKey, language);
  document.documentElement.lang = language === 'kk' ? 'kk' : language;
  translateElement(document.body, language);
  updateLanguageButton(language);
  updateChartLanguage(language);
  window.dispatchEvent(new CustomEvent('app-language-changed', { detail: { language } }));
}

function toggleLanguage() {
  const currentLanguage = getCurrentLanguage();
  const nextLanguage = languages[(languages.indexOf(currentLanguage) + 1) % languages.length];
  applyLanguage(nextLanguage);
}

window.translateAppText = translateValue;
window.getAppLanguage = getCurrentLanguage;
window.toggleLanguage = toggleLanguage;

document.addEventListener('DOMContentLoaded', () => {
  applyLanguage(getCurrentLanguage());
  const button = document.getElementById('langToggleBtn');
  if (button) button.addEventListener('click', toggleLanguage);

  const observer = new MutationObserver(records => {
    const language = getCurrentLanguage();
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            translateElement(node, language);
          }
        });
      } else if (record.type === 'characterData') {
        const node = record.target;
        if (!textNodes.has(node)) textNodes.set(node, node.nodeValue);
        const original = textNodes.get(node);
        const translated = translateValue(original, language);
        if (node.nodeValue !== translated) node.nodeValue = translated;
      } else if (record.type === 'attributes') {
        const element = record.target;
        const attribute = record.attributeName;
        let values = attributes.get(element);
        if (!values) {
          values = {};
          attributes.set(element, values);
        }
        if (!(attribute in values)) values[attribute] = element.getAttribute(attribute);
        const translated = translateValue(values[attribute], language);
        if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label']
  });
});
