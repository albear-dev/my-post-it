/**
 * @file 시스템 트레이 아이콘 관리
 *
 * 트레이 아이콘을 생성하고, 더블클릭(전체 활성화)과
 * 우클릭 컨텍스트 메뉴(새 포스트잇, 전체 목록, 전체 보이기, 종료)를 제공한다.
 */

const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

const state = require('./state');

/**
 * 시스템 트레이 아이콘을 생성하고 이벤트·메뉴를 설정한다.
 *
 * - 더블클릭: 모든 포스트잇 창을 최상위로 활성화
 * - 우클릭 메뉴:
 *   - 새 포스트잇: 새 포스트잇 생성
 *   - 전체 목록: 매니저 창 열기
 *   - 전체 보이기: 숨겨진 포스트잇 포함 모두 보이기
 *   - 종료: 앱 종료
 */
function createTray() {
  const { createNewPostit, unhidePostit } = require('./postitWindow');
  const { openManager, notifyManager } = require('./manager');

  const iconPath = path.join(__dirname, '..', 'img', 'postit.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  state.tray = new Tray(icon);
  state.tray.setToolTip('MyPostit');

  // 더블클릭 → 모든 포스트잇 맨 위로 활성화
  state.tray.on('double-click', () => {
    for (const win of state.windows.values()) {
      if (win.isDestroyed()) continue;
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    }
  });

  // 우클릭 → 트레이 메뉴
  const contextMenu = Menu.buildFromTemplate([
    { label: '새 포스트잇', click: () => { createNewPostit(); notifyManager(); } },
    { label: '전체 목록',   click: () => openManager() },
    { label: '전체 보이기',  click: () => {
      state.store.getAll().forEach(p => { if (p.hidden) unhidePostit(p.id); });
      for (const win of state.windows.values()) {
        if (win.isDestroyed()) continue;
        if (win.isMinimized()) win.restore();
        win.show();
        win.setAlwaysOnTop(true);
        win.setAlwaysOnTop(false);
      }
    }},
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  state.tray.setContextMenu(contextMenu);
}

module.exports = { createTray };
