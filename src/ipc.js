/**
 * @file 기본 포스트잇 IPC 핸들러 + 우클릭 컨텍스트 메뉴
 *
 * 포스트잇 데이터 조회, 내용 저장, 생성, 삭제, 접기 토글 등
 * 개별 포스트잇에서 발생하는 기본 IPC 이벤트를 처리한다.
 */

const { BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

/**
 * 기본 포스트잇 IPC 핸들러 + 컨텍스트 메뉴를 등록한다.
 *
 * 핸들:
 * - get-postit-data: 포스트잇 데이터 반환 (invoke/handle)
 *
 * 이벤트:
 * - save-content: 에디터 내용 저장
 * - create-postit: 새 포스트잇 생성
 * - delete-postit: 포스트잇 삭제 (확인 다이얼로그)
 * - toggle-collapse: 접기/펴기 토글
 * - show-context-menu: 우클릭 컨텍스트 메뉴 표시
 */
function registerIpcHandlers() {
  const { createNewPostit, confirmAndDelete, toggleCollapse } = require('./postitWindow');
  const { openFormatter, openCodeSnippet, openProperties, openPasswordDialog, openCategorySettings } = require('./dialogs');
  const { openManager, notifyManager } = require('./manager');
  const { notifyCalendar, openCalendar } = require('./calendar');
  const { hidePostit } = require('./postitWindow');
  const { markDirty, createBackup } = require('./history');
  const { openHistory } = require('./historyWindow');

  /**
   * 포스트잇 데이터를 WebContents ID로 조회하여 반환한다.
   * 렌더러에서 ipcRenderer.invoke('get-postit-data')로 호출.
   */
  ipcMain.handle('get-postit-data', (event) => {
    for (const [id, win] of state.windows.entries()) {
      if (win.webContents.id === event.sender.id) {
        return state.store.get(id);
      }
    }
    return null;
  });

  /** 에디터 내용을 저장하고 매니저·캘린더 목록을 갱신한다. */
  ipcMain.on('save-content', (_event, { id, content, contentType }) => {
    const update = { content };
    if (contentType) update.contentType = contentType;
    state.store.update(id, update);
    notifyManager();
    notifyCalendar();
    markDirty();
  });

  /** 새 포스트잇을 생성하고 매니저·캘린더 목록을 갱신한다. */
  ipcMain.on('create-postit', () => {
    createNewPostit();
    notifyManager();
    notifyCalendar();
    markDirty();
  });

  /** 포스트잇 삭제 (확인 다이얼로그 표시). */
  ipcMain.on('delete-postit', (_event, { id }) => {
    confirmAndDelete(id);
    markDirty();
  });

  /** 접기/펴기 토글. */
  ipcMain.on('toggle-collapse', (_event, { id }) => toggleCollapse(id));

  /** 에디터 내용이 넘칠 때 창 높이를 자동으로 늘린다. */
  ipcMain.on('auto-resize', (_event, { id, deltaHeight }) => {
    const win = state.windows.get(id);
    if (!win || win.isDestroyed()) return;
    const postit = state.store.get(id);
    if (!postit || postit.collapsed) return;

    const [width, height] = win.getSize();
    const { screen } = require('electron');
    const display = screen.getDisplayMatching(win.getBounds());
    const maxHeight = display.workAreaSize.height;
    const newHeight = Math.min(height + deltaHeight, maxHeight);

    win.setSize(width, newHeight);
    state.store.update(id, { height: newHeight });
  });

  /**
   * 우클릭 컨텍스트 메뉴를 구성하여 표시한다.
   *
   * 에디터 영역(inEditor=true): 잘라내기/복사/붙여넣기 + 속성 변경(선택 있을 때)
   * 공통: 포스트잇 속성, 전체 목록, 숨기기, 삭제
   *
   * @param {{ id: string, hasSelection: boolean, formatting: Object, inEditor: boolean }} params
   */
  ipcMain.on('show-context-menu', (event, { id, hasSelection, formatting, inEditor, contentType, locked, readOnly }) => {
    const items = [
      { label: i18n.t('menu.newPostit'), click: () => createNewPostit() },
    ];

    // 잠금 안 된 경우에만 편집 메뉴 표시
    if (!locked && inEditor) {
      items.push({ type: 'separator' });
      if (!readOnly) {
        items.push({ label: i18n.t('menu.cut'), role: 'cut' });
      }
      items.push({ label: i18n.t('menu.copy'), role: 'copy' });
      if (!readOnly) {
        items.push({ label: i18n.t('menu.paste'), role: 'paste' });
      }

      // Wiki 모드에서는 포매터(속성 변경) 숨김, 읽기전용에서도 숨김
      if (!readOnly && hasSelection && contentType !== 'wiki') {
        items.push({ type: 'separator' });
        items.push({
          label: i18n.t('menu.formatting'),
          click: () => openFormatter(event.sender, formatting),
        });
      }

      // 코드조각 입력 (HTML 모드, 편집 가능 시)
      if (!readOnly && contentType !== 'wiki') {
        items.push({
          label: i18n.t('menu.insertCode'),
          click: () => openCodeSnippet(event.sender),
        });
      }
    }

    // 잠금 / 읽기전용 섹션
    items.push({ type: 'separator' });
    if (locked) {
      items.push({
        label: i18n.t('menu.unlock'),
        click: () => openPasswordDialog(id, 'verify', 'unlock'),
      });
    } else {
      items.push({
        label: i18n.t('menu.lock'),
        click: () => openPasswordDialog(id, 'set', 'lock'),
      });
      items.push({
        label: i18n.t('menu.readOnly'),
        type: 'checkbox',
        checked: !!readOnly,
        click: () => {
          const newVal = !readOnly;
          state.store.update(id, { readOnly: newVal });
          const win = state.windows.get(id);
          if (win && !win.isDestroyed()) {
            win.webContents.send('readonly-changed', { readOnly: newVal });
          }
        },
      });
    }

    items.push({ type: 'separator' });
    items.push({ label: i18n.t('menu.properties'), click: () => openProperties(id) });
    items.push({ label: i18n.t('menu.allList'),     click: () => openManager() });
    items.push({ label: i18n.t('menu.calendar'),    click: () => openCalendar() });
    items.push({ label: i18n.t('menu.history'),      click: () => openHistory() });
    items.push({ label: i18n.t('menu.categorySettings'), click: () => openCategorySettings() });
    items.push({ label: i18n.t('menu.openDataFolder'), click: () => {
      if (state.store && state.store.dbPath) {
        shell.openPath(path.dirname(state.store.dbPath));
      }
    }});
    items.push({ type: 'separator' });
    items.push({ label: i18n.t('menu.hide'), click: () => hidePostit(id) });
    items.push({ label: i18n.t('menu.deleteThis'), click: () => confirmAndDelete(id) });

    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });

  /** 강제 백업 (Ctrl+S) */
  ipcMain.on('force-backup', () => {
    createBackup('manual');
  });

  /** 잠금 해제 요청 (렌더러에서 더블클릭 시) */
  ipcMain.on('request-unlock', (_event, { id }) => {
    const postit = state.store.get(id);
    if (postit && postit.locked) {
      openPasswordDialog(id, 'verify', 'unlock');
    }
  });
}

module.exports = { registerIpcHandlers };
