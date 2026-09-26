# ТЗ: SafeZone — голосовой ассистент по безопасности с картой

> **Как пользоваться этим документом в Claude Code.** Положите файл в корень репозитория как `SPEC.md`. Работайте по этапам из раздела 12: один этап — одна сессия. Начинайте запрос так: _«Прочитай SPEC.md и сделай этап M1. Критерии готовности в разделе 12»_. Места с пометкой **[проверить]** — это детали, которые нужно сверить с актуальной документацией перед реализацией.

---

## 1. Контекст

**Хакатон:** Build, Ship, Shape: Amazon Developer Hackathon 2026, https://amazonappdev2026.devpost.com

- **Дедлайн:** 23 октября 2026, 12:00 PDT (24 октября, 00:00 по Астане). Внутренний дедлайн: **22 октября**.
- **Трек:** Alexa+. Призы $25 000 / $15 000 / $4 000 + кредиты AWS.
- **Мини-конкурсы:** AWS (использование Bedrock, AgentCore и т.п.) и Open Source. Проект может выиграть трек и один мини-конкурс, поэтому строим под оба.
- **Что принимается в треке Alexa+:** рабочий Agent Skill **или** self-hosted MCP-сервер по спецификации MCP 2025-11-25 и новее через Streamable HTTP. Также разрешено веб-приложение, которое **симулирует** Alexa+.
- **Критерии жюри (поровну):** техническая реализация, дизайн, потенциальная польза, оригинальность. Простые боты «вопрос-ответ» и обёртки над API оцениваются ниже.
- **Сдаём:** репозиторий на GitHub с инструкцией запуска, видео до 3 минут, описание и отзыв об инструментах на английском. Friction log необязателен, но даёт до +10%.

**Почему такая архитектура.** Жюри не обязательно имеет доступ к Alexa+, а у нас его может не быть из Казахстана. Поэтому ядро проекта — MCP-сервер, который одинаково работает и с настоящим Alexa+, и с нашим веб-симулятором. Симулятор даёт то, чего нет у большинства конкурентов: **карту**.

---

## 2. Что мы строим

**Одной фразой:** пользователь голосом спрашивает об опасностях рядом с местом, ассистент собирает данные из нескольких открытых источников, делает вывод о риске, отвечает голосом и показывает всё на карте.

**Язык продукта:** английский (интерфейс, голос, ответы). Судьи из США. Демо-локации тоже в США.

**Пример диалога (основа видео):**

1. _User:_ «Is it safe around my home in Sacramento?»
   _Assistant:_ «There are 14 active fire hotspots within 40 km, the closest is 18 km north-east. The wind is blowing from that direction, and air quality is unhealthy for sensitive groups. Keep windows closed and prepare a go-bag.»
   _Карта:_ перелёт к Сакраменто, маркер дома, очаги пожаров, круг радиуса, стрелка ветра.
2. _User:_ «How is the wind moving?» → стрелки ветра, короткий ответ.
3. _User:_ «Where's the nearest hospital away from the fire?» → маркеры больниц, одна подсвечена, маршрут до неё.

**Что НЕ делаем (вне рамок хакатона):** регистрацию пользователей, push-уведомления, мобильное приложение, собственный анализ спутниковых снимков, данные по Казахстану.

---

## 3. Архитектура

```
┌──────────────────────────────┐         ┌───────────────────┐
│ Web simulator (React+MapLibre)│         │ Alexa+ (optional) │
│  микрофон · чат · карта       │         │  сам себе агент   │
└──────────────┬───────────────┘         └─────────┬─────────┘
               │ HTTPS /api/chat                    │ MCP (Streamable HTTP)
               ▼                                    │
┌──────────────────────────────┐                    │
│ Agent service                │                    │
│  Bedrock Converse + tool loop│── MCP client ──────┤
│  Polly (TTS)                 │                    │
└──────────────────────────────┘                    ▼
                                   ┌──────────────────────────────┐
                                   │ MCP server "safezone"        │
                                   │  tools: geocode, fires,      │
                                   │  alerts, quakes, air, wind,  │
                                   │  safe places, route, risk    │
                                   └──────────────┬───────────────┘
                                                  ▼
                   NASA FIRMS · NWS · USGS · Open-Meteo · Amazon Location · OSM
```

**Компоненты и зачем они нужны**

| Компонент               | Роль                                                                                      | Почему отдельно                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `server` — MCP-сервер   | Все инструменты и работа с данными                                                        | Это и есть сдача в трек Alexa+. Один сервер для Alexa+ и симулятора               |
| `agent` — сервис агента | Изображает «мозг» Alexa+ для симулятора: LLM на Bedrock решает, какие инструменты вызвать | В настоящем Alexa+ эту роль играет сама Alexa. Нам он нужен только для симулятора |
| `web` — симулятор       | Голос, чат, карта                                                                         | Главное визуальное отличие проекта                                                |
| Alexa+ add-on           | Регистрирует наш сервер в Alexa+                                                          | Опционально, если будет доступ                                                    |

**Главный принцип:** инструмент возвращает и текст для голоса, и данные для карты (раздел 5.2). Сервер ничего не знает о том, кто его вызывает.

---

## 4. Структура репозитория

Монорепозиторий на TypeScript, npm workspaces.

```
safezone/
├── SPEC.md                 # этот документ
├── CLAUDE.md               # короткие правила для Claude Code (см. раздел 17)
├── README.md               # на английском, для судей
├── LICENSE                 # MIT
├── .env.example
├── package.json            # workspaces: server, agent, web, shared
├── shared/                 # общие типы: SafetyToolResult, слои карты
│   └── src/types.ts
├── server/                 # MCP-сервер
│   ├── src/
│   │   ├── index.ts        # HTTP + Streamable HTTP transport
│   │   ├── tools/          # по файлу на инструмент
│   │   ├── sources/        # клиенты внешних API
│   │   ├── risk/           # логика assess_risk
│   │   └── demo/           # чтение фикстур в DEMO_MODE
│   ├── fixtures/           # записанные ответы API для демо
│   └── test/
├── agent/                  # сервис агента (Bedrock + Polly)
│   └── src/
├── web/                    # Vite + React + MapLibre
│   └── src/
└── docs/
    ├── ARCHITECTURE.md
    ├── FRICTION-LOG.md
    └── DEVPOST.md          # черновик описания для сдачи
```

**Инструменты разработки:** Node.js 20+, TypeScript strict, `zod` для схем, `@turf/turf` для геометрии, `vitest` для тестов, ESLint + Prettier.

---

## 5. MCP-сервер

### 5.1 Транспорт и базовые требования

- Библиотека: официальный TypeScript SDK `@modelcontextprotocol/sdk`, версия с поддержкой спецификации **2025-11-25**. **[проверить]** в changelog SDK, какая версия её поддерживает.
- Транспорт: **Streamable HTTP**, endpoint `POST /mcp`.
- **Режим без состояния (stateless):** на каждый запрос создаём новый транспорт без генератора сессий. _Зачем:_ Alexa+ сама хранит историю разговора и не передаёт идентификатор сессии, а stateless-сервер легко масштабируется и работает на Lambda.
- Включить JSON-ответы вместо SSE-потока, если SDK это позволяет (`enableJsonResponse`). _Зачем:_ проще разворачивать на Lambda.
- `GET /health` → `200 {"ok":true}` для проверки деплоя.
- CORS разрешён для домена симулятора.
- Все инструменты помечены как только для чтения (`readOnlyHint: true`) в аннотациях.

### 5.2 Общий формат ответа инструментов

Каждый инструмент возвращает:

- `content[0]` — `{ type: "text", text: summary }`, короткий текст для озвучки;
- `structuredContent` — объект `SafetyToolResult` (ниже), а в описании инструмента — `outputSchema` на его основе.

```ts
// shared/src/types.ts
export type Severity = "none" | "low" | "moderate" | "high" | "extreme";

export interface MapLayer {
  id: string; // уникален в рамках ответа, например "fires"
  kind: "home" | "fires" | "alerts" | "quakes" | "air" | "wind" | "places" | "route" | "radius";
  geojson: GeoJSON.FeatureCollection;
}

export interface MapView {
  center?: [number, number]; // [lon, lat]
  zoom?: number;
  bbox?: [number, number, number, number]; // [west, south, east, north]
}

export interface SafetyToolResult {
  summary: string; // 1–2 предложения, English, для голоса
  severity?: Severity;
  map?: { view?: MapView; layers: MapLayer[] };
  data: Record<string, unknown>; // структурированные данные инструмента
  sources: { name: string; url: string; fetchedAt: string }[];
  demo?: boolean; // true, если ответ из фикстур
}
```

**Почему так:** Alexa+ прочитает `summary`. Наш симулятор возьмёт `map` и нарисует слои. Поле `sources` показывает судьям, откуда данные, это плюс к доверию и к оценке «пользы».

**Правила для `summary`:** максимум 2 предложения, без координат и технических терминов, расстояния в километрах **и** милях (судьи из США), сначала главное.

### 5.3 Инструменты

Для каждого: назначение, вход, источник, обработка, выход. Входные схемы описываются через `zod`.

---

#### `geocode`

- **Назначение:** превратить «Sacramento» или «my home at 123 Main St» в координаты.
- **Вход:** `{ query: string }`
- **Источник:** Amazon Location Service, Places API (`@aws-sdk/client-geo-places`, команда Geocode) **[проверить]** точные названия команд. **Запасной вариант без ключа:** Open-Meteo Geocoding `https://geocoding-api.open-meteo.com/v1/search?name={query}&count=1`.
- **Выход:** `data: { name, lat, lon, country }`, слой `home` с точкой, `view.center`, `zoom: 10`.
- **Зачем Amazon Location:** это сервис AWS, он усиливает заявку на мини-конкурс AWS. Запасной вариант нужен для демо-режима и на случай проблем с ключами.

#### `get_fire_hotspots`

- **Назначение:** активные очаги пожаров вокруг точки.
- **Вход:** `{ lat: number, lon: number, radius_km?: number = 50, days?: number = 1 }`
- **Источник:** NASA FIRMS Area API:
  `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/{west},{south},{east},{north}/{days}`
  Ключ `MAP_KEY` бесплатный, получить на сайте FIRMS. Допустимый диапазон `days` **[проверить]** (обычно от 1 до 10).
- **Обработка:**
  1. Посчитать bbox вокруг точки по радиусу (turf).
  2. Распарсить CSV (поля `latitude, longitude, acq_date, acq_time, confidence, frp`).
  3. Отфильтровать по реальному расстоянию (haversine), отбросить `confidence = l` (низкая уверенность).
  4. Для каждого очага посчитать расстояние и направление (bearing) от точки.
  5. Сгруппировать близкие очаги (кластеризация в радиусе 2 км), чтобы не озвучивать «214 точек».
- **Выход:** `data: { count, clusters, closest: { distance_km, bearing_deg, direction: "NE" } }`, слои `fires` (точки с `frp` для размера маркера) и `radius` (круг), `view.bbox` по очагам.
- **Пример summary:** «14 active fire hotspots within 50 km. The closest is 18 km (11 mi) north-east.»

#### `get_weather_alerts`

- **Назначение:** официальные предупреждения: штормы, наводнения, жара, пожароопасность, «Red Flag Warning».
- **Вход:** `{ lat: number, lon: number }`
- **Источник:** National Weather Service `https://api.weather.gov/alerts/active?point={lat},{lon}`. Ключ не нужен, **обязателен заголовок `User-Agent`** с контактом (например `SafeZone (email@example.com)`). Работает только для США.
- **Обработка:** взять `event, severity, headline, instruction, expires`. У некоторых предупреждений `geometry = null` (они привязаны к зонам): тогда слой не рисуем, но в данных оставляем.
- **Выход:** `data: { alerts: [...] }`, слой `alerts` (полигоны), `severity` = максимальная из предупреждений (Extreme → extreme, Severe → high, Moderate → moderate, Minor → low).
- **Вне США:** вернуть пустой список и `summary` вида «Official alerts are available for US locations only.»

#### `get_earthquakes`

- **Назначение:** недавние землетрясения рядом.
- **Вход:** `{ lat, lon, radius_km?: number = 200, days?: number = 3, min_magnitude?: number = 2.5 }`
- **Источник:** USGS `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude={lat}&longitude={lon}&maxradiuskm={r}&starttime={ISO}&minmagnitude={m}`. Ключ не нужен, ответ уже в GeoJSON.
- **Выход:** `data: { count, strongest: { mag, place, time, distance_km } }`, слой `quakes`.

#### `get_air_quality`

- **Назначение:** качество воздуха и дым.
- **Вход:** `{ lat, lon }`
- **Источник:** Open-Meteo Air Quality `https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&current=us_aqi,pm2_5,pm10`. Ключ не нужен.
- **Обработка:** перевести `us_aqi` в категорию EPA: 0–50 Good, 51–100 Moderate, 101–150 Unhealthy for Sensitive Groups, 151–200 Unhealthy, 201–300 Very Unhealthy, 301+ Hazardous.
- **Выход:** `data: { us_aqi, category, pm2_5 }`, слой `air` (точка с цветом категории), `severity` по категории.

#### `get_wind`

- **Назначение:** ветер, нужен для оценки, куда пойдёт дым и огонь.
- **Вход:** `{ lat, lon }`
- **Источник:** Open-Meteo Forecast `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh`.
- **Важно:** метеорологическое направление ветра — это **откуда** он дует. 270° = западный ветер, дует **на восток**. В `data` отдавать оба значения: `from_deg` и `to_deg = (from_deg + 180) % 360`.
- **Выход:** `data: { speed_kmh, gusts_kmh, from_deg, to_deg, from_direction }`, слой `wind` (линия-стрелка от точки по направлению `to_deg` длиной пропорционально скорости).

#### `find_safe_places`

- **Назначение:** ближайшие больницы, пожарные части, пункты эвакуации.
- **Вход:** `{ lat, lon, type?: "hospital" | "fire_station" | "shelter" | "any" = "any", radius_km?: number = 25, avoid?: { lat: number, lon: number, radius_km: number }[] }`
- **Источник:** Overpass API (OpenStreetMap), запрос `amenity=hospital`, `amenity=fire_station`, `emergency=assembly_point`, `social_facility=shelter` в радиусе. Альтернатива: Amazon Location SearchNearby **[проверить]**.
- **Параметр `avoid`:** зоны, которых нужно избегать (например, кластеры пожаров). Места внутри этих зон отбрасываются, а при сортировке понижаются места, которые лежат в сторону опасности. _Зачем:_ это отвечает на вопрос «nearest hospital away from the fire».
- **Выход:** `data: { places: [{ name, type, lat, lon, distance_km }] }` (до 5 штук), слой `places`.

#### `get_route` (приоритет P2, делаем если успеваем)

- **Назначение:** маршрут от точки до выбранного места.
- **Вход:** `{ from: {lat, lon}, to: {lat, lon} }`
- **Источник:** Amazon Location Routes (`@aws-sdk/client-geo-routes`) **[проверить]**.
- **Выход:** `data: { distance_km, duration_min }`, слой `route` (линия).

#### `assess_risk` — главный инструмент

- **Назначение:** сводная оценка опасности для точки с рекомендациями. Подробная логика в разделе 6.
- **Вход:** `{ lat, lon, radius_km?: number = 50 }` **или** `{ place: string }` (тогда внутри вызывается `geocode`).
- **Обработка:** параллельно вызвать fires, alerts, quakes, air, wind; применить правила; собрать все слои в один ответ.
- **Выход:** `severity`, `data: { factors: [...], recommendations: [...] }`, все слои сразу, `view.bbox` охватывает всё важное.
- **Пример summary:** «Risk level is high. A fire cluster 18 km north-east is upwind of you and air quality is unhealthy — keep windows closed and prepare to leave.»

### 5.4 Описания инструментов

По описанию инструмента Alexa+ и наш агент решают, что вызывать. Поэтому описания пишем тщательно:

- на английском, 1–3 предложения;
- **когда** использовать инструмент, а не только что он делает;
- для `assess_risk` явно: _«Use this first when the user asks whether a place is safe or what dangers are nearby.»_
- для узких инструментов: _«Use for follow-up questions specifically about …»_

### 5.5 Демо-режим (`DEMO_MODE=true`)

- Инструменты не ходят во внешние API, а читают записанные ответы из `server/fixtures/`.
- Фикстуры: реальные ответы API, сохранённые скриптом `npm run record-fixtures` для 2–3 сценариев (Сакраменто с пожарами, Лос-Анджелес, спокойная локация).
- Если координаты запроса не совпадают со сценарием, берём ближайший сценарий и ставим `demo: true`.
- **Зачем:** судьи должны запустить проект без наших ключей. Также это страховка на день записи видео: реальных пожаров в нужном месте может не оказаться.

### 5.6 Кэш, лимиты, ошибки

- Кэш в памяти на 5 минут по ключу «инструмент + округлённые до 0.01° координаты + параметры».
- Таймаут внешних запросов 8 секунд.
- Если один источник недоступен, инструмент не падает: возвращает то, что есть, и пишет в `summary` «(fire data temporarily unavailable)». `assess_risk` работает с частичными данными.
- Ошибки ввода (координаты вне диапазона и т.п.) возвращаются как MCP-результат с `isError: true` и понятным текстом.
- Ключи никогда не попадают в ответы и логи.

---

## 6. Логика `assess_risk`

**Идея:** это не среднее арифметическое, а набор понятных правил. Каждое правило даёт фактор с уровнем и рекомендацией. Итоговый уровень = максимальный из факторов. Правила вынести в отдельный модуль `server/src/risk/rules.ts` и покрыть тестами.

### 6.1 Правила

| Фактор                      | Условие                                                                     | Уровень  |
| --------------------------- | --------------------------------------------------------------------------- | -------- |
| Пожар очень близко          | ближайший очаг ≤ 10 км                                                      | high     |
| Пожар с наветренной стороны | очаг ≤ 30 км **и** он с наветренной стороны (см. 6.2) **и** ветер ≥ 15 км/ч | high     |
| Пожар в радиусе             | очаг ≤ радиуса, остальные условия не выполнены                              | moderate |
| Официальное предупреждение  | severity Extreme                                                            | extreme  |
|                             | severity Severe                                                             | high     |
|                             | severity Moderate                                                           | moderate |
| Качество воздуха            | AQI 101–150                                                                 | moderate |
|                             | AQI 151–200                                                                 | high     |
|                             | AQI > 200                                                                   | extreme  |
| Землетрясение               | M ≥ 5.0 в пределах 100 км за последние 24 часа                              | moderate |
|                             | M ≥ 6.0 в пределах 100 км за последние 24 часа                              | high     |
| Нет факторов                | —                                                                           | none     |

**Эскалация:** если есть два и более фактора уровня high из разных источников (например, пожар и воздух), итог = extreme.

### 6.2 Как понять, что пожар с наветренной стороны

1. Посчитать направление от **дома к очагу** (`bearing_to_fire`).
2. Взять направление, **откуда** дует ветер (`wind.from_deg`).
3. Если угловая разница между ними ≤ 45°, пожар с наветренной стороны: ветер несёт дым и огонь от очага к дому.

```ts
const diff = Math.abs(((bearingToFire - wind.from_deg + 540) % 360) - 180);
const upwind = diff <= 45;
```

Это частая ошибка: перепутать «откуда» и «куда» дует ветер. Обязательно юнит-тест: ветер с северо-востока (45°), очаг на северо-востоке → upwind = true; очаг на юго-западе → false.

### 6.3 Рекомендации

Каждому фактору соответствует готовая короткая фраза на английском, например:

- high fire / upwind → «Prepare a go-bag and know your evacuation route.»
- air ≥ Unhealthy → «Keep windows closed and limit time outside.»
- extreme alert → «Follow official instructions: {instruction из NWS}.»

В `summary` попадают уровень и максимум две главные рекомендации. Полный список — в `data.recommendations` и на панели в симуляторе.

**Важно:** в интерфейсе и README указать, что это демонстрационный проект, не заменяет официальные службы, при опасности звонить 911.

---

## 7. Сервис агента (`agent`)

**Зачем:** в симуляторе нет Alexa, кто-то должен понимать вопрос и вызывать инструменты. Эту роль играет LLM на Amazon Bedrock.

### 7.1 API

- `POST /api/chat`
  - Вход: `{ messages: [{ role: "user" | "assistant", content: string }] }` — вся история диалога с клиента (сервис без состояния).
  - Выход: `{ reply: string, toolResults: SafetyToolResult[] }`.
- `POST /api/tts`
  - Вход: `{ text: string }`
  - Выход: `audio/mpeg` из Amazon Polly (нейронный голос, en-US).

### 7.2 Цикл агента

1. При старте подключиться к MCP-серверу как MCP-клиент (`@modelcontextprotocol/sdk` client + Streamable HTTP client transport), получить `tools/list`, преобразовать в формат `toolConfig` для Bedrock.
2. Вызвать Bedrock **Converse API** (`@aws-sdk/client-bedrock-runtime`, `ConverseCommand`) с системным промптом, историей и инструментами.
3. Если ответ требует инструмент (`stopReason === "tool_use"`), вызвать его через MCP, добавить результат в историю, повторить.
4. Максимум 5 итераций, затем вернуть ответ.
5. Все `structuredContent` вызванных инструментов собрать в `toolResults`.

**Модель:** любая модель на Bedrock с поддержкой инструментов, доступная в нашем регионе (например, Claude Sonnet или Amazon Nova Pro). Регион по умолчанию `us-east-1`. **[проверить]** доступ к модели в консоли Bedrock (Model access).

### 7.3 Системный промпт (черновик)

```
You are SafeZone, a voice safety assistant that behaves like Alexa+.
Answer in 1–3 short spoken sentences, no markdown, no coordinates.
When the user asks whether a place is safe or what dangers are nearby,
call assess_risk first. Use the narrower tools only for follow-up questions.
Remember the user's location from earlier in the conversation.
Use both kilometers and miles. Never invent data: if a tool returned
nothing, say so. Remind users to follow official instructions in emergencies.
```

### 7.4 Без доступа к Bedrock

Если переменная `BEDROCK_ENABLED=false`, `/api/chat` работает в **сценарном режиме**: три заранее заданных вопроса из раздела 2 сопоставляются с фиксированными вызовами инструментов. Этого хватает, чтобы судьи увидели весь поток без ключей AWS.

---

## 8. Веб-симулятор (`web`)

**Стек:** Vite + React + TypeScript + `maplibre-gl`.

### 8.1 Экран

```
┌──────────────────────────────────────────────┬───────────────────┐
│                                              │  Risk: HIGH  🔴   │
│                                              │  ─────────────    │
│                 КАРТА (на весь экран)        │  Factors          │
│                                              │  Recommendations  │
│                                              │  Sources          │
│                                              │                   │
├──────────────────────────────────────────────┴───────────────────┤
│  💬 история диалога (последние 3 реплики)                        │
│  [ 🎤 удерживать и говорить ]   [ ввод текстом ]  [пресеты ▾]    │
└──────────────────────────────────────────────────────────────────┘
```

- Стиль в духе Alexa: тёмная тема, светящееся кольцо вокруг кнопки микрофона во время прослушивания и ответа.
- Панель справа сворачивается на мобильных.
- **Пресеты:** три кнопки с вопросами из сценария. Нужны для видео и для судей.

### 8.2 Голос

- Распознавание: Web Speech API (`SpeechRecognition`, `lang = "en-US"`). Работает в Chrome. В браузерах без поддержки остаётся ввод текстом.
- Озвучка: `POST /api/tts` (Polly). Если недоступно, запасной вариант `speechSynthesis` браузера.
- Состояния кнопки: idle → listening → thinking → speaking.

### 8.3 Карта

- Подложка: Amazon Location Maps (стиль тёмный) **[проверить]** получение ключа API. Запасной вариант без ключа: OpenFreeMap (`https://tiles.openfreemap.org/styles/dark` или `liberty`).
- На каждый `SafetyToolResult`:
  1. Для каждого слоя: если источник с таким `id` уже есть, заменить данные (`setData`), иначе создать.
  2. Если есть `view`, плавно перелететь (`flyTo` или `fitBounds`, 1.5 секунды).
- Стили слоёв:

| kind     | Отображение                                                           |
| -------- | --------------------------------------------------------------------- |
| `home`   | Пульсирующая точка                                                    |
| `fires`  | Оранжево-красные круги, размер по `frp`, лёгкий heatmap при отдалении |
| `radius` | Пунктирный круг                                                       |
| `alerts` | Полупрозрачные полигоны, цвет по severity                             |
| `quakes` | Круги, размер по магнитуде                                            |
| `air`    | Цветной бейдж по категории EPA                                        |
| `wind`   | Анимированная стрелка                                                 |
| `places` | Иконки (больница, пожарная часть), выбранная подсвечена               |
| `route`  | Яркая линия                                                           |

- Легенда в углу показывает только видимые слои.
- Клик по объекту открывает попап с деталями и источником.

### 8.4 Надёжность демо

- Индикатор «DEMO DATA» в углу, если ответ пришёл с `demo: true`.
- Все запросы с обработкой ошибок: при сбое — понятное сообщение в чате, интерфейс не зависает.

---

## 9. Подключение к настоящему Alexa+ (опционально)

- Документация: https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html
- Alexa+ выступает MCP-клиентом. Создаём **Alexa+ MCP add-on**, указываем публичный HTTPS-адрес нашего `/mcp`, разворачиваем командой `alexa-ai deploy`. После изменения инструментов разворачиваем заново.
- **MCP Apps:** Alexa+ поддерживает расширение MCP Apps для интерактивного интерфейса в диалоге. Если успеем, отдать упрощённую карту как UI-ресурс для устройств с экраном. **[проверить]** формат в документации MCP Apps. Приоритет P2.
- Нужен доступ к превью Alexa+ для разработчиков. **[проверить]** доступность из Казахстана, спросить в Discussions на Devpost. Если доступа нет, сдаём сервер + симулятор, это разрешено правилами.

---

## 10. Развёртывание на AWS

| Что           | Где                                         | Комментарий                                                                                                                                         |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP-сервер    | AWS Lambda + Function URL (или API Gateway) | Stateless + JSON-ответы. Альтернатива: Bedrock AgentCore Runtime, если он поддерживает наш сценарий **[проверить]**, это плюс для мини-конкурса AWS |
| Сервис агента | AWS Lambda + Function URL                   | Права IAM на Bedrock и Polly                                                                                                                        |
| Веб-симулятор | S3 + CloudFront или Amplify Hosting         | Статика после `vite build`                                                                                                                          |
| Секреты       | Lambda environment + AWS Secrets Manager    | FIRMS MAP_KEY, ключ Amazon Location                                                                                                                 |

- Инфраструктура описывается кодом (AWS CDK на TypeScript), чтобы судьи видели, как всё развёрнуто. Если не успеваем, пошаговая инструкция в README.
- Регион: `us-east-1`.
- Бюджет: запросить $150 кредитов AWS через форму в правилах хакатона (до 21 октября). Поставить AWS Budget с оповещением на $20.

---

## 11. Конфигурация

`.env.example`:

```
# server
PORT=8787
DEMO_MODE=false
FIRMS_MAP_KEY=
NWS_USER_AGENT=SafeZone (your-email@example.com)
AWS_REGION=us-east-1
AMAZON_LOCATION_API_KEY=
ALLOWED_ORIGINS=http://localhost:5173

# agent
MCP_SERVER_URL=http://localhost:8787/mcp
BEDROCK_ENABLED=true
BEDROCK_MODEL_ID=
POLLY_VOICE_ID=Joanna

# web
VITE_AGENT_URL=http://localhost:8788
VITE_MAP_STYLE_URL=
```

Секреты не коммитим. `.env` в `.gitignore`.

---

## 12. Этапы и критерии готовности

Приоритеты: **P0** — без этого не сдаём, **P1** — сильно повышает оценку, **P2** — если успеваем.

### M1. Каркас (27 сен – 30 сен) — P0

- Монорепо, TypeScript, линтер, тесты, `shared/types.ts`.
- MCP-сервер с `/mcp` и `/health`, инструмент `get_fire_hotspots` с реальными данными FIRMS.
- **Готово, когда:** в MCP Inspector (`npx @modelcontextprotocol/inspector`) видно инструмент, вызов для Сакраменто возвращает очаги и корректный `SafetyToolResult`.

### M2. Все источники (1 окт – 5 окт) — P0

- `geocode`, `get_weather_alerts`, `get_earthquakes`, `get_air_quality`, `get_wind`, `find_safe_places`.
- Кэш, таймауты, обработка ошибок.
- **Готово, когда:** каждый инструмент проходит юнит-тест на фикстуре и ручную проверку в Inspector.

### M3. Симулятор с картой (параллельно с M2, 1 окт – 7 окт) — P0

- Экран из раздела 8, карта, отрисовка слоёв из `SafetyToolResult`, ввод текстом, пресеты.
- На этом этапе фронт может вызывать MCP-сервер напрямую (без агента), чтобы проверить отображение.
- **Готово, когда:** ответ `get_fire_hotspots` рисуется на карте и карта перелетает к нужному месту.

### M4. Агент и голос (8 окт – 12 окт) — P0

- Сервис агента: Bedrock + цикл инструментов, `/api/chat`, `/api/tts`.
- Голосовой ввод и озвучка в симуляторе.
- **Готово, когда:** три вопроса из раздела 2 работают голосом подряд, с сохранением контекста.

### M5. `assess_risk` и демо-режим (12 окт – 15 окт) — P0

- Правила из раздела 6 с тестами (включая тест на направление ветра).
- Фикстуры и `DEMO_MODE`, сценарный режим агента.
- **Готово, когда:** `git clone` → `npm install` → `npm run demo` запускает всё без ключей.

### M6. Деплой (15 окт – 17 окт) — P0

- Всё на AWS, публичные адреса. Симулятор работает по ссылке.
- **Готово, когда:** демо по публичной ссылке работает с реальными данными.

### M7. Полировка (17 окт – 19 окт) — P1

- Анимации, легенда, попапы, мобильная вёрстка, панель рисков.
- `get_route` и подсветка маршрута — P2.
- Подключение к настоящему Alexa+ и MCP Apps — P2.

### M8. Сдача (19 окт – 22 окт) — P0

- Видео, README, `DEVPOST.md`, friction log, отзыв об инструментах. Чек-лист в разделе 14.

---

## 13. Тестирование

- **Юнит-тесты (vitest):** парсинг каждого источника на фикстурах, правила риска, направление ветра, кластеризация очагов, категории AQI.
- **Контрактный тест:** каждый инструмент возвращает объект, проходящий `zod`-схему `SafetyToolResult`.
- **Протокол:** скрипт `npm run smoke` отправляет `initialize`, `tools/list`, `tools/call` на `/mcp` и проверяет ответы, включая версию протокола 2025-11-25.
- **Ручная проверка:** MCP Inspector и три сценария в симуляторе перед каждым мёржем в `main`.

---

## 14. Чек-лист сдачи

- [ ] Репозиторий публичный, лицензия MIT
- [ ] README на английском: что это, скриншот или GIF, архитектура, запуск в демо-режиме одной командой, запуск с ключами, ссылка на живое демо, дисклеймер про экстренные службы
- [ ] Видео до 3 минут на YouTube или Vimeo: проблема (10 с) → живое демо трёх вопросов (2 мин) → архитектура и AWS (30 с) → что дальше (10 с)
- [ ] Описание на Devpost на английском (`docs/DEVPOST.md`)
- [ ] Отзыв об инструментах Amazon (что понравилось, что нет, как прошёл старт)
- [ ] Friction log (`docs/FRICTION-LOG.md`)
- [ ] Указаны мини-конкурсы: AWS и/или Open Source
- [ ] Оба участника в команде на Devpost
- [ ] Сдано до 22 октября

---

## 15. Friction log

Ведём с первого дня. Даёт до +10% к оценке. Записываем каждую проблему с инструментами **Amazon** (Alexa+, AWS, Bedrock, Polly, Location), не с нашим кодом.

```markdown
### 2026-09-28 — Bedrock model access

- **Что делали:** пытались вызвать модель через Converse API
- **Что ожидали:** ответ модели
- **Что произошло:** AccessDeniedException, пока не включили доступ к модели в консоли
- **Сколько времени потеряли:** 40 минут
- **Что помогло бы:** понятное сообщение об ошибке со ссылкой на Model access
```

---

## 16. Риски

| Риск                                     | Что делаем                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| Нет доступа к Alexa+                     | Симулятор разрешён правилами, это основной путь                            |
| В день записи нет реальных пожаров в США | Демо-режим с записанными данными                                           |
| Лимиты или сбои внешних API              | Кэш, частичные ответы, фикстуры                                            |
| Не успеваем                              | Строго по приоритетам P0 → P1 → P2. `get_route` и MCP Apps первыми под нож |
| Расходы AWS                              | Кредиты $150, бюджетное оповещение, Lambda вместо постоянных серверов      |
| Ключи утекли в репозиторий               | `.gitignore`, проверка перед коммитом, ключи только в переменных окружения |

---

## 17. Шаблон `CLAUDE.md`

Положить в корень репозитория, чтобы Claude Code соблюдал правила проекта:

```markdown
# SafeZone

Full spec: SPEC.md. Read the relevant section before changing code.

- TypeScript strict, npm workspaces: shared, server, agent, web
- All tool results must match SafetyToolResult in shared/src/types.ts
- Wind direction from APIs is where wind comes FROM (see SPEC 6.2)
- Never commit secrets; config via .env (see .env.example)
- Every tool must work in DEMO_MODE using server/fixtures
- Run `npm test` and `npm run lint` before finishing a task
- User-facing text in English; code comments in English
```
