# Yeastar Audio Monitor

เว็บแอปเดโมสำหรับรับเสียงสายสนทนาแบบเรียลไทม์จาก **Yeastar P-Series** (ได้หลายเครื่อง) ผ่านฟีเจอร์ **WebSocket Audio Streaming**:

- **Dashboard**: ดูสายที่กำลังคุยแยกตาม PBX, ระดับเสียงแต่ละฝั่ง, สถิติเฟรม, **ฟังสด** (ซ้าย/ขวา) และ**ถอดเสียงสด**
- **ตั้งค่า AI Platform**: Deepgram API key, model, ภาษา + ปุ่มทดสอบการเชื่อมต่อ
- **ตั้งค่า Yeastar PBX**: เพิ่ม/แก้ไข/ลบ PBX ได้หลายเครื่อง แต่ละเครื่องมี URL + Secret ของตัวเอง
  และตั้งค่า WebSocket Audio Streaming บนตัว PBX ผ่าน **Yeastar OpenAPI** ได้ (เปิด/ปิด, URL, Secret, sample rate, เลือก Extension/Trunk/DID)

```
Yeastar PBX (หลายเครื่อง) ──ws──▶ /yeastar/<pbxId> ─▶ CallStore ─▶ /ui (WebSocket) ─▶ Browser
        ▲                                           │  ▲
        │ OpenAPI (https)                           ▼  │ transcript
   YeastarApiClient                             SttManager ──wss──▶ Deepgram
```

## ติดตั้งและรัน

ต้องมี Node.js 20 ขึ้นไป

```bash
npm install
cp .env.example .env        # ไม่บังคับ — ตั้งค่าทั้งหมดทำผ่านหน้าเว็บได้

# ใช้งานจริง (พอร์ตเดียว 8080 ทั้งหน้าเว็บและ PBX)
npm run build
npm start                    # เปิด http://localhost:8080

# ระหว่างพัฒนา (hot reload)
npm run dev                  # เปิด http://localhost:5173 (PBX ยังเชื่อมที่ :8080)
```

## ทดสอบโดยไม่ต้องมี PBX

```bash
npm run mock-pbx                                   # สายจำลอง 20 วินาที ในนาม PBX ตัวแรก
npm run mock-pbx -- --pbx <id หรือชื่อ PBX>          # ในนาม PBX ที่ระบุ (รันหลายตัวพร้อมกันได้)
npm run mock-pbx -- --pbx <id> --no-path           # จำลอง PBX ที่ไม่ส่ง path → แอปต้องจับคู่จาก Secret
npm run mock-pbx -- --file sample.wav              # WAV 16-bit: mono = ฝั่ง A, stereo = ซ้าย A / ขวา B
npm run mock-pbx -- --secret wrong                 # ทดสอบกรณี Secret ผิด (ต้องได้ 401)

npm run mock-yeastar-api -- --client-id demo --client-secret demo-secret   # จำลอง Yeastar OpenAPI ที่ :8088
```

- mock-pbx อ่าน path / Secret / sample rate ของ PBX จาก `data/settings.json` ให้อัตโนมัติ
- ใช้ mock-yeastar-api: ในแท็บ **Yeastar API** ใส่ Base URL `http://localhost:8088`, Client ID/Secret ตามที่รัน
  (ตัวเลือก `--token-ttl 125` ใช้ทดสอบการต่ออายุ token, `--hide-secret` จำลอง PBX ที่ไม่เปิดเผย auth_value)
- ถ้าอยากเห็นผลถอดเสียงจริง ใช้ไฟล์ WAV ที่มีเสียงพูด (เสียงสังเคราะห์จะไม่มีข้อความ)

## เพิ่ม PBX

เมนู **ตั้งค่า Yeastar PBX** → **+ เพิ่ม PBX** → แท็บ **ทั่วไป & ขาเข้า**: ตั้งชื่อ, Secret (ห้ามซ้ำกับ PBX อื่น), sample rate แล้วบันทึก

