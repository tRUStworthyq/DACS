#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${KEYCLOAK_CONTAINER_NAME:-keycloak}"

if ! docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Keycloak container '$CONTAINER_NAME' was not found. Start the DACS dev stack first." >&2
  exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
  echo "Keycloak container '$CONTAINER_NAME' is not running." >&2
  exit 1
fi

echo "Enabling self-registration in the DACS realm..."
docker exec "$CONTAINER_NAME" /bin/sh -c '
  set -e
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 \
    --realm master \
    --user "$KEYCLOAK_ADMIN" \
    --password "$KEYCLOAK_ADMIN_PASSWORD"
  /opt/keycloak/bin/kcadm.sh update realms/DACS -s registrationAllowed=true
  /opt/keycloak/bin/kcadm.sh get realms/DACS --fields realm,registrationAllowed
'

echo "Registration is enabled. Open DACS /register and then choose Register on the Keycloak page."
