/**
 * @file Markdown(GitLab Flavored) → HTML 변환기
 *
 * 외부 라이브러리 없이 GitLab Flavored Markdown 문법을 HTML로 변환한다.
 * 지원 문법: 제목, 굵게, 기울임, 취소선, 목록, 체크박스,
 *           인용, 인라인 코드, 코드 블록, 수평선, 링크
 */

/**
 * Markdown 텍스트를 HTML로 변환한다.
 *
 * @param {string} text - Markdown 텍스트
 * @returns {string} HTML 문자열
 */
function parseWiki(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];
  let inList = false;    // ul
  let inOList = false;   // ol
  let inCode = false;    // 코드 블록
  let codeLang = '';
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 코드 블록: ```
    if (line.trim().startsWith('```')) {
      if (!inCode) {
        if (inList)  { result.push('</ul>'); inList = false; }
        if (inOList) { result.push('</ol>'); inOList = false; }
        inCode = true;
        codeLang = line.trim().slice(3).trim();
        codeLines = [];
      } else {
        const langAttr = codeLang ? ` data-lang="${codeLang}"` : '';
        result.push(`<pre${langAttr}><code>${codeLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
        inCode = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // 빈 줄 → 목록 종료 + 빈 줄
    if (!line.trim()) {
      if (inList)  { result.push('</ul>'); inList = false; }
      if (inOList) { result.push('</ol>'); inOList = false; }
      result.push('<br>');
      continue;
    }

    // 수평선: --- 또는 *** 또는 ___
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      if (inList)  { result.push('</ul>'); inList = false; }
      if (inOList) { result.push('</ol>'); inOList = false; }
      result.push('<hr>');
      continue;
    }

    // 제목: # ~ ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (inList)  { result.push('</ul>'); inList = false; }
      if (inOList) { result.push('</ol>'); inOList = false; }
      const level = headingMatch[1].length;
      result.push(`<h${level}>${applyInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // 인용: > text
    const quoteMatch = line.match(/^>\s*(.*)$/);
    if (quoteMatch) {
      if (inList)  { result.push('</ul>'); inList = false; }
      if (inOList) { result.push('</ol>'); inOList = false; }
      result.push(`<blockquote>${applyInline(quoteMatch[1])}</blockquote>`);
      continue;
    }

    // 체크박스: - [ ] 또는 - [x]
    const checkMatch = line.match(/^-\s+\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      if (inOList) { result.push('</ol>'); inOList = false; }
      if (!inList) { result.push('<ul style="list-style:none;padding-left:4px;">'); inList = true; }
      const checked = checkMatch[1].toLowerCase() === 'x';
      const textClass = checked ? ' class="checked-text"' : '';
      result.push(`<li><input type="checkbox" class="postit-checkbox"${checked ? ' checked' : ''}><span${textClass}>${applyInline(checkMatch[2])}</span></li>`);
      continue;
    }

    // 비순서 목록: - item 또는 * item
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (inOList) { result.push('</ol>'); inOList = false; }
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${applyInline(ulMatch[1])}</li>`);
      continue;
    }

    // 순서 목록: 1. item
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList)  { result.push('</ul>'); inList = false; }
      if (!inOList) { result.push('<ol>'); inOList = true; }
      result.push(`<li>${applyInline(olMatch[1])}</li>`);
      continue;
    }

    // 일반 텍스트
    if (inList)  { result.push('</ul>'); inList = false; }
    if (inOList) { result.push('</ol>'); inOList = false; }
    result.push(`<div>${applyInline(line)}</div>`);
  }

  // 닫히지 않은 코드 블록 처리
  if (inCode) {
    result.push(`<pre><code>${codeLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`);
  }
  if (inList)  result.push('</ul>');
  if (inOList) result.push('</ol>');

  return result.join('');
}

/**
 * 인라인 Markdown 문법을 HTML로 변환한다.
 * GitLab 스타일: 굵게, 기울임, 취소선, 인라인 코드, 링크
 *
 * @param {string} text - 한 줄의 텍스트
 * @returns {string} 인라인 HTML
 */
function applyInline(text) {
  // 인라인 코드: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 링크: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // 자동 URL 변환 (bare URL, 이미 href 안에 있는 것 제외)
  text = text.replace(/(^|[\s(])((https?:\/\/)[^\s<>)\]]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  // 굵게: **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 기울임: *text*
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 취소선: ~~text~~
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return text;
}

/**
 * Markdown 텍스트에서 플레인 텍스트를 추출한다.
 * 타이틀 바 표시용.
 *
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
    clean = clean.replace(/^#{1,3}\s+/, '');
    clean = clean.replace(/^>\s*/, '');
    clean = clean.replace(/^-\s+\[[ xX]\]\s*/, '');
    clean = clean.replace(/^[-*]\s+/, '');
    clean = clean.replace(/^\d+\.\s+/, '');
    clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1');
    clean = clean.replace(/\*([^*]+)\*/g, '$1');
    clean = clean.replace(/~~([^~]+)~~/g, '$1');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    if (clean) return clean;
  }
  return '';
}

/**
 * HTML을 Markdown 텍스트로 변환한다.
 * 모드 전환(HTML→Wiki) 시 사용. 완벽하지 않은 변환이므로 손실 가능.
 *
 * @param {string} html - HTML 문자열
 * @returns {string} Markdown 텍스트
 */
function htmlToWiki(html) {
  if (!html) return '';

  let text = html;

  // 코드 블록을 먼저 추출 (내부 줄바꿈 보존 필요)
  const codeBlocks = [];
  text = text.replace(/<pre([^>]*)><code>([\s\S]*?)<\/code><\/pre>/gi, (_m, attrs, code) => {
    const langMatch = attrs.match(/data-lang=["']([^"']+)["']/);
    const lang = langMatch ? langMatch[1] : '';
    const decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    codeBlocks.push('\n```' + lang + '\n' + decoded + '\n```\n');
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // HTML 소스의 줄바꿈은 의미 없으므로 제거 (이중 줄바꿈 방지)
  text = text.replace(/\r?\n/g, '');
  // 줄바꿈 태그
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 순서 목록: <ol> 내의 <li>에 번호 부여
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let n = 0;
    return inner.replace(/<li[^>]*>/gi, () => `${++n}. `);
  });

  // 체크박스가 포함된 <li> (일반 <li> 변환 전에 처리)
  text = text.replace(/<li[^>]*>\s*<input[^>]*checked[^>]*>/gi, '- [x] ');
  text = text.replace(/<li[^>]*>\s*<input[^>]*type=["']checkbox["'][^>]*>/gi, '- [ ] ');

  // 비순서 목록: 나머지 <li>
  text = text.replace(/<li[^>]*>/gi, '- ');

  // 독립 체크박스 (<li> 외부)
  text = text.replace(/<input[^>]*checked[^>]*type=["']checkbox["'][^>]*>/gi, '- [x] ');
  text = text.replace(/<input[^>]*type=["']checkbox["'][^>]*checked[^>]*>/gi, '- [x] ');
  text = text.replace(/<input[^>]*type=["']checkbox["'][^>]*>/gi, '- [ ] ');

  // 블록 종료 태그 → 줄바꿈
  text = text.replace(/<\/(div|p|li|h[1-6]|blockquote|ul|ol)>/gi, '\n');

  // 제목 태그
  text = text.replace(/<h1[^>]*>/gi, '# ');
  text = text.replace(/<h2[^>]*>/gi, '## ');
  text = text.replace(/<h3[^>]*>/gi, '### ');
  // 인용
  text = text.replace(/<blockquote[^>]*>/gi, '> ');
  // 굵게
  text = text.replace(/<(strong|b)>/gi, '**');
  text = text.replace(/<\/(strong|b)>/gi, '**');
  // 기울임
  text = text.replace(/<(em|i)>/gi, '*');
  text = text.replace(/<\/(em|i)>/gi, '*');
  // 취소선
  text = text.replace(/<(del|s)>/gi, '~~');
  text = text.replace(/<\/(del|s)>/gi, '~~');
  // 인라인 코드
  text = text.replace(/<code>/gi, '`');
  text = text.replace(/<\/code>/gi, '`');
  // 링크 (텍스트와 URL이 같으면 bare URL로)
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, (_m, href, linkText) => {
    return linkText.trim() === href.trim() ? linkText : `[${linkText}](${href})`;
  });
  // 수평선
  text = text.replace(/<hr[^>]*>/gi, '---');
  // 나머지 HTML 태그 제거
  text = text.replace(/<[^>]+>/g, '');
  // HTML 엔티티 변환
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  // 코드 블록 플레이스홀더 복원
  text = text.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[+idx]);
  // 연속 빈 줄 정리 (3개 이상 → 2개)
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

module.exports = { parseWiki, wikiToPlainText, htmlToWiki };
