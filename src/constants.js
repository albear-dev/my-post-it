/**
 * @file 애플리케이션 전역 상수 정의
 */

/** 포스트잇 타이틀 바(헤더) 높이 (px) */
const HEADER_HEIGHT = 28;

/** 새 포스트잇 기본 너비 (px) */
const DEFAULT_WIDTH = 300;

/** 새 포스트잇 기본 높이 (px) */
const DEFAULT_HEIGHT = 300;

/** 자석 스냅 감지 거리 (px) — 이 거리 이내로 접근하면 가장자리에 달라붙음 */
const SNAP_THRESHOLD = 15;

module.exports = { HEADER_HEIGHT, DEFAULT_WIDTH, DEFAULT_HEIGHT, SNAP_THRESHOLD };
