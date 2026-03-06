/**
 * @file 포스트잇 히스토리/백업 시스템
 *
 * 수동(Ctrl+S) 및 자동(주기적) 백업을 관리한다.
 * 백업 파일은 userData/history/ 폴더에 저장된다.
 */

const { app, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

const state = require('./state');

/** 백업 저장 폴더 경로 */
let historyDir = '';

/** 변경 감지 플래그 */
let dirty = false;

/** 자동 백업 타이머 ID */
let autoBackupTimer = null;

/** 최대 백업 보관 수 */
const MAX_BACKUPS = 100;

/**
 * 히스토리 모듈을 초기화한다.
 * history 폴더를 생성하고 자동 백업 타이머를 시작한다.
 */
function initHistory() {
  historyDir = path.join(app.getPath('userData'), 'history');
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  startAutoBackup();
}

/**
 * 백업을 생성한다.
 * 현재 postits.json 내용을 타임스탬프 파일명으로 복사한다.
 *
 * @param {string} [reason='manual'] - 백업 사유 (manual/auto/pre-restore)
 * @returns {string|null} 생성된 백업 파일명 또는 null
 */
function createBackup(reason = 'manual') {
  if (!state.store || !state.store.dbPath) return null;

  try {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '_'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');

    const filename = `postits_${ts}.json`;
    const srcPath = state.store.dbPath;
    const destPath = path.join(historyDir, filename);

    // 원본 파일이 존재하지 않으면 스킵
    if (!fs.existsSync(srcPath)) return null;

    fs.copyFileSync(srcPath, destPath);
    pruneOldBackups();

    // 히스토리 창이 열려있으면 갱신
    notifyHistoryWindow();

    return filename;
  } catch (err) {
    console.error('[history] createBackup failed:', err.message);
    return null;
  }
}

/**
 * 데이터 변경 플래그를 설정한다.
 * 백업 주기가 '매번(0)'이면 즉시 백업한다.
 */
function markDirty() {
  const interval = state.store ? (state.store.getSetting('backupInterval') ?? 60000) : 60000;
  if (interval === 0) {
    createBackup('auto');
  } else {
    dirty = true;
  }
}

/**
 * 자동 백업 타이머를 시작/재시작한다.
 */
function startAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }

  const interval = state.store ? (state.store.getSetting('backupInterval') ?? 60000) : 60000;

  // '매번(0)' 설정이면 타이머 불필요 (markDirty에서 즉시 백업)
  if (interval === 0) return;

  autoBackupTimer = setInterval(() => {
    if (dirty) {
      dirty = false;
      createBackup('auto');
    }
  }, interval);
}

/**
 * 백업 주기를 변경하고 타이머를 재시작한다.
 *
 * @param {number} ms - 백업 주기 (0=매번, 60000=1분, 600000=10분, 1800000=30분)
 */
function setBackupInterval(ms) {
  if (state.store) {
    state.store.setSetting('backupInterval', ms);
  }
  startAutoBackup();
  // 트레이 메뉴 갱신
  const { rebuildTrayMenu } = require('./tray');
  rebuildTrayMenu();
}

/**
 * 백업 파일 목록을 반환한다 (최신순).
 *
 * @returns {{ filename: string, timestamp: string, size: number, count: number }[]}
 */
function getBackupList() {
  if (!historyDir || !fs.existsSync(historyDir)) return [];

  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith('postits_') && f.endsWith('.json'))
    .sort()
    .reverse();

  return files.map(filename => {
    const filePath = path.join(historyDir, filename);
    const stat = fs.statSync(filePath);

    // 포스트잇 수 카운트
    let count = 0;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      count = data.postits ? Object.keys(data.postits).length : 0;
    } catch { /* ignore */ }

    // 파일명에서 타임스탬프 추출: postits_YYYYMMDD_HHmmss.json
    const match = filename.match(/postits_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json/);
    let timestamp = '';
    if (match) {
      timestamp = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
    }

    return { filename, timestamp, size: stat.size, count };
  });
}

/**
 * 백업 파일 내용을 미리보기한다.
 *
 * @param {string} filename - 백업 파일명
 * @returns {{ titles: string[], count: number }|null}
 */
function previewBackup(filename) {
  const filePath = path.join(historyDir, filename);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const postits = data.postits ? Object.values(data.postits) : [];
    const titles = postits.map(p => {
      if (p.locked) return '🔒';
      if (!p.content) return '(empty)';
      // 텍스트 추출
      const text = p.contentType === 'wiki'
        ? p.content.split('\n').find(l => l.trim()) || ''
        : p.content.replace(/<[^>]+>/g, '').split('\n').find(l => l.trim()) || '';
      return text.substring(0, 60).trim();
    });
    return { titles, count: postits.length };
  } catch {
    return null;
  }
}

