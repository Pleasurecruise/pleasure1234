export interface Caret {
  left: number;
  top: number;
  line: number;
}

export interface Sheet {
  caret(): Caret;
  insert(text: string): void;
  deleteBack(word: boolean): void;
  deleteForward(): void;
  navigate(key: string): void;
  copy(cut: boolean): void;
  selectAll(): void;
}

const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'boxSizing', 'wordBreak', 'overflowWrap', 'textIndent',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
] as const;

export function createSheet(paper: HTMLTextAreaElement, changed: (returning: boolean) => void): Sheet {
  const caret = (): Caret => {
    const style = getComputedStyle(paper);
    const ghost = document.createElement('div');
    for (const prop of MIRRORED) ghost.style[prop] = style[prop];
    ghost.style.borderStyle = 'solid';
    ghost.style.position = 'absolute';
    ghost.style.visibility = 'hidden';
    ghost.style.whiteSpace = 'pre-wrap';
    ghost.style.width = `${paper.offsetWidth}px`;
    ghost.textContent = paper.value.slice(0, paper.selectionEnd);
    const mark = document.createElement('span');
    mark.textContent = '​';
    ghost.append(mark);
    document.body.append(ghost);
    const spot = { left: mark.offsetLeft, top: mark.offsetTop, line: Number.parseFloat(style.lineHeight) || mark.offsetHeight };
    ghost.remove();
    return spot;
  };

  const replace = (text: string, start: number, end: number) => {
    paper.setRangeText(text, start, end, 'end');
    changed(text.endsWith('\n'));
  };

  const moveTo = (pos: number) => {
    const p = Math.max(0, Math.min(paper.value.length, pos));
    paper.setSelectionRange(p, p);
    changed(false);
  };

  const lineStart = (pos: number) => paper.value.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = (pos: number) => {
    const i = paper.value.indexOf('\n', pos);
    return i === -1 ? paper.value.length : i;
  };
  const charBefore = (pos: number) => Array.from(paper.value.slice(0, pos)).pop()?.length ?? 0;
  const charAfter = (pos: number) => Array.from(paper.value.slice(pos))[0]?.length ?? 0;

  return {
    caret,

    insert: (text) => replace(text, paper.selectionStart, paper.selectionEnd),

    deleteBack(word) {
      const end = paper.selectionEnd;
      let start = paper.selectionStart;
      if (start === end) start = word ? paper.value.slice(0, end).replace(/\S+\s*$|\s+$/u, '').length : end - charBefore(end);
      if (start !== end) replace('', start, end);
    },

    deleteForward() {
      const start = paper.selectionStart;
      const end = paper.selectionEnd === start ? start + charAfter(start) : paper.selectionEnd;
      if (start !== end) replace('', start, end);
    },

    navigate(key) {
      const { selectionStart: start, selectionEnd: end, value } = paper;
      const collapsed = start === end;
      if (key === 'ArrowLeft') moveTo(collapsed ? start - charBefore(start) : start);
      else if (key === 'ArrowRight') moveTo(collapsed ? end + charAfter(end) : end);
      else if (key === 'Home') moveTo(lineStart(start));
      else if (key === 'End') moveTo(lineEnd(end));
      else if (key === 'ArrowUp') {
        const here = lineStart(start);
        if (here === 0) return moveTo(0);
        const above = lineStart(here - 1);
        moveTo(above + Math.min(start - here, here - 1 - above));
      } else if (key === 'ArrowDown') {
        const here = lineStart(end);
        const below = lineEnd(end) + 1;
        if (below > value.length) return moveTo(value.length);
        moveTo(below + Math.min(end - here, lineEnd(below) - below));
      }
    },

    copy(cut) {
      const { selectionStart: start, selectionEnd: end } = paper;
      if (start === end) return;
      void navigator.clipboard?.writeText(paper.value.slice(start, end));
      if (cut) replace('', start, end);
    },

    selectAll() {
      paper.focus();
      paper.select();
    },
  };
}
