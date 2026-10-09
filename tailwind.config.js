/** @type {import('tailwindcss').Config} */
const colors = {
  // 单一强调色（蓝紫）+ 三种状态色，深色为主 —— 见第 1 份 §8
  accent: {
    DEFAULT: '#7c6cf2',
    hover: '#8d7ef5',
    down: '#6a5ae0',
    soft: 'rgba(124, 108, 242, 0.14)'
  },
  ok: '#3fb27f',
  warn: '#d9a13b',
  bad: '#e0576b',
  ink: {
    900: '#101014',
    850: '#15151b',
    800: '#1a1a22',
    750: '#20202a',
    700: '#282833',
    600: '#35353f',
    500: '#4a4a56',
    400: '#6b6b78',
    300: '#9494a1',
    200: '#c2c2cc',
    100: '#e8e8ee'
  }
}

module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}', './resources/lexicon/**/*.json'],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily: {
        // 中日文都不缺字的系统字体栈
        sans: ['"Microsoft YaHei UI"', '"Meiryo UI"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Cascadia Mono"', 'Consolas', '"Courier New"', 'monospace']
      },
      borderRadius: { card: '10px' },
      boxShadow: {
        panel: '0 8px 28px rgba(0,0,0,0.45)',
        overlay: '0 12px 40px rgba(0,0,0,0.6)'
      }
    }
  },
  plugins: []
}
