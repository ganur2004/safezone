#!/bin/bash
# Полная проверка развёрнутого SafeZone на реальных данных.
SITE=https://d227d864bivil2.cloudfront.net
MCP=https://ayqlrjlocnuxkk44xu3xs32pqe0lcqqd.lambda-url.ap-southeast-2.on.aws/mcp
AGENT=https://q4znfugo6dhy2aionoo2gq5iem0hpuyo.lambda-url.ap-southeast-2.on.aws

echo "=== 1. Здоровье и режим (demoMode должен быть false)"
curl -s --max-time 30 ${MCP%/mcp}/health; echo
curl -s --max-time 30 $AGENT/health; echo
curl -s -o /dev/null --max-time 30 -w "simulator: http %{http_code}\n" $SITE

tool() {
  name=$1; args=$2
  printf '%-20s ' "$name"
  r=$(curl -s --max-time 60 -X POST $MCP \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -H "mcp-protocol-version: 2025-11-25" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}")
  if echo "$r" | grep -q '"isError":true'; then printf 'FAIL  '; else printf 'ok    '; fi
  if echo "$r" | grep -q '"demo":true'; then printf '[ФИКСТУРЫ!] '; fi
  echo "$r" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | cut -c1-78
}

echo
echo "=== 2. Все девять инструментов на реальных данных"
P='{"lat":38.5816,"lon":-121.4944}'
tool geocode '{"query":"Sacramento"}'
tool get_fire_hotspots '{"lat":38.5816,"lon":-121.4944,"radius_km":100,"days":3}'
tool get_weather_alerts "$P"
tool get_earthquakes "$P"
tool get_air_quality "$P"
tool get_wind "$P"
tool find_safe_places '{"lat":38.5816,"lon":-121.4944,"type":"hospital","radius_km":15}'
tool get_route '{"from":{"lat":38.5816,"lon":-121.4944},"to":{"lat":38.5729,"lon":-121.461},"label":"Sutter"}'
tool assess_risk '{"place":"Sacramento"}'

echo
echo "=== 3. Диалог через агента, с сохранением контекста"
ask() {
  printf '%-46s ' "$(echo "$1" | cut -c1-44)"
  curl -s --max-time 60 -X POST $AGENT/api/chat -H "content-type: application/json" \
    -d "{\"messages\":$2}" | sed -n 's/.*"reply":"\([^"]*\)".*/\1/p' | cut -c1-80
}
ask "Is it safe around my home in Sacramento?" '[{"role":"user","content":"Is it safe around my home in Sacramento?"}]'
ask "How is the wind moving?" '[{"role":"user","content":"Is it safe in Sacramento?"},{"role":"assistant","content":"Fires."},{"role":"user","content":"How is the wind moving?"}]'
ask "Nearest hospital away from the fire?" '[{"role":"user","content":"Is it safe in Sacramento?"},{"role":"assistant","content":"Fires."},{"role":"user","content":"Where is the nearest hospital away from the fire?"}]'

echo
echo "=== 4. Голос Polly"
curl -s --max-time 40 -X POST $AGENT/api/tts -H "content-type: application/json" \
  -d '{"text":"Risk level is moderate."}' -o /tmp/sz.mp3 \
  -w "  http %{http_code}, %{size_download} bytes, %{content_type}\n"

echo
echo "=== 5. Данные действительно свежие (сверьте с первоисточниками)"
curl -s --max-time 60 -X POST $MCP -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" -H "mcp-protocol-version: 2025-11-25" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_earthquakes","arguments":{"lat":38.5816,"lon":-121.4944,"radius_km":500,"days":2,"min_magnitude":3}}}' \
  | grep -o '"url":"https://earthquake.usgs.gov[^"]*"' | head -3
