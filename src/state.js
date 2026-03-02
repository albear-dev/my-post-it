/**
 * @file 애플리케이션 공유 상태
 *
 * 모든 모듈이 이 파일을 require 하여 공유 상태에 접근한다.
 * 순환 의존성 방지를 위해 상태만 보유하고 로직은 포함하지 않는다.
 */

module.exports = {
  /** @type {import('./store')|null} PostitStore 인스턴스 (main.js에서 초기화) */
  store: null,

  /** @type {Map<string, import('electron').BrowserWindow>} postitId → BrowserWindow */
  windows: new Map(),

  /** @type {Map<number, import('electron').WebContents>} formatter webContentsId → postit webContents */
  formatterTargets: new Map(),

  /** @type {Map<number, string>} properties webContentsId → postitId */
  propertiesTargets: new Map(),

  /** @type {import('electron').Tray|null} 시스템 트레이 아이콘 */
  tray: null,

  /** @type {import('electron').BrowserWindow|null} 전체 목록 관리 창 (싱글턴) */
  managerWindow: null,

  /** @type {Map<string, import('electron').BrowserWindow>} postitId → notification BrowserWindow */
  notificationWindows: new Map(),

  /** @type {Map<string, number>} postitId → timestamp (무시 후 재알림 금지 만료 시각) */
  dismissedUntil: new Map(),

  /** @type {number|null} 알림 스케줄러가 마지막으로 체크한 시각 (ms timestamp) */
  lastAlarmCheck: null,

  /** @type {Map<number, {postitId: string, action: string}>} password dialog webContentsId → target info */
  passwordDialogTargets: new Map(),

  /** @type {Set<string>} 수동 드래그 중인 포스트잇 ID 집합 */
  draggingPostits: new Set(),

  /** @type {Map<string, number[]>} 드래그 시작 시 원본 크기 (id → [width, height]) */
  dragOriginalSize: new Map(),

  /** @type {Map<string, {ox: number, oy: number}>} 드래그 시작 시 커서↔창 오프셋 */
  dragOffset: new Map(),
};
