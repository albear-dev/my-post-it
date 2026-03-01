/**
 * @file 포스트잇 데이터 영속화 (JSON 파일 기반 로컬 DB)
 *
 * userData 경로에 postits.json 파일을 생성/관리하며,
 * 모든 포스트잇의 CRUD 작업을 동기적으로 처리한다.
 */

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

class PostitStore {
  constructor() {
    /** @type {string|null} JSON 파일 절대 경로 */
    this.dbPath = null;
    /** @type {{ postits: Object.<string, Object> }} 전체 데이터 */
    this.data = { postits: {} };
  }

  /**
   * DB 파일 경로를 초기화하고 기존 데이터를 로드한다.
   * 파일이 없거나 파싱 실패 시 빈 데이터로 시작한다.
   */
  init() {
    this.dbPath = path.join(app.getPath('userData'), 'postits.json');
    try {
      this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    } catch {
      this.data = { postits: {} };
    }
  }

  /**
   * 현재 데이터를 JSON 파일에 동기 저장한다.
   * @private
   */
  _save() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * 모든 포스트잇을 배열로 반환한다.
   * @returns {Object[]} 포스트잇 객체 배열
   */
  getAll() { return Object.values(this.data.postits); }

  /**
   * 특정 포스트잇을 ID로 조회한다.
   * @param {string} id - 포스트잇 ID
   * @returns {Object|undefined} 포스트잇 객체 또는 undefined
   */
  get(id) { return this.data.postits[id]; }

  /**
   * 새 포스트잇을 저장하고 반환한다.
   * @param {Object} postit - 저장할 포스트잇 객체 (id 필수)
   * @returns {Object} 저장된 포스트잇 객체
   */
  create(postit) {
    this.data.postits[postit.id] = postit;
    this._save();
    return postit;
  }

  /**
   * 기존 포스트잇의 필드를 부분 업데이트한다.
   * @param {string} id - 포스트잇 ID
   * @param {Object} updates - 업데이트할 필드 (Object.assign으로 병합)
   */
  update(id, updates) {
    if (this.data.postits[id]) {
      Object.assign(this.data.postits[id], updates);
      this._save();
    }
  }

  /**
   * 포스트잇을 영구 삭제한다.
   * @param {string} id - 삭제할 포스트잇 ID
   */
  delete(id) {
    delete this.data.postits[id];
    this._save();
  }

  /**
   * 앱 설정값을 조회한다.
   * @param {string} key - 설정 키
   * @returns {*} 설정값 (없으면 undefined)
   */
  getSetting(key) {
    return this.data.settings && this.data.settings[key];
  }

  /**
   * 앱 설정값을 저장한다.
   * @param {string} key - 설정 키
   * @param {*} val - 설정값
   */
  setSetting(key, val) {
    if (!this.data.settings) this.data.settings = {};
    this.data.settings[key] = val;
    this._save();
  }
}

module.exports = PostitStore;
