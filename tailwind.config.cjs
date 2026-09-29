// Tailwind: נבנה מראש ע"י tools/build.mjs (לא בזמן ריצה בדפדפן)
module.exports = Object.assign({
      theme: {
        extend: {
          colors: {
            bg: 'var(--bg)', surface: 'var(--surface)', surface2: 'var(--surface-2)',
            ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)',
            accent: 'var(--accent)', accentInk: 'var(--accent-ink)', accentSoft: 'var(--accent-soft)',
            brass: 'var(--brass)', rose: 'var(--rose)', teal: 'var(--teal)', danger: 'var(--danger)', ok: 'var(--ok)', warn: 'var(--warn)'
          },
          fontFamily: {
            display: ['var(--font)'],
            body: ['var(--font)']
          }
        }
      }
    }, { content: ['./src/**/*.{jsx,html}'] });
