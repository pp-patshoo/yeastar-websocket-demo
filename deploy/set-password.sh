#!/usr/bin/env bash
# Set the dashboard login (DASH_USER / DASH_PASS_HASH) in .env using Caddy's bcrypt hashing.
# Usage: ./deploy/set-password.sh        then: docker compose up -d
set -euo pipefail
cd "$(dirname "$0")/.."

CADDY_IMAGE="caddy:2.11.7"
ENV_FILE=".env"
[ -f "$ENV_FILE" ] || cp deploy/.env.example "$ENV_FILE"

read -rp "ชื่อผู้ใช้ (Username) [admin]: " user
user="${user:-admin}"
if ! [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ชื่อผู้ใช้ใช้ได้เฉพาะ A-Z a-z 0-9 . _ -" >&2
  exit 1
fi
read -rsp "รหัสผ่าน (Password): " pw; echo
read -rsp "ยืนยันรหัสผ่าน: " pw2; echo
if [ "$pw" != "$pw2" ]; then echo "รหัสผ่านไม่ตรงกัน" >&2; exit 1; fi
if [ "${#pw}" -lt 10 ]; then echo "รหัสผ่านควรยาวอย่างน้อย 10 ตัวอักษร" >&2; exit 1; fi

# Pass the password through the container's environment (not the command line of this host).
hash="$(PW="$pw" docker run --rm -e PW "$CADDY_IMAGE" sh -c 'caddy hash-password --plaintext "$PW"' | tr -d '\r\n')"
unset pw pw2
if [[ "$hash" != \$2* ]]; then echo "สร้าง hash ไม่สำเร็จ: $hash" >&2; exit 1; fi

tmp="$(mktemp)"
grep -vE '^(DASH_USER|DASH_PASS_HASH)=' "$ENV_FILE" > "$tmp" || true
{
  cat "$tmp"
  echo "DASH_USER=$user"
  # single quotes: docker compose must not treat the $ in the bcrypt hash as variables
  echo "DASH_PASS_HASH='$hash'"
} > "$ENV_FILE"
rm -f "$tmp"
chmod 600 "$ENV_FILE"
echo "บันทึก login ของ \"$user\" ใน $ENV_FILE แล้ว — รัน: docker compose up -d"
