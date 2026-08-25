#!/usr/bin/env bash
# Golden version matrix: run the live lint suite against every key ES version
# (watershed-based split, 5.x → 9.x).
#
# Usage:
#   ./scripts/version-matrix.sh              # all versions
#   ./scripts/version-matrix.sh 7.17.28 9.0.3  # subset
#
# Requirements: docker; ~2GB free RAM per instance (run sequentially).
# On Apple Silicon the 5.x/6.x images run via amd64 emulation (slower start).
set +u

VERSIONS=(
  "5.6.16"    # last 5.x (field_caps since 5.4)
  "6.8.23"    # last 6.x (typed APIs era)
  "7.7.1"     # pre composable-templates (7.8 watershed)
  "7.10.2"    # data streams GA (7.9 watershed), last OSS-era
  "7.17.28"   # last 7.x, bridge to 8
  "8.6.2"     # 8.x before ES|QL
  "8.11.4"    # ES|QL watershed
  "8.17.3"    # current mainline
  "9.0.3"     # latest major
)
[ $# -gt 0 ] && VERSIONS=("$@")

PORT=39200
NAME=mcp-lint-matrix
PASS=()
FAIL=()

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for V in "${VERSIONS[@]}"; do
  MAJOR="${V%%.*}"
  echo ""
  echo "=== ES $V ==="
  cleanup

  PLATFORM=()
  if [ "$MAJOR" -le 6 ] && [ "$(uname -m)" = "arm64" ]; then
    PLATFORM=(--platform linux/amd64)
  fi

  ENVS=(-e "discovery.type=single-node" -e "ES_JAVA_OPTS=-Xms512m -Xmx512m")
  # 5.x/6.x default-bundle x-pack auth; 8.x/9.x enable security by default
  ENVS+=(-e "xpack.security.enabled=false")
  if [ "$MAJOR" -le 5 ]; then
    # 5.x single-node bootstrap
    ENVS=(-e "ES_JAVA_OPTS=-Xms512m -Xmx512m" -e "xpack.security.enabled=false" -e "discovery.zen.minimum_master_nodes=1" -e "transport.host=localhost")
  fi

  if ! docker run -d --name "$NAME" ${PLATFORM[@]:-} -p "$PORT:9200" "${ENVS[@]}" \
      "docker.elastic.co/elasticsearch/elasticsearch:$V" >/dev/null; then
    echo "!! failed to start container for $V"
    FAIL+=("$V (container)")
    continue
  fi

  # wait for the REST layer (up to 180s; emulated oldies are slow)
  READY=0
  for _ in $(seq 1 90); do
    if curl -s "http://localhost:$PORT/" | grep -q '"number"'; then READY=1; break; fi
    sleep 2
  done
  if [ "$READY" != 1 ]; then
    echo "!! ES $V did not become ready"
    docker logs "$NAME" 2>&1 | tail -5
    FAIL+=("$V (startup)")
    continue
  fi

  if ES_TEST_URL="http://localhost:$PORT" npx vitest run tests/live-lint.test.ts --reporter=basic; then
    PASS+=("$V")
  else
    FAIL+=("$V (tests)")
  fi
done

cleanup
echo ""
echo "======== matrix summary ========"
echo "PASS: ${PASS[*]:-none}"
echo "FAIL: ${FAIL[*]:-none}"
[ ${#FAIL[@]} -eq 0 ]
