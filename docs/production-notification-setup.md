# Production notifications — тохируулах гарын авлага

Дата: **2026-08-18**.

Энэ файл нь **кодоор хийж болохгүй, гараар хийх ёстой** алхмуудыг бичнэ.
Код тал бэлэн — доорх алхмуудыг гүйцэтгэтэл push ба имэйл идэвхжихгүй,
харин апп доторх мэдэгдэл өмнөх шигээ ажиллана.

Тэмдэглэгээ: **MANUAL ACTION REQUIRED** = зөвхөн та хийж чадна.

---

## 0. Одоогийн байдал — юу ажиллаж, юу хүлээж байна

| Суваг | Код | Тохиргоо | Ажиллаж байна уу |
|---|---|---|---|
| Апп доторх мэдэгдэл | ✅ | шаардлагагүй | ✅ **тийм** |
| Android push | ✅ | ❌ Firebase хүлээж байна | ❌ |
| iOS push | ⛔ зориуд хийгээгүй | — | ❌ (шийдвэрээр) |
| Имэйл (нууц үг сэргээх) | ✅ | ❌ SMTP хүлээж байна | ❌ |

---

## 1. Сувгийн бодлого (PHASE 9)

Бүх мэдэгдэл бүх сувгаар явдаггүй. Одоогийн бодлого:

| Эвент | Апп дотор | Push (Android) | Имэйл |
|---|:---:|:---:|:---:|
| `SERVICE_REQUEST_CREATED` | ✅ | ✅ | ❌ |
| `SERVICE_REQUEST_ASSIGNED` | ✅ | ✅ | ❌ |
| `SERVICE_REQUEST_REASSIGNED` | ✅ | ✅ | ❌ |
| `SERVICE_REQUEST_STATUS_CHANGED` | ✅ | ✅ | ❌ |
| `SERVICE_REQUEST_UNCLAIMED` | ✅ | ✅ | ❌ |
| `REPORT_SUBMITTED` | ✅ | ✅ | ❌ |
| `REPORT_APPROVED` | ✅ | ✅ | ❌ |
| `REPORT_RETURNED` | ✅ | ✅ | ❌ |
| `RISK_ASSESSMENT_RAISED` | ✅ | ✅ | ❌ |
| `REPAIR_REQUIRED` | ✅ | ✅ | ❌ |
| `REVISIT_REQUIRED` | ✅ | ✅ | ❌ |
| `INVOICE_ISSUED` | ✅ | ✅ | ❌ |
| `INVOICE_DUE_SOON` | ✅ | ✅ | ❌ |
| `INVOICE_OVERDUE` | ✅ | ✅ | ❌ |
| `PLANNED_WORK_DUE_SOON` | ✅ | ✅ | ❌ |
| `PLANNED_WORK_OVERDUE` | ✅ | ✅ | ❌ |
| `SLA_NEAR_BREACH` | ✅ | ✅ | ❌ |
| `SLA_BREACHED` | ✅ | ✅ | ❌ |
| **Нууц үг сэргээх** | ❌ | ❌ | ✅ |

**Яагаад push бүх эвентэд ✅ вэ:** push нь апп доторх мэдэгдлийн хуулбар,
тусдаа шийдвэр биш. `notify()` мөр бичсэнийхээ дараа тэр мөрийг эзэмшигчийн
төхөөрөмж рүү дамжуулна. Сувгийг эвент тус бүрээр салгах шаардлага гарвал
`dispatchPush` дуудлагад шүүлтүүр нэмэх нь нэг мөрийн ажил.

**Яагаад имэйл зөвхөн нууц үг сэргээхэд вэ:** backend дээр өөр имэйл
байхгүй. Мэдэгдлийг имэйлээр давхардуулах нь хэрэглэгчийн inbox-ыг
дүүргэдэг бөгөөд хэн ч хүсээгүй. Хэрэв хожим хэрэгтэй бол `notify()`
дотор `sendMail` нэмэх — гэхдээ **эхлээд** давтамжийн бодлого (digest)
шийдэх ёстой.

