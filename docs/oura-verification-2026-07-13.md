# Верификация Oura Sync Overhaul — критический разбор

**Дата:** 2026-07-13 · **Проверяемый объём:** всё, что спроектировано и выполнено по плану [`docs/superpowers/plans/2026-07-10-oura-sync-overhaul.md`](superpowers/plans/2026-07-10-oura-sync-overhaul.md) (Task 1–5, PR #75/#76/#78/#79/#80/#81, миграции 008/020/021/022).
**Метод:** локальный verification-loop (build/types/tests/security/diff) + живая проверка продакшна (деплой, схема БД, реальный end-to-end прогон синка на текущем коде) + прямой пробинг Oura API v2 сырыми HTTP-запросами с реальным токеном.

---

## 1. Результаты verification loop (локально, `main` @ `96c8fd2`)

| Фаза | Результат | Детали |
|---|---|---|
| Build | ✅ | `npm run build` — компиляция чистая, все 33 роута, `ƒ /api/cron/oura-sync` в таблице роутов |
| TypeCheck | ✅ | `npx tsc --noEmit` — exit 0, ошибок нет |
| Lint | ➖ N/A | В проекте нет lint-скрипта и eslint-конфига — состояние существовало до overhaul, не регрессия (кандидат в бэклог) |
| Tests | ✅ | `test:unit` 10/10 · `test:correlation` 15/15 · `test:med-knowledge` 27/27 — 0 падений, вывод чистый |
| Security | ✅ | Скан секретов/`console.log`/`debugger` по всем затронутым файлам — пусто |
| Diff | ✅ | 23 файла, +1525/−387 — весь диф в рамках плана, посторонних изменений нет, worktree чистый |

## 2. Живая проверка продакшна

| Проверка | Результат | Доказательство |
|---|---|---|
| Деплой = main HEAD | ✅ | `GET /api/version` → `96c8fd2` (совпадает) |
| Cron-роут fail-closed | ✅ | `/api/cron/oura-sync` без токена → 401, с неверным → 401 |
| Миграции 008/020/021/022 применены | ✅ | `information_schema`: все 5 таблиц + все 7 новых колонок на месте |
| **Разрыв данных закрыт** | ✅ | `external_health_daily_snapshots`: было 15 строк (max 2026-04-26) → стало 46+, max `2026-07-12`. Двухмесячный простой окончен |
| Sync-run аудит работает | ✅ | 2 записи в `external_health_sync_runs`, обе `success`, тип `daily` |
| Connection self-heal | ✅ | `status=connected`, `last_sync_at=2026-07-12` |
| Аналитика (008) пишется | ✅ | 123 `oura_raw_documents`, 31 `daily_health_features`, endpoint coverage заполняется |

### Живой end-to-end прогон текущего кода (все 5 задач сразу)

Запущен dev-сервер с прод-окружением, вызван `/api/cron/oura-sync` — реальный Oura API, реальная прод-база:

```
{"synced":1,"results":[{"userId":"f9b3…","status":"ok","snapshots":8}]}
```

Результат по фичам:

| Задача | Поле/фича | Статус | Факт |
|---|---|---|---|
| T2 cron-синк | весь пайплайн | ✅ **работает** | 8 снапшотов, run записан, coverage записан |
| T4 sleep detail | `sleep_avg_hrv`, `sleep_efficiency`, `deep/rem`, `respiratory_rate` | ✅ **работает** | 4 дня заполнены реальными данными (`sleep`: HTTP 200, 32 дока) |
| T4 RHR | `resting_heart_rate` из `sleepDetail.lowest_heart_rate` | ✅ **работает** | 4 дня заполнены |
| T5 tags | `oura_tags` | ✅ код работает, данных нет | `enhanced_tag`: HTTP 200, 0 доков — пользователь не ставит теги в приложении Oura. Не дефект |
| **T3 heart** | `vo2_max`, `resilience_level`, `cardiovascular_age` | 🔴 **НЕ работает** | см. §3 — главная находка |

## 3. 🔴 Главная находка: heart-эндпоинты падают с 401, и код это молча глотает

Прямой пробинг Oura API с реальным (рабочим!) токеном:

```
vO2_max:                  HTTP 401  → {"detail":"Token is not authorized access heart_health scope."}
daily_resilience:         HTTP 401  → {"detail":"Token is not authorized access stress scope."}
daily_cardiovascular_age: HTTP 401  (тот же heart_health scope)
enhanced_tag:             HTTP 200, docs=0   (реально пусто — ок)
sleep:                    HTTP 200, docs=32  (токен валиден — ок)
```

**Причина.** Эндпоинты `vO2_max`/`daily_cardiovascular_age` требуют OAuth-scope **`heart_health`**, а `daily_resilience` — scope **`stress`**. Ни одного из них нет ни в `DEFAULT_SCOPES` (`src/lib/oura/config.ts:7`), ни в вайтлисте `SUPPORTED_OURA_SCOPES` (`src/lib/oura/oauth.ts:25`), ни в выданном токене (проверено: у соединения только `email personal daily heartrate tag workout session spo2`).

**Почему это прошло все ревью.** Плановая цепочка опиралась на каталог эндпоинтов в `docs/oura-integration-stack.md` §2, где требования к scope для новых эндпоинтов не были указаны; ни одна из 8 ревью-проверок (5 task-ревью, whole-branch review, re-review фикса) не могла это поймать статически — нужен был живой вызов с реальным токеном. **Это в точности повторение урока OpenRouter-инцидента из `docs/agent-handoff-current-main.md` §0: «проверяй живым вызовом, а не существованием в каталоге».**

**Усугубляющий фактор — та же слепая зона, что породила исходный баг.** `fetchOptionalOuraCollection` (`ouraSyncEngine.ts:245`) молча превращает 401/403/404 в `{data: []}`: ни лога, ни различий в endpoint coverage. В таблице покрытия 401-ый эндпоинт записан как `success / 0 documents` — неотличимо от «данных нет». Оригинальный баг `heart_health` (несуществующий эндпоинт → тихий 404 → NULL-колонки месяцами) выжил именно из-за этого паттерна, и новый код воспроизвёл его один в один, только с 401 вместо 404.

## 4. Прочие наблюдения (не дефекты)

- `correlation_insight_cards` = 0 — норма: карточки генерируются on-demand при заходе на `/app/insights` при активном consent; данных для корреляций уже достаточно.
- Sentry-монитор `cron-oura-sync` создан кодом при первом вызове; алерт-правило в Sentry UI стоит проверить глазами один раз.
- Проверка тег-сопоставления (`includes('caffeine')` по `tag_type_code`) по-прежнему невозможна — у пользователя 0 тегов. Отложенный пункт остаётся отложенным.
- `daily_lifestyle_snapshots` не персистит новые поля (вайтлист колонок в `correlation/persistence.ts`) — известный отложенный пункт, сегодня безвреден.
- Lint отсутствует в проекте как класс — кандидат в бэклог, вне рамок этого overhaul.

## 5. Заключение

**Править нужно.** Ядро overhaul работает и подтверждено живым прогоном: простой с 2026-04-26 устранён, cron-синк, sleep detail, RHR, аудит и аналитика — рабочие. Но **Task 3 (heart-поля) фактически не выполняет своё назначение в продакшне**: колонки `vo2_max`/`resilience_level`/`cardiovascular_age` останутся NULL — та самая проблема G2 из исходного аудита воспроизвелась в новой форме (401 вместо 404). Без исправления scope и re-consent эта часть плана — мёртвый код.

Отдельно: сохраняется системная слепая зона (тихое глотание 401), из-за которой такие поломки не видны ни в логах, ни в coverage-таблице. Её нужно закрыть, иначе следующая подобная ошибка снова проживёт месяцы.

## 6. План исправлений

### F-1 (обязательно): scope-фикс + re-consent — вернуть к жизни heart-поля
1. `src/lib/oura/config.ts:7` — добавить в `DEFAULT_SCOPES`: `heart_health stress` (итог: `email personal daily heartrate tag workout session spo2 heart_health stress`).
2. `src/lib/oura/oauth.ts:25` — добавить `'heart_health'`, `'stress'` в `SUPPORTED_OURA_SCOPES`.
3. Если в Vercel задан env `OURA_SCOPES` — обновить его тем же списком (иначе перекроет дефолт).
4. **Ручное действие владельца:** переподключить Oura в `/app/settings` (disconnect → connect) — scope выдаётся только в момент consent, существующий токен не расширить.
5. Верификация: повторить пробинг (скрипт сохранён: `.superpowers/sdd/probe-oura-endpoints.mjs`) — ожидаем 200 на всех трёх; затем один прогон синка и `select count(vo2_max) ... where local_date >= current_date - 7` > 0 (с оговоркой: у аккаунта должны реально быть данные VO2/resilience в приложении Oura).

### F-2 (обязательно): убрать слепую зону тихих 401
1. В `fetchOptionalOuraCollection` перестать считать **401** «нормальным отсутствием фичи»: 401 — это всегда проблема токена/scope. Минимальный вариант: пробрасывать 401 в端 coverage как `status:'failed'` с `error:{httpStatus:401, detail:...}` и `Sentry.captureException` (один раз за прогон, не за эндпоинт), не роняя весь синк (403/404 можно оставить как «фича недоступна», но тоже писать в coverage реальный статус, а не `success/0`).
2. Критерий приёмки: после фикса запись в `oura_sync_endpoint_coverage` для эндпоинта, вернувшего 401, отличима от «пустых данных» одним SQL-запросом.

### F-3 (ручное, владелец — уже числится в бэклоге): cron-job.org job
`GET https://medremind-app-two.vercel.app/api/cron/oura-sync`, header `Authorization: Bearer <прод CRON_SECRET>`, каждые 6 ч, тот же аккаунт, что job #7402449. Плюс job для P-5 (`/api/cron/food-model-check`, daily) — тоже до сих пор не создан.

### F-4 (мелочь, вместе с F-1): поправить доку
`docs/oura-integration-stack.md` §2/§4.2 — зафиксировать реальные требования scope (`heart_health` для vO2/cardio-age, `stress` для resilience); сейчас каталог утверждает, что существующих scope достаточно.

### Отложено без изменений (триггеры в `docs/project-backlog.md` §1.1)
- Персист новых полей в `daily_lifestyle_snapshots` — при превращении таблицы в авторитетный источник.
- Верификация тег-сопоставления — при появлении реальных тегов.
- Lint в проекте — отдельным решением.

**Оценка объёма F-1+F-2+F-4: один небольшой PR (~1–2 ч работы) + одно переподключение Oura владельцем.**

---

*Артефакты верификации: скрипт пробинга `.superpowers/sdd/probe-oura-endpoints.mjs` (локальный, не в git); SQL-выборки через Supabase Management API; ledger сессии `.superpowers/sdd/progress.md`.*
