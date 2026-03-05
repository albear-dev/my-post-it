/**
 * @file 히스토리 관리 창 + IPC 핸들러
 *
 * 백업 목록을 표시하고 미리보기/복구/삭제를 처리한다.
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

/**
 * 히스토리 창을 연다 (싱글턴).
 */
function openHistory() {
  if (state.historyWindow && !state.historyWindow.isDestroyed()) {
    state.historyWindow.focus();
    return;
  }

  state.historyWindow = new BrowserWindow({
    width: 650, height: 500,
    minWidth: 500, minHeight: 350,
    resizable: true, minimizable: true, maximizable: true,
    title: i18n.t('window.historyTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  state.historyWindow.setMenuBarVisibility(false);
  state.historyWindow.loadFile(path.join(__dirname, '..', 'history.html'));

  state.historyWindow.webContents.once('did-finish-load', () => {
    const { getBackupList } = require('./history');
    state.historyWindow.webContents.send('set-translations', i18n.getAllTranslations());
    state.historyWindow.webContents.send('history-updated', getBackupList());
  });

  state.historyWindow.on('closed', () => { state.historyWindow = null; });
}

/**
 * 히스토리 관련 IPC 핸들러를 등록한다.
 */
function registerHistoryIpc() {
  const { getBackupList, previewBackup, restoreBackup, deleteBackup } = require('./history');

  ipcMain.handle('get-history-list', () => {
    return getBackupList();
  });

  ipcMain.handle('preview-backup', (_event, { filename }) => {
    return previewBackup(filename);
  });

  ipcMain.handle('restore-backup', (_event, { filename }) => {
    return restoreBackup(filename);
  });

  ipcMain.on('delete-backup', (_event, { filename }) => {
    deleteBackup(filename);
  });
}

module.exports = { openHistory, registerHistoryIpc };
