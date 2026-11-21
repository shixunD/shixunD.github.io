// nameSearch.js —— 名字拼音定位：一个窄输入框，输入拼音字母或汉字（含语音输入），把读音对得上的学生用金黄色闪框标出来
// 全局命名空间：window.NameSearch
// 用在：学生趋势顶部选择器（「📝 作业趋势…」右边）、作业 / 背诵 / 考试详情的「编辑」按钮左边
// 规则：
//   输入和学生姓名都换成无声调拼音（汉字查 scripts/vendor/pinyinData.js，离线可用），只留 a–z，不分大小写；
//   只比读音不比汉字：输入的拼音是姓名完整拼音的开头就算匹配（L / LI / 李 都能对上 李四、里乌；LIW / 礼物 / 李武 只对上 里乌）。
//   多音字每个读音都试（曾 = zeng / ceng）；ü 当 u，所以 lv、lu 都能对上 吕。
//   每加一个或删一个字就重新匹配；匹配上的闪 5 下（和跳转定位学生同一个效果），之后留一个静止的框，直到输入变了或清空。
//   页面重绘（改状态、换作业等）后保留输入，框照样标出来；Esc 清空，Enter 依次跳到下一个匹配的学生。

(function () {
    'use strict';

    let table = null;          // 字 -> [无调读音]，第一次用时从 PinyinData 建
    const queries = {};        // 每个位置（key）各自记住输入，页面重绘后恢复
    const MAX_NAME_FORMS = 64; // 一个名字最多展开这么多种读音组合（多音字很多时截断）

    function charTable() {
        if (table) return table;
        table = new Map();
        String(window.PinyinData || '').split('|').forEach((g) => {
            const i = g.indexOf(':');
            if (i < 1) return;
            const syl = g.slice(0, i);
            for (const ch of g.slice(i + 1)) {
                const list = table.get(ch);
                if (list) list.push(syl); else table.set(ch, [syl]);
            }
        });
        return table;
    }

    // 把文字拆成读音段：每个汉字一段（可能多个读音），连续的字母合成一段；其余（空格、标点、数字、查不到的字）都丢掉。
    // v 一律当 u（拼音输入习惯用 v 打 ü，表里 ü 记作 u）
    function segments(text) {
        const t = charTable();
        const out = [];
        let letters = '';
        const flush = () => { if (letters) { out.push([letters]); letters = ''; } };
        for (const ch of String(text || '').normalize('NFKC')) {
            if (/[a-z]/i.test(ch)) { letters += ch.toLowerCase().replace('v', 'u'); continue; }
            if (ch === 'ü' || ch === 'Ü') { letters += 'u'; continue; }
            const reads = t.get(ch);
            if (reads) { flush(); out.push(reads); }
        }
        flush();
        return out;
    }

    // 姓名的所有完整拼音写法（多音字展开）
    function nameForms(name) {
        let forms = [''];
        segments(name).forEach((alts) => {
            const next = [];
            for (const f of forms) {
                for (const a of alts) { if (next.length < MAX_NAME_FORMS) next.push(f + a); }
            }
            forms = next;
        });
        return forms.filter(Boolean);
    }

    // 输入（读音段）能不能拼成 s 从开头起的一段
    function prefixOf(segs, i, s, pos) {
        if (i === segs.length) return true;
        return segs[i].some((a) => s.startsWith(a, pos) && prefixOf(segs, i + 1, s, pos + a.length));
    }

    // query 的读音是不是 name 某种完整拼音的开头；query 里没有可用的字母 / 汉字时返回 false
    function matches(query, name) {
        const segs = typeof query === 'string' ? segments(query) : query;
        if (!segs.length) return false;
        return nameForms(name).some((s) => prefixOf(segs, 0, s, 0));
    }

    // 输入框 HTML。key 区分不同位置（各自记住输入）
    function html(key) {
        return `<span class="name-search" data-name-search="${key}">
            <input type="search" class="name-search-input" placeholder="拼音找人" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="next"
                title="输入拼音字母或汉字（可用语音输入），读音对得上的学生会闪金框；Enter 跳到下一个，Esc 清空">
            <span class="name-search-count" aria-live="polite"></span>
        </span>`;
    }

    // 绑定 html(key) 生成的输入框。opts：
    //   targets()  返回 [{ el, name }]：要匹配的元素和对应学生姓名（每次匹配时现取，页面局部变化也跟得上）
    //   block      滚到第一个匹配时的 scrollIntoView 位置，默认 'center'
    function bind(root, key, opts) {
        const wrap = root.querySelector(`[data-name-search="${key}"]`);
        if (!wrap) return;
        const input = wrap.querySelector('input');
        const countEl = wrap.querySelector('.name-search-count');
        const block = opts.block || 'center';
        let hits = [];
        let cursor = -1;

        const clearMarks = () => {
            root.querySelectorAll('.name-hit').forEach((el) => el.classList.remove('name-hit', 'flash-student'));
        };

        // flash：重新闪 5 下；scroll：滚到第一个匹配
        function apply(flash, scroll) {
            const q = input.value;
            queries[key] = q;
            clearMarks();
            const segs = segments(q);
            hits = segs.length ? opts.targets().filter((t) => t.el && matches(segs, t.name)).map((t) => t.el) : [];
            cursor = hits.length ? 0 : -1;
            hits.forEach((el) => {
                el.classList.add('name-hit');
                if (flash) {
                    void el.offsetWidth;   // 让动画从头再闪一遍
                    el.classList.add('flash-student');
                }
            });
            countEl.textContent = segs.length ? (hits.length ? `${hits.length}人` : '无') : '';
            wrap.classList.toggle('no-hit', !!segs.length && !hits.length);
            if (scroll && hits.length) hits[0].scrollIntoView({ block });
        }

        input.addEventListener('input', () => apply(true, true));
        input.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                e.stopPropagation();
                input.value = '';
                apply(false, false);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (!hits.length) return;
                cursor = (cursor + 1) % hits.length;
                const el = hits[cursor];
                el.scrollIntoView({ block });
                el.classList.remove('flash-student');
                void el.offsetWidth;
                el.classList.add('flash-student');
            }
        });

        // 页面重绘后恢复上次的输入：只标静止的框，不闪不滚
        if (queries[key]) {
            input.value = queries[key];
            apply(false, false);
        }
    }

    window.NameSearch = { html, bind, matches, segments, nameForms };
})();
