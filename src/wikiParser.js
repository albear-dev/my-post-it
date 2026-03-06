/**
 * @file Markdown(GitLab Flavored) → HTML 변환기
 *
 * marked v12 + highlight.js 기반으로 GFM Markdown을 HTML로 변환한다.
 * 지원 문법: 제목, 굵게, 기울임, 취소선, 중첩 목록, 체크박스,
 *           인용, 인라인 코드, 코드 블록(구문 강조), 수평선, 링크,
 *           이미지, 표, 나무위키 색상({{{#color text}}})
 */

const { marked } = require('marked');
const hljs = require('highlight.js');

// ── marked 설정 (모듈 로드 시 1회) ─────────────────────────
// marked v12 API: renderer 메서드는 위치 파라미터(positional params) 사용

marked.use({
  breaks: true,   // 줄바꿈 → <br> (포스트잇에 필수)
  gfm: true,      // 표, 취소선, 체크박스, 자동링크
  renderer: {
    // ── 체크박스 목록 아이템 ──
    // v12: listitem(text, task, checked)
    listitem(text, task, checked) {
      if (task) {
        const checkedAttr = checked ? ' checked' : '';
        const textClass = checked ? ' class="checked-text"' : '';
        // marked가 생성한 기본 checkbox 제거
        text = text.replace(/<input[^>]*>\s*/, '');
        return `<li><input type="checkbox" class="postit-checkbox"${checkedAttr}><span${textClass}>${text}</span></li>\n`;
      }
      return `<li>${text}</li>\n`;
    },

    // ── 목록 컨테이너 ──
    // v12: list(body, ordered, start)
    list(body, ordered, start) {
      if (ordered) {
        const startAttr = (start != null && start !== 1) ? ` start="${start}"` : '';
        return `<ol${startAttr}>${body}</ol>\n`;
      }
      // 체크박스 목록이면 리스트 마커 숨김
      const isTask = body.includes('class="postit-checkbox"');
      if (isTask) return `<ul style="list-style:none;padding-left:4px;">${body}</ul>\n`;
      return `<ul>${body}</ul>\n`;
    },

    // ── 링크 (새 탭) ──
    // v12: link(href, title, text)
    link(href, title, text) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}" target="_blank"${titleAttr}>${text}</a>`;
    },

    // ── 이미지 (크기 지정 지원: ![alt|WxH](url)) ──
    // v12: image(href, title, text)
    image(href, title, text) {
      const titleAttr = title ? ` title="${title}"` : '';
      // alt에서 크기 파싱: "name|200" 또는 "name|200x300"
      let alt = text;
      let style = 'max-width:100%;height:auto;';
      const sizeMatch = text.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
      if (sizeMatch) {
        alt = sizeMatch[1];
        const w = sizeMatch[2];
        const h = sizeMatch[3];
        style = h ? `width:${w}px;height:${h}px;` : `width:${w}px;height:${w}px;`;
      }
      return `<img src="${href}" alt="${alt}"${titleAttr} style="${style}">`;
    },

    // ── 코드 블록 (highlight.js 직접 호출) ──
    // v12: code(code, language, isEscaped)
    code(code, lang) {
      const langAttr = lang ? ` data-lang="${lang}"` : '';
      let highlighted;
      if (lang && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        highlighted = code;
      }
      const langClass = lang ? ` class="hljs language-${lang}"` : '';
      // 라인 수 계산
      const lines = highlighted.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const lineNums = lines.map((_ln, i) => `<span>${i + 1}</span>`).join('');
      // 헤더 (언어 라벨 + 복사 버튼)
      const langLabel = lang ? lang : 'code';
      const header = `<div class="code-header"><span class="code-lang" title="Click to change language">${langLabel}</span><span class="code-copy" title="Copy">📋</span></div>`;
      const body = `<div class="code-body"><div class="code-lines">${lineNums}</div><pre${langAttr}><code${langClass} contenteditable="true" spellcheck="false">${lines.join('\n')}</code></pre></div>`;
      return `<div class="code-block" contenteditable="false">${header}${body}</div>\n`;
    }
  }
});

// ── parseWiki ───────────────────────────────────────────────

/**
 * Markdown 텍스트를 HTML로 변환한다.
 * @param {string} text - Markdown 텍스트
 * @returns {string} HTML 문자열
 */
