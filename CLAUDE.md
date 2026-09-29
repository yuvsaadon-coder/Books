# מה שנקרא — הקשר לסשן חדש של Claude Code

קובץ העברה: מה שסשן חדש צריך לדעת כדי להמשיך את העבודה בלי להתחיל מאפס.

## העבודה עם המשתמש
- עונים בעברית, מיושר לימין (`<div dir="rtl" align="right">`).
- מה שאפשר לפתור בקוד, פותרים לבד. שואלים רק על הרשאות, חיובים או משהו שקשור ליציבות.
- לא מכניסים מפתחות API לקוד (המאגר ציבורי). מפתחות נשמרים רק כסודות ב-Cloudflare.
- עובדים על הענף `claude/hebrew-book-tracker-engine-afipw8`. לא פותחים PR בלי בקשה מפורשת.
- אחרי כל שינוי: `npm run build`, בדיקות, commit, push, ובדיקה שה-CI עבר.

## מה יש כאן
- **האפליקציה:** `src/app.jsx` (React, קובץ אחד), `src/starter-books.js` (400 ספרי היכרות ב-15 ז'אנרים), `src/index.template.html` (שלד, צבעים, CSS).
- **`index.html` נבנה** (`npm run build` → `tools/build.mjs`). לא עורכים אותו ידנית. ה-CI בודק שהוא תואם למקור.
- **פרסום:** GitHub Pages — https://yuvsaadon-coder.github.io/Books/ . אפליקציה ניתנת להתקנה (`manifest.webmanifest`, `sw.js`, `icons/`).
- **בכל שחרור:** להעלות `APP_VERSION` ב-`src/app.jsx` ואת `CACHE` ב-`sw.js` (למשל v22 → v23). הגרסה מוצגת בתחתית מסך ההגדרות.
- **אייקונים:** עורכים את ה-SVG ב-`icons/`, ואז מריצים `node tools/icons.mjs`.

## השרת (Cloudflare Worker `books`)
`worker/worker.js`, כתובת https://books.yuvsaadon.workers.dev . Workers Builds מפרסם אותו אוטומטית בכל push, לפי `wrangler.jsonc` שבשורש.

**סודות:**
- `ANTHROPIC_API_KEY`, `GOOGLE_BOOKS_KEY`, `NLI_API_KEY` מוגדרים כ-Build secrets.
- `worker/sync-secrets.sh` מעתיק אותם לסודות של השרת בכל פרסום.

**תשתית:**
- KV בשם `LIBRARY`.
- Durable Object בשם `AiJob` (משתנה `JOBS`) לעבודות רקע.

**נקודות קצה:**
| כתובת | תפקיד |
|---|---|
| `/ping` | מה מוגדר בשרת |
| `/sync` | סנכרון כל המשתמשים והספרים (כולל `social` של חברים) |
| `/v1/messages` | Claude (מודלים מותרים ב-`ALLOWED_MODELS`) |
| `/jobs`, `/jobs/:id` | המלצה שרצה בשרת גם כשהטלפון כבוי |
| `/gbooks` | Google Books עם מפתח ומטמון |
| `/nli` | הספרייה הלאומית |
| `/stores` | חיפוש בחנויות ובהוצאות |
| `/bookinfo` | זמינות ותקציר, מטמון ל-4 ימים ב-KV |
| `/page` | אימות דף ספר |
| `/digest`, `/push/key`, `/push/subscribe` | ההצעות הדו-שבועיות והתראות (Web Push עם VAPID שנוצר ונשמר ב-KV) |

**Cron:** כל שעה (`triggers` ב-`wrangler.jsonc`), הפונקציה `runDigests` בודקת למי הגיע הזמן לקבל 10 ספרים חדשים (כל 14 יום; משתמש חדש יום אחרי שנוצר).

## ההמלצות (הלוגיקה המרכזית)
- **שאלון משולב:** בקשה חופשית + מיקוד (`FOCUS`), ואז 2–4 שאלות המשך (`aiClarify`).
- **ההמלצה עצמה:** `recRequest` → עבודת רקע בשרת. בלי חיפוש ברשת. Claude מציע 8 ספרים.
  - המודל מקבל את הפרופיל הספרותי (`litProfile`) ורק את הספרים שהשתנו מאז, לא את כל הספרייה.
- **אימות:** `verifyRec`, במקביל לכל ההצעות, עם תקרה של 30 שניות לספר.
  - סדר הבדיקה: Google Books + הספרייה הלאומית + ISBN → Open Library → חנויות (רק לשם עברי).
  - מה שלא נמצא נפסל. מוצגים עד 5 ספרים.
- **השלמה:** `enrichRec` → `/bookinfo`, מביא זמינות, קישורים ותקציר עברי מהמקור.
- **מודלים:**
  - Sonnet 4.6 (`AI_MODEL`) להמלצה, לזיהוי החכם ולפרטי ספר.
  - Haiku 4.5 (`FAST_MODEL`, `fast: true`) לשאלות המשך, לפרופיל, לחילוץ ספרים מטקסט ולתרגום.

## ממשק ופנייה
- **לשון פנייה:** טקסטים בממשק נכתבים ברבים ועוברים דרך `T()`, שמחליפה מילים לפי `PLURAL_FORMS`/`MASC_FORMS` לפי `settings.address`. במשפט שלא מתאים להחלפת מילים, `gx(m, f, n)`. טקסט חדש שפונה למשתמש צריך `T()` ומילה חדשה במילון.
- **עברית בלבד:** כש-`recLang` הוא he או auto, `finishRecs`, `verifyRec(r, heOnly)` ו-`buildCandidates` מקבלים רק מהדורה עברית או ישראלית (`isHebrewOrIsraeli`). כך גם בהצעות הדו-שבועיות בשרת.
- **סיכום דו-שבועי (Wrapped):** `summaryStats`/`SummaryStory`, מחושב במכשיר ובלי AI. נפתח מההתראה (`?view=summary`), מהבאנר או מהסטטיסטיקות.
- **מצב מתנה:** `st.gift` → `recRequest` בלי הטעם של המשתמש. ספר שנשמר מקבל את התגית 'מתנה', ולא נכנס לפרופיל.
- **"מה האפליקציה יודעת עליי":** `KnowsAboutMe`. מחיקות נשמרות ב-`tombstones.misc`, כדי שהסנכרון לא יחזיר אותן.
- **ייבוא וייצוא:** `readImportRows` (Goodreads, StoryGraph, CSV כללי) ו-`toGoodreadsCSV`. מה שלא אומת עובר לתור של "הוספה ← רשימה".

- **עיצוב:** `PageHero` (אריח צבעוני לכל מסך), `SettingsGroup` (קבוצות בהגדרות), `ChatLog` (הודעות התקדמות מקובצות), `SyncDot` (חיווי סנכרון), `MySummaryCard` (כרטיס קבוע לסיכום בספרייה). צילומי מסך: `SHOTS=<תיקייה> node e2e.mjs`.
- **חנויות:** `STORE_SEARCH` — דפי החיפוש האמיתיים: סטימצקי `catalogsearch/result/?q=`, צומת ספרים `/חיפוש?q=`, עברית `/Search/<שם>`.
- **ביקורות:** `findReviews` בשרת — Haiku עם חיפוש רק ב-`REVIEW_SITES`, סיכום בעברית, וכל קישור נבדק מול תוצאות החיפוש. "לא נמצא" נשמר רק ליומיים.
- **משוב:** `/feedback` שומר ב-KV תחת `app-feedback` (Cloudflare ← KV ← LIBRARY).
- **רשימת ההיכרות:** בכניסה הראשונה נפתחת בחלון מלא (`showStarter` ב-App). אחר כך `StarterPrompt` מוצג בראש "הספרים שלי" ו"הוספת ספר" עד "לא צריך יותר" או עד שהרשימה נגמרת (`settings.starterDone`, מסתנכרן). לא מופיעה בהגדרות.

## נתונים (לכל משתמש)
- **ספר:** `status` ('read' או 'want'), דירוג, תגיות, הערה.
- **שלילות:** `rejections` — לחודש או לתמיד, עם הערה.
- **פרופיל:** `litProfile` (הפרופיל הספרותי) ו-`profileNote` (הערה של המשתמש).
- **היסטוריה:** `history` של שיחות המלצה.
- **חברים:** `vrt-social`, משותף לכל המשתמשים, דרך הסנכרון. מה חברים רואים: `settings.share`.
- **ביקורת מהצ'אט:** `feedback` — נכנסת לפרופיל בזהירות (מצב רוח רגעי מול טעם קבוע).
- **הגדרות:** `settings.address` (לשון פנייה), `readAt` לכל ספר. מצב קורא אלקטרוני נשמר במכשיר (`vrt-eink`).
- **React והאייקונים** נארזים לתוך `index.html` בזמן הבנייה (בלי CDN).

## בדיקות
- מתקינים פעם אחת: `npm install` בשורש, ו-`cd tests && npm install`.
- מריצים: `cd tests && CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm test`.
- מה נבדק:
  - `starter.mjs` — רשימת הפתיחה: גודל, איזון ז'אנרים, כפילויות.
  - `worker.mjs` — בדיקות יחידה לשרת.
  - `e2e.mjs` — Playwright עם רשת מדומה: שני טלפונים, סנכרון, המלצות, חברים ועוד.
- `.github/workflows/test.yml` מריץ את כל זה בכל push.

## לא נבדק מול המערכות האמיתיות
סביבת הענן של Claude Code חוסמת את השרת ב-workers.dev ואת אתרי החנויות, ולכן אלה נבדקו רק מול תשובות מדומות:
- כתובות דפי החיפוש של סטימצקי וצומת ספרים (`STORE_SEARCH_URLS` ו-`ISBN_SEARCH_URLS`) הן ניחוש.
- מבנה התשובה של הספרייה הלאומית (`parseNli`).
- חיפוש ברשת דרך Haiku (`storeSearchViaClaude`).
- עבודות הרקע ב-Durable Object.

כדי לבדוק את אלה מסשן של Claude Code, צריך להוסיף את `books.yuvsaadon.workers.dev` לדומיינים המותרים בהגדרות הרשת של הסביבה.
