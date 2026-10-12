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

Готовые установщики собираются на ОС назначения и публикуются как CI Artifacts в GitHub Actions: `installer-macOS` содержит DMG для Mac runner, а `installer-Windows x64` — `.exe` для Windows. Скачайте соответствующий файл из завершённого запуска workflow; для установки на другом Mac приложение может показать предупреждение Gatekeeper, поскольку проект не подписан Apple Developer ID. Установщики содержат приложение и встроенный backend, но не приватные исходные наборы и базу данных.

Для локальной сборки сначала установите пакетировочные зависимости: `python -m pip install -r backend/requirements-packaging.txt`, затем в `frontend/` запустите `npm run build:mac` на Mac или `npm run build:win` на Windows. Скрипт сборки автоматически использует `.venv`, если она создана в `DataHackathon/`.

После установки базы данных расположите её отдельно от приложения: `%APPDATA%\dataset-viewer\data\database.sqlite` на Windows или `~/Library/Application Support/dataset-viewer/data/database.sqlite` на macOS. Дополнительные CSV-датасеты для Claude положите в соседнюю папку `sinte/`. AI-функции дополнительно требуют личный Anthropic API-ключ, вводимый в настройках приложения.