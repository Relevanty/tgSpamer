# Node.js Telegram Sender (gramjs)

## Быстрый старт

```bash
git clone <repo>
cd relevantySpamer
npm install
cp .env.example .env
npm start
```

## Настройка `.env`

- `API_ID` / `API_HASH` — заполнять не нужно; если указаны оба корректно, скрипт использует их вместо встроенных.
- `AUTH_METHOD=qr` (по умолчанию) или `phone`.
- `SESSION_STRING` — можно оставить пустым; после авторизации сохранится автоматически.
- Прокси (если нужен): `SOCKS_PROXY=127.0.0.1:1080`, `SOCKS_TYPE=5`, `TELEGRAM_TRANSPORT=obfuscated`. Если прокси пустой — работает без него.
- Стикер: если не заданы `STICKER_SET_INDEX` / `STICKER_DOC_INDEX`, скрипт попросит отправить стикер в «Избранное» и возьмёт его. Можно задать руками (индексы с 0) или оставить пустым.
- Планировщик: `SCHEDULE_HOUR`, `SCHEDULE_MINUTE` — время (местное) для ежедневного автозапуска при использовании `npm run schedule`.
- Профили и файлы:
  - `PROFILE=acc1` — метка профиля (используется для путей storage при `STORAGE_MODE=per_profile`).
  - `STORAGE_MODE=shared|per_profile` — общий или раздельный стор.
  - `REPORT_FILE` — путь к отчёту (иначе общий или `storage/<profile>/report.csv` при per_profile).
  - `LIST_FILE` — имя файла в `lists/` (если не задан — интерактивный выбор).
  - `MESSAGE_FILES` — имена через запятую из `messages/` (если не задано — берётся из `MESSAGE_CONFIG.TEXT_FILE_NAMES`).

## Запуск рассылки

1) `npm start`
2) При первом запуске авторизация:
   - QR: скан из терминала (`Настройки -> Устройства -> Подключить устройство`).
   - Phone: код в приложении / SMS; команды: `/resend`, `/sms`, `/app`.
3) Выбор списка: скрипт покажет файлы в `lists/`, введите номер. Прогресс общий — если хотите независимый прогресс для разных списков, меняйте/чистите `storage/`.
4) Сообщения берутся из `messages/`, настроены в `src/config.js` (`MESSAGE_CONFIG.TEXT_FILE_NAMES`).
5) Стикер берётся из первого набора аккаунта (можно отключить `STICKER_CONFIG.ENABLED`).

## Архивация диалогов (без рассылки)

```bash
npm run archive        # .env
npm run archive:acc1   # .env.acc1
```

Критерии архивации (по умолчанию):
- приватный чат, не в архиве;
- нет входящих после вашего первого исходящего;
- исходящих ≥ 2, одно длинное (>=400 символов);
- последнее исходящее старше 24 часов;
- сам диалог не старше 168 часов (неделя) по умолчанию;
- максимум 30 диалогов за проход.
Настраивается через `ARCHIVE_*` переменные в `.env`.

## Планировщик (ежедневный запуск)

```bash
npm run schedule        # .env
npm run schedule:acc1   # .env.acc1
```
- Ждёт до указанного времени (по умолчанию 12:00), запускает рассылку, после завершения планирует следующий день.
- Если `SCHEDULE_START_IMMEDIATELY=true`, первый запуск идёт сразу, а дальше — по расписанию.
- Время задаётся `SCHEDULE_HOUR` / `SCHEDULE_MINUTE` в `.env`.

## Где хранится состояние

- `storage/processed-users.json` — кого уже отправили.
- `storage/progress-state.json` — указатель строки.
- `storage/daily-stats.json` — счётчики за день.
Чтобы начать заново: очистить `storage/` или удалить нужные файлы.

## Лимиты по умолчанию (см. `src/config.js`)

- Между сообщениями: 3000 мс.
- Между пользователями: 60000 мс.
- После каждых 20 попыток — пауза 30 мин.

## Запуск в Docker

1. Создайте рабочий `.env` рядом с [`docker-compose.yml`](docker-compose.yml) на основе [`example.env.acc1`](example.env.acc1).
2. Для первого интерактивного входа выполните:

```bash
docker compose run --rm telegram-sender
```

3. После сохранения `SESSION_STRING` в [`.env`](.env) можно запускать в фоне:

```bash
docker compose up -d telegram-sender
```

4. Для режима ежедневного расписания:

```bash
docker compose --profile scheduler up -d telegram-scheduler
```

### Что монтируется

- [`./lists`](lists/) → `/app/lists`
- [`./messages`](messages/) → `/app/messages`
- [`./storage`](storage/) → `/app/storage`
- [`./report.csv`](report.csv) → `/app/report.csv`
- [`.env`](.env) → `/app/.env`

### Полезные команды

```bash
docker compose build
docker compose up telegram-sender
docker compose logs -f telegram-sender
docker compose run --rm telegram-sender npm run archive
docker compose --profile scheduler up -d telegram-scheduler
```

### Замечания по деплою

- [`Dockerfile`](Dockerfile) использует базовый образ `node:20-bookworm-slim`.
- [`docker-compose.yml`](docker-compose.yml) включает `stdin_open: true` и `tty: true`, чтобы работали QR-логин и интерактивные prompts.
- Для полностью неинтерактивного деплоя заранее сохраните `SESSION_STRING` и укажите `LIST_FILE`/`MESSAGE_FILES` в [`.env`](.env).
- Если `report.csv` отсутствует, создайте пустой файл перед запуском: `touch report.csv`.
