# ติดตั้ง Yeastar Audio Monitor บน Ubuntu 24.04 ด้วย Docker

```
LAN browser ──http :80──▶ Caddy (login) ──────────▶ app (dashboard)
Cloudflare Quick Tunnel ─▶ Caddy :81 (login, ภายใน) ─▶ app (dashboard)   ← cloudflared อยู่ใน container ของ app เปิด/ปิดจากหน้าเว็บ
Yeastar PBX ──ws :8080──▶ app (พอร์ตรับเสียงจาก PBX เท่านั้น) ──▶ Deepgram / Yeastar API
```

- หน้า Dashboard และ API เข้าได้ผ่าน Caddy เท่านั้น และต้อง login ทั้งทาง LAN และทาง Tunnel
- พอร์ต 8080 เป็นพอร์ตของแอปที่**รับเฉพาะ WebSocket เสียงจาก PBX** ซึ่งตรวจด้วย Secret ของ PBX แต่ละตัว
  - ถ้าเปิดพอร์ตนี้ในเบราว์เซอร์ จะได้ 404 ไม่เห็น dashboard
  - PBX ต่อตรงเข้าแอปโดยไม่ผ่าน Caddy เพราะ proxy ทิ้ง header ที่ชื่อมี `_` เช่น `auth_key` ซึ่งเป็นค่าเริ่มต้นของ Yeastar