/**
 * 백업에서 복구한다.
 *
 * @param {string} filename - 백업 파일명
 * @returns {boolean} 성공 여부
 */
function restoreBackup(filename) {
  const filePath = path.join(historyDir, filename);
  try {
    // 1. 현재 데이터 먼저 백업
    createBackup('pre-restore');

    // 2. 백업 파일 로드
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.postits) return false;

    // 3. 현재 데이터 교체
    state.store.data.postits = data.postits;
    state.store._save();

    // 4. 모든 포스트잇 창 재로드
    const { reloadAllPostits } = require('./postitWindow');
    reloadAllPostits();

    // 5. 매니저/캘린더 갱신
    const { notifyManager } = require('./manager');
    const { notifyCalendar } = require('./calendar');
    notifyManager();
    notifyCalendar();

    return true;
  } catch (err) {
    console.error('[history] restoreBackup failed:', err.message);
    return false;
  }
}

/**
 * 백업 파일을 삭제한다.
 *
 * @param {string} filename - 백업 파일명
 * @returns {boolean} 성공 여부
 */
function deleteBackup(filename) {
  const filePath = path.join(historyDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      notifyHistoryWindow();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 오래된 백업을 정리한다 (MAX_BACKUPS 초과 시 가장 오래된 것 삭제).
 */
function pruneOldBackups() {
  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith('postits_') && f.endsWith('.json'))
    .sort();

  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    try {
      fs.unlinkSync(path.join(historyDir, oldest));
    } catch { /* ignore */ }
  }
}

/**
 * 히스토리 창이 열려있으면 목록을 갱신한다.
 */
function notifyHistoryWindow() {
  if (state.historyWindow && !state.historyWindow.isDestroyed()) {
    state.historyWindow.webContents.send('history-updated', getBackupList());
  }
}

/**
 * 데이터를 비밀번호 보호 ZIP으로 내보낸다.
 *
 * @param {string} filePath - 저장할 ZIP 파일 경로
 * @param {string} password - ZIP 비밀번호
 * @returns {Promise<boolean>} 성공 여부
 */
async function exportData(filePath, password) {
  if (!state.store || !state.store.dbPath) return false;

  try {
    const archiver = require('archiver');
    require('archiver-zip-encrypted');
    const output = fs.createWriteStream(filePath);

    const archive = archiver.create('zip-encrypted', {
      zlib: { level: 9 },
      encryptionMethod: 'aes256',
      password,
    });

    return new Promise((resolve, reject) => {
      output.on('close', () => resolve(true));
      archive.on('error', err => reject(err));

      archive.pipe(output);
      archive.file(state.store.dbPath, { name: 'postits.json' });
      archive.finalize();
    });
  } catch (err) {
    console.error('[history] exportData failed:', err.message);
    return false;
  }
}

/**
 * 비밀번호 보호 ZIP에서 데이터를 불러온다.
 *
 * @param {string} filePath - ZIP 파일 경로
 * @param {string} password - ZIP 비밀번호
 * @returns {Promise<boolean>} 성공 여부
 */
async function importData(filePath, password) {
  try {
    const unzipper = require('unzipper');
    const directory = await unzipper.Open.file(filePath);

    const entry = directory.files.find(f => f.path === 'postits.json');
    if (!entry) return false;

    const buffer = await entry.buffer(password);
    const data = JSON.parse(buffer.toString('utf8'));
    if (!data.postits) return false;

    // 현재 데이터 백업
    createBackup('pre-import');

    // 데이터 교체
    state.store.data.postits = data.postits;
    if (data.settings) {
      state.store.data.settings = { ...state.store.data.settings, ...data.settings };
    }
    state.store._save();

    // 모든 포스트잇 창 재로드
    const { reloadAllPostits } = require('./postitWindow');
    reloadAllPostits();

    // 매니저/캘린더 갱신
    const { notifyManager } = require('./manager');
    const { notifyCalendar } = require('./calendar');
    notifyManager();
    notifyCalendar();

    return true;
  } catch (err) {
    console.error('[history] importData failed:', err.message);
    return false;
  }
}

module.exports = {
  initHistory,
  createBackup,
  markDirty,
  setBackupInterval,
  getBackupList,
  previewBackup,
  restoreBackup,
  deleteBackup,
  startAutoBackup,
  exportData,
  importData,
};
