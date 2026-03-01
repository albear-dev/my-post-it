/**
 * @file 수동 드래그 IPC 핸들러
 *
 * -webkit-app-region: drag 대신 JS 기반 수동 드래그를 구현한다.
 * DPI 스케일링 문제를 방지하기 위해 메인 프로세스에서
 * screen.getCursorScreenPoint()로 좌표를 직접 계산한다.
 */

const { ipcMain, screen } = require('electron');

const state = require('./state');
const { calcSnap } = require('./postitWindow');

/**
 * 수동 드래그 관련 IPC 핸들러를 등록한다.
 *
 * - drag-start: 드래그 시작 — 원본 크기·커서 오프셋 저장
 * - drag-move: 드래그 중 — 커서 위치 기반으로 창 이동 (setBounds로 크기 유지)
 * - drag-end: 드래그 종료 — 자석 스냅 적용 + 위치 저장 + 상태 정리
 */
function registerDragHandlers() {

  /**
   * 드래그 시작: 원본 크기와 커서↔창 오프셋을 기록한다.
   * 렌더러는 포스트잇 ID만 전송하고 좌표 계산은 메인 프로세스가 담당한다.
   */
  ipcMain.on('drag-start', (_event, { id }) => {
    state.draggingPostits.add(id);
    const win = state.windows.get(id);
    if (win && !win.isDestroyed()) {
      state.dragOriginalSize.set(id, win.getSize());
      const cursor = screen.getCursorScreenPoint();
      const [winX, winY] = win.getPosition();
      state.dragOffset.set(id, { ox: cursor.x - winX, oy: cursor.y - winY });
    }
  });

  /**
   * 드래그 중: 커서 위치에서 오프셋을 빼서 창 위치를 계산한다.
   * setBounds를 사용하여 DPI 스케일링에 의한 크기 변화를 방지한다.
   */
  ipcMain.on('drag-move', (_event, { id }) => {
    const win = state.windows.get(id);
    const offset = state.dragOffset.get(id);
    if (!win || win.isDestroyed() || !offset) return;
    const cursor = screen.getCursorScreenPoint();
    const size = state.dragOriginalSize.get(id);
    const newX = cursor.x - offset.ox;
    const newY = cursor.y - offset.oy;
    if (size) {
      win.setBounds({ x: newX, y: newY, width: size[0], height: size[1] });
    } else {
      win.setPosition(newX, newY);
    }
  });

  /**
   * 드래그 종료: 자석 스냅 적용 후 위치를 저장하고 드래그 상태를 정리한다.
   */
  ipcMain.on('drag-end', (_event, { id }) => {
    state.draggingPostits.delete(id);
    state.dragOriginalSize.delete(id);
    state.dragOffset.delete(id);
    const win = state.windows.get(id);
    if (!win || win.isDestroyed()) return;

    // 자석 스냅 적용
    const bounds = win.getBounds();
    const snap = calcSnap(bounds, id);
    if (snap.snapped) {
      win.setPosition(snap.x, snap.y);
    }

    // 위치 저장
    const [x, y] = win.getPosition();
    state.store.update(id, { x, y });
  });
}

module.exports = { registerDragHandlers };
