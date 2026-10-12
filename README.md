# Информация для хакатона

Сайт хакатона: https://datathon.stat.gov.kz/#/

## Документация по датасетам

На текущий момент рассмотрены только синтетические.

[Документация](docs/README.md).


## Зависимости

На хосте требуются установленные [Python](https://www.python.org/) и [NodeJS](https://nodejs.org/en/).

#### Настройка среды для запуска приложения

Перейдите в каталог приложения:

```shell
cd DataHackathon
```

#### Установка backend-зависимостей Python

Создайте виртуальное окружение в корне `DataHackathon` (именно здесь Electron ищет `.venv`):

```shell
python -m venv .venv
```

Активируйте его и установите зависимости:

Windows PowerShell:
```shell
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

macOS:
```shell
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

#### Установка зависимостей `NodeJS`

```shell
cd frontend
npm ci
```

#### Подготовка локальной базы данных

Папка `data/raw/`, наборы `data/sinte/` и файл `database.sqlite` не распространяются через Git и не включаются в установщик. Чтобы создать базу из исходных CSV, сначала скопируйте файлы в `DataHackathon/data/raw/`, затем из каталога `DataHackathon` выполните:

```shell
python clean_to_db.py
```

Перед импортом с дубликатами задайте политику агрегации через локальный `aggregation.json` и аргумент `--aggregation-map aggregation.json`; детали и проверки качества описаны в [инструкции приложения](DataHackathon/README.md).

#### Запуск из исходников

```shell
cd frontend
npm start
```

#### Сборка установщиков

Готовые установщики собираются на ОС назначения: Windows-сборку — на Windows, macOS-сборку — на Mac. Windows backend нельзя собрать для Windows с Mac, потому что PyInstaller создаёт backend под текущую ОС. Для Windows x64 запустите `npm run build:win` на Windows-компьютере с локально подготовленными данными; для Mac — `npm run build:mac` на Mac. Каждый установщик включает CSV только наборов D002, D004, D006 и D008. Исходные данные не коммитятся в Git; подготовьте их локально до сборки. Четыре набора занимают около 417 МБ до сжатия. Основной дашборд с показателями из `database.sqlite` в компактную сборку не включён.

Для локальной сборки сначала установите пакетировочные зависимости из `DataHackathon/`: `python -m pip install -r backend/requirements-packaging.txt`, затем в `DataHackathon/frontend/` запустите команду для ОС назначения. Скрипт использует `.venv`, если она создана в `DataHackathon/`, и проверяет, что все четыре папки содержат CSV-файлы.

Четыре датасета включены в установщик и доступны приложению сразу после установки; их не нужно копировать вручную. Компактная сборка не содержит базу основного дашборда. AI-функции пока требуют Anthropic API-ключ в настройках приложения; для полностью готового к жюри AI без персонального ключа отдельно нужен развернутый защищённый AI backend с ключом в секретах хостинга.