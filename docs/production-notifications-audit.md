# Production notifications — audit

Дата: **2026-08-18**. Хамрах хүрээ: backend, web, ажилтны апп, харилцагчийн апп, дэд бүтэц.

Энэ бол **PHASE 1–2 тайлан**. Код өөрчлөгдөөгүй. Бүх дүгнэлт нь repo дотор бодитоор
байгаа файл дээр тулгуурласан бөгөөд file:line эшлэлтэй. Шалгаагүй зүйлийг
"тодорхойгүй" гэж бичсэн — таамаглаагүй.

Уншихаас өмнө нэг зүйлийг ойлгох нь чухал: **мэдэгдлийн хүргэх суваг нь алдаа биш,
зориудаар хойшлуулсан шийдвэр.** `packages/shared/src/constants/notification.ts:5-7`
дээр шууд бичсэн байна: *"this is an in-app centre only: no email, no SMS, no push."*
Мөн `NOTIFICATION_CHANNEL_UNAPPROVED_NOTE` (мөр 100-101) нь хэрэглэгчид харагддаг
текст бөгөөд вэб дээр Alert болж гарч ирдэг. Тиймээс push/email нэмэх нь дутуу ажлыг
гүйцээх биш, **батлагдаагүй шийдвэрийг батлах** асуудал.

---

## 1. Одоо юу ажиллаж байна вэ

### Backend — апп доторх мэдэгдэл (production-ready)

| Зүйл | Байдал | Эшлэл |
|---|---|---|
| `Notification` модель | Ажиллаж байна | `apps/backend/src/modules/notification/notification.model.ts:33-50` |
| 4 маршрут (жагсаалт, уншаагүйн тоо, нэгийг унших, бүгдийг унших) | Ажиллаж байна | `notification.routes.ts:34-80` |
| Эрхийн хамгаалалт `notification.view` | Ажиллаж байна | `notification.routes.ts:26,34,51,63,76` |
| Хуудаслалт | Ажиллаж байна | `notification.service.ts:205-221` |
| 18 эвент, ноцтой байдлын map | Ажиллаж байна | `packages/shared/src/constants/notification.ts:9-94` |
| 11 API тест | Ажиллаж байна | `notification.api.test.ts` |

**Түрээслэгчийн тусгаарлалт аль хэдийн зөв, бүр даалгаварт хүссэнээс хатуу.**
Notification баримт дээр `tenant`/`customer` талбар **огт байхгүй**
(`notification.model.ts:33-46` — 0 тохиолдол). Оронд нь бүх **унших** үйлдэл
`recipient: ObjectId(actor.userId)` гэсэн шүүлтүүртэй:

- `listNotifications` — `notification.service.ts:201`
- `unreadCount` — `:226`
- `markRead` — `:237`, `:247`
- `markAllRead` — `:258`

Өөрөөр хэлбэл хэрэглэгч зөвхөн **өөрийнхөө** inbox-ыг л уншина. Tenant A-гийн хүн
Tenant B-гийн мэдэгдлийг унших нь загварын хувьд боломжгүй — эрх ч үүнийг нээхгүй
(`notification.service.ts:199-200` дээрх тайлбар: *"no permission grants sight of
somebody else's inbox"*).

Эрсдэл нь **бичих талд** байна. `recipientsByPermission`
(`notification.service.ts:88-106`) нь эрхээр нь **бүх** tenant-аас хэрэглэгч түүдэг
бөгөөд `head_admin`-ыг **болзолгүйгээр** нэмдэг (мөр 97). Тиймээс cross-tenant
зөв эсэх нь `notify()` дуудаж буй газар бүр зөв сонсогчийг сонгосон эсэхээс хамаарна.

### Web (production-ready, polling)

- Мэдэгдлийн хуудас: жагсаалт, уншаагүй шүүлтүүр, нэг/бүгдийг унших, хуудаслалт —
  `apps/web/src/features/notifications/NotificationsPage.tsx`
- Хонх + улаан badge, **60 секундын polling** — `AppShell.tsx:20,42`
- 8 тест — `NotificationsPage.test.tsx`

### Гар утасны хоёр апп (in-app inbox бүрэн)

Хоёулаа ижил 4 endpoint рүү ханддаг, inbox + badge-тэй.
- Ажилтан: `apps/mobile-employee/lib/features/employee/home/...`
- Харилцагч: `apps/mobile/lib/features/customer_portal/...`

### Дэд бүтэц (ажиллаж байгаа хэсэг)

| Зүйл | Утга | Эшлэл |
|---|---|---|
| Домэйн + TLS | `https://monhorus.itsystem.mn`, 2026-11-11 хүртэл, автомат сунгалт | `docs/PRODUCTION_STATUS.md:16-17` |
| Backend | `127.0.0.1:4000`, systemd `monhorus-api` | `:20` |
| MongoDB | host process, replica set `rs0`, loopback | `:21`, `DEPLOYMENT_MONHORUS_PROD.md:21` |
| Reverse proxy | nginx + certbot | `DEPLOYMENT_MONHORUS_PROD.md:275-278` |
| Firewall | `ufw` | `DEPLOYMENT_MONHORUS_PROD.md:442` |
| Log | pino, нууц утга redact хийдэг | `apps/backend/src/config/logger.ts:32-60` |

---

## 2. Юу дутуу байна вэ

### 2.1 Push — бүхэлдээ байхгүй (greenfield)

Дараах бүх зүйл **байхгүй** гэдгийг би өөрөө шалгасан (repo даяар `find`/`grep`):

| Шаардлага | Байдал |
|---|---|
| `firebase_core`, `firebase_messaging` (хоёр апп) | байхгүй |
| `flutter_local_notifications`, `permission_handler` | байхгүй |
| `google-services.json` (хоёр апп) | байхгүй |
| `GoogleService-Info.plist` (хоёр апп) | байхгүй |
| `.entitlements` / `aps-environment` | байхгүй |
| `UIBackgroundModes: remote-notification` | байхгүй |
| `POST_NOTIFICATIONS` зөвшөөрөл | байхгүй (зөвхөн `INTERNET`) |
| google-services Gradle plugin + classpath | байхгүй |
| `AppDelegate` push бүртгэл | байхгүй (16 мөр, template хэвээр) |
| backend `firebase-admin` | байхгүй |
| Төхөөрөмжийн token модель/endpoint | байхгүй |
| Deep link (Android intent-filter, iOS URL scheme) | байхгүй |
| `navigatorKey` эсвэл route table | байхгүй |

Сүүлийн хоёр нь чухал: push ирсэн ч **дарахад хаашаа ч шилжих боломжгүй**. Хоёр
апп хоёулаа `MaterialApp(home: AuthGate())` бүтэцтэй, нэрлэсэн маршрут байхгүй
(`apps/mobile/lib/main.dart:28-34`, `apps/mobile-employee/lib/main.dart:26-32`).
Сервер `linkPath` талбарыг аль хэдийн илгээдэг ба хоёр апп хоёулаа түүнийг **парс
хийдэг ч хэзээ ч уншдаггүй** — маршрутлахад зориулсан ганц талбар үхмэл байна.

### 2.2 Имэйл — код бэлэн, тохиргоо байхгүй

Бүх backend дээр **ганцхан** имэйл байдаг: нууц үг сэргээх
(`apps/backend/src/modules/auth/auth.service.ts:429`). Урилга, дансны мэдэгдэл,
нэхэмжлэлийн имэйл — **байхгүй**.

`mail.service.ts` нь `SMTP_HOST` тохируулагдсан эсэхээр гурван зан төлөвтэй:

| Нөхцөл | Зан төлөв | Эшлэл |
|---|---|---|
| `SMTP_HOST` тохирсон | Жинхэнэ SMTP илгээнэ | `mail.service.ts:100-135` |
| Тохироогүй + production | **Алдаа шидэж татгалзана** | `:88-98` |
| Тохироогүй + dev | Лог руу бичнэ | `:69-77` |

Production дээр татгалздаг болсон нь зөв шийдэл. Гэхдээ `sendMail` нь
try/catch дотор бөгөөд **хэзээ ч дахин шиддэггүй** (`:163-169`) — өөрөөр хэлбэл
хэрэглэгч ямар ч тохиолдолд "имэйл илгээлээ" гэсэн хариу авна.

**Retry байхгүй, queue байхгүй, outbox байхгүй, template engine байхгүй.** Нэг
оролдлого. HTML нь `auth.service.ts:337-362` дотор гараар бичигдсэн.

### 2.3 Илгээгчгүй 6 эвент

18 эвентээс **6 нь код дотор хэзээ ч үүсдэггүй**:
`PLANNED_WORK_DUE_SOON`, `PLANNED_WORK_OVERDUE`, `SLA_NEAR_BREACH`, `SLA_BREACHED`,
`INVOICE_DUE_SOON`, `INVOICE_OVERDUE`.

Ялангуяа `planned-work.overdue.service.ts` нь хугацаа хэтэрсэн ажлыг тооцдог ч
`notify` импортлодоггүй. Өөрөөр хэлбэл **хугацаа хэтэрсэн төлөвлөгөөт ажлын
мэдэгдэл хэзээ ч очдоггүй**.

### 2.4 Харилцагч руу чиглэсэн мэдэгдэл бараг байхгүй

`customerId`-аар дамжуулж харилцагч руу мэдэгддэг **ганцхан** газар байна:
`service-request.auto-status.ts:108-119` (хүсэлт дууссан үед). Харин shared
константууд дээр `REPORT_APPROVED`, эрсдэлийн эвентүүдийг "хэрэглэгч"-д хүрнэ гэж
тайлбарласан ч (`packages/shared/src/constants/notification.ts:28,32,34`) кодод
тийм биш.

### 2.5 Бусад олдсон алдаа

1. **Dev имэйл fallback ажиллахгүй.** `logTransport` нь `{ to, subject, body }`
   гэж лог руу бичдэг (`mail.service.ts:69-77`) — зорилго нь хөгжүүлэгч сэргээх
   холбоосыг хуулж авах. Гэтэл `logger.ts:47-48` нь `body`/`*.body`-г **нөхцөлгүйгээр**
   redact хийдэг. Үр дүнд нь холбоосын оронд `[REDACTED]` гарна. Тайлбар нь энэ
   redaction-ыг production backstop гэж үздэг ч dev fallback-ийг устгаж байгааг
   анзаараагүй.
2. **iOS bundle id template хэвээр.** Харилцагчийн апп: `com.example.monhorusMobile`
   (`apps/mobile/ios/Runner.xcodeproj/project.pbxproj:494,676,698`), `DEVELOPMENT_TEAM`
   огт байхгүй. Android талд нь зориуд `mn.monhorus.monhorus_mobile` болгож
   зассан байхад iOS үлдсэн. **APNs сертификат үүсгэхээс өмнө заавал шийдэх ёстой** —
   дараа өөрчилвөл сертификат ба `GoogleService-Info.plist` хоёул хүчингүй болно.
3. **Ажилтны аппын хоёр платформын id зөрүүтэй**: iOS `mn.monhorus.monhorusEmployee`,
   Android `mn.monhorus.monhorus_employee`. Firebase дээр 4 апп бүртгэхэд энэ
   4 өөр id хэрэгтэй.
4. **Badge хуучирдаг.** Хоёр апп хоёулаа `Timer.periodic` болон `AppLifecycleState`
   ажиглагчгүй. Харилцагчийн аппын pull-to-refresh нь `unreadNotificationCountProvider`-ыг
   **invalidate хийдэггүй** (`customer_home_screen.dart:105-107`) — badge тоо
   тодорхойгүй хугацаагаар буруу үлдэж болно.
5. **Вэб дээрх уншаагүйн тоо зөвхөн харагдаж буй хуудсыг тоолдог**
   (`NotificationsPage.tsx:112`) — сервер дээрх `/unread-count`-ыг ашигладаггүй.
   Гар утасны апп үүнийг зөв хийсэн байхад вэб буруу.
6. **Харилцагчийн аппын enum-д `SERVICE_REQUEST_UNCLAIMED` дутуу** (17/18). Практикт
   хор хөнөөлгүй — тэр эвент зөвхөн `dispatch.assign` эрхтэнд очдог, мөн `fromWire`
   нь `null` буцаадаг тул уначихгүй. Гэхдээ гэрээ зөрчсөн хэвээр.
7. **`insertMany` нь ordered** (`notification.service.ts:162`) — нэг баримт буруу
   бол бүх багц унана. Энэ нь тесттэй, мэдэгдэж байгаа зан төлөв.

---

## 3. Зөвхөн хөгжүүлэлтэд зориулсан зүйлс

| Зүйл | Эшлэл | Production дээр юу болох вэ |
|---|---|---|
| `mail` лог fallback | `mail.service.ts:69-77` | Production дээр ажиллахгүй — `refuseInProduction` татгалзана |
| `APP_WEB_BASE_URL` анхны утга `http://localhost:5173` | `env.ts:91` | **Production дээр сервер асахгүй** — доороос үзнэ үү |
| `CORS_ORIGINS` анхны утга `http://localhost:5173` | `env.ts:56` | Хамгаалалтгүй — production guard **байхгүй** |
| Апп дотор API хаяг `10.0.2.2` / `127.0.0.1` | `app_config.dart:27,30` | `--dart-define` өгөхгүй бол release build ажиллахгүй |
| Вэб `api-client` localhost fallback | `apps/web/src/lib/api-client.ts:6` | `.env.production` хамгаалж байгаа |
| `SEED_DEV_PASSWORD` | `env.ts:80` | — |

### ⚠️ Хамгийн яаралтай: одоогийн `main`-ыг байршуулбал сервер асахгүй

`env.ts:133-153` дээр `assertProductionOverrides` гэсэн шалгалт байна.
`NODE_ENV=production` үед `APP_WEB_BASE_URL`-ийн hostname нь `localhost`,
`127.0.0.1` эсвэл `::1` бол Zod алдаа нэмж, `process.exit(1)` хийдэг
(`env.ts:157-164`).

Сервер дээр `APP_WEB_BASE_URL` **тохируулаагүй** (`PRODUCTION_STATUS.md:53`), тиймээс
анхны localhost утга руу унана. Үр дүн: **шинэ код байршуулмагц backend асахаа болино.**

Энэ бол сайн хамгаалалт — чимээгүй эвдрэхийн оронд чангаар унана. Гэхдээ
байршуулахын өмнө `APP_WEB_BASE_URL=https://monhorus.itsystem.mn` гэж заавал
нэмэх ёстой.

---

## 4. Production-д бэлэн зүйлс

- Апп доторх мэдэгдлийн бүх урсгал (backend + web + 2 апп)
- Түрээслэгчийн тусгаарлалт (recipient-scoped унших)
- RBAC (`notification.view`, 7 preset дээр байгаа)
- Домэйн, TLS, автомат сунгалт
- nginx reverse proxy, backend loopback дээр proxy_pass
- MongoDB loopback дээр
- pino log + нууц утгын redaction
- Нөөцлөлтийн script-үүд (timer суусан эсэх нь маргаантай — 6.3-ыг үзнэ үү)

---

## 5. Юу нь Gmail/SMTP шаардах вэ

Зөвхөн **нууц үг сэргээх имэйл**. Өөр имэйл байхгүй.

Хэрэгтэй хувьсагчид (`env.ts:107-115`, нэр нь яг ийм байх ёстой):

```ini
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Monhorus <no-reply@monhorus.itsystem.mn>
```

`.env.example:66-74` дээр эдгээр нь **тайлбар болгож бичигдсэн** байгаа тул
шууд хуулбал `mailEnabled=false` хэвээр үлдэнэ.

### Gmail тохирох уу?

`.env.example:69` дээр `smtp.gmail.com` гэж жишээ болгож бичсэн. Гэхдээ:

- Gmail SMTP нь **App Password** шаарддаг (2FA заавал), энгийн нууц үг ажиллахгүй.
- Google Workspace-гүй үнэгүй Gmail нь өдөрт ~500 захидлын хязгаартай.
- `MAIL_FROM` нь `no-reply@monhorus.itsystem.mn` гэж тохируулагдсан бол Gmail
  түүнийг **дарж, жинхэнэ Gmail хаягаар** солино (эсвэл SPF унана).
- OAuth2 нь илүү найдвартай ч `mail.service.ts` дээр OAuth2-ын код **байхгүй** —
  зөвхөн `auth: { user, pass }` дэмждэг (`:119`).

Нууц үг сэргээх нь **transactional** имэйл — хэрэглэгч хүлээж байдаг, хойшлуулж
болохгүй, spam руу орж болохгүй. Тиймээс:

- **Хамгийн бага хөдөлмөр**: `itsystem.mn` домэйны одоо байгаа мэйл сервер
  (SPF/DKIM аль хэдийн байгаа магадлалтай). `PRODUCTION_STATUS.md:186` мөн үүнийг
  эхний сонголт болгож тавьсан.
- **Хамгийн найдвартай**: transactional provider (SES/Resend/Postmark). Сарын
  хэдэн зуун захидалд бараг үнэгүй.
- **Gmail App Password**: түр зуурын шийдэл болно, гэхдээ `no-reply@` хаягтай
  зөрчилдөнө.

**Аль ч тохиолдолд SPF ба DKIM бичлэг заавал хэрэгтэй** — эс бөгөөс сэргээх
захидал spam руу орно (`PRODUCTION_STATUS.md:191`).

---

## 6. Юу нь Firebase шаардах вэ

Push хийхээр шийдвэл **бүх зүйл**. FCM бол Android push-ийн цорын ганц зам, мөн
iOS дээр APNs-ийг ороож өгдөг.

Хэрэгтэй байх зүйлс:
- Firebase төсөл (1 ширхэг)
- **4 апп бүртгэл** (2 апп × 2 платформ), учир нь id-нууд өөр:
  - `mn.monhorus.monhorus_mobile` (харилцагч, Android)
  - `com.example.monhorusMobile` (харилцагч, iOS — **эхлээд засах ёстой**)
  - `mn.monhorus.monhorus_employee` (ажилтан, Android)
  - `mn.monhorus.monhorusEmployee` (ажилтан, iOS)
- `google-services.json` × 2, `GoogleService-Info.plist` × 2
- Backend талд `firebase-admin` + service account (`FIREBASE_PROJECT_ID`,
  `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)

Web push нь **шаардлагагүй** — вэб нь ажлын байран дээр нээлттэй байдаг админ
самбар, 60 секундын polling хангалттай. Даалгаварт ч "mobile push байгаа учраас
browser push нэмэх хэрэггүй" гэж бичсэн.

---

## 7. Юу нь Apple APNs шаардах вэ

Зөвхөн **iOS push**. FCM ашигласан ч Apple-ийн зөвшөөрөл заавал хэрэгтэй:

- Apple Developer Program гишүүнчлэл (жилийн төлбөртэй)
- APNs Auth Key (`.p8`) — нэг түлхүүр бүх апп, бүх орчинд ажиллана (сертификатаас
  илүү тохиромжтой)
- Xcode дээр Push Notifications capability → `.entitlements` файл `aps-environment`-тэй
- `UIBackgroundModes: remote-notification`
- Bundle id бүр Apple дээр бүртгэлтэй байх

**Одоо байгаа саад**: `DEVELOPMENT_TEAM` тохируулаагүй, харилцагчийн аппын bundle
id нь `com.example.*` хэвээр. Эдгээрийг **сертификат үүсгэхийн өмнө** засах ёстой.

---

## 8. Юу нь firewall шаардах вэ

Одоогийн байдал `ufw` ашиглаж байна (`DEPLOYMENT_MONHORUS_PROD.md:442`).

**Push/email нэмэхэд ямар ч шинэ ORTOX порт нээх шаардлагагүй** — хоёулаа
backend-ээс гарах (outbound) холболт:
- SMTP → гадагш 587 (эсвэл 465)
- FCM → гадагш 443

`ufw` нь анхны байдлаараа outbound-ыг зөвшөөрдөг тул **өөрчлөлт хэрэггүй байх
магадлалтай**. Гэхдээ энэ серверийн `ufw` дүрмийн бүрэн жагсаалтыг би **харах
боломжгүй** — баримт бичигт зөвхөн 3020/3021 нэмсэн гэж бичсэн, бүтэн жагсаалт
хаана ч байхгүй.

**Одоо байгаа жинхэнэ эрсдэл** (push-тэй огт хамаагүй): backend нь `0.0.0.0:4000`
дээр сонсдог. `server.ts:60` дээр `app.listen(env.PORT)` гэж host аргументгүй
дуудсан. Өөрөөр хэлбэл **`ufw` унтарвал backend TLS-гүйгээр шууд интернэтэд
гарна**. `HOST` гэсэн хувьсагч `env.ts` дотор **огт байхгүй** тул үүнийг засахад
код өөрчлөх шаардлагатай.

**MongoDB нь loopback дээр** гэж баримтжуулсан (`DEPLOYMENT_MONHORUS_PROD.md:21`).
Docker огт байхгүй тул порт publish хийх асуудал үүсэхгүй. Гэхдээ энэ бол
**баримт бичиг, бодит шалгалт биш**. Батлах команд: `sudo ss -tlnp | grep -E ':4000|:27017'`.

⚠️ Энэ сервер дээр **өөр 4 сайт ажиллаж байна** (`itsystem.mn`, `test.itsystem.mn`,
`test1.itsystem.mn`, `wellcom.mn`). Firewall-ийн аливаа өөрчлөлт зөвхөн **нэмэлт**
байх ёстой. Дэлгэрэнгүйг `docs/production-firewall.md`-д тусад нь бичнэ (PHASE 10).

---

## 9. Юу нь домэйн/HTTPS шаардах вэ

Домэйн ба HTTPS аль хэдийн **байгаа**: `https://monhorus.itsystem.mn`, сертификат
2026-11-11 хүртэл, автомат сунгалттай.

Шинээр шаардагдах зүйл байхгүй. Гэхдээ:

| Зүйл | Байдал |
|---|---|
| `APP_WEB_BASE_URL` — сэргээх холбоос үүсгэдэг | **Тохируулаагүй** — сервер асахгүй |
| `CORS_ORIGINS` | Production guard байхгүй — гараар шалгах ёстой |
| Вэб `VITE_API_BASE_URL` | `.env.production`-д зөв бичигдсэн ✅ |
| Гар утасны API хаяг | `--dart-define` заавал өгөх ёстой |
| `:3020` / `:3021` | TLS-гүй хэвээр, хуучин APK-д зориулж зориуд нээлттэй |

iOS push нь HTTPS-ийг шууд шаарддаггүй, гэхдээ ATS нь HTTP руу хандахыг хориглодог
тул апп аль хэдий HTTPS хэрэглэх ёстой.

---

## 10. Юу нь мөнгө шаардах вэ

Би энд **зөвхөн бодит үнийн загварыг** бичнэ. Тодорхой тоо нь өөрчлөгддөг тул
эцсийн үнийг PHASE 15-д тусад нь гаргана.

| Зүйл | Загвар | Тайлбар |
|---|---|---|
| Домэйн `itsystem.mn` | Жилийн | Аль хэдийн төлсөн |
| Сервер `103.87.255.221` | Сарын | Аль хэдийн төлсөн, 4 сайт хуваалцаж байна |
| Let's Encrypt TLS | **Үнэгүй** | Аль хэдийн ажиллаж байна |
| **Apple Developer Program** | **Жилийн төлбөр** | iOS push хийхэд **гарцаагүй** |
| Firebase FCM | **Үнэгүй** | Spark plan дээр push хязгааргүй |
| Google Play Console | Нэг удаагийн | iOS-той адилгүй, аль хэдийн төлсөн байх магадлалтай |
| SMTP (өөрийн сервер) | **Үнэгүй** | `itsystem.mn` дээр байгаа бол |
| SMTP (Gmail App Password) | **Үнэгүй** | Өдөрт ~500 хязгаартай |
| Transactional provider | Хэрэглээгээр | Бага хэмжээнд ихэвчлэн үнэгүй давхарга байдаг |
| ufw | **Үнэгүй** | Ubuntu дотор багтсан |
| Cloudflare | **Үнэгүй давхарга хангалттай** | Одоогоор ашиглаагүй |

**Чухал**: "$1 firewall" гэх мэт зүйл энд **шаардлагагүй**. `ufw` нь үнэгүй бөгөөд
аль хэдийн ажиллаж байна.

**Дүгнэлт**: push-ийг зөвхөн Android дээр хийвэл **нэмэлт зардал 0**. iOS нэмэх
үед л Apple Developer Program-ын жилийн төлбөр гарна.

---

## 11. Юу нь үнэгүй байж болох вэ

- FCM push (Android + iOS хоёулаа) — Firebase Spark plan
- Let's Encrypt TLS + автомат сунгалт
- `ufw` firewall
- Апп доторх мэдэгдэл (аль хэдийн ажиллаж байна)
- SMTP хэрэв `itsystem.mn` дээрх мэйл серверийг ашиглавал
- Cloudflare үнэгүй давхарга (хэрэв нэмэхээр шийдвэл)

---

## 12. Ямар нууц/эрх шаардагдах вэ

**Одоогоор git дотор ямар ч нууц байхгүй.** Би бүх салбарын түүхийг шалгасан:
`git log --all --diff-filter=A --name-only` — зөвхөн `.env.example` × 2 ба
`apps/web/.env.production` гарч ирсэн. Сүүлийнх нь **зориудаар** commit хийгдсэн
бөгөөд зөвхөн нийтийн API хаяг агуулдаг (Vite бүх `VITE_*`-ыг browser bundle руу
шууд оруулдаг тул нууц байх боломжгүй).

### Шинээр хэрэгтэй болох нууцууд

| Нууц | Хаана хадгалах | Тэмдэглэл |
|---|---|---|
| `SMTP_PASS` (эсвэл Gmail App Password) | `/etc/monhorus/backend.env` | 0640 root:monhorus |
| `FIREBASE_PRIVATE_KEY` | `/etc/monhorus/backend.env` | `\n` escape болгох шаардлагатай |
| `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PROJECT_ID` | мөн тэнд | Нууц биш ч тохиргоо |
| APNs `.p8` түлхүүр | Firebase Console руу upload | **Git-д хэзээ ч оруулахгүй** |
| `google-services.json` × 2 | Апп доторх | Нууц биш ч git-д оруулахгүй нь зүйтэй |
| `GoogleService-Info.plist` × 2 | Апп доторх | Мөн адил |

### ⚠️ `.gitignore` дээрх цоорхой

Одоогийн `.gitignore` нь `.env`, `*.jks`, `key.properties`-ыг сайн хамгаалдаг
(`:45-55`, `:104-106`). Гэхдээ дараах загварууд **байхгүй**:

```
google-services.json
GoogleService-Info.plist
*.p8
*.p12
serviceAccount*.json
```

Одоо эдгээр файл repo дотор нэг ч байхгүй тул асуудал үүсээгүй. Гэхдээ Firebase
ажил эхлэх мөчид **нэг ч зүйл тэднийг commit хийхээс сэргийлэхгүй**. Push хийхээр
шийдвэл энэ мөрүүдийг **эхний алхам болгож** нэмэх ёстой.

### Одоо байгаа жижиг эрсдэл

`apps/backend/.env` (git-д ороогүй, зөв) дотор `BOOTSTRAP_ADMIN_PASSWORD` нь
жинхэнэ утгатай хэвээр байна. Төслийн өөрийн баримт бичиг үүнийг bootstrap хийсний
дараа устгахыг зөвлөсөн (`.env.example:44`).

---

## 13. Шийдэх шаардлагатай асуултууд

Эдгээрийг шийдэхгүйгээр PHASE 3+ рүү орох нь таамаглал дээр код бичих болно.

1. **Push-ийг батлах уу?** `NOTIFICATION_CHANNEL_UNAPPROVED_NOTE` нь хэрэглэгчид
   "зөвхөн апп дотор" гэж амласан. Push нэмбэл энэ текст, вэб дэх Alert, мөн
   харилцагчийн аппын `customer_profile_screen.dart:110` дээрх текстийг хамт
   өөрчлөх ёстой.
2. **Аль мэйл сервер?** `itsystem.mn`-ий одоо байгаа сервер / Gmail App Password /
   transactional provider.
3. **iOS push хэрэгтэй юу?** Хэрэггүй бол Apple Developer төлбөр, bundle id засвар,
   APNs түлхүүр — бүгд шаардлагагүй болно. Android-only push нь 0 зардлаар боломжтой.
4. **Харилцагчийн аппын iOS bundle id-г юу болгох вэ?** `com.example.*` хэвээр
   үлдэж болохгүй. Санал: `mn.monhorus.monhorusMobile` (ажилтны аппын хэв маягтай
   нийцүүлэх).
5. **Илгээгчгүй 6 эвентийг яах вэ?** Хэрэгжүүлэх үү, эсвэл enum-аас хасах уу.
6. **Хугацаа хэтэрсэн төлөвлөгөөт ажлын мэдэгдлийг нэмэх үү?** Логик нь бэлэн,
   зөвхөн `notify` дуудлага дутуу.

---

## 14. Санал болгож буй дараалал

Push/email-ээс үл хамааран **эхлээд хийх ёстой** зүйлс:

1. `APP_WEB_BASE_URL=https://monhorus.itsystem.mn` тохируулах — эс бөгөөс шинэ код
   байршуулмагц сервер асахгүй.
2. `.gitignore`-д Firebase/Apple нууцын загварууд нэмэх — Firebase ажил эхлэхээс өмнө.
3. Мэйл серверийг шийдэж, SPF/DKIM тохируулах.
4. Dev лог fallback-ийн redaction алдааг засах.
5. Вэб дээрх уншаагүйн тоог `/unread-count`-аас авдаг болгох.

Үүний дараа push (хэрэв батлагдвал):

6. Bundle id-нуудыг эцэслэх → Firebase төсөл + 4 апп → `.gitignore` эхлээд.
7. Backend: төхөөрөмжийн token модель + бүртгэх/устгах endpoint.
8. Апп бүр дээр FCM + зөвшөөрөл + `navigatorKey` + `linkPath` маршрутлалт.
9. Суваг бүрийн бодлогын матриц (PHASE 9).

---

## Хавсралт — шалгасан аргачлал

Энэ тайлан 5 зэрэгцээ аудитын үр дүн дээр үндэслэсэн (backend, web, ажилтны апп,
харилцагчийн апп, дэд бүтэц). Дараах гол баталгаануудыг би **өөрөө дахин шалгасан**,
учир нь агентын тайлан заримдаа итгэлтэй боловч буруу байдаг:

- Firebase/APNs файл байхгүй — `find` бүх апп дээр
- Хоёр pubspec дээр firebase dependency байхгүй — `grep`
- `git ls-files` дээр нууц файл байхгүй
- `env.ts:133-153` production guard — эх код уншсан
- `logger.ts` redaction нь `body`-г устгадаг — эх код уншсан
- `notification.model.ts` дээр tenant талбар байхгүй — `grep -c` = 0
- Бүх унших үйлдэл `recipient`-аар хязгаарлагдсан — 5 мөр бүгд шалгасан
- Bundle id-нууд — `project.pbxproj` ба `build.gradle.kts`
- Эвентийн зөрүү (17 vs 18) — хоёр жагсаалтыг `comm`-оор харьцуулсан
