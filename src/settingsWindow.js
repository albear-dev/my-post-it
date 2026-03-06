/**
 * @file 설정 창 관리 + IPC
 *
 * 싱글턴 설정 창을 열고, 언어·백업 주기·태그·데이터 관련 IPC를 처리한다.
 */

const { BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

// ─── 설정 창 열기 ──────────────────────────────────────────────────────────

/**
 * 설정 창을 연다 (싱글턴).
 */
function openSettings() {
  if (state.settingsWindow && !state.settingsWindow.isDestroyed()) {
    state.settingsWindow.focus();
    return;
  }

  const swin = new BrowserWindow({
    width: 640, height: 520,
    resizable: true, minimizable: false, maximizable: false,
    minWidth: 520, minHeight: 400,
    title: i18n.t('window.settingsTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  swin.setMenuBarVisibility(false);
  swin.loadFile(path.join(__dirname, '..', 'settings.html'));

  swin.webContents.once('did-finish-load', () => {
    swin.webContents.send('set-translations', i18n.getAllTranslations());
    swin.webContents.send('init-settings', {
      locales: i18n.getAvailableLocales(),
      currentLocale: i18n.getLocale(),
      backupInterval: state.store ? (state.store.getSetting('backupInterval') ?? 60000) : 60000,
      appVersion: require('../package.json').version,
      categories: state.store ? state.store.getCategories() : [],
      titleBarConfig: state.store ? state.store.getSetting('titleBarConfig') : null,
      tagGroups: state.store ? extractTagGroups(state.store.getCategories()) : [],
    });
  });

  state.settingsWindow = swin;
  swin.on('closed', () => { state.settingsWindow = null; });
}

/**
 * 태그 목록에서 고유 그룹명을 추출한다.
 */
function extractTagGroups(cats) {
  const groups = new Set();
  (cats || []).forEach(c => {
    const idx = c.name.indexOf(':');
    if (idx > 0) groups.add(c.name.substring(0, idx));
  });
  return [...groups];
}

// ─── IPC 핸들러 ────────────────────────────────────────────────────────────

/**
 * 설정 관련 IPC 핸들러를 등록한다.
 */
function registerSettingsIpc() {
  const { setBackupInterval } = require('./history');

  /** 언어 변경 */
  ipcMain.on('settings-change-language', (_event, localeCode) => {
    i18n.switchLanguage(localeCode);
    // 설정 창도 번역 갱신
    if (state.settingsWindow && !state.settingsWindow.isDestroyed()) {
      state.settingsWindow.webContents.send('set-translations', i18n.getAllTranslations());
    }
  });

  /** 동기 확인 다이얼로그 (renderer의 confirm() 대체) */
  ipcMain.handle('dialog-confirm', async (_event, message) => {
    const { dialog } = require('electron');
    const win = BrowserWindow.fromWebContents(_event.sender);
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [i18n.t('dialog.ok'), i18n.t('dialog.cancel')],
      defaultId: 1,
      message,
    });
    return result.response === 0;
  });

  /** 백업 주기 변경 */
  ipcMain.on('settings-change-backup-interval', (_event, ms) => {
    setBackupInterval(ms);
  });

  /** 태그 저장 (인라인) — renames: { oldName: newName }, deletes: string[] */
  ipcMain.on('settings-save-categories', (_event, cats, renames, deletes) => {
    state.store.setCategories(cats);
    const { notifyManager } = require('./manager');
    const { markDirty } = require('./history');

    const renameKeys = renames ? Object.keys(renames) : [];
    const deleteSet = new Set(deletes || []);
    const needSync = renameKeys.length > 0 || deleteSet.size > 0;

    // 이름 변경 또는 삭제가 있으면 모든 포스트잇의 categories 갱신
    if (needSync) {
      const all = state.store.getAll();
      for (const p of all) {
        if (!Array.isArray(p.categories) || p.categories.length === 0) continue;
        const orig = [...p.categories];
        const updated = orig
          .filter(c => !deleteSet.has(c))
          .map(c => renames[c] || c);
        if (updated.length !== orig.length || updated.some((c, i) => c !== orig[i])) {
          state.store.update(p.id, { categories: updated });
        }
      }
    }

    notifyManager();
    markDirty();
    // 열린 모든 포스트잇에 태그 정의 변경 + 갱신된 categories 알림
    for (const [id, win] of state.windows.entries()) {
      if (!win.isDestroyed()) {
        const p = state.store.get(id);
        // globalCategories + 해당 포스트잇의 최신 categories를 한번에 전달
        win.webContents.send('categories-updated', cats, p ? p.categories : null);
      }
    }
  });

  /** 타이틀바 설정 저장 */
  ipcMain.on('settings-save-titlebar-config', (_event, config) => {
    state.store.setSetting('titleBarConfig', config);
    // 열린 모든 포스트잇에 설정 변경 알림
    for (const win of state.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('titlebar-config-changed', config);
      }
    }
  });

  /** 데이터 폴더 열기 */
  ipcMain.on('settings-open-data-folder', () => {
    if (state.store && state.store.dbPath) {
      shell.openPath(path.dirname(state.store.dbPath));
    }
  });

  /** 데이터 내보내기 */
  ipcMain.on('settings-export-data', () => {
    const { openExportPasswordDialog } = require('./dialogs');
    state.exportImportTarget = { mode: 'export' };
    openExportPasswordDialog('export');
  });

  /** 데이터 불러오기 */
  ipcMain.on('settings-import-data', async () => {
    const result = await dialog.showOpenDialog({
      title: i18n.t('dialog.importTitle'),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;

    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: [i18n.t('dialog.ok'), i18n.t('dialog.cancel')],
      defaultId: 1,
      message: i18n.t('dialog.importConfirm'),
    });
    if (confirm.response !== 0) return;

    const { openExportPasswordDialog } = require('./dialogs');
    state.exportImportTarget = { mode: 'import', filePath: result.filePaths[0] };
    openExportPasswordDialog('import');
  });
}

module.exports = { openSettings, registerSettingsIpc };
