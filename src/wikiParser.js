/**
 * @file Markdown(GitLab Flavored) ↔ HTML 변환기
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

// ── htmlToWiki ──────────────────────────────────────────────

/**
 * HTML을 Markdown 텍스트로 변환한다.
 * 모드 전환(HTML→Wiki) 시 사용. 완벽하지 않은 변환이므로 손실 가능.
 * @param {string} html - HTML 문자열
 * @returns {string} Markdown 텍스트
 */
function htmlToWiki(html) {
  if (!html) return '';

  let text = html;

  // 0. 백슬래시 이스케이프 복원 (<span data-esc="charCode"> → \X)
  text = text.replace(/<span\s+data-esc="(\d+)">[^<]*<\/span>/gi, (_m, code) => {
    return `\\${String.fromCharCode(+code)}`;
  });

  // 1. 코드 블록 추출 (내부 줄바꿈 + hljs span 보존)
  // 1-0. code-block 래퍼(헤더, 라인넘버 div 포함) 제거 → <pre> 만 남김
  text = text.replace(/<div class="code-block"[^>]*>[\s\S]*?(<pre[\s\S]*?<\/pre>)\s*<\/div>/gi, '$1');
  const preserved = [];
  text = text.replace(/<pre([^>]*)><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_m, attrs, code) => {
    const langMatch = attrs.match(/data-lang=["']([^"']+)["']/);
    const lang = langMatch ? langMatch[1] : '';
    // contenteditable에서 Enter → <div>, <br> 가 삽입되므로 줄바꿈으로 변환
    let decoded = code;
    decoded = decoded.replace(/<br\s*\/?>/gi, '\n');
    decoded = decoded.replace(/<\/div>\s*<div[^>]*>/gi, '\n');
    decoded = decoded.replace(/<div[^>]*>/gi, '\n');
    decoded = decoded.replace(/<\/div>/gi, '');
    // hljs span 등 나머지 태그 제거
    decoded = decoded.replace(/<[^>]+>/g, '');
    decoded = decoded.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    // 앞뒤 불필요한 빈 줄 정리
    decoded = decoded.replace(/^\n/, '');
    preserved.push('\n```' + lang + '\n' + decoded + '\n```\n');
    return `\x00P${preserved.length - 1}\x00`;
  });

  // 2. 표 추출 (내부 줄바꿈 + 정렬 보존)
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableContent) => {
    const rows = [];
    const aligns = []; // 첫 행(thead)에서 정렬 추출
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let isFirstRow = true;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells = [];
      const cellRegex = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(inlineHtmlToWiki(cellMatch[3]));
        if (isFirstRow) {
          const alignMatch = cellMatch[2].match(/align=["'](\w+)["']/i);
          aligns.push(alignMatch ? alignMatch[1] : '');
        }
      }
      rows.push(cells);
      isFirstRow = false;
    }
    if (rows.length === 0) return '';
    let tbl = '\n| ' + rows[0].join(' | ') + ' |\n';
    // 정렬 구분선
    tbl += '| ' + rows[0].map((_c, i) => {
      const a = (aligns[i] || '').toLowerCase();
      if (a === 'center') return ':---:';
      if (a === 'right') return '---:';
      return '---';
    }).join(' | ') + ' |\n';
    for (let i = 1; i < rows.length; i++) {
      tbl += '| ' + rows[i].join(' | ') + ' |\n';
    }
    preserved.push(tbl + '\n');
    return `\x00P${preserved.length - 1}\x00`;
  });

  // 2.5 빈 단락 보존 (<p><br></p>, <div><br></div> 등 → 마커)
  text = text.replace(/<(p|div)[^>]*>\s*(?:<br\s*\/?>)?\s*<\/\1>/gi, '\x00EL\x00');

  // 3. 이미지 변환 (크기 정보 보존)
  text = text.replace(/<img[^>]*?>/gi, (imgTag) => {
    const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
    const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);
    if (!srcMatch) return imgTag;
    const src = srcMatch[1];
    let alt = altMatch ? altMatch[1] : '';
    // width/height를 style 또는 속성에서 추출
    let w = null, h = null;
    const styleMatch = imgTag.match(/style=["']([^"']*)["']/i);
    if (styleMatch) {
      const wm = styleMatch[1].match(/width:\s*(\d+)px/);
      const hm = styleMatch[1].match(/height:\s*(\d+)px/);
      if (wm) w = wm[1];
      if (hm) h = hm[1];
    }
    const widthAttr = imgTag.match(/\bwidth=["'](\d+)["']/i);
    const heightAttr = imgTag.match(/\bheight=["'](\d+)["']/i);
    if (!w && widthAttr) w = widthAttr[1];
    if (!h && heightAttr) h = heightAttr[1];
    // 크기가 있으면 alt에 추가
    if (w && h && w !== h) {
      alt = `${alt}|${w}x${h}`;
    } else if (w) {
      alt = `${alt}|${w}`;
    }
    return `![${alt}](${src})`;
  });

  // 4. HTML 소스 줄바꿈 제거 (먼저 제거해야 목록/블록 변환 시 정확한 줄바꿈 생성)
  text = text.replace(/\r?\n/g, '');

  // 5. <br> → 줄바꿈
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 6. 목록 변환 (태그별 상태 머신 — 줄바꿈 제거 후 실행)
  text = convertListsToWiki(text);

  // 7. 독립 체크박스 (<li> 외부)
  text = text.replace(/<input[^>]*checked[^>]*>/gi, '- [x] ');
  text = text.replace(/<input[^>]*type=["']checkbox["'][^>]*>/gi, '- [ ] ');

  // 8. 블록 종료 태그 → 줄바꿈 (2줄로 단락 구분)
  text = text.replace(/<\/(div|p|h[1-6]|blockquote)>/gi, '\n\n');

  // 9. 제목
  text = text.replace(/<h([1-6])[^>]*>/gi, (_m, n) => '#'.repeat(+n) + ' ');
  // 인용
  text = text.replace(/<blockquote[^>]*>/gi, '> ');
  // 인라인 서식
  text = text.replace(/<(strong|b)>/gi, '**');
  text = text.replace(/<\/(strong|b)>/gi, '**');
  text = text.replace(/<(em|i)>/gi, '*');
  text = text.replace(/<\/(em|i)>/gi, '*');
  text = text.replace(/<(del|s)>/gi, '~~');
  text = text.replace(/<\/(del|s)>/gi, '~~');
  text = text.replace(/<code>/gi, '`');
  text = text.replace(/<\/code>/gi, '`');
  // 링크
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (_m, href, linkText) => {
    return linkText.trim() === href.trim() ? linkText : `[${linkText}](${href})`;
  });
  // 수평선
  text = text.replace(/<hr[^>]*>/gi, '\n---\n');

  // 10. 인라인 스타일 span → Markdown 서식
  text = convertStyledSpans(text);

  // 11. 나머지 HTML 태그 제거 (<u> 태그는 보존 — Markdown에 밑줄 문법 없음)
  text = text.replace(/<(?!\/?u\b)[^>]+>/g, '');
  // HTML 엔티티
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');

  // 12. 플레이스홀더 복원
  text = text.replace(/\x00P(\d+)\x00/g, (_m, idx) => preserved[+idx]);
  // 연속 빈 줄 정리 (빈 단락 마커는 보존)
  text = text.replace(/\n{3,}/g, '\n\n');
  // 빈 단락 마커 → 줄바꿈 복원
  text = text.replace(/\x00EL\x00/g, '\n');
  return text.trim();
}

/**
 * 나무위키 색상값 → CSS 색상 ("ff85b1" → "#ff85b1", "red" → "red")
 */
function namuColorToCSS(val) {
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(val)) return '#' + val;
  return val;
}

/**
 * CSS 색상 → 나무위키 색상 표기 (rgb(204,0,0) → "#cc0000", "#cc0000" → "#cc0000", "red" → "#red")
 */
function cssColorToNamu(css) {
  const trimmed = css.trim();
  if (trimmed.startsWith('#')) return trimmed;
  const m = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
  return '#' + trimmed;
}

/**
 * <span style="...">text</span>을 Markdown 서식 + 나무위키 색상으로 변환한다.
 * 중첩 span을 안쪽부터 처리 (루프).
 */
function convertStyledSpans(html) {
  let text = html;
  let prev;
  do {
    prev = text;
    // (?:(?!<span[\s>]).)*? — 내부에 다른 <span>이 없는 가장 안쪽 span만 매칭
    text = text.replace(/<span\s+style="([^"]*)">((?:(?!<span[\s>]).)*?)<\/span>/gi, (_m, style, content) => {
      let result = content;
      const isBold          = /font-weight\s*:\s*(bold|[7-9]\d\d)/i.test(style);
      const isItalic        = /font-style\s*:\s*italic/i.test(style);
      const isStrikethrough = /text-decoration[^;]*line-through/i.test(style);
      const isUnderline     = /text-decoration[^;]*underline/i.test(style);

      // 색상 추출 (color vs background-color 구분)
      const colorMatch = style.match(/(?:^|;\s*)color\s*:\s*([^;]+)/i);
      const bgMatch    = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
      const textColor  = colorMatch ? colorMatch[1].trim() : null;
      const bgColor    = bgMatch ? bgMatch[1].trim() : null;

      // 기본색(#333333) 및 투명 배경 감지
      const isDefaultColor = !textColor
        || textColor === '#333333' || textColor === '#333'
        || textColor === 'rgb(51, 51, 51)' || textColor === 'rgb(51,51,51)';
      const isNoBg = !bgColor
        || bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)'
        || bgColor === 'initial' || bgColor === 'inherit' || bgColor === 'none';

      // Markdown 서식 마커
      if (isUnderline)     result = `<u>${result}</u>`;
      if (isStrikethrough) result = `~~${result}~~`;
      if (isItalic)        result = `*${result}*`;
      if (isBold)          result = `**${result}**`;

      // 나무위키 색상 문법
      if (!isDefaultColor || !isNoBg) {
        const tc = isDefaultColor ? null : cssColorToNamu(textColor);
        const bc = isNoBg ? null : cssColorToNamu(bgColor);
        if (tc && bc)       result = `{{{${tc}${bc} ${result}}}}`;
        else if (tc)        result = `{{{${tc} ${result}}}}`;
        else if (bc)        result = `{{{#333333${bc} ${result}}}}`;
      }

      return result;
    });
  } while (text !== prev);
  return text;
}