function parseWiki(text) {
  if (!text) return '';

  // ── 코드 블록/인라인 코드 보호 (이스케이프 치환에서 제외) ──
  const codeSlots = [];
  let src = text;
  src = src.replace(/```[\s\S]*?```/g, (m) => {
    codeSlots.push(m);
    return `\x01CODE${codeSlots.length - 1}\x01`;
  });
  src = src.replace(/`[^`]+`/g, (m) => {
    codeSlots.push(m);
    return `\x01CODE${codeSlots.length - 1}\x01`;
  });

  // ── 백슬래시 이스케이프 → 플레이스홀더 (marked가 처리하기 전) ──
  src = src.replace(/\\([^a-zA-Z0-9\s])/g, (_m, ch) => {
    return `\x00ESC${ch.charCodeAt(0)}\x00`;
  });

  // ── 나무위키 색상 문법: {{{#color text}}} → <span> ──
  // {{{#color content}}} — 글자색만
  // {{{#color1#color2 content}}} — 글자색 + 배경색
  let prevSrc;
  do {
    prevSrc = src;
    src = src.replace(/\{\{\{#([a-zA-Z0-9]+)(?:#([a-zA-Z0-9]+))?\s+((?:(?!\{\{\{).)*?)\}\}\}/g,
      (_m, c1, c2, content) => {
        const textColor = namuColorToCSS(c1);
        let style = `color:${textColor}`;
        if (c2) style += `;background-color:${namuColorToCSS(c2)}`;
        return `<span style="${style}">${content}</span>`;
      });
  } while (src !== prevSrc);

  // ── 빈 줄 보존 (3+ 연속 줄바꿈 → 마커 단락) ──
  // 코드 블록이 플레이스홀더 상태이므로 코드 내부 빈 줄에 영향 없음
  src = src.replace(/\n{3,}/g, (m) => {
    const extra = m.length - 2; // \n\n = 1개 단락 구분, 나머지는 추가 빈 줄
    return '\n\n' + '\x01EMP\x01\n\n'.repeat(extra);
  });

  // ── 코드 블록 복원 ──
  src = src.replace(/\x01CODE(\d+)\x01/g, (_m, idx) => codeSlots[+idx]);

  // ── marked 실행 ──
  let html = marked.parse(src).trim();

  // ── 빈 줄 마커 → 빈 단락 ──
  html = html.replace(/<p>\x01EMP\x01<\/p>/g, '<p><br></p>');

  // ── 플레이스홀더 → <span data-esc="charCode"> (HTML 에디터에서 보존) ──
  html = html.replace(/\x00ESC(\d+)\x00/g, (_m, code) => {
    return `<span data-esc="${code}">&#${code};</span>`;
  });

  return html;
}

// ── wikiToPlainText ─────────────────────────────────────────

/**
 * Markdown 텍스트에서 플레인 텍스트를 추출한다.
 * 타이틀 바 표시용.
 * @param {string} text - Markdown 텍스트
 * @returns {string} 플레인 텍스트 (첫 줄)
 */
function wikiToPlainText(text) {
  if (!text) return '';
  const lines = text.split('\n');
  for (const line of lines) {
    let clean = line.trim();
    if (!clean) continue;
    if (clean.startsWith('```')) continue;
    // 표 구분선 건너뛰기
    if (/^\|[\s\-:|]+\|$/.test(clean)) continue;
    // 표 행 → 첫 셀 텍스트 추출
    if (clean.startsWith('|') && clean.endsWith('|')) {
      clean = clean.replace(/^\|/, '').replace(/\|$/, '').split('|')[0].trim();
    }
    clean = clean.replace(/^#{1,6}\s+/, '');
    clean = clean.replace(/^>\s*/, '');
    clean = clean.replace(/^-\s+\[[ xX]\]\s*/, '');
    clean = clean.replace(/^[-*+]\s+/, '');
    clean = clean.replace(/^\d+\.\s+/, '');
    // 이미지: ![alt|size](url) → alt
    clean = clean.replace(/!\[([^\]]*?)(?:\|\d+(?:x\d+)?)?\]\([^)]+\)/g, '$1');
    clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1');
    clean = clean.replace(/\*([^*]+)\*/g, '$1');
    clean = clean.replace(/~~([^~]+)~~/g, '$1');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // 나무위키 색상 문법 제거
    clean = clean.replace(/\{\{\{#[a-zA-Z0-9]+(?:#[a-zA-Z0-9]+)?\s+([\s\S]*?)\}\}\}/g, '$1');
    if (clean) return clean;
  }
  return '';
}

/**
 * 나무위키 색상값 → CSS 색상 ("ff85b1" → "#ff85b1", "red" → "red")
 */
function namuColorToCSS(val) {
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(val)) return '#' + val;
  return val;
}

module.exports = { parseWiki, wikiToPlainText };
