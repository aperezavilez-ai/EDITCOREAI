const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  const html = `<!DOCTYPE html>
<html>
<head>
  <script>
    (function() {
      var _origDocAdd = document.addEventListener;
      document.addEventListener = function(type, fn, opts) {
        if (type === 'DOMContentLoaded' && (document.readyState === 'interactive' || document.readyState === 'complete')) {
          setTimeout(fn, 1);
          return;
        }
        return _origDocAdd.call(document, type, fn, opts);
      };
      var _origWinAdd = window.addEventListener;
      window.addEventListener = function(type, fn, opts) {
        if (type === 'load' && document.readyState === 'complete') {
          setTimeout(fn, 1);
          return;
        }
        return _origWinAdd.call(window, type, fn, opts);
      };
    })();
  </script>
</head>
<body>
  <h1>Test ReadyState</h1>
  <div id="out">EMPTY</div>
  <script>
    // Simulate dynamically executed script or late attached listener
    setTimeout(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('out').textContent = 'FIRED!';
      });
    }, 100);
  </script>
</body>
</html>`;

  await page.setContent(html);
  await new Promise(r => setTimeout(r, 600));

  const text = await page.$eval('#out', el => el.textContent);
  console.log("OUT RESULT WITH SHIM:", text);

  await browser.close();
})();
