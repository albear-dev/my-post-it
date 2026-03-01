/**
 * @file 알림 스케줄러 + 알림 창 관리 + 알림 IPC
 *
 * 3가지 알림 모드를 지원한다:
 * - MODE 1 (요일 반복): alarmDays 배열에 포함된 요일에만 알림
 * - MODE 2 (1회): 특정 날짜+시간에 1회 알림
 * - MODE 3 (매일): 시간만 설정 시 매일 알림
 *
 * 우선순위: alarmDays가 있으면 MODE 1만 사용 (date 무시 → 이중 알림 방지)
 */

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const state = require('./state');

// ─── 알림 스케줄러 ─────────────────────────────────────────────────────────────

/**
 * 30초마다 호출되어 모든 포스트잇의 알림 조건을 점검한다.
 *
 * 동작 방식:
 * 1. [lastAlarmCheck, now] 시간 구간 내에 알림 시각이 포함되면 발화
 * 2. 자정 경계를 위해 어제 시각도 추가 체크 (MODE 1, 3)
 * 3. dismissedUntil 기간 중이거나 이미 알림 창이 열려 있으면 스킵
 */
function checkAlarms() {
  const now = new Date();
  const nowTs = now.getTime();
  const checkFrom = state.lastAlarmCheck || nowTs;
  state.lastAlarmCheck = nowTs;

  const allPostits = state.store.getAll();

  for (const p of allPostits) {
    if (!p.alarm || !p.time) continue;
    if (state.notificationWindows.has(p.id)) continue;

    const dismissTime = state.dismissedUntil.get(p.id);
    if (dismissTime && nowTs < dismissTime) continue;

    const alarmDays = p.alarmDays || [];
    const [hours, minutes] = p.time.split(':').map(Number);
    let shouldFire = false;

    if (alarmDays.length > 0) {
      // ── MODE 1: 요일 반복 (alarmDays 우선, date 무시) ──
      const todayTarget = new Date(now);
      todayTarget.setHours(hours, minutes, 0, 0);
      const todayTs = todayTarget.getTime();
      const todayDow = todayTarget.getDay();

      const yesterdayTarget = new Date(todayTarget);
      yesterdayTarget.setDate(yesterdayTarget.getDate() - 1);
      const yesterdayTs = yesterdayTarget.getTime();
      const yesterdayDow = yesterdayTarget.getDay();

      if (alarmDays.includes(todayDow) && todayTs >= checkFrom && todayTs <= nowTs) {
        shouldFire = true;
      }
      if (!shouldFire && alarmDays.includes(yesterdayDow) && yesterdayTs >= checkFrom && yesterdayTs <= nowTs) {
        shouldFire = true;
      }

    } else if (p.date) {
      // ── MODE 2: 1회 알림 (특정 날짜 + 시간) ──
      const target = new Date(`${p.date}T${p.time}:00`);
      if (isNaN(target.getTime())) continue;
      const targetTs = target.getTime();

      if (targetTs >= checkFrom && targetTs <= nowTs) {
        shouldFire = true;
      }

    } else {
      // ── MODE 3: 매일 알림 (시간만 설정, 날짜·요일 없음) ──
      const todayTarget = new Date(now);
      todayTarget.setHours(hours, minutes, 0, 0);
      const todayTs = todayTarget.getTime();

      const yesterdayTarget = new Date(todayTarget);
      yesterdayTarget.setDate(yesterdayTarget.getDate() - 1);
      const yesterdayTs = yesterdayTarget.getTime();

      if (todayTs >= checkFrom && todayTs <= nowTs) {
        shouldFire = true;
      }
      if (!shouldFire && yesterdayTs >= checkFrom && yesterdayTs <= nowTs) {
        shouldFire = true;
      }
    }

    if (shouldFire) {
      showNotification(p);
    }
  }
}

// ─── 알림 창 ───────────────────────────────────────────────────────────────────

