# Информация для хакатона

Сайт хакатона: https://datathon.stat.gov.kz/#/

# Зависимости

На хосте требуются установленные [Python](https://www.python.org/) и [NodeJS](https://nodejs.org/en/).

## Настройка среды для запуска приложения

Предварительно нужно перейти в [каталог](DataHackathon/README.md) приложения:

```shell
cd DataHackathon\frontend\
```

### Установка зависимостей `Python`

Рекомендуется создать виртуальную среду:

```shell
python -m venv .venv
```

Можно устанавливать зависимости:

```shell
pip install -r requirements.txt
```

`Visual Studio Code` сразу подхватит виртуальную среду и ее зависимости.

### Установка зависимостей `NodeJS`

Установить зависимости:

```shell
npm install
```

### Запуск приложения

```shell
npm start
```