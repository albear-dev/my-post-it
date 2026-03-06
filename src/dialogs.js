/**
 * @file 포매터(서식 변경) 및 속성 편집 다이얼로그 관리 + IPC
 *
 * 포매터: 선택 텍스트의 글꼴 크기·굵기·밑줄·색상을 변경하는 창
 * 속성:  날짜·시간·우선순위·알림·반복요일·색상을 편집하는 창
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

// ─── 포매터 ────────────────────────────────────────────────────────────────────

/**
 * 텍스트 서식 변경 창을 연다.
 * 동일 포스트잇에 대해 이미 열려 있으면 포커스만 이동한다.
 *
 * @param {import('electron').WebContents} postitWC - 대상 포스트잇의 WebContents
 * @param {Object} [formatting] - 현재 서식 정보 (fontSize, bold, underline, color)
 */
function openFormatter(postitWC, formatting) {
  // 이미 같은 포스트잇용 포매터가 열려 있으면 포커스만 이동
  for (const [fwcId, pwc] of state.formatterTargets.entries()) {
    if (pwc.id === postitWC.id) {
      const existing = BrowserWindow.getAllWindows().find(
        w => !w.isDestroyed() && w.webContents.id === fwcId
      );
      if (existing) { existing.focus(); return; }
    }
  }

  const fwin = new BrowserWindow({
    width:       430,
    height:      375,
    resizable:   false,
    minimizable: false,
    maximizable: false,
    title:       i18n.t('window.formatterTitle'),
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });

  fwin.setMenuBarVisibility(false);
  fwin.loadFile(path.join(__dirname, '..', 'formatter.html'));

  fwin.webContents.once('did-finish-load', () => {
    fwin.webContents.send('set-translations', i18n.getAllTranslations());
    fwin.webContents.send('init-formatter', formatting ?? {
      fontSize: 10, bold: false, italic: false, underline: false, strikethrough: false, color: '#333333', bgColor: '',
    });
  });

  const fwcId = fwin.webContents.id;
  state.formatterTargets.set(fwcId, postitWC);
  fwin.on('closed', () => state.formatterTargets.delete(fwcId));
}

// ─── 코드조각 입력 ───────────────────────────────────────────────────────────────

/**
 * 코드조각 입력 창을 연다.
 * @param {import('electron').WebContents} postitWC - 대상 포스트잇의 WebContents
 */
function openCodeSnippet(postitWC) {
  for (const [cwcId, pwc] of state.codeSnippetTargets.entries()) {
    if (pwc.id === postitWC.id) {
      const existing = BrowserWindow.getAllWindows().find(
        w => !w.isDestroyed() && w.webContents.id === cwcId
      );
      if (existing) { existing.focus(); return; }
    }
  }

  const cwin = new BrowserWindow({
    width: 460, height: 340,
    resizable: true, minimizable: false, maximizable: false,
    title: i18n.t('window.codeSnippetTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  cwin.setMenuBarVisibility(false);
  cwin.loadFile(path.join(__dirname, '..', 'codesnippet.html'));

  cwin.webContents.once('did-finish-load', () => {
    cwin.webContents.send('set-translations', i18n.getAllTranslations());
  });

  const cwcId = cwin.webContents.id;
  state.codeSnippetTargets.set(cwcId, postitWC);
  cwin.on('closed', () => state.codeSnippetTargets.delete(cwcId));
}

// ─── 속성 편집 ─────────────────────────────────────────────────────────────────

/**
 * 포스트잇 속성 편집 창을 연다.
 * 동일 포스트잇에 대해 이미 열려 있으면 포커스만 이동한다.
 *
 * @param {string} postitId - 대상 포스트잇 ID
 */
function openProperties(postitId) {
  for (const [pwcId, pid] of state.propertiesTargets.entries()) {
    if (pid === postitId) {
      const existing = BrowserWindow.getAllWindows().find(
        w => !w.isDestroyed() && w.webContents.id === pwcId
      );
      if (existing) { existing.focus(); return; }
    }
  }

  const postit = state.store.get(postitId);
  if (!postit) return;

  const pwin = new BrowserWindow({
    width: 350, height: 530,
    resizable: false, minimizable: false, maximizable: false,
    title: i18n.t('window.propertiesTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  pwin.setMenuBarVisibility(false);
  pwin.loadFile(path.join(__dirname, '..', 'properties.html'));

  pwin.webContents.once('did-finish-load', () => {
    pwin.webContents.send('set-translations', i18n.getAllTranslations());
    pwin.webContents.send('init-properties', {
      date:        postit.date        || '',
      time:        postit.time        || '',
      priority:    postit.priority    ?? 3,
      alarm:       postit.alarm       || false,
      alarmDays:   postit.alarmDays   || [],
      color:       postit.color       || '#ffff99',
      contentType: postit.contentType || 'html',
      categories:  postit.categories  || [],
      allCategories: state.store.getCategories(),
    });
  });

  const pwcId = pwin.webContents.id;
  state.propertiesTargets.set(pwcId, postitId);
  pwin.on('closed', () => state.propertiesTargets.delete(pwcId));
}

// ─── 다이얼로그 IPC ────────────────────────────────────────────────────────────

/**
 * 포매터·속성 편집 관련 IPC 핸들러를 등록한다.
 *
 * - formatter-apply: 서식 적용 후 포매터 창 닫기
 * - formatter-cancel: 포매터 취소
 * - properties-save: 속성 저장 → 포스트잇에 반영 + 매니저 갱신
 * - properties-cancel: 속성 편집 취소
 */
function registerDialogIpc() {
  const { notifyManager } = require('./manager');
  const { notifyCalendar } = require('./calendar');
  const { markDirty } = require('./history');

  /** 포매터에서 서식을 적용한다. 대상 포스트잇에 apply-formatting 이벤트 전송. */
  ipcMain.on('formatter-apply', (event, formatting) => {
    const postitWC = state.formatterTargets.get(event.sender.id);
    if (postitWC && !postitWC.isDestroyed()) {
      postitWC.send('apply-formatting', formatting);
    }
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 포매터 취소: 창을 닫는다. */
  ipcMain.on('formatter-cancel', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 코드조각 삽입: 대상 포스트잇에 insert-code-snippet 이벤트 전송. */
  ipcMain.on('codesnippet-apply', (event, data) => {
    const postitWC = state.codeSnippetTargets.get(event.sender.id);
    if (postitWC && !postitWC.isDestroyed()) {
      postitWC.send('insert-code-snippet', data);
    }
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 코드조각 취소: 창을 닫는다. */
  ipcMain.on('codesnippet-cancel', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /**
   * 속성 저장: store 업데이트 → 포스트잇 창에 변경 알림 → 매니저 갱신.
   * 색상 변경 시 포스트잇 창의 배경색도 함께 변경된다.
   */
  ipcMain.on('properties-save', (event, props) => {
    const postitId = state.propertiesTargets.get(event.sender.id);
    if (postitId) {
      state.store.update(postitId, {
        date: props.date, time: props.time, priority: props.priority,
        alarm: props.alarm ?? false, alarmDays: props.alarmDays || [],
        color: props.color || '#ffff99',
        contentType: props.contentType || 'html',
        categories: props.categories || [],
      });
      const win = state.windows.get(postitId);
      if (win && !win.isDestroyed()) {
        win.webContents.send('properties-changed', props);
      }
      notifyManager();
      notifyCalendar();
      markDirty();
    }
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 속성 편집 취소: 창을 닫는다. */
  ipcMain.on('properties-cancel', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 비밀번호 다이얼로그: 확인 → 잠금/해제 처리 */
  ipcMain.on('password-submit', (event, { password }) => {
    const target = state.passwordDialogTargets.get(event.sender.id);
    if (!target) return;
    const { postitId, action } = target;

    if (action === 'lock') {
      state.store.update(postitId, { locked: true, lockPassword: password });
      const win = state.windows.get(postitId);
      if (win && !win.isDestroyed()) {
        win.webContents.send('lock-changed', { locked: true });
      }
    } else if (action === 'unlock') {
      state.store.update(postitId, { locked: false, lockPassword: '' });
      const win = state.windows.get(postitId);
      if (win && !win.isDestroyed()) {
        win.webContents.send('lock-changed', { locked: false });
      }
    }

    notifyManager();
    notifyCalendar();
    markDirty();
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 비밀번호 다이얼로그: 취소 */
  ipcMain.on('password-cancel', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 내보내기/불러오기 비밀번호: 확인 */
  ipcMain.on('export-import-password-submit', async (event, { password }) => {
    const { dialog } = require('electron');
    const target = state.exportImportTarget;
    if (!target) return;

    BrowserWindow.fromWebContents(event.sender)?.close();

    const { exportData, importData } = require('./history');
    const i18n = require('./i18n');

    if (target.mode === 'export') {
      // 저장 위치 선택
      const result = await dialog.showSaveDialog({
        title: i18n.t('dialog.exportTitle'),
        defaultPath: 'MyPostit_export.zip',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return;

      const ok = await exportData(result.filePath, password);
      dialog.showMessageBox({
        type: ok ? 'info' : 'error',
        message: i18n.t(ok ? 'dialog.exportSuccess' : 'dialog.exportError'),
      });
    } else if (target.mode === 'import') {
      const ok = await importData(target.filePath, password);
      dialog.showMessageBox({
        type: ok ? 'info' : 'error',
        message: i18n.t(ok ? 'dialog.importSuccess' : 'dialog.wrongPassword'),
      });
    }

    state.exportImportTarget = null;
  });

  /** 내보내기/불러오기 비밀번호: 취소 */
  ipcMain.on('export-import-password-cancel', (event) => {
    state.exportImportTarget = null;
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 새 포스트잇 타입 선택 */
  ipcMain.on('newpostit-select', (event, contentType) => {
    const { createNewPostit } = require('./postitWindow');
    createNewPostit(contentType);
    notifyManager();
    notifyCalendar();
    markDirty();
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  /** 새 포스트잇 다이얼로그 취소 */
  ipcMain.on('newpostit-cancel', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

}

// ─── 비밀번호 다이얼로그 ─────────────────────────────────────────────────────

/**
 * 비밀번호 입력 다이얼로그를 연다.
 *
 * @param {string} postitId - 대상 포스트잇 ID
 * @param {'set'|'verify'} mode - 'set': 비밀번호 설정, 'verify': 비밀번호 확인
 * @param {'lock'|'unlock'} action - 결과 처리 방식
 */
function openPasswordDialog(postitId, mode, action) {
  const postit = state.store.get(postitId);
  if (!postit) return;

  const pwin = new BrowserWindow({
    width: 300,
    height: mode === 'set' ? 240 : 180,
    resizable: false, minimizable: false, maximizable: false,
    title: i18n.t('dialog.passwordTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  pwin.setMenuBarVisibility(false);
  pwin.loadFile(path.join(__dirname, '..', 'password.html'));

  pwin.webContents.once('did-finish-load', () => {
    pwin.webContents.send('set-translations', i18n.getAllTranslations());
    pwin.webContents.send('init-password', {
      mode,
      storedPassword: postit.lockPassword || '',
    });
  });

  const pwcId = pwin.webContents.id;
  state.passwordDialogTargets.set(pwcId, { postitId, action });
  pwin.on('closed', () => state.passwordDialogTargets.delete(pwcId));
}

// ─── 내보내기/불러오기 비밀번호 다이얼로그 ───────────────────────────────────

/**
 * 내보내기/불러오기용 비밀번호 입력 다이얼로그를 연다.
 *
 * @param {'export'|'import'} mode - export: 비밀번호 설정 (2필드), import: 비밀번호 확인 (1필드)
 */
function openExportPasswordDialog(mode) {
  const pwin = new BrowserWindow({
    width: 300,
    height: mode === 'export' ? 240 : 180,
    resizable: false, minimizable: false, maximizable: false,
    title: i18n.t(mode === 'export' ? 'dialog.exportTitle' : 'dialog.importTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  pwin.setMenuBarVisibility(false);
  pwin.loadFile(path.join(__dirname, '..', 'exportpassword.html'));

  pwin.webContents.once('did-finish-load', () => {
    pwin.webContents.send('set-translations', i18n.getAllTranslations());
    pwin.webContents.send('init-export-password', { mode });
  });

  const pwcId = pwin.webContents.id;
  state.exportImportTarget = { ...(state.exportImportTarget || {}), pwcId };
  pwin.on('closed', () => {
    if (state.exportImportTarget && state.exportImportTarget.pwcId === pwcId) {
      state.exportImportTarget = null;
    }
  });
}

// ─── 새 포스트잇 타입 선택 ──────────────────────────────────────────────────

/**
 * 새 포스트잇 생성 시 편집 모드(에디터/마크다운) 선택 다이얼로그를 연다.
 */
function openNewPostitDialog() {
  const nwin = new BrowserWindow({
    width: 320, height: 230,
    resizable: false, minimizable: false, maximizable: false,
    title: i18n.t('window.newPostitTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  nwin.setMenuBarVisibility(false);
  nwin.loadFile(path.join(__dirname, '..', 'newpostit.html'));

  nwin.webContents.once('did-finish-load', () => {
    nwin.webContents.send('set-translations', i18n.getAllTranslations());
  });

  state.newPostitDialogWindow = nwin;
  nwin.on('closed', () => { state.newPostitDialogWindow = null; });
}

module.exports = { openFormatter, openCodeSnippet, openProperties, openPasswordDialog, openExportPasswordDialog, openNewPostitDialog, registerDialogIpc };
