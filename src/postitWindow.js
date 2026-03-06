/**
 * @file 포스트잇 창 생성·관리 모듈
 *
 * BrowserWindow 생성, 자석 스냅, 접기/펴기, 새 포스트잇 생성,
 * 삭제·숨기기·보이기·활성화 등 포스트잇 창 관련 핵심 로직을 담당한다.
 */

const { BrowserWindow, dialog } = require('electron');
const path = require('path');

const state = require('./state');
const i18n = require('./i18n');
const { HEADER_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT, SNAP_THRESHOLD } = require('./constants');

// ─── 유틸리티 ──────────────────────────────────────────────────────────────────

/**
 * 고유한 포스트잇 ID를 생성한다.
 * 형식: `p_<timestamp>_<random8chars>`
 * @returns {string} 생성된 고유 ID
 */
function generateId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── 자석 스냅 ─────────────────────────────────────────────────────────────────

/**
 * 이동 중인 포스트잇 창의 자석 스냅 위치를 계산한다.
 * 다른 포스트잇 가장자리에 SNAP_THRESHOLD(15px) 이내로 접근하면
 * 해당 가장자리에 정렬된 좌표를 반환한다.
 *
 * 스냅 판정:
 * - 수평: 좌변↔우변, 좌변↔좌변, 우변↔우변, 우변↔좌변
 * - 수직: 상변↔하변, 상변↔상변, 하변↔하변, 하변↔상변
 *
 * @param {{ x: number, y: number, width: number, height: number }} movingBounds - 이동 중인 창의 bounds
 * @param {string} movingId - 이동 중인 포스트잇 ID (자기 자신 제외)
 * @returns {{ x: number, y: number, snapped: boolean }} 스냅 적용 좌표 + 스냅 여부
 */
function calcSnap(movingBounds, movingId) {
  let { x, y, width, height } = movingBounds;
  let snapX = x;
  let snapY = y;
  const r = x + width;
  const b = y + height;

  for (const [id, w] of state.windows.entries()) {
    if (id === movingId || w.isDestroyed()) continue;
    const o  = w.getBounds();
    const or = o.x + o.width;
    const ob = o.y + o.height;

    // 세로 방향으로 겹치는지 (수평 스냅 판정 전제)
    const vNear = b + SNAP_THRESHOLD > o.y && y - SNAP_THRESHOLD < ob;
    // 가로 방향으로 겹치는지 (수직 스냅 판정 전제)
    const hNear = r + SNAP_THRESHOLD > o.x && x - SNAP_THRESHOLD < or;

    if (vNear) {
      if      (Math.abs(r - o.x) < SNAP_THRESHOLD) snapX = o.x - width;  // 우→좌 달라붙기
      else if (Math.abs(x - or)  < SNAP_THRESHOLD) snapX = or;           // 좌→우 달라붙기
      else if (Math.abs(x - o.x) < SNAP_THRESHOLD) snapX = o.x;         // 좌변 정렬
      else if (Math.abs(r - or)  < SNAP_THRESHOLD) snapX = or - width;   // 우변 정렬
    }

    if (hNear) {
      if      (Math.abs(b - o.y) < SNAP_THRESHOLD) snapY = o.y - height; // 하→상 달라붙기
      else if (Math.abs(y - ob)  < SNAP_THRESHOLD) snapY = ob;           // 상→하 달라붙기
      else if (Math.abs(y - o.y) < SNAP_THRESHOLD) snapY = o.y;          // 상변 정렬
      else if (Math.abs(b - ob)  < SNAP_THRESHOLD) snapY = ob - height;  // 하변 정렬
    }
  }

  return { x: snapX, y: snapY, snapped: snapX !== x || snapY !== y };
}

// ─── 접기 / 펴기 ───────────────────────────────────────────────────────────────

/**
 * 포스트잇을 접거나 펴는 토글 동작을 수행한다.
 * - 접기: 높이를 HEADER_HEIGHT로 고정하고 최소/최대 높이 제한
 * - 펴기: 저장된 원래 크기로 복원하고 높이 제한 해제
 *
 * @param {string} id - 대상 포스트잇 ID
 */
function toggleCollapse(id) {
  const win    = state.windows.get(id);
  const postit = state.store.get(id);
  if (!win || !postit) return;

  const collapsed = !postit.collapsed;

  if (collapsed) {
    const [width] = win.getSize();
    state.store.update(id, { collapsed, width });
    win.setMinimumSize(150, HEADER_HEIGHT);
    win.setMaximumSize(9999, HEADER_HEIGHT);
    win.setSize(width, HEADER_HEIGHT, true);
  } else {
    const saved = state.store.get(id);
    state.store.update(id, { collapsed });
    win.setMinimumSize(150, 100);
    win.setMaximumSize(9999, 9999);
    win.setSize(saved.width || DEFAULT_WIDTH, saved.height || DEFAULT_HEIGHT, true);
  }

  win.webContents.send('collapse-changed', { collapsed });
}

// ─── 포스트잇 창 생성 ──────────────────────────────────────────────────────────

/**
 * 포스트잇 데이터를 기반으로 BrowserWindow를 생성하고 이벤트를 바인딩한다.
 *
 * 등록되는 이벤트:
 * - moved: 이동 후 자석 스냅 + 위치 저장 (수동 드래그 중 스킵)
 * - resized: 리사이즈 후 너비 스냅 + 크기 저장
 * - close: 종료 시 최종 위치 저장
 * - closed: windows Map에서 제거
 * - will-resize: 수동 드래그 중 리사이즈 방지
 *
 * @param {Object} postit - 포스트잇 데이터 객체
 * @returns {BrowserWindow} 생성된 BrowserWindow 인스턴스
 */
function createPostitWindow(postit) {
  const winOpts = {
    width:           postit.width  || DEFAULT_WIDTH,
    height:          postit.collapsed ? HEADER_HEIGHT : (postit.height || DEFAULT_HEIGHT),
    frame:           false,
    resizable:       true,
    movable:         true,
    maximizable:     false,
    backgroundColor: postit.color || '#ffff99',
    skipTaskbar:     true,
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  };

  if (typeof postit.x === 'number' && typeof postit.y === 'number') {
    winOpts.x = postit.x;
    winOpts.y = postit.y;
  }

  const win = new BrowserWindow(winOpts);

  if (postit.collapsed) {
    win.setMinimumSize(150, HEADER_HEIGHT);
    win.setMaximumSize(9999, HEADER_HEIGHT);
  }

  win.loadURL(`file://${path.join(__dirname, '..', 'index.html')}?id=${postit.id}`);

  // 번역 데이터 전송
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('set-translations', i18n.getAllTranslations());
  });

  // 이동 후: 자석 스냅 → 위치 저장 (수동 드래그 중에는 스킵)
  win.on('moved', () => {
    if (!state.windows.has(postit.id)) return;
    if (state.draggingPostits.has(postit.id)) return;
    const bounds = win.getBounds();
    const snap   = calcSnap(bounds, postit.id);
    if (snap.snapped) {
      win.setPosition(snap.x, snap.y);
    }
    const [x, y] = win.getPosition();
    state.store.update(postit.id, { x, y });
  });

  // 리사이즈 후: 너비 스냅 + 크기 저장
  win.on('resized', () => {
    const current = state.store.get(postit.id);
    if (!current) return;
    let [width, height] = win.getSize();
    let snapX = null;

    // 근처 포스트잇의 가로 길이에 자석 스냅
    const bounds = win.getBounds();
    for (const [id, other] of state.windows.entries()) {
      if (id === postit.id || other.isDestroyed()) continue;
      const ob = other.getBounds();
      const hOverlap = bounds.x < ob.x + ob.width + SNAP_THRESHOLD
                     && bounds.x + bounds.width > ob.x - SNAP_THRESHOLD;
      const vOverlap = bounds.y < ob.y + ob.height + SNAP_THRESHOLD
                     && bounds.y + bounds.height > ob.y - SNAP_THRESHOLD;
      if (hOverlap && vOverlap && Math.abs(width - ob.width) < SNAP_THRESHOLD) {
        width = ob.width;
        snapX = ob.x;
        break;
      }
    }

    // 스냅된 너비 적용
    const [curW] = win.getSize();
    if (width !== curW) {
      win.setSize(width, current.collapsed ? HEADER_HEIGHT : height);
    }

    // 왼쪽 정렬 스냅
    if (snapX !== null) {
      const [, curY] = win.getPosition();
      win.setPosition(snapX, curY);
      state.store.update(postit.id, { x: snapX });
    }

    if (current.collapsed) {
      state.store.update(postit.id, { width });
    } else {
      state.store.update(postit.id, { width, height });
    }
  });

  // 종료 시 최종 위치 저장
  win.on('close', () => {
    const [x, y] = win.getPosition();
    state.store.update(postit.id, { x, y });
  });

  win.on('closed', () => state.windows.delete(postit.id));

  // 수동 드래그 중 상단 가장자리에서 리사이즈 방지
  win.on('will-resize', (event) => {
    if (state.draggingPostits.has(postit.id)) event.preventDefault();
  });

  state.windows.set(postit.id, win);
  return win;
}

