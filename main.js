/**
 * @file 애플리케이션 엔트리 포인트
 *
 * Electron 앱 라이프사이클을 관리하고, 각 기능 모듈을 초기화한다.
 * 실제 비즈니스 로직은 src/ 디렉토리의 모듈에 분리되어 있다.
 *
 * 모듈 구조:
 * - src/constants.js    : 전역 상수
 * - src/store.js        : PostitStore (JSON 영속화)
 * - src/state.js        : 공유 상태 (windows, Maps, Sets)
 * - src/postitWindow.js : 포스트잇 창 생성·관리
 * - src/drag.js         : 수동 드래그 IPC
 * - src/alarm.js        : 알림 스케줄러·알림 창
 * - src/manager.js      : 전체 목록 관리 창
 * - src/dialogs.js      : 포매터·속성 편집 창
 * - src/tray.js         : 시스템 트레이
 * - src/ipc.js          : 기본 IPC·컨텍스트 메뉴
 */

const { app } = require('electron');

const PostitStore = require('./src/store');
const state = require('./src/state');
const { createPostitWindow, createNewPostit } = require('./src/postitWindow');
const { createTray } = require('./src/tray');
const { checkAlarms, registerAlarmIpc } = require('./src/alarm');
const { registerDragHandlers } = require('./src/drag');
const { registerManagerIpc } = require('./src/manager');
const { registerDialogIpc } = require('./src/dialogs');
const { registerIpcHandlers } = require('./src/ipc');

// ─── IPC 핸들러 등록 (app.whenReady 전에 등록해도 안전) ───────────────────────
registerIpcHandlers();
registerDragHandlers();
registerAlarmIpc();
registerManagerIpc();
registerDialogIpc();

// ─── 앱 라이프사이클 ───────────────────────────────────────────────────────────

/** 앱 준비 완료 시: Store 초기화 → 트레이 생성 → 포스트잇 복원 → 알림 시작 */
app.whenReady().then(() => {
  state.store = new PostitStore();
  state.store.init();
  createTray();

  const postits = state.store.getAll();
  const visible = postits.filter(p => !p.hidden);
  if (postits.length === 0) {
    createNewPostit();
  } else {
    visible.forEach(createPostitWindow);
  }

  // 알림 스케줄러: 30초마다 체크
  setInterval(checkAlarms, 30000);
  checkAlarms();
});

/** 모든 창이 닫혀도 트레이가 있으므로 앱을 종료하지 않음 */
app.on('window-all-closed', () => {
  // 트레이 아이콘이 있으므로 앱 유지
});

/** macOS: dock 아이콘 클릭 시 포스트잇이 없으면 새로 생성 */
app.on('activate', () => {
  if (state.windows.size === 0) createNewPostit();
});
