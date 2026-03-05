/**
 * @file 캘린더 창 관리 + IPC
 *
 * 포스트잇 알림을 월간 달력에 표시하는 싱글턴 창을 제어한다.
 * 날짜 우클릭 → 새 포스트잇 생성, 엔트리 더블클릭 → 포스트잇 활성화.
 */

const { BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');

// ── Calendar Window (싱글턴) ───────────────────────────────────────────────────

/**
 * 캘린더 창을 열거나, 이미 열려 있으면 포커스한다.
 */
function openCalendar() {
  if (state.calendarWindow && !state.calendarWindow.isDestroyed()) {
    state.calendarWindow.focus();
    return;
  }

  const saved = state.store.getSetting('calendarBounds');
  const bounds = {
    width:  (saved && saved.width)  || 680,
    height: (saved && saved.height) || 620,
  };
  if (saved && saved.x != null && saved.y != null) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }

  state.calendarWindow = new BrowserWindow({
    ...bounds,
    minWidth: 520, minHeight: 560,
    resizable: true, minimizable: true, maximizable: true,
    title: i18n.t('window.calendarTitle'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  state.calendarWindow.setMenuBarVisibility(false);
  state.calendarWindow.loadFile(path.join(__dirname, '..', 'calendar.html'));

  state.calendarWindow.webContents.once('did-finish-load', () => {
    state.calendarWindow.webContents.send('set-translations', i18n.getAllTranslations());
    sendCalendarData();
  });

  // 위치/크기 변경 시 저장
  const saveBounds = () => {
    if (!state.calendarWindow || state.calendarWindow.isDestroyed()) return;
    const b = state.calendarWindow.getBounds();
    state.store.setSetting('calendarBounds', { x: b.x, y: b.y, width: b.width, height: b.height });
  };
  state.calendarWindow.on('moved',   saveBounds);
  state.calendarWindow.on('resized', saveBounds);
  state.calendarWindow.on('close', () => {
    saveBounds();
    state.store.setSetting('calendarOpen', false);
  });

  state.store.setSetting('calendarOpen', true);
  state.calendarWindow.on('closed', () => { state.calendarWindow = null; });
}

/**
 * 캘린더에 표시할 포스트잇 데이터를 전송한다.
 */
function sendCalendarData() {
  if (!state.calendarWindow || state.calendarWindow.isDestroyed()) return;
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
    locked:      p.locked || false,
  }));
  state.calendarWindow.webContents.send('calendar-init', allPostits);
}

/**
 * 외부 모듈에서 포스트잇 데이터 변경 시 캘린더를 갱신한다.
 */
function notifyCalendar() {
  sendCalendarData();
}

// ── Calendar IPC ───────────────────────────────────────────────────────────────

function registerCalendarIpc() {
  const { activatePostit, generateId, createPostitWindow } = require('./postitWindow');
  const { openProperties } = require('./dialogs');
  const { notifyManager } = require('./manager');
  const { DEFAULT_WIDTH, DEFAULT_HEIGHT } = require('./constants');
  const { markDirty } = require('./history');

  // 더블클릭 엔트리 → 포스트잇 활성화
  ipcMain.on('calendar-activate', (_event, { id }) => {
    activatePostit(id);
  });

  // 날짜 셀 우클릭 → 새 포스트잇 생성 (해당 날짜 자동 설정)
  ipcMain.on('calendar-date-context', (_event, { dateStr }) => {
    if (!state.calendarWindow || state.calendarWindow.isDestroyed()) return;

    const menu = Menu.buildFromTemplate([
      {
        label: i18n.t('calendar.newPostitOnDate', { date: dateStr }),
        click: () => {
          const id = generateId();
          const count = state.windows.size;
          const offset = (count % 8) * 30;

          const postit = {
            id,
            content:      '',
            x:            150 + offset,
            y:            150 + offset,
            width:        DEFAULT_WIDTH,
            height:       DEFAULT_HEIGHT,
            collapsed:    false,
            date:         dateStr,
            time:         '',
            priority:     3,
            hidden:       false,
            alarm:        false,
            alarmDays:    [],
            color:        '#ffff99',
            contentType:  'html',
            locked:       false,
            lockPassword: '',
            readOnly:     false,
          };

          state.store.create(postit);
          createPostitWindow(postit);
          notifyManager();
          notifyCalendar();
          markDirty();
        },
      },
    ]);
    menu.popup({ window: state.calendarWindow });
  });

  // 엔트리 우클릭 → 속성 편집 / 삭제
  ipcMain.on('calendar-entry-context', (_event, { id }) => {
    if (!state.calendarWindow || state.calendarWindow.isDestroyed()) return;

    const menu = Menu.buildFromTemplate([
      {
        label: i18n.t('calendar.editProperties'),
        click: () => openProperties(id),
      },
      { type: 'separator' },
      {
        label: i18n.t('calendar.deletePostit'),
        click: async () => {
          const { response } = await dialog.showMessageBox(state.calendarWindow, {
            type:      'question',
            buttons:   [i18n.t('dialog.delete'), i18n.t('dialog.cancel')],
            defaultId: 1,
            cancelId:  1,
            message:   i18n.t('dialog.deleteConfirm'),
          });
          if (response === 0) {
            const win = state.windows.get(id);
            if (win && !win.isDestroyed()) {
              state.windows.delete(id);
              win.destroy();
            }
            state.store.delete(id);
            notifyManager();
            notifyCalendar();
            markDirty();
          }
        },
      },
    ]);
    menu.popup({ window: state.calendarWindow });
  });

  // 드래그앤드롭 → 날짜 변경
  ipcMain.on('calendar-move-date', (_event, { id, newDate }) => {
    state.store.update(id, { date: newDate });
    // 포스트잇 창이 열려 있으면 속성 변경 알림
    const win = state.windows.get(id);
    if (win && !win.isDestroyed()) {
      const updated = state.store.get(id);
      win.webContents.send('properties-changed', updated);
    }
    notifyManager();
    notifyCalendar();
    markDirty();
  });
}

module.exports = { openCalendar, sendCalendarData, notifyCalendar, registerCalendarIpc };