// ─── 새 포스트잇 생성 ──────────────────────────────────────────────────────────

/**
 * 새 포스트잇을 기본값으로 생성하고 창을 연다.
 * 위치는 기존 포스트잇 수에 따라 30px씩 오프셋 (최대 8개 순환).
 */
function createNewPostit(contentType) {
  const id     = generateId();
  const count  = state.windows.size;
  const offset = (count % 8) * 30;

  const postit = {
    id,
    content:   '',
    x:         150 + offset,
    y:         150 + offset,
    width:     DEFAULT_WIDTH,
    height:    DEFAULT_HEIGHT,
    collapsed: false,
    date:      '',
    time:      '',
    priority:  3,
    hidden:    false,
    alarm:     false,
    alarmDays: [],
    color:       '#ffff99',
    contentType: contentType || 'html',
    locked:       false,
    lockPassword: '',
    readOnly:     false,
  };

  state.store.create(postit);
  createPostitWindow(postit);
}

// ─── 삭제 ──────────────────────────────────────────────────────────────────────

/**
 * 확인 다이얼로그를 띄운 후 포스트잇을 영구 삭제한다.
 * 사용자가 '삭제'를 선택하면 store에서 제거하고 창을 파괴한다.
 *
 * @param {string} id - 삭제 대상 포스트잇 ID
 */
async function confirmAndDelete(id) {
  const { notifyManager } = require('./manager');
  const win = state.windows.get(id);
  if (!win) return;

  const { response } = await dialog.showMessageBox(win, {
    type:      'question',
    buttons:   [i18n.t('dialog.delete'), i18n.t('dialog.cancel')],
    defaultId: 1,
    cancelId:  1,
    message:   i18n.t('dialog.deleteConfirm'),
  });

  if (response === 0) {
    state.store.delete(id);
    state.windows.delete(id);
    win.destroy();
    notifyManager();
  }
}

// ─── 숨기기 / 보이기 ───────────────────────────────────────────────────────────

/**
 * 포스트잇을 숨긴다 (hidden=true).
 * 창을 파괴하고 windows Map에서 제거한다.
 *
 * @param {string} id - 숨길 포스트잇 ID
 */
function hidePostit(id) {
  const { notifyManager } = require('./manager');
  state.store.update(id, { hidden: true });
  const win = state.windows.get(id);
  if (win && !win.isDestroyed()) {
    state.windows.delete(id);
    win.destroy();
  }
  notifyManager();
}

/**
 * 숨겨진 포스트잇을 다시 보이게 한다 (hidden=false).
 * 창이 없으면 새로 생성하고, 최상위로 활성화한다.
 *
 * @param {string} id - 보이게 할 포스트잇 ID
 */
function unhidePostit(id) {
  const { notifyManager } = require('./manager');
  const postit = state.store.get(id);
  if (!postit) return;
  state.store.update(id, { hidden: false });
  if (!state.windows.has(id)) {
    createPostitWindow(state.store.get(id));
  }
  const win = state.windows.get(id);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
  }
  notifyManager();
}

/**
 * 포스트잇을 최상위로 활성화한다.
 * 숨겨진 상태라면 먼저 unhide 처리한다.
 *
 * @param {string} id - 활성화할 포스트잇 ID
 */
function activatePostit(id) {
  const postit = state.store.get(id);
  if (!postit) return;
  if (postit.hidden) {
    unhidePostit(id);
  } else {
    const win = state.windows.get(id);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    }
  }
}

/**
 * 모든 포스트잇 창을 닫고 현재 데이터로 재생성한다.
 * 백업 복구 후 호출된다.
 */
function reloadAllPostits() {
  // 기존 포스트잇 창 모두 닫기
  for (const [id, win] of state.windows.entries()) {
    if (!win.isDestroyed()) win.destroy();
  }
  state.windows.clear();

  // 보이는 포스트잇 재생성
  const postits = state.store.getAll().filter(p => !p.hidden);
  postits.forEach(p => createPostitWindow(p));
}

module.exports = {
  generateId,
  calcSnap,
  toggleCollapse,
  createPostitWindow,
  createNewPostit,
  confirmAndDelete,
  hidePostit,
  unhidePostit,
  activatePostit,
  reloadAllPostits,
};
