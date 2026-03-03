/**
 * @file 시스템 트레이 아이콘 관리
 *
 * 트레이 아이콘을 생성하고, 더블클릭(전체 활성화)과
 * 우클릭 컨텍스트 메뉴(새 포스트잇, 전체 목록, 전체 보이기, 언어 선택, 종료)를 제공한다.
 */

const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

/**
 * 트레이 컨텍스트 메뉴를 (재)빌드한다.
 * 언어 전환 시 호출되어 메뉴 라벨을 갱신한다.
 */
function rebuildTrayMenu() {
  if (!state.tray) return;

  const { createNewPostit, unhidePostit } = require('./postitWindow');
  const { openManager, notifyManager } = require('./manager');
  const { openCalendar } = require('./calendar');

  const locales = i18n.getAvailableLocales();
  const currentLocale = i18n.getLocale();

  const langSubmenu = locales.map(loc => ({
    label: loc.nativeName,
    type: 'radio',
    checked: loc.code === currentLocale,
    click: () => i18n.switchLanguage(loc.code),
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: i18n.t('tray.newPostit'), click: () => { createNewPostit(); notifyManager(); } },
    { label: i18n.t('tray.allList'),   click: () => openManager() },
    { label: i18n.t('tray.calendar'),  click: () => openCalendar() },
    { label: i18n.t('tray.showAll'),   click: () => {
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
    { label: i18n.t('tray.language'), submenu: langSubmenu },
    { type: 'separator' },
    { label: i18n.t('tray.quit'), click: () => app.quit() },
  ]);
  state.tray.setContextMenu(contextMenu);
}

/**
 * 시스템 트레이 아이콘을 생성하고 이벤트·메뉴를 설정한다.
 *
 * - 더블클릭: 모든 포스트잇 창을 최상위로 활성화
 * - 우클릭 메뉴: 새 포스트잇, 전체 목록, 전체 보이기, 언어 선택, 종료
 */
function createTray() {
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

  rebuildTrayMenu();
}

module.exports = { createTray, rebuildTrayMenu };
