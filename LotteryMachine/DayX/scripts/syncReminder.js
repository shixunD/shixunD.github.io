// Reminds the user to sync after local data changes stay unuploaded for a while.
const SyncReminder = {
    mutationKey: 'syncReminderLastMutationAt',
    uploadKey: 'syncReminderLastUploadAt',
    snoozeKey: 'syncReminderSnoozedUntil',
    timerId: null,
    modal: null,
    escapeHandler: null,

    init() {
        this.schedule();
    },

    isEnabled() {
        return AppState.syncReminderEnabled !== false;
    },

    getIntervalMs() {
        const seconds = parseInt(AppState.syncReminderIntervalSeconds, 10);
        return Math.max(1, isNaN(seconds) ? 300 : seconds) * 1000;
    },

    getTime(key) {
        const value = parseInt(localStorage.getItem(key) || '0', 10);
        return isNaN(value) ? 0 : value;
    },

    hasPendingChanges() {
        return this.getTime(this.mutationKey) > this.getTime(this.uploadKey);
    },

    recordMutation() {
        localStorage.setItem(this.mutationKey, Date.now().toString());
        localStorage.removeItem(this.snoozeKey);
        this.schedule();
    },

    recordUpload() {
        localStorage.setItem(this.uploadKey, Date.now().toString());
        localStorage.removeItem(this.snoozeKey);
        this.dismiss(false);
        this.schedule();
    },

    onSettingsChanged() {
        this.dismiss(false);
        this.schedule();
    },

    schedule() {
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }

        if (!this.isEnabled() || !this.hasPendingChanges()) {
            return;
        }

        const mutationDueAt = this.getTime(this.mutationKey) + this.getIntervalMs();
        const snoozedUntil = this.getTime(this.snoozeKey);
        const dueAt = Math.max(mutationDueAt, snoozedUntil);
        const delay = dueAt - Date.now();

        if (delay <= 0) {
            this.show();
            return;
        }

        this.timerId = setTimeout(() => this.show(), delay);
    },

    show() {
        if (!this.isEnabled() || !this.hasPendingChanges() || this.modal) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'sync-reminder-overlay';
        overlay.innerHTML = `
            <div class="sync-reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-reminder-title">
                <div class="sync-reminder-title" id="sync-reminder-title">同步提醒</div>
                <div class="sync-reminder-text">本地数据已有一段时间未上传，是否现在同步到 OneDrive？</div>
                <div class="sync-reminder-actions">
                    <button class="sync-reminder-confirm" type="button">确认</button>
                    <button class="sync-reminder-cancel" type="button">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modal = overlay;

        overlay.querySelector('.sync-reminder-confirm').addEventListener('click', () => this.confirmSync());
        overlay.querySelector('.sync-reminder-cancel').addEventListener('click', () => this.dismiss(true));

        this.escapeHandler = (event) => {
            if (event.key === 'Escape') {
                this.dismiss(true);
            }
        };

        document.addEventListener('keydown', this.escapeHandler);
    },

    async confirmSync() {
        this.dismiss(false);

        if (typeof InputPage === 'undefined' || !InputPage.syncToOneDrive) {
            this.snooze();
            return;
        }

        await InputPage.syncToOneDrive();

        if (this.hasPendingChanges()) {
            this.snooze();
        }
    },

    snooze() {
        localStorage.setItem(this.snoozeKey, (Date.now() + this.getIntervalMs()).toString());
        this.schedule();
    },

    dismiss(shouldSnooze) {
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }

        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }

        if (shouldSnooze) {
            this.snooze();
        }
    },

    installApiHooks(api) {
        if (!api || api.__syncReminderHooksInstalled) {
            return;
        }

        const mutationMethods = [
            'addWordToDate',
            'deleteWord',
            'updateWordsOrder',
            'updateWordColor',
            'updateWordText',
            'updateReviewCount',
            'deleteAllData',
            'importData'
        ];

        mutationMethods.forEach(methodName => {
            const original = api[methodName];
            if (typeof original !== 'function') {
                return;
            }

            api[methodName] = async function (...args) {
                const result = await original.apply(this, args);
                SyncReminder.recordMutation(methodName);
                return result;
            };
        });

        const originalUpload = api.uploadBackupToOneDrive;
        if (typeof originalUpload === 'function') {
            api.uploadBackupToOneDrive = async function (...args) {
                const result = await originalUpload.apply(this, args);
                SyncReminder.recordUpload();
                return result;
            };
        }

        api.__syncReminderHooksInstalled = true;
    }
};

window.SyncReminder = SyncReminder;
