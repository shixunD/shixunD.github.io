// Detects when a newer deployment of the site is available (GitHub Pages
// caching means the browser often keeps serving a stale copy) and prompts
// the user to reload. Include on every page with `window.__SITE_ROOT__`
// set to the relative path back to the repo root (e.g. './' or '../').
(function () {
    var ROOT = window.__SITE_ROOT__ || './';
    var ASSETS = ['index.html', 'reader/chapter.html', 'reader/reader.js', 'reader/styles.css'];
    var STORAGE_KEY = 'site_version_fingerprint';
    var SKIP_KEY = 'site_version_skip';
    var CHECK_INTERVAL_MS = 5 * 60 * 1000;

    async function fetchFingerprint() {
        var parts = await Promise.all(ASSETS.map(async function (path) {
            try {
                var res = await fetch(ROOT + path, { cache: 'no-store', method: 'HEAD' });
                if (!res.ok) return '';
                return res.headers.get('etag') || res.headers.get('last-modified') || '';
            } catch (e) {
                return '';
            }
        }));
        return parts.join('|');
    }

    function forceReload() {
        var url = new URL(location.href);
        url.searchParams.set('_v', Date.now().toString(36));
        location.replace(url.toString());
    }

    function ensureStyles() {
        if (document.getElementById('version-check-styles')) return;
        var style = document.createElement('style');
        style.id = 'version-check-styles';
        style.textContent = [
            '.vc-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);',
            'display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;}',
            '.vc-dialog{background:#fff;border-radius:12px;max-width:360px;width:100%;',
            'padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
            '.vc-dialog h3{margin:0 0 10px;color:#333;font-size:1.2em;}',
            '.vc-dialog p{margin:0 0 16px;color:#555;font-size:0.95em;line-height:1.5;}',
            '.vc-checkbox{display:flex;align-items:center;gap:8px;margin-bottom:18px;color:#555;font-size:0.88em;cursor:pointer;}',
            '.vc-actions{display:flex;justify-content:flex-end;gap:10px;}',
            '.vc-btn{padding:8px 16px;border:none;border-radius:6px;font-size:0.9em;cursor:pointer;}',
            '.vc-btn-cancel{background:#eee;color:#333;}',
            '.vc-btn-cancel:hover{background:#e0e0e0;}',
            '.vc-btn-confirm{background:#667eea;color:#fff;}',
            '.vc-btn-confirm:hover{background:#5568d3;}'
        ].join('');
        document.head.appendChild(style);
    }

    function showUpdateDialog(newFingerprint) {
        if (document.querySelector('.vc-overlay')) return;
        ensureStyles();

        var overlay = document.createElement('div');
        overlay.className = 'vc-overlay';
        overlay.innerHTML =
            '<div class="vc-dialog">' +
            '<h3>发现新版本</h3>' +
            '<p>网站内容已更新，是否立即刷新以加载最新版本？</p>' +
            '<label class="vc-checkbox"><input type="checkbox" id="vc-skip-checkbox">本版本不再提示</label>' +
            '<div class="vc-actions">' +
            '<button class="vc-btn vc-btn-cancel" id="vc-cancel-btn">取消</button>' +
            '<button class="vc-btn vc-btn-confirm" id="vc-confirm-btn">立即更新</button>' +
            '</div></div>';
        document.body.appendChild(overlay);

        overlay.querySelector('#vc-confirm-btn').addEventListener('click', function () {
            localStorage.setItem(STORAGE_KEY, newFingerprint);
            forceReload();
        });

        overlay.querySelector('#vc-cancel-btn').addEventListener('click', function () {
            var skip = overlay.querySelector('#vc-skip-checkbox').checked;
            if (skip) {
                localStorage.setItem(SKIP_KEY, newFingerprint);
                localStorage.setItem(STORAGE_KEY, newFingerprint);
            }
            overlay.remove();
        });
    }

    async function checkForUpdate() {
        var fingerprint = await fetchFingerprint();
        if (!fingerprint.replace(/\|/g, '')) return;

        var stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            localStorage.setItem(STORAGE_KEY, fingerprint);
            return;
        }
        if (stored === fingerprint) return;

        var skipped = localStorage.getItem(SKIP_KEY);
        if (skipped === fingerprint) {
            localStorage.setItem(STORAGE_KEY, fingerprint);
            return;
        }

        showUpdateDialog(fingerprint);
    }

    function init() {
        checkForUpdate();
        setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
