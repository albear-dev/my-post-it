/**
 * @file 기본 포스트잇 IPC 핸들러 + 우클릭 컨텍스트 메뉴
 *
 * 포스트잇 데이터 조회, 내용 저장, 생성, 삭제, 접기 토글 등
 * 개별 포스트잇에서 발생하는 기본 IPC 이벤트를 처리한다.
 */

const { BrowserWindow, ipcMain, Menu } = require('electron');

const state = require('./state');

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
  const { openFormatter, openProperties } = require('./dialogs');
  const { openManager, notifyManager } = require('./manager');
  const { hidePostit } = require('./postitWindow');

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

  /** 에디터 내용을 저장하고 매니저 목록을 갱신한다. */
  ipcMain.on('save-content', (_event, { id, content }) => {
    state.store.update(id, { content });
    notifyManager();
  });

  /** 새 포스트잇을 생성하고 매니저 목록을 갱신한다. */
  ipcMain.on('create-postit', () => {
    createNewPostit();
    notifyManager();
  });

  /** 포스트잇 삭제 (확인 다이얼로그 표시). */
  ipcMain.on('delete-postit', (_event, { id }) => confirmAndDelete(id));

  /** 접기/펴기 토글. */
  ipcMain.on('toggle-collapse', (_event, { id }) => toggleCollapse(id));

  /**
   * 우클릭 컨텍스트 메뉴를 구성하여 표시한다.
   *
   * 에디터 영역(inEditor=true): 잘라내기/복사/붙여넣기 + 속성 변경(선택 있을 때)
   * 공통: 포스트잇 속성, 전체 목록, 숨기기, 삭제
   *
   * @param {{ id: string, hasSelection: boolean, formatting: Object, inEditor: boolean }} params
   */
  ipcMain.on('show-context-menu', (event, { id, hasSelection, formatting, inEditor }) => {
    const items = [
      { label: '새 포스트잇 생성', click: () => createNewPostit() },
    ];

    if (inEditor) {
      items.push({ type: 'separator' });
      items.push({ label: '잘라내기',  role: 'cut'   });
      items.push({ label: '복사',      role: 'copy'  });
      items.push({ label: '붙여넣기',  role: 'paste' });

      if (hasSelection) {
        items.push({ type: 'separator' });
        items.push({
          label: '속성 변경',
          click: () => openFormatter(event.sender, formatting),
        });
      }
    }

    items.push({ type: 'separator' });
    items.push({ label: '포스트잇 속성', click: () => openProperties(id) });
    items.push({ label: '전체 목록',     click: () => openManager() });
    items.push({ type: 'separator' });
    items.push({ label: '숨기기', click: () => hidePostit(id) });
    items.push({ label: '이 포스트잇 삭제', click: () => confirmAndDelete(id) });

    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });
}

module.exports = { registerIpcHandlers };