## 1. เตรียม VM

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl git
```

ตั้ง **IP คงที่**ให้ VM เพราะ PBX ต้องเชื่อมมาที่ IP นี้ ทำได้ 2 ทาง:
- ใช้ DHCP reservation ที่ router (แนะนำ)
- หรือแก้ไฟล์ `/etc/netplan/*.yaml` แล้วรัน `sudo netplan apply`

## 2. ติดตั้ง Docker Engine (จาก repo ทางการของ Docker)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER      # จากนั้น logout แล้ว login ใหม่
docker compose version             # ตรวจว่าใช้ได้
```

## 3. ดึงโค้ดและตั้งค่า

```bash
git clone https://github.com/pp-patshoo/yeastar-websocket-demo.git
cd yeastar-websocket-demo
cp deploy/.env.example .env
nano .env                          # ตั้ง PUBLIC_HOST = IP ของ VM
./deploy/set-password.sh           # ตั้งชื่อผู้ใช้/รหัสผ่านของหน้า Dashboard
mkdir -p data && chmod 700 data
```

- `data/` เก็บค่าตั้งทั้งหมด รวมถึง Deepgram key และ Client Secret ของ Yeastar
- container รันด้วย uid 1000 ซึ่งตรงกับ user แรกของ Ubuntu ตามปกติ
- ถ้า user ของคุณไม่ใช่ uid 1000 (ดูด้วยคำสั่ง `id -u`) ให้รัน `sudo chown 1000:1000 data`

## 4. เริ่มใช้งาน

```bash
docker compose up -d --build
docker compose ps                  # app ต้องขึ้นสถานะ healthy
docker compose logs -f app         # ดู log (Ctrl+C เพื่อออก)
```

จากนั้นทำต่อในหน้าเว็บ:
1. เปิด `http://<IP ของ VM>` แล้ว login
2. ไปที่ **ตั้งค่า Yeastar PBX** → เพิ่ม PBX → แท็บ **Yeastar API** → แท็บ **WebSocket Audio Streaming บน PBX** → กด **ใช้ค่าของแอป** → **ส่งไปที่ PBX**
   - URL ขาเข้าต้องเป็น `ws://<IP ของ VM>:8080/yeastar/<id>`
   - ถ้าเห็น IP แบบ `172.x` แปลว่ายังไม่ได้ตั้ง `PUBLIC_HOST`
3. ไปที่ **ตั้งค่า AI Platform** แล้วใส่ Deepgram key

## 5. เข้าจากนอก LAN (Cloudflare Quick Tunnel)

1. ไปที่เมนู **การเข้าถึง** แล้วเปิด **Cloudflare Quick Tunnel**
2. รอให้สถานะเป็น "ออนไลน์" แล้วคัดลอก URL `https://….trycloudflare.com`
3. เปิด URL นั้นจากที่ไหนก็ได้ แล้ว login ด้วยชื่อผู้ใช้/รหัสผ่านเดียวกับใน LAN

ข้อจำกัดของ Quick Tunnel:
- **URL เปลี่ยนทุกครั้ง**ที่ปิด/เปิด tunnel หรือรีสตาร์ท container
- Cloudflare ระบุว่าใช้สำหรับทดสอบ และไม่มีการรับประกัน uptime
- ถ้าต้องการ URL ถาวรหรือระบบ login ของ Cloudflare ต้องมีโดเมนบน Cloudflare แล้วใช้ Named Tunnel แทน
- PBX ยังส่งเสียงทาง LAN (พอร์ต 8080) เหมือนเดิม ไม่ได้ผ่าน tunnel

**ปิดการเข้าผ่าน LAN** (ให้เข้าได้เฉพาะทาง tunnel):
- ต้องเปิดหน้า **การเข้าถึง** ผ่าน URL ของ tunnel ก่อน จึงจะปิดได้
- ถ้า tunnel ล่มหรือถูกปิด ระบบจะเปิดทาง LAN ให้อัตโนมัติ
- ถ้ายังเข้าไม่ได้: ตั้ง `FORCE_LAN_DASHBOARD=1` ใน `.env` แล้วรัน `docker compose up -d`

## 6. งานดูแลประจำ

| งาน | คำสั่ง |
|---|---|
| อัปเดตเวอร์ชัน | `git pull && docker compose up -d --build` |
| รีสตาร์ท | `docker compose restart app` (URL ของ tunnel จะเปลี่ยน) |
| หยุดทั้งหมด | `docker compose down` (แอปจะคืน token ของ Yeastar API ก่อนหยุด) |
| เปลี่ยนรหัสผ่าน | `./deploy/set-password.sh && docker compose up -d` |
| สำรองค่าตั้ง | `sudo tar czf yeastar-data-$(date +%F).tgz data/` (เก็บไว้ในที่ปลอดภัย เพราะมี key อยู่) |
| ดู log | `docker compose logs -f app` / `docker compose logs -f caddy` |

## ข้อควรระวังด้านความปลอดภัย

- **Docker ข้ามกฎของ ufw:** พอร์ตที่ Docker เปิด (80, 8080) เข้าถึงได้จากทุกที่ที่ถึง VM แม้ใน ufw จะสั่ง deny ไว้
  - VM **ไม่ควรมี public IP ตรง ๆ** ควรอยู่หลัง router หรือ firewall ของ LAN
  - Cloudflare Tunnel ไม่ต้องเปิดพอร์ตขาเข้าใด ๆ
- **รหัสผ่านใน LAN:** หน้าเว็บใน LAN เป็น `http` ธรรมดา รหัสผ่านจึงวิ่งแบบไม่เข้ารหัสภายใน LAN ส่วนทาง tunnel เป็น `https`
- **เสียงจาก PBX:** ส่งมาแบบ `ws://` ที่ไม่เข้ารหัสภายใน LAN
- **ไฟล์ลับ:** อย่า commit `.env` และ `data/` ทั้งสองอยู่ใน `.gitignore` แล้ว

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `docker compose up` แจ้ง `Set DASH_PASS_HASH` | ยังไม่ได้รัน `./deploy/set-password.sh` |
| login ไม่ผ่านทั้งที่รหัสถูก | ค่า `DASH_PASS_HASH` ใน `.env` ต้องอยู่ใน `'…'` ให้รัน `set-password.sh` ใหม่ |
| URL ขาเข้าเป็น IP `172.x` | ยังไม่ได้ตั้ง `PUBLIC_HOST` ใน `.env` หรือยังไม่ได้รัน `docker compose up -d` หลังแก้ |
| PBX เชื่อมไม่ได้ | ดูหน้าแก้ไข PBX → "สถานะการเชื่อมต่อจาก PBX" และ `docker compose logs app` ตรวจว่า PBX ping IP ของ VM ได้ และใช้พอร์ต 8080 |
| app ไม่ healthy / `permission denied` ที่ `data/` | `sudo chown 1000:1000 data` |
| Tunnel ขึ้น "ผิดพลาด" | ดู log ของ cloudflared ในหน้า **การเข้าถึง** ตรวจว่า VM ออกอินเทอร์เน็ตได้ |