แอประบุว่าเสียงมาจาก PBX ไหนด้วย path `/yeastar/<pbxId>` ใน URL และถ้า PBX ไม่ส่ง path มา จะจับคู่จาก Secret แทน
การเชื่อมต่อที่จับคู่ไม่ได้จะแสดงในกล่อง **การเชื่อมต่อที่ไม่รู้จัก** ที่หน้ารายการ PBX

เปิด firewall ของ Windows ให้รับ TCP พอร์ต 8080 ขาเข้า:

```powershell
New-NetFirewallRule -DisplayName "Yeastar Audio Monitor" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

### ตั้งค่าที่ PBX ผ่าน Yeastar API (แนะนำ — P-Series Software Edition)

1. ที่ PBX: **Integrations → API** → เปิด Enable API, คัดลอก Client ID / Client Secret
   (ถ้าเปิด IP Restriction ให้เพิ่ม IP ของเครื่องที่รันแอป)
2. ในแอป แท็บ **Yeastar API**: ใส่ Base URL เช่น `https://192.168.1.10:8088`, Client ID/Secret
   (ติ๊ก "ยอมรับใบรับรอง self-signed" ถ้า PBX ใช้ใบรับรองของตัวเอง) → **ทดสอบการเชื่อมต่อ** → บันทึก
3. แท็บ **WebSocket Audio Streaming บน PBX**: กด **ใช้ค่าของแอป**, เลือก Extension / กลุ่ม / Trunk / DID
   → ตรวจตาราง **เทียบค่าบน PBX กับค่าที่จะส่ง** → **ส่งไปที่ PBX** → ยืนยัน (แอปจะอ่านค่ากลับมาแสดงให้เห็น)

ข้อควรรู้เรื่อง Yeastar API:
- แอปใช้ access token ร่วมกันหนึ่งชุดต่อ PBX, ต่ออายุอัตโนมัติ และคืน token (`del_token`) เมื่อแก้ข้อมูล API, ลบ PBX หรือปิดแอป
  เพราะ PBX ให้ token ที่ใช้ได้พร้อมกันไม่เกิน 8 ตัว
- PBX จะ**บล็อก IP** ถ้ายืนยันตัวตนผิด 5 ครั้งติดกัน — เมื่อรหัสผิด แอปจะหยุดลองจนกว่าจะบันทึก Client ID/Secret ใหม่
  (ถ้าโดนบล็อกแล้ว ปลดได้ที่ Security → Security Rules → Blocked IPs ของ PBX)
- แอปส่งรายการ Subscribe **ทั้งชุด** ทุกครั้ง

### ตั้งค่าที่ PBX ด้วยตัวเอง

1. คัดลอก URL ขาเข้าจากแท็บ **ทั่วไป & ขาเข้า** เช่น `ws://192.168.1.50:8080/yeastar/hq-1a2b`
2. ที่ PBX: **Integrations → WebSocket Audio Streaming** → เปิดใช้งาน, Server Address = URL ข้างบน
3. Secret: ตั้งชื่อ field ให้ตรงกับ `auth_key` และค่าให้ตรงกับ Secret ในแอป, Sample Rate ให้ตรงกัน
4. เลือก Extension / Trunk / DID แล้ว Save

## ตั้งค่า Deepgram

1. สมัครที่ console.deepgram.com แล้วสร้าง API key (บัญชีใหม่ได้เครดิตทดลอง — ไม่ใช่ฟรีถาวร)
2. หน้า **ตั้งค่า AI Platform** → วาง key → model `nova-3`, ภาษา `th` → **ทดสอบการเชื่อมต่อ** → บันทึก
3. เปิด "เริ่มถอดเสียงอัตโนมัติกับทุกสายใหม่" หรือกด **เริ่มถอดเสียง** รายสายใน Dashboard

แต่ละฝั่งของสายใช้ 1 stream (สาย 1:1 = 2 stream) และคิดค่าบริการตามนาทีของแต่ละ stream

