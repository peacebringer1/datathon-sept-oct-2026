# Информация для хакатона

Сайт хакатона: https://datathon.stat.gov.kz/#/

## Документация по датасетам

На текущий момент рассмотрены только синтетические.

[Документация](docs/README.md).


## Зависимости

На хосте требуются установленные [Python](https://www.python.org/) и [NodeJS](https://nodejs.org/en/).

### Настройка среды для запуска приложения

Перейдите в каталог приложения:

```shell
cd DataHackathon
```

### Установка зависимостей `Python`

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

### Установка зависимостей `NodeJS`

```shell
cd frontend
npm ci
```

#### Подготовка локальной базы данных

Папка `data/raw/`, наборы `data/sinte/` и файл `database.sqlite` не распространяются через Git и не включаются в установщик. Чтобы создать базу из исходных CSV, сначала скопируйте файлы в `DataHackathon/data/raw/`, затем из каталога `DataHackathon` выполните:

```shell
python clean_to_db.py
```

### Запуск приложения

```shell
cd frontend
npm start
```

## Сборка приложения

Чтобы собрать установщик приложения для платформы `Windows`:

```shell
npm run build:win
```

Полученный результат находится в каталоге `dist/Аналитика Демографии Setup *.exe`, где `*` - версия приложения.

## Запуск приложения

Приложение находится в меню "Пуск", называемый как "Аналитика Демографии" и готов к работе.

## Использование

Интерфейс очень интуитивный, можно разобраться.
