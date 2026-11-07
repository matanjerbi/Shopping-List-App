# סל חכם — Smart Basket

אפליקציית ווב (PWA) לקניות בסופר: מבצעים חריגים על המוצרים שאתה קונה, חלופות זולות ממותגים אחרים, סריקת קבלות, השוואת סל, בדיקת חיובי יתר ורשימות קניות משותפות.

**האפליקציה:** https://matanjerbi.github.io/Shopping-List-App/ — באייפון: שיתוף ← "הוסף למסך הבית". באנדרואיד: תפריט ← "התקן אפליקציה".

## מבנה

| תיקייה | מה יש בה |
|---|---|
| `pipeline/` | Python. מוריד כל יום את קבצי המחירים, המבצעים והסניפים של כל הרשתות (חוק שקיפות המחירים, דרך `il-supermarket-scraper`) לסניפים בערים שב-`config.json`, מסווג מוצרים לקטגוריות ושומר היסטוריית מחירים של 90 יום |
| `web/` | האפליקציה (Preact + htm, בלי build). `js/engine.js` הוא מנוע המבצעים, ההשוואות וניתוח הקבלות |
| `worker/` | Cloudflare Worker + D1: רשימות משותפות ופרופילים להתראות |
| `notify/` | שולח התראות Web Push אחרי כל ריצת נתונים, עם אותו מנוע מבצעים |
| `.github/workflows/site.yml` | פריסה ל-Pages, ריצת נתונים פעמיים ביום (06:00 ו-16:00) ופריסת ה-Worker |

## הגדרה חד־פעמית

ב-Settings → Secrets and variables → Actions צריך להוסיף:
- `CLOUDFLARE_API_TOKEN`: טוקן עם הרשאות Workers Scripts:Edit ו-D1:Edit
- `CLOUDFLARE_ACCOUNT_ID`

מהם נגזרים אוטומטית מפתח ה-VAPID להתראות והטוקן בין הצינור לשרת, כך שלא צריך secrets נוספים.

כדי להוסיף ערים, ערוך את `pipeline/config.json`. כדי לרענן נתונים ידנית: Actions → Build & deploy → Run workflow.

## בדיקות
```
python pipeline/tests/test_pipeline.py
cd web && npm test
cd worker && npm ci && npm test
```