**Хэн хүлээж авах вэ** — эвент бүр эрхээр тодорхойлогдоно
(`notification.service.ts:88-106`). Жишээ: `INVOICE_OVERDUE` нь
`invoice.view` эрхтэй бүх ажилтан **ба** тухайн харилцагчид очно.

---

## 2. MANUAL ACTION REQUIRED — Firebase Console

### 2.1 Төсөл үүсгэх

1. https://console.firebase.google.com → **Add project**
2. Нэр: `monhorus` (эсвэл дурын)
3. Google Analytics — **хэрэггүй**, унтраа

### 2.2 Хоёр Android апп бүртгэх

> ⚠️ Bundle/package id нь **яг тааруулах** ёстой. Буруу бол push чимээгүй
> ажиллахгүй.

**Ажилтны апп:**
* Project settings → **Add app** → Android
* Android package name: `mn.monhorus.monhorus_employee`
* App nickname: `Monhorus Employee`
* `google-services.json` татаж авах →
  **`apps/mobile-employee/android/app/google-services.json`** гэж хадгална

**Харилцагчийн апп:**
* Add app → Android
* Android package name: `mn.monhorus.monhorus_mobile`
* App nickname: `Monhorus Mobile`
* `google-services.json` →
  **`apps/mobile/android/app/google-services.json`**

> `.gitignore` эдгээрийг блоклоно — энэ нь зөв. Git-д оруулахгүй.
> Файл байрлуулмагц Gradle plugin автоматаар идэвхжинэ (`build.gradle.kts`
> дотор `if (file("google-services.json").exists())`).

**SHA сертификатын тухай:** FCM push-д SHA-1 **шаардлагагүй**. Зөвхөн
Google Sign-In, Dynamic Links зэрэгт хэрэгтэй. Тиймээс алгасаж болно.

### 2.3 Backend-д зориулсан service account

1. Project settings → **Service accounts**
2. **Generate new private key** → JSON татагдана
3. Тэр JSON дотроос **гурван утга** авна:
   * `project_id` → `FIREBASE_PROJECT_ID`
   * `client_email` → `FIREBASE_CLIENT_EMAIL`
   * `private_key` → `FIREBASE_PRIVATE_KEY`

> ⚠️ JSON файлыг **git-д оруулахгүй**. `.gitignore` нь
> `serviceAccount*.json`-ыг блоклоно, гэхдээ өөр нэртэй байвал блоклохгүй —
> файлыг repo-гоос гадуур хадгалах нь хамгийн найдвартай.

### 2.4 Серверийн env файлд нэмэх

**MANUAL ACTION REQUIRED** — сервер дээр:

```bash
sudo nano /etc/monhorus/backend.env
```

Нэмэх:

```ini
FIREBASE_PROJECT_ID=<project_id>
FIREBASE_CLIENT_EMAIL=<client_email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"
```

> **`FIREBASE_PRIVATE_KEY`-ийн тухай хамгийн түгээмэл алдаа:** JSON доторх
> утга нь `\n` гэсэн **хоёр тэмдэгт** (backslash + n) агуулна. Түүнийг
> **яг тэр хэвээр**, давхар хашилтанд, нэг мөрөнд буулгана.
> `push.service.ts` нь гарын үсэг зурахаасаа өмнө `\n`-г жинхэнэ мөр
> таслалт болгож хөрвүүлдэг. Хэрэв та өөрөө жинхэнэ мөр таслалт болгож
> оруулбал env файл эвдэрнэ.

Дараа нь:

```bash
sudo systemctl restart monhorus-api
sudo journalctl -u monhorus-api -n 50 --no-pager
```

Гурвуулаа тохирсон үед `pushEnabled` үнэн болно. Аль нэг нь дутуу бол
push чимээгүй унтраалттай хэвээр — сервер асахад саад болохгүй.

### 2.5 APK дахин build хийх

`google-services.json` нь **build хийх үед** аппад шигтгэгддэг. Тиймээс
файл нэмсний дараа **заавал дахин build**:

```bash
cd apps/mobile-employee
flutter build apk --release --dart-define=API_BASE_URL=https://monhorus.itsystem.mn/api/v1

cd ../mobile
flutter build apk --release --dart-define=API_BASE_URL=https://monhorus.itsystem.mn/api/v1
```

