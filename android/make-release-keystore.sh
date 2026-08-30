#!/usr/bin/env bash
# ZARA §43 — generate (or regenerate) the RELEASE keystore.
# Run once per release identity. NEVER commit the keystore or passwords.
# Keep a backup: losing this file means future updates need a new app identity.
set -euo pipefail

read -rp "Keystore password (min 6 chars): " STOREPASS
read -rp "Confirm password: " CONFIRM
[ "$STOREPASS" = "$CONFIRM" ] || { echo "passwords differ"; exit 1; }
[ "${#STOREPASS}" -ge 6 ] || { echo "password too short"; exit 1; }

cd "$(dirname "$0")"
keytool -genkeypair -v \
  -keystore zara-release.keystore \
  -alias zara -keyalg RSA -keysize 2048 -validity 10950 \
  -storepass "$STOREPASS" -keypass "$STOREPASS" \
  -dname "CN=ZARA Companion, OU=Personal, O=ZARA User, C=IN"

cat > keystore.properties <<PROPS
storeFile=zara-release.keystore
storePassword=$STOREPASS
keyAlias=zara
keyPassword=$STOREPASS
PROPS
chmod 600 keystore.properties zara-release.keystore

echo "Done. zara-release.keystore + keystore.properties created (both gitignored)."
echo "Back BOTH files up somewhere safe — they are your app's identity."
