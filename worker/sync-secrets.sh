#!/bin/sh
# רץ בזמן הבנייה ב-Cloudflare (Workers Builds). סודות שהוגדרו כ-Build secrets זמינים רק בזמן הבנייה,
# לכן מעבירים אותם כאן לסודות של השרת עצמו. הערכים לא מודפסים ללוג. סוד שלא הוגדר מדולג.
copy() {
  name="$1"; value="$2"
  if [ -n "$value" ]; then
    printf '%s' "$value" | npx wrangler secret put "$name" --name books >/dev/null 2>&1 \
      && echo "$name copied to the worker's runtime secrets" \
      || echo "Could not copy $name (continuing)"
  else
    echo "No $name build variable; skipping"
  fi
}
copy ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
copy GOOGLE_BOOKS_KEY "$GOOGLE_BOOKS_KEY"
exit 0