> ⚠️ `--dart-define` **заавал**. Үгүй бол апп `10.0.2.2:4000` руу хандана
> (`app_config.dart:27`) бөгөөд release build дээр cleartext хориотой тул
> огт ажиллахгүй.

> ⚠️ Build хийсний дараа **гарын үсгийг шалга**
> (`PRODUCTION_STATUS.md` §3.9):
> ```bash
> apksigner verify --print-certs app-release.apk | grep "SHA-256"
> ```
> `key.properties` байхгүй бол чимээгүйхэн debug түлхүүрээр гарын үсэг
> зурагдана, Android шинэчлэлтийг суулгахаас татгалзана.

---

## 3. MANUAL ACTION REQUIRED — Gmail / SMTP

### 3.1 App Password үүсгэх

1. Ашиглах Google акаунтыг сонго (жишээ: `no-reply@`-ын оронд ажиллах хаяг)
2. https://myaccount.google.com/security → **2-Step Verification** заавал асаа
   (үүнгүйгээр App Password гарахгүй)
3. https://myaccount.google.com/apppasswords → шинэ App Password
4. 16 тэмдэгтийн утга гарч ирнэ — **нэг л удаа харагдана**

### 3.2 Илгээгчийн хаягийг шийдэх — энэ алхмыг бүү алгас

Gmail нь `From` толгойг **дардаг**. Хоёр сонголт:

**А. Хялбар зам** — `MAIL_FROM`-ыг Gmail хаяг болгох:
```ini
MAIL_FROM=Monhorus <таны-gmail@gmail.com>
```
Ажиллана, гэхдээ хэрэглэгч Gmail хаягийг харна.

**Б. Зөв зам** — `no-reply@monhorus.itsystem.mn`-ыг баталгаажуулах:
1. Тэр хаягийг **үнэхээр үүсгэх** (одоо байхгүй)
2. Gmail → Settings → Accounts → **Send mail as** → нэмэх → баталгаажуулах
3. `itsystem.mn` DNS дээр **SPF** бичлэгт Google-г нэмэх:
   `v=spf1 include:_spf.google.com ~all`
4. Дараа нь `MAIL_FROM=Monhorus <no-reply@monhorus.itsystem.mn>`

> **Б-г хийхгүй бол** захидал spam руу орох магадлал өндөр. Нууц үг
> сэргээх захидал бол хэрэглэгч хүлээж байгаа захидал — spam руу орох нь
> хамгийн муу үр дүн.

### 3.3 Серверт нэмэх

```bash
sudo nano /etc/monhorus/backend.env
```

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<таны Gmail хаяг>
SMTP_PASS=<16 тэмдэгтийн App Password>
MAIL_FROM=Monhorus <шийдсэн хаяг>
```

```bash
sudo systemctl restart monhorus-api
```

### 3.4 Батлах

```bash
curl -X POST https://monhorus.itsystem.mn/api/v1/auth/forgot-password \
  -H 'Content-Type: application/json' \
  -d '{"email":"бодит@хаяг.mn"}'
```

Дараа нь:
1. Захидал **ирсэн эсэхийг** шалга (spam хавтсыг ч хар)
2. Холбоос `https://monhorus.itsystem.mn/...` руу заасан эсэхийг шалга —
   `localhost` бол `APP_WEB_BASE_URL` буруу
3. **Логт токен байхгүй** эсэхийг шалга:
   ```bash
   sudo journalctl -u monhorus-api -n 100 --no-pager | grep -i "reset\|token"
   ```
   `[REDACTED]` л харагдах ёстой.

---

## 4. 🔴 MANUAL ACTION REQUIRED — байршуулахын өмнө ЗААВАЛ

**Одоогийн `main`-ыг байршуулбал backend асахгүй.**

`env.ts:133-153` дээрх шалгалт: `NODE_ENV=production` үед
`APP_WEB_BASE_URL` нь localhost бол Zod алдаа өгч `process.exit(1)` хийнэ.
Сервер дээр энэ хувьсагч **тохируулаагүй** (`PRODUCTION_STATUS.md:53`).

```bash
sudo nano /etc/monhorus/backend.env
```

