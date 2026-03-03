/**
 * @file 다국어(i18n) 지원 모듈
 *
 * 언어별 JSON 파일을 로드하고 번역 키를 조회하는 기능을 제공한다.
 * 영어(en)를 기본 fallback으로 사용하며, 런타임에 언어 전환이 가능하다.
 *
 * 언어 파일 탐색 순서:
 * 1. 실행파일 옆 lang/ (패키징 후 사용자 커스터마이징용)
 * 2. 앱 번들 내 lang/ (개발 + 패키징 기본)
 */

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

const state = require('./state');

/** @type {Object} 영어(fallback) 번역 데이터 */
let fallback = {};

/** @type {Object} 현재 로케일 번역 데이터 */
let current = {};

/** @type {string} 현재 로케일 코드 */
let currentLocale = 'en';

/**
 * lang/ 디렉토리 경로 후보 목록을 반환한다.
 * @returns {string[]} 탐색할 디렉토리 경로 배열
 */
function getLangDirs() {
  return [
    path.join(path.dirname(process.execPath), 'lang'),
    path.join(app.getAppPath(), 'lang'),
  ];
}

/**
 * 지정 로케일의 JSON 파일을 로드한다.
 * 실행파일 옆 lang/를 먼저 탐색하고, 없으면 앱 번들 내 lang/를 사용한다.
 *
 * @param {string} locale - 로케일 코드 (예: 'en', 'ko')
 * @returns {Object} 번역 데이터 객체 (로드 실패 시 빈 객체)
 */
function loadLocale(locale) {
  const dirs = getLangDirs();
  for (const dir of dirs) {
    const filePath = path.join(dir, `${locale}.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // 이 경로에 없으면 다음 경로 시도
    }
  }
  return {};
}

/**
 * i18n을 초기화한다. 영어 fallback을 로드하고 지정 로케일을 설정한다.
 *
 * @param {string} [locale='en'] - 초기 로케일 코드
 */
function init(locale) {
  fallback = loadLocale('en');
  currentLocale = locale || 'en';
  current = currentLocale === 'en' ? fallback : loadLocale(currentLocale);
}

/**
 * 로케일을 변경한다.
 *
 * @param {string} locale - 새 로케일 코드
 */
function setLocale(locale) {
  currentLocale = locale;
  current = locale === 'en' ? fallback : loadLocale(locale);
}

/**
 * 번역 키에 해당하는 문자열을 반환한다.
 * 현재 로케일 → 영어 fallback → 키 자체를 반환한다.
 * `{param}` 형태의 파라미터 치환을 지원한다.
 *
 * @param {string} key - 번역 키 (예: 'tray.newPostit')
 * @param {Object} [params] - 치환 파라미터 (예: { count: 3 })
 * @returns {string} 번역된 문자열
 */
function t(key, params) {
  let str = current[key] || fallback[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

/**
 * 렌더러에 전달할 병합된 번역 객체를 반환한다.
 * 영어 fallback 위에 현재 로케일을 덮어쓴 결과.
 *
 * @returns {Object} 병합된 번역 데이터
 */
function getAllTranslations() {
  return { ...fallback, ...current };
}

/**
 * 현재 로케일 코드를 반환한다.
 *
 * @returns {string} 로케일 코드
 */
function getLocale() {
  return currentLocale;
}

/**
 * 사용 가능한 로케일 목록을 반환한다.
 * lang/ 디렉토리를 스캔하여 JSON 파일의 _meta 정보를 수집한다.
 *
 * @returns {{ code: string, name: string, nativeName: string }[]} 로케일 목록
 */
function getAvailableLocales() {
  const locales = [];
  const seen = new Set();
  const dirs = getLangDirs();

  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const code = file.replace('.json', '');
        if (seen.has(code)) continue;
        seen.add(code);
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          if (data._meta) {
            locales.push({
              code:       data._meta.code || code,
              name:       data._meta.name || code,
              nativeName: data._meta.nativeName || data._meta.name || code,
            });
          }
        } catch {
          // 파싱 실패 → 스킵
        }
      }
    } catch {
      // 디렉토리 없음 → 스킵
    }
  }

  return locales;
}

/**
 * 언어를 전환한다.
 * store에 설정을 저장하고, 모든 열린 창에 번역을 브로드캐스트한다.
 *
 * @param {string} locale - 새 로케일 코드
 */
function switchLanguage(locale) {
  setLocale(locale);
  state.store.setSetting('locale', locale);

  // 모든 포스트잇 창에 번역 전송
  const translations = getAllTranslations();
  for (const win of state.windows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send('set-translations', translations);
    }
  }

  // 매니저 창에 번역 전송
  if (state.managerWindow && !state.managerWindow.isDestroyed()) {
    state.managerWindow.webContents.send('set-translations', translations);
  }

  // 캘린더 창에 번역 전송
  if (state.calendarWindow && !state.calendarWindow.isDestroyed()) {
    state.calendarWindow.webContents.send('set-translations', translations);
  }

  // 알림 창에 번역 전송
  for (const nwin of state.notificationWindows.values()) {
    if (!nwin.isDestroyed()) {
      nwin.webContents.send('set-translations', translations);
    }
  }

  // 포매터/속성 창에 번역 전송
  const { BrowserWindow } = require('electron');
  for (const fwcId of state.formatterTargets.keys()) {
    const win = BrowserWindow.getAllWindows().find(
      w => !w.isDestroyed() && w.webContents.id === fwcId
    );
    if (win) win.webContents.send('set-translations', translations);
  }
  for (const pwcId of state.propertiesTargets.keys()) {
    const win = BrowserWindow.getAllWindows().find(
      w => !w.isDestroyed() && w.webContents.id === pwcId
    );
    if (win) win.webContents.send('set-translations', translations);
  }

  // 트레이 메뉴 재빌드
  const { rebuildTrayMenu } = require('./tray');
  rebuildTrayMenu();
}

module.exports = {
  init,
  setLocale,
  t,
  getAllTranslations,
  getLocale,
  getAvailableLocales,
  switchLanguage,
};