## ข้อมูลที่เก็บ

- ค่าตั้งอยู่ใน `data/settings.json` (รวม Deepgram key และ Yeastar Client Secret — อย่า commit โฟลเดอร์ `data/`)
- ไฟล์รูปแบบเดิม (PBX เดียว) จะถูกย้ายเป็น "PBX 1" ให้อัตโนมัติตอนเปิดแอป
- สายและข้อความถอดเสียงอยู่ในหน่วยความจำเท่านั้น (20 สายล่าสุด) หายเมื่อ restart; ไม่มีการบันทึกไฟล์เสียง

## ความปลอดภัย

หน้าเว็บ**ไม่มีระบบ login** ออกแบบมาให้ใช้ใน LAN เท่านั้น — อย่าเปิดพอร์ตนี้ออกอินเทอร์เน็ต
(ผู้ที่เข้าหน้าเว็บได้สามารถแก้ค่า WebSocket Audio Streaming บน PBX ผ่าน API ได้)
ถ้าจำเป็นต้องใช้ข้ามเครือข่าย ควรวางหลัง reverse proxy ที่มี TLS + authentication

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `server/index.ts` | HTTP + แยก WebSocket: `/ui` = browser, path อื่น = PBX |
| `server/ingest.ts` | รับ connection จาก PBX, ระบุว่าเป็น PBX ไหน (path → Secret), ตรวจ auth |
| `server/callStore.ts` | สถานะสาย/channel (key = pbxId + callid), สถิติ, transcript |
| `server/yeastarApi.ts` | Yeastar OpenAPI client: token, refresh, del_token, แปล errcode |
| `server/routes/pbx.ts` | REST ของ PBX: CRUD, ทดสอบ API, อ่าน/ส่งค่า WebSocket Audio Streaming |
| `server/network.ts` | หา IP ของแอปที่อยู่วงเดียวกับ PBX เพื่อสร้าง URL ขาเข้า |
| `server/sttManager.ts` | Deepgram stream ต่อ channel, keepalive, ทดสอบการเชื่อมต่อ |
| `server/dashboardHub.ts` | ส่ง event/ระดับเสียง/เสียงสดให้ browser |
| `server/settingsStore.ts` | ค่าตั้ง (รายการ PBX + AI), migration, ตรวจ Secret ซ้ำ |
| `shared/protocol.ts` | type ที่ใช้ร่วมกันระหว่าง server และหน้าเว็บ |
| `web/src/nav.ts` | รายการเมนูด้านซ้าย (เพิ่มหน้าใหม่ที่นี่ + `App.tsx`) |
| `web/src/pages/PbxListPage.tsx`, `PbxEditPage.tsx` | รายการ PBX และหน้าแก้ไข 3 แท็บ |
| `web/src/components/pbx/` | แท็บ WebSocket Audio Streaming บน PBX + ตัวเลือก Subscribe |
| `tools/mock-pbx.ts`, `tools/mock-yeastar-api.ts` | ตัวจำลอง PBX (เสียง) และ Yeastar OpenAPI |

## สิ่งที่ต้องยืนยันกับ PBX จริง

- รูปแบบ header ที่ PBX ใช้ส่ง Secret และ PBX ส่ง path ท้าย URL มาหรือไม่ (ดูได้ในหน้าแก้ไข PBX หลังเชื่อมครั้งแรก)
- `websocketaudiostream/update` ทับรายการ Subscribe ทั้งชุดหรือรวมกับของเดิม
- ID ของ DID จาก `get_menuoptions?menu=trunk_did_id` ใช้เป็น `subscribe_id` ได้ตรงหรือไม่
- `websocketaudiostream/get` คืน `auth_value` ให้อ่านได้หรือไม่ (ถ้าไม่ แถว Secret จะแสดง "ไม่ทราบ")
- ข้อความ JSON จริงตรงกับเอกสารหรือไม่ (ดูได้ที่ Message inspector ใน Dashboard)
