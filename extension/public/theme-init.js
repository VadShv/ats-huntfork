/**
 * theme-init.js — применение темы синхронно, до монтирования Vue.
 * Вынесен из inline <script> в index.html из-за MV3 CSP (script-src 'self').
 * Размещён в public/ — копируется в output как статический ресурс.
 */
;(function () {
  try {
    var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    chrome.storage.local.get('theme', function (res) {
      var t = res && res.theme ? res.theme : (sysDark ? 'dark' : 'light')
      var el = document.documentElement
      el.classList.toggle('dark', t === 'dark')
      el.classList.toggle('light', t !== 'dark')
    })
  } catch (e) {
    var sysDark2 = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', !!sysDark2)
    document.documentElement.classList.toggle('light', !sysDark2)
  }
})()
