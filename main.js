const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, nativeImage, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const HEADER_HEIGHT      = 28;
const DEFAULT_WIDTH      = 300;
const DEFAULT_HEIGHT     = 300;
const SNAP_THRESHOLD     = 15;     // 자석 스냅 감지 거리 (px)

// ─── Local DB (JSON file in userData) ────────────────────────────────────────
class PostitStore {
  constructor() {
    this.dbPath = null;
    this.data   = { postits: {} };
  }

  init() {
    this.dbPath = path.join(app.getPath('userData'), 'postits.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch {
      this.data = { postits: {} };
    }
  }

  _save() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  getAll()       { return Object.values(this.data.postits); }
  get(id)        { return this.data.postits[id]; }

  create(postit) {
    this.data.postits[postit.id] = postit;
    this._save();
    return postit;
  }

  update(id, updates) {
    if (this.data.postits[id]) {
      Object.assign(this.data.postits[id], updates);
      this._save();
    }
  }

  delete(id) {
    delete this.data.postits[id];
    this._save();
  }
}

const store   = new PostitStore();
const windows            = new Map(); // postitId -> BrowserWindow
const formatterTargets   = new Map(); // formatter webContentsId -> postit webContents
const propertiesTargets  = new Map(); // properties webContentsId -> postitId
let   tray               = null;      // 시스템 트레이 아이콘
let   managerWindow      = null;      // 전체 목록 관리 창 (싱글턴)
const notificationWindows = new Map(); // postitId -> notification BrowserWindow
const dismissedUntil      = new Map(); // postitId -> timestamp (무시 후 재알림 금지)
let   lastAlarmCheck      = null;      // 알림 스케줄러 마지막 체크 시각
const draggingPostits     = new Set();  // 수동 드래그 중인 포스트잇 ID
const dragOriginalSize    = new Map();  // 드래그 시작 시 원본 크기 (id → [w, h])
const dragOffset          = new Map();  // 드래그 시작 시 커서↔창 오프셋 (id → {ox,oy})

// ─── 속성 변경 포매터 창 ───────────────────────────────────────────────────────
function openFormatter(postitWC, formatting) {
  // 이미 같은 포스트잇용 포매터가 열려 있으면 포커스만 이동
  for (const [fwcId, pwc] of formatterTargets.entries()) {
    if (pwc.id === postitWC.id) {
      const existing = BrowserWindow.getAllWindows().find(
        w => !w.isDestroyed() && w.webContents.id === fwcId
      );
      if (existing) { existing.focus(); return; }
    }
  }

  const fwin = new BrowserWindow({
    width:       380,
    height:      330,
    resizable:   false,
    minimizable: false,
    maximizable: false,
    title:       '속성 변경',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    },
  });

  fwin.setMenuBarVisibility(false);
  fwin.loadFile('formatter.html');

  fwin.webContents.once('did-finish-load', () => {
    fwin.webContents.send('init-formatter', formatting ?? {
      fontSize: 8, bold: false, underline: false, color: '#333333',
    });
  });

  const fwcId = fwin.webContents.id;
  formatterTargets.set(fwcId, postitWC);
  fwin.on('closed', () => formatterTargets.delete(fwcId));
}

