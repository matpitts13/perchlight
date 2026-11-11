// A small Markdown subset for announcement emails: # headings, paragraphs,
// - and 1. lists, **bold**, *italic*, `code` and [links](https://...).
// Everything is HTML-escaped first, so nothing typed can become markup
// except what these rules produce. Inline styles keep it looking right in
// email apps, which ignore stylesheets.

const P = 'style="font-size:15px;line-height:1.6;margin:0 0 16px"';
const LIST = 'style="font-size:15px;line-height:1.6;margin:0 0 16px;padding-left:24px"';
const H = { 1: 'style="font-size:24px;line-height:1.3;margin:0 0 16px"', 2: 'style="font-size:20px;line-height:1.3;margin:24px 0 12px"', 3: 'style="font-size:17px;line-height:1.3;margin:20px 0 8px"' };

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;background:#f5f5f4;padding:1px 4px;border-radius:4px">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" style="color:#1c1917">${label}</a>`);
}

/** @returns {string} HTML */
export function markdownToHtml(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p ${P}>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag} ${LIST}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level} ${H[level]}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? numbered)[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}