/**
 * 인라인 HTML을 Markdown 인라인으로 변환 (표 셀 내부용)
 */
function inlineHtmlToWiki(html) {
  let t = html;
  // 백슬래시 이스케이프 복원
  t = t.replace(/<span\s+data-esc="(\d+)">[^<]*<\/span>/gi, (_m, code) => {
    return `\\${String.fromCharCode(+code)}`;
  });
  t = t.replace(/<(strong|b)>/gi, '**').replace(/<\/(strong|b)>/gi, '**');
  t = t.replace(/<(em|i)>/gi, '*').replace(/<\/(em|i)>/gi, '*');
  t = t.replace(/<(del|s)>/gi, '~~').replace(/<\/(del|s)>/gi, '~~');
  t = t.replace(/<code>/gi, '`').replace(/<\/code>/gi, '`');
  t = convertStyledSpans(t);
  t = t.replace(/<input[^>]*checked[^>]*>/gi, '[x]');
  t = t.replace(/<input[^>]*type=["']checkbox["'][^>]*>/gi, '[ ]');
  t = t.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (_m, href, text) => {
    return text.trim() === href.trim() ? text : `[${text}](${href})`;
  });
  t = t.replace(/<(?!\/?u\b)[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return t.trim();
}

/**
 * HTML 내의 <ul>/<ol> 목록을 Markdown으로 변환한다.
 * 태그별 상태 머신으로 중첩 목록을 들여쓰기로 처리.
 */
function convertListsToWiki(html) {
  const parts = html.split(/(<[^>]+>)/);
  let result = '';
  let depth = 0;
  const listTypeStack = [];  // 'ul' | 'ol'
  const olCounters = {};     // depth → 현재 번호

  for (const part of parts) {
    if (!part) continue;

    const tagMatch = part.match(/^<\/?(\w+)([^>]*)>$/i);
    if (!tagMatch) {
      // 텍스트 노드
      result += part;
      continue;
    }

    const tagName = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2] || '';
    const isClosing = part[1] === '/';

    if ((tagName === 'ul' || tagName === 'ol') && !isClosing) {
      listTypeStack.push(tagName);
      depth++;
      if (tagName === 'ol') olCounters[depth] = 0;
    } else if ((tagName === 'ul' || tagName === 'ol') && isClosing) {
      listTypeStack.pop();
      depth--;
      if (depth === 0) result += '\n';
    } else if (tagName === 'li' && !isClosing && depth > 0) {
      // ol은 "1. " (3칸)이므로 3-space, ul은 "- " (2칸)이므로 2-space
      let indent = '';
      for (let d = 0; d < depth - 1; d++) {
        indent += listTypeStack[d] === 'ol' ? '   ' : '  ';
      }
      const type = listTypeStack[listTypeStack.length - 1];
      if (type === 'ol') {
        olCounters[depth] = (olCounters[depth] || 0) + 1;
        result += `\n${indent}${olCounters[depth]}. `;
      } else {
        result += `\n${indent}- `;
      }
    } else if (tagName === 'li' && isClosing) {
      // skip
    } else if (tagName === 'input' && depth > 0 && /type=["']checkbox["']/i.test(attrs)) {
      // 체크박스: 직전에 추가한 "- "를 "- [x] " 또는 "- [ ] "로 교체
      if (/checked/i.test(attrs)) {
        result = result.replace(/- $/, '- [x] ');
      } else {
        result = result.replace(/- $/, '- [ ] ');
      }
    } else if (depth > 0 && (tagName === 'span' || tagName === 'p')) {
      // 목록 내 <span>, <p>는 무시 (체크박스 래퍼, 단락)
    } else {
      // 목록 내 인라인 태그(<strong> 등)는 유지, 목록 밖도 유지
      result += part;
    }
  }

  return result;
}

module.exports = { parseWiki, wikiToPlainText, htmlToWiki };