// ─── 포스트잇 속성 편집 창 ────────────────────────────────────────────────────
function openProperties(postitId) {
  // 이미 열려 있으면 포커스만
  for (const [pwcId, pid] of propertiesTargets.entries()) {
    if (pid === postitId) {
      const existing = BrowserWindow.getAllWindows().find(
        w => !w.isDestroyed() && w.webContents.id === pwcId
      );
      if (existing) { existing.focus(); return; }
    }
  }

  const postit = store.get(postitId);
  if (!postit) return;

  const pwin = new BrowserWindow({
    width: 350, height: 380,
    resizable: false, minimizable: false, maximizable: false,
    title: '포스트잇 속성',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  pwin.setMenuBarVisibility(false);
  pwin.loadFile('properties.html');

  pwin.webContents.once('did-finish-load', () => {
    pwin.webContents.send('init-properties', {
      date:      postit.date      || '',
      time:      postit.time      || '',
      priority:  postit.priority  ?? 3,
      alarm:     postit.alarm     || false,
      alarmDays: postit.alarmDays || [],
      color:     postit.color     || '#ffff99',
    });
  });

  const pwcId = pwin.webContents.id;
  propertiesTargets.set(pwcId, postitId);
  pwin.on('closed', () => propertiesTargets.delete(pwcId));
}

// ─── 자석 스냅 계산 ────────────────────────────────────────────────────────────
function calcSnap(movingBounds, movingId) {
  let { x, y, width, height } = movingBounds;
  let snapX = x;
  let snapY = y;
  const r = x + width;
  const b = y + height;

  for (const [id, w] of windows.entries()) {
    if (id === movingId || w.isDestroyed()) continue;
    const o  = w.getBounds();
    const or = o.x + o.width;
    const ob = o.y + o.height;

    // 세로 방향으로 가까운지 (수평 스냅 판정 전제)
    const vNear = b + SNAP_THRESHOLD > o.y && y - SNAP_THRESHOLD < ob;
    // 가로 방향으로 가까운지 (수직 스냅 판정 전제)
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

// ─── 접기 / 펴기 ──────────────────────────────────────────────────────────────
function toggleCollapse(id) {
  const win    = windows.get(id);
  const postit = store.get(id);
  if (!win || !postit) return;

  const collapsed = !postit.collapsed;

  if (collapsed) {
    const [width] = win.getSize();
    store.update(id, { collapsed, width });
    win.setMinimumSize(150, HEADER_HEIGHT);
    win.setMaximumSize(9999, HEADER_HEIGHT);
    win.setSize(width, HEADER_HEIGHT, true);
    // setResizable 유지 → 가로 리사이즈 가능 (높이는 min==max 로 고정)
  } else {
    const saved = store.get(id);
    store.update(id, { collapsed });
    win.setMinimumSize(150, 100);
    win.setMaximumSize(9999, 9999);
    win.setSize(saved.width || DEFAULT_WIDTH, saved.height || DEFAULT_HEIGHT, true);
  }

  win.webContents.send('collapse-changed', { collapsed });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createPostitWindow(postit) {
  const winOpts = {
    width:           postit.width  || DEFAULT_WIDTH,
    height:          postit.collapsed ? HEADER_HEIGHT : (postit.height || DEFAULT_HEIGHT),
    frame:           false,
    resizable:       true, // 접힌 상태에서도 가로 리사이즈 허용 (높이는 min/max로 고정)
    movable:         true,
    maximizable:     false, // OS maximize 비활성화 (drag 영역 더블클릭 시 maximize 방지)
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

  win.loadURL(`file://${path.join(__dirname, 'index.html')}?id=${postit.id}`);

  // 드래그 종료 시: 자석 스냅 → 위치 저장 (수동 드래그 중에는 스킵)
  win.on('moved', () => {
    if (!windows.has(postit.id)) return;
    if (draggingPostits.has(postit.id)) return;
    const bounds = win.getBounds();
    const snap   = calcSnap(bounds, postit.id);
    if (snap.snapped) {
      win.setPosition(snap.x, snap.y);
    }
    const [x, y] = win.getPosition();
    store.update(postit.id, { x, y });
  });

  // 수동 리사이즈 시 크기 저장 + 가로 길이 자석 스냅 + 왼쪽 정렬
  win.on('resized', () => {
    const current = store.get(postit.id);
    if (!current) return;
    let [width, height] = win.getSize();
    let snapX = null;

    // 근처 포스트잇의 가로 길이에 자석 스냅
    const bounds = win.getBounds();
    for (const [id, other] of windows.entries()) {
      if (id === postit.id || other.isDestroyed()) continue;
      const ob = other.getBounds();
      const hOverlap = bounds.x < ob.x + ob.width + SNAP_THRESHOLD
                     && bounds.x + bounds.width > ob.x - SNAP_THRESHOLD;
      const vOverlap = bounds.y < ob.y + ob.height + SNAP_THRESHOLD
                     && bounds.y + bounds.height > ob.y - SNAP_THRESHOLD;
      if (hOverlap && vOverlap && Math.abs(width - ob.width) < SNAP_THRESHOLD) {
        width = ob.width;
        snapX = ob.x;  // 왼쪽 위치도 맞춤
        break;
      }
    }

    // 스냅된 너비가 실제 너비와 다르면 적용
    const [curW] = win.getSize();
    if (width !== curW) {
      win.setSize(width, current.collapsed ? HEADER_HEIGHT : height);
    }

    // 왼쪽 정렬 스냅
    if (snapX !== null) {
      const [, curY] = win.getPosition();
      win.setPosition(snapX, curY);
      store.update(postit.id, { x: snapX });
    }

    if (current.collapsed) {
      store.update(postit.id, { width });
    } else {
      store.update(postit.id, { width, height });
    }
  });

  // 앱 종료 / 창 닫기 시 최종 위치 저장
  win.on('close', () => {
    const [x, y] = win.getPosition();
    store.update(postit.id, { x, y });
  });

  win.on('closed', () => windows.delete(postit.id));

  // 수동 드래그 중 상단 가장자리에서 리사이즈 방지
  win.on('will-resize', (event) => {
    if (draggingPostits.has(postit.id)) event.preventDefault();
  });

  windows.set(postit.id, win);
  return win;
}

function generateId() {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createNewPostit() {
  const id     = generateId();
  const count  = windows.size;
  const offset = (count % 8) * 30;

  const postit = {
    id,
    content:   '',
    x:         150 + offset,
    y:         150 + offset,
    width:     DEFAULT_WIDTH,
    height:    DEFAULT_HEIGHT,
    collapsed: false,
    date:      '',   // YYYY-MM-DD 또는 빈값
    time:      '',   // HH:MM 또는 빈값
    priority:  3,    // 1~5 (기본 3.보통)
    hidden:    false,
    alarm:     false,
    alarmDays: [],     // 반복 요일 (0=일, 1=월, ..., 6=토)
    color:     '#ffff99',
  };

  store.create(postit);
  createPostitWindow(postit);
}

// ─── Delete helper ────────────────────────────────────────────────────────────
async function confirmAndDelete(id) {
  const win = windows.get(id);
  if (!win) return;

  const { response } = await dialog.showMessageBox(win, {
    type:      'question',
    buttons:   ['삭제', '취소'],
    defaultId: 1,
    cancelId:  1,
    message:   '이 포스트잇을 삭제할까요?',
  });

  if (response === 0) {
    store.delete(id);
    windows.delete(id);
    win.destroy();
    notifyManager();
  }
}

// ─── 숨기기 / 보이기 ─────────────────────────────────────────────────────────
function hidePostit(id) {
  store.update(id, { hidden: true });
  const win = windows.get(id);
  if (win && !win.isDestroyed()) {
    windows.delete(id);
    win.destroy();
  }
  notifyManager();
}

function unhidePostit(id) {
  const postit = store.get(id);
  if (!postit) return;
  store.update(id, { hidden: false });
  if (!windows.has(id)) {
    createPostitWindow(store.get(id));
  }
  const win = windows.get(id);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
  }
  notifyManager();
}

function activatePostit(id) {
  const postit = store.get(id);
  if (!postit) return;
  if (postit.hidden) {
    unhidePostit(id);
  } else {
    const win = windows.get(id);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.setAlwaysOnTop(true);
      win.setAlwaysOnTop(false);
    }
  }
}

// ─── 전체 목록 관리 창 ─────────────────────────────────────────────────────────
function openManager() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.focus();
    return;
  }

  managerWindow = new BrowserWindow({
    width: 780, height: 520,
    minWidth: 600, minHeight: 400,
    resizable: true, minimizable: true, maximizable: true,
    title: '포스트잇 전체 목록',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  managerWindow.setMenuBarVisibility(false);
  managerWindow.loadFile('manager.html');

  managerWindow.webContents.once('did-finish-load', () => {
    sendManagerData();
  });

  managerWindow.on('closed', () => { managerWindow = null; });
}

function sendManagerData() {
  if (!managerWindow || managerWindow.isDestroyed()) return;
  const allPostits = store.getAll().map(p => ({
    id:       p.id,
    content:  p.content || '',
    date:     p.date || '',
    time:     p.time || '',
    priority: p.priority ?? 3,
    hidden:   p.hidden || false,
    alarm:     p.alarm || false,
    alarmDays: p.alarmDays || [],
    color:     p.color || '#ffff99',
  }));
  managerWindow.webContents.send('manager-init', allPostits);
}

function notifyManager() {
  sendManagerData();
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-postit-data', (event) => {
  for (const [id, win] of windows.entries()) {
    if (win.webContents.id === event.sender.id) {
      return store.get(id);
    }
  }
  return null;
});

ipcMain.on('save-content', (_event, { id, content }) => {
  store.update(id, { content });
  notifyManager();
});

ipcMain.on('create-postit', () => {
  createNewPostit();
  notifyManager();
});

ipcMain.on('delete-postit', (_event, { id }) => confirmAndDelete(id));

ipcMain.on('toggle-collapse', (_event, { id }) => toggleCollapse(id));

// ─── 수동 드래그 IPC ──────────────────────────────────────────────────────
ipcMain.on('drag-start', (_event, { id }) => {
  draggingPostits.add(id);
  const win = windows.get(id);
  if (win && !win.isDestroyed()) {
    dragOriginalSize.set(id, win.getSize());
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = win.getPosition();
    dragOffset.set(id, { ox: cursor.x - winX, oy: cursor.y - winY });
  }
});

ipcMain.on('drag-move', (_event, { id }) => {
  const win = windows.get(id);
  const offset = dragOffset.get(id);
  if (!win || win.isDestroyed() || !offset) return;
  const cursor = screen.getCursorScreenPoint();
  const size = dragOriginalSize.get(id);
  const newX = cursor.x - offset.ox;
  const newY = cursor.y - offset.oy;
  if (size) {
    win.setBounds({ x: newX, y: newY, width: size[0], height: size[1] });
  } else {
    win.setPosition(newX, newY);
  }
});

ipcMain.on('drag-end', (_event, { id }) => {
  draggingPostits.delete(id);
  dragOriginalSize.delete(id);
  dragOffset.delete(id);
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return;

  // 자석 스냅 적용
  const bounds = win.getBounds();
  const snap = calcSnap(bounds, id);
  if (snap.snapped) {
    win.setPosition(snap.x, snap.y);
  }

  // 위치 저장
  const [x, y] = win.getPosition();
  store.update(id, { x, y });
});

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

// 포매터 → 서식 적용
ipcMain.on('formatter-apply', (event, formatting) => {
  const postitWC = formatterTargets.get(event.sender.id);
  if (postitWC && !postitWC.isDestroyed()) {
    postitWC.send('apply-formatting', formatting);
  }
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// 포매터 → 취소
ipcMain.on('formatter-cancel', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// 속성 편집 → 저장
ipcMain.on('properties-save', (event, props) => {
  const postitId = propertiesTargets.get(event.sender.id);
  if (postitId) {
    store.update(postitId, {
      date: props.date, time: props.time, priority: props.priority,
      alarm: props.alarm ?? false, alarmDays: props.alarmDays || [],
      color: props.color || '#ffff99',
    });
    const win = windows.get(postitId);
    if (win && !win.isDestroyed()) {
      win.webContents.send('properties-changed', props);
    }
    notifyManager();
  }
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// 속성 편집 → 취소
ipcMain.on('properties-cancel', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// ─── 알림 IPC ──────────────────────────────────────────────────────────────
ipcMain.on('notification-snooze', (_event, { id }) => {
  const postit = store.get(id);
  if (postit && postit.time) {
    const alarmDays = postit.alarmDays || [];

    if (alarmDays.length > 0 || !postit.date) {
      // 반복 알림(요일/매일): 시간 변경 없이 30분 쿨다운
      dismissedUntil.set(id, Date.now() + 30 * 60 * 1000);
    } else {
      // 1회 알림: 날짜+시간을 +30분
      const d = new Date(`${postit.date}T${postit.time}:00`);
      d.setMinutes(d.getMinutes() + 30);
      const newDate = d.toISOString().slice(0, 10);
      const newTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      store.update(id, { date: newDate, time: newTime });

      const win = windows.get(id);
      if (win && !win.isDestroyed()) {
        const updated = store.get(id);
        win.webContents.send('properties-changed', updated);
      }
      notifyManager();
    }
  }
  closeNotification(id);
});

ipcMain.on('notification-cancel', (_event, { id }) => {
  store.update(id, { alarm: false });
  const win = windows.get(id);
  if (win && !win.isDestroyed()) {
    const updated = store.get(id);
    win.webContents.send('properties-changed', updated);
  }
  notifyManager();
  closeNotification(id);
});

ipcMain.on('notification-dismiss', (_event, { id }) => {
  // 5분 후 재알림 허용
  dismissedUntil.set(id, Date.now() + 5 * 60 * 1000);
  closeNotification(id);
});

// ─── Manager IPC ──────────────────────────────────────────────────────────────
ipcMain.on('manager-hide', (_event, { ids }) => {
  ids.forEach(id => hidePostit(id));
});

ipcMain.on('manager-unhide', (_event, { ids }) => {
  ids.forEach(id => unhidePostit(id));
});

ipcMain.on('manager-delete', async (_event, { ids }) => {
  if (!managerWindow || managerWindow.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(managerWindow, {
    type:      'question',
    buttons:   ['삭제', '취소'],
    defaultId: 1,
    cancelId:  1,
    message:   `선택한 ${ids.length}개 포스트잇을 삭제할까요?`,
  });
  if (response === 0) {
    ids.forEach(id => {
      const win = windows.get(id);
      if (win && !win.isDestroyed()) {
        windows.delete(id);
        win.destroy();
      }
      store.delete(id);
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

ipcMain.on('manager-show-all', () => {
  store.getAll().forEach(p => {
    if (p.hidden) unhidePostit(p.id);
  });
  for (const win of windows.values()) {
    if (win.isDestroyed()) continue;
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
  }
});

ipcMain.on('manager-hide-all', () => {
  store.getAll().forEach(p => {
    if (!p.hidden) hidePostit(p.id);
  });
});

// ─── 알림 스케줄러 ──────────────────────────────────────────────────────────
function checkAlarms() {
  const now = new Date();
  const nowTs = now.getTime();
  const checkFrom = lastAlarmCheck || nowTs; // 첫 실행 시 now 기준
  lastAlarmCheck = nowTs;

  const allPostits = store.getAll();

  for (const p of allPostits) {
    // 기본 조건: 알림 활성 + 시간 설정
    if (!p.alarm || !p.time) continue;

    // 이미 알림 창이 열려 있으면 스킵
    if (notificationWindows.has(p.id)) continue;

    // 무시(dismiss) 후 재알림 금지 기간이면 스킵
    const dismissTime = dismissedUntil.get(p.id);
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

      // 자정 경계: 어제도 체크
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

      // 자정 경계: 어제도 체크
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

function showNotification(postit) {
  const display = screen.getPrimaryDisplay();
  const { width: workW, height: workH } = display.workAreaSize;
  const { x: workX, y: workY } = display.workArea;

  // 여러 알림이 있을 때 위로 누적
  const offset = notificationWindows.size * 150;

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

  nwin.loadFile('notification.html');

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

  notificationWindows.set(postit.id, nwin);
  nwin.on('closed', () => notificationWindows.delete(postit.id));
}

function closeNotification(id) {
  const nwin = notificationWindows.get(id);
  if (nwin && !nwin.isDestroyed()) {
    nwin.destroy();
  }
  notificationWindows.delete(id);
}

// ─── 시스템 트레이 ──────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'img', 'postit.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('MyPostit');

  // 더블클릭 → 모든 포스트잇 맨 위로 활성화
  tray.on('double-click', () => {
    for (const win of windows.values()) {
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
      // 숨겨진 포스트잇도 unhide
      store.getAll().forEach(p => { if (p.hidden) unhidePostit(p.id); });
      for (const win of windows.values()) {
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
  tray.setContextMenu(contextMenu);
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  store.init();
  createTray();

  const postits = store.getAll();
  const visible = postits.filter(p => !p.hidden);
  if (postits.length === 0) {
    createNewPostit();
  } else {
    visible.forEach(createPostitWindow);
  }

  // 알림 스케줄러: 30초마다 체크
  setInterval(checkAlarms, 30000);
  checkAlarms(); // 앱 시작 시 즉시 체크
});

// 모든 창 닫혀도 트레이가 있으므로 종료하지 않음
app.on('window-all-closed', () => {
  // 트레이 아이콘이 있으면 앱 유지
});

app.on('activate', () => {
  if (windows.size === 0) createNewPostit();
});
