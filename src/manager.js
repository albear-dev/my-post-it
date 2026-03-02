/**
 * @file 전체 목록 관리 창 + 매니저 IPC
 *
 * 모든 포스트잇을 테이블 형태로 보여주는 관리 창을 제어한다.
 * 숨기기, 보이기, 삭제, 활성화 등의 일괄 작업을 처리한다.
 */

const { BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

// ─── 관리 창 ───────────────────────────────────────────────────────────────────

/**
 * 전체 목록 관리 창을 연다 (싱글턴).
 * 이미 열려 있으면 포커스만 이동한다.
 */
function openManager() {
  if (state.managerWindow && !state.managerWindow.isDestroyed()) {
    state.managerWindow.focus();
    return;
  }

  state.managerWindow = new BrowserWindow({
    width: 780, height: 520,
    minWidth: 600, minHeight: 400,
    resizable: true, minimizable: true, maximizable: true,
    title: i18n.t('window.managerTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  state.managerWindow.setMenuBarVisibility(false);
  state.managerWindow.loadFile(path.join(__dirname, '..', 'manager.html'));

  state.managerWindow.webContents.once('did-finish-load', () => {
    state.managerWindow.webContents.send('set-translations', i18n.getAllTranslations());
    sendManagerData();
  });

  state.managerWindow.on('closed', () => { state.managerWindow = null; });
}

/**
 * 관리 창에 전체 포스트잇 목록 데이터를 전송한다.
 * 관리 창이 열려 있지 않으면 무시한다.
 */
function sendManagerData() {
  if (!state.managerWindow || state.managerWindow.isDestroyed()) return;
  const allPostits = state.store.getAll().map(p => ({
    id:          p.id,
    content:     p.content || '',
    date:        p.date || '',
    time:        p.time || '',
    priority:    p.priority ?? 3,
    hidden:      p.hidden || false,
    alarm:       p.alarm || false,
    alarmDays:   p.alarmDays || [],
    color:       p.color || '#ffff99',
    contentType: p.contentType || 'html',
  }));
  state.managerWindow.webContents.send('manager-init', allPostits);
}

/**
 * 관리 창의 포스트잇 목록을 갱신한다.
 * 포스트잇 생성/삭제/숨기기/속성변경 후 호출된다.
 */
function notifyManager() {
  sendManagerData();
}

// ─── 매니저 IPC ────────────────────────────────────────────────────────────────

/**
 * 매니저 관련 IPC 핸들러를 등록한다.
 *
 * - manager-hide: 선택된 포스트잇 일괄 숨기기
 * - manager-unhide: 선택된 포스트잇 일괄 보이기
 * - manager-delete: 선택된 포스트잇 일괄 삭제 (확인 다이얼로그)
 * - manager-activate: 특정 포스트잇 활성화 (더블클릭)
 * - manager-create: 새 포스트잇 생성
 * - manager-show-all: 모든 포스트잇 보이기 + 활성화
 * - manager-hide-all: 모든 포스트잇 숨기기
 */
function registerManagerIpc() {
  const { hidePostit, unhidePostit, activatePostit, createNewPostit } = require('./postitWindow');

  ipcMain.on('manager-hide', (_event, { ids }) => {
    ids.forEach(id => hidePostit(id));
  });

  ipcMain.on('manager-unhide', (_event, { ids }) => {
    ids.forEach(id => unhidePostit(id));
  });

  /** 선택한 포스트잇을 확인 후 일괄 삭제한다. */
  ipcMain.on('manager-delete', async (_event, { ids }) => {
    if (!state.managerWindow || state.managerWindow.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(state.managerWindow, {
      type:      'question',
      buttons:   [i18n.t('dialog.delete'), i18n.t('dialog.cancel')],
      defaultId: 1,
      cancelId:  1,
      message:   i18n.t('dialog.deleteMultiConfirm', { count: ids.length }),
    });
    if (response === 0) {
      ids.forEach(id => {
        const win = state.windows.get(id);
        if (win && !win.isDestroyed()) {
          state.windows.delete(id);
          win.destroy();
        }
        state.store.delete(id);
      });
      notifyManager();
    }
  });

  ipcMain.on('manager-activate', (_event, { id }) => {
    activatePostit(id);
  });

  ipcMain.on('manager-create', () => {
    createNewPostit();
    notifyManager();
  });

  /** 모든 포스트잇을 보이기 + 최상위 활성화한다. */
  ipcMain.on('manager-show-all', () => {
    state.store.getAll().forEach(p => {
      if (p.hidden) unhidePostit(p.id);
    });
    for (const win of state.windows.values()) {
      if (win.isDestroyed()) continue;
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    }
  });

  /** 모든 포스트잇을 숨긴다. */
  ipcMain.on('manager-hide-all', () => {
    state.store.getAll().forEach(p => {
      if (!p.hidden) hidePostit(p.id);
    });
  });
}

module.exports = { openManager, sendManagerData, notifyManager, registerManagerIpc };