/**
 * 화면 우하단에 슬라이드 업 알림 창을 표시한다.
 * 여러 알림이 있으면 위로 150px씩 누적 배치한다.
 *
 * @param {Object} postit - 알림 대상 포스트잇 데이터
 */
function showNotification(postit) {
  const display = screen.getPrimaryDisplay();
  const { width: workW, height: workH } = display.workAreaSize;
  const { x: workX, y: workY } = display.workArea;

  const offset = state.notificationWindows.size * 150;

  const nwin = new BrowserWindow({
    width: 320, height: 140,
    x: workX + workW - 330,
    y: workY + workH - 150 - offset,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    transparent: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  nwin.loadFile(path.join(__dirname, '..', 'notification.html'));

  nwin.webContents.once('did-finish-load', () => {
    nwin.webContents.send('init-notification', {
      id:        postit.id,
      content:   postit.content || '',
      date:      postit.date || '',
      time:      postit.time || '',
      priority:  postit.priority ?? 3,
      alarmDays: postit.alarmDays || [],
    });
  });

  state.notificationWindows.set(postit.id, nwin);
  nwin.on('closed', () => state.notificationWindows.delete(postit.id));
}

/**
 * 알림 창을 닫고 notificationWindows에서 제거한다.
 *
 * @param {string} id - 포스트잇 ID
 */
function closeNotification(id) {
  const nwin = state.notificationWindows.get(id);
  if (nwin && !nwin.isDestroyed()) {
    nwin.destroy();
  }
  state.notificationWindows.delete(id);
}

// ─── 알림 IPC ──────────────────────────────────────────────────────────────────

/**
 * 알림 관련 IPC 핸들러를 등록한다.
 *
 * - notification-snooze: 30분 연기 (반복 알림은 dismissedUntil, 1회는 시간 변경)
 * - notification-cancel: 알림 해제 (alarm=false)
 * - notification-dismiss: 5분 후 재알림 허용
 */
function registerAlarmIpc() {
  const { notifyManager } = require('./manager');

  /**
   * 30분 연기: 반복 알림(요일/매일)은 dismissedUntil 쿨다운 설정,
   * 1회 알림은 날짜+시간을 30분 뒤로 변경한다.
   */
  ipcMain.on('notification-snooze', (_event, { id }) => {
    const postit = state.store.get(id);
    if (postit && postit.time) {
      const alarmDays = postit.alarmDays || [];

      if (alarmDays.length > 0 || !postit.date) {
        // 반복 알림: 30분 쿨다운
        state.dismissedUntil.set(id, Date.now() + 30 * 60 * 1000);
      } else {
        // 1회 알림: 날짜+시간을 +30분
        const d = new Date(`${postit.date}T${postit.time}:00`);
        d.setMinutes(d.getMinutes() + 30);
        const newDate = d.toISOString().slice(0, 10);
        const newTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        state.store.update(id, { date: newDate, time: newTime });

        const win = state.windows.get(id);
        if (win && !win.isDestroyed()) {
          const updated = state.store.get(id);
          win.webContents.send('properties-changed', updated);
        }
        notifyManager();
      }
    }
    closeNotification(id);
  });

  /** 알림 해제: alarm 플래그를 false로 설정하고 알림 창을 닫는다. */
  ipcMain.on('notification-cancel', (_event, { id }) => {
    state.store.update(id, { alarm: false });
    const win = state.windows.get(id);
    if (win && !win.isDestroyed()) {
      const updated = state.store.get(id);
      win.webContents.send('properties-changed', updated);
    }
    notifyManager();
    closeNotification(id);
  });

  /** 무시(닫기): 5분간 재알림을 금지하고 알림 창을 닫는다. */
  ipcMain.on('notification-dismiss', (_event, { id }) => {
    state.dismissedUntil.set(id, Date.now() + 5 * 60 * 1000);
    closeNotification(id);
  });
}

module.exports = { checkAlarms, showNotification, closeNotification, registerAlarmIpc };
