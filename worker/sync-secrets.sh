#!/bin/sh
# רץ בזמן הבנייה ב-Cloudflare (Workers Builds). מפתח שהוגדר כ-Build secret זמין רק בזמן הבנייה,
# לכן מעבירים אותו כאן לסוד של השרת עצמו. הערך לא מודפס ללוג. אם אין מפתח, לא עושים כלום.
if [ -n "$ANTHROPIC_API_KEY" ]; then
  printf '%s' "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY --name books >/dev/null 2>&1 \
    && echo "ANTHROPIC_API_KEY copied to the worker's runtime secrets" \
    || echo "Could not copy ANTHROPIC_API_KEY (continuing)"
else
  echo "No ANTHROPIC_API_KEY build variable; skipping"
fi
exit 0
