// shortcutUtil.js —— 键盘快捷键组合的标准化与匹配（支持 Ctrl/Alt/Shift/Meta + 单键的组合）
// 全局命名空间：window.ShortcutUtil

(function () {
    'use strict';

    const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

    // 把 KeyboardEvent 转成标准化字符串，如 "Ctrl+Shift+T"、"PageUp"。
    // 单独按下修饰键时返回 null，交给调用方继续等待下一次按键（组合键的最后一下必须是非修饰键）。
    function formatFromEvent(e) {
        if (MODIFIER_KEYS.has(e.key)) return null;
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        return parts.join('+');
    }

    function matches(e, combo) {
        if (!combo) return false;
        return formatFromEvent(e) === combo;
    }

    window.ShortcutUtil = { formatFromEvent, matches };
})();