```ini
APP_WEB_BASE_URL=https://monhorus.itsystem.mn
PASSWORD_RESET_TTL_MINUTES=60
```

Энэ бол алдаа биш, **зориудын хамгаалалт** — чимээгүй эвдэрсэн холбоос
илгээхийн оронд чангаар унана.

### Байршуулалтын дараалал

```bash
# 1. Нөөцлөх (ЗААВАЛ)
sudo /usr/local/sbin/backup-monhorus.sh

# 2. Код байршуулах (одоо байгаа журмаар)

# 3. Индекс синк — ШИНЭ талбарууд нэмэгдсэн
cd /srv/clients/monhorus/apps/backend
npm run sync:indexes -- --dry-run     # ЭХЛЭЭД харна
npm run sync:indexes                   # дараа нь хэрэгжүүлнэ

# 4. Дахин асаах
sudo systemctl restart monhorus-api
sudo systemctl status monhorus-api

# 5. Батлах
curl -s https://monhorus.itsystem.mn/api/v1/../health
```

> `sync:indexes` нь схемд байхгүй индексийг **устгадаг** тул `--dry-run`
> заавал эхлээд (`PRODUCTION_STATUS.md` §3.7).

---

## 5. Шалгах жагсаалт — бүх зүйл ажиллаж байгаа эсэх

### Push

- [ ] Хоёр `google-services.json` байрлуулсан
- [ ] `FIREBASE_*` гурван хувьсагч серверт нэмсэн
- [ ] `systemctl restart monhorus-api` хийсэн
- [ ] APK дахин build хийсэн, гарын үсэг шалгасан
- [ ] Утсан дээр суулгаж, нэвтэрсэн
- [ ] Android 13+ дээр зөвшөөрлийн диалог гарсан
- [ ] Өгөгдлийн санд `devicetokens` цуглуулгад мөр үүссэн:
      ```
      mongosh monhorus --eval 'db.devicetokens.find().pretty()'
      ```
- [ ] Тест мэдэгдэл үүсгээд утсанд ирсэн

### Имэйл

- [ ] `SMTP_*` тохирсон
- [ ] Бодит хаяг руу туршсан, захидал **ирсэн**
- [ ] Холбоос `https://monhorus.itsystem.mn` руу заасан
- [ ] Логт токен **байхгүй**

### Мэдэгдэл ерөнхийд

- [ ] `APP_WEB_BASE_URL` тохирсон
- [ ] Вэб дээр хонхны тоо зөв
- [ ] Хугацаа хэтэрсэн ажлын мэдэгдэл ирж эхэлсэн (15 мин дотор)

---

## 6. Хэрэв iOS-ийг хожим нэмэхээр шийдвэл

Одоо **зориуд хийгээгүй**. Нэмэх бол дараалал:

1. **Эхлээд** харилцагчийн аппын bundle id солих:
   `com.example.monhorusMobile` → жишээ нь `mn.monhorus.monhorusMobile`
   (`apps/mobile/ios/Runner.xcodeproj/project.pbxproj`, 3 газар)
   > ⚠️ Сертификат үүсгэсний **дараа** солих боломжгүй — бүгд хүчингүй болно
2. Apple Developer Program гишүүнчлэл авах
3. Xcode → Signing & Capabilities → team сонгох, **Push Notifications** нэмэх
   → `Runner.entitlements` үүсч `aps-environment` нэмэгдэнэ
4. `Info.plist` → `UIBackgroundModes` → `remote-notification`
5. Apple Developer → Keys → **APNs Auth Key** (`.p8`) үүсгэх
6. Firebase → iOS апп нэмэх (2 ширхэг) → `GoogleService-Info.plist` татах
7. Firebase → Project settings → Cloud Messaging → APNs key upload
8. `AppDelegate.swift` дээр `FirebaseApp.configure()` нэмэх
9. Кодын тал: `push_messaging.dart` дээрх `_supported` getter-г
   `Platform.isAndroid || Platform.isIOS` болгох, backend дээр
   `PUSH_ENABLED_PLATFORMS`-д `'ios'` нэмэх

Алхам 9 нь хоёр мөрийн засвар — үлдсэн 8 нь бүгд консол дээрх ажил.
