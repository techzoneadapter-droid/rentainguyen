'use client';

import { useLayoutEffect } from 'react';

const cp1252 = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

const suspicious = /(?:Ã.|Â.|Ä.|Æ.|á[º»]|â[€žœ™¦]|ðŸ|ï¿½)/;

function decodeOnce(value: string) {
  if (!suspicious.test(value)) return value;
  const bytes: number[] = [];

  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }
    const mapped = cp1252.get(code);
    if (mapped === undefined) return value;
    bytes.push(mapped);
  }

  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return decoded.includes('\ufffd') ? value : decoded;
  } catch {
    return value;
  }
}

function repair(value: string) {
  let current = value;
  for (let pass = 0; pass < 3; pass++) {
    const decoded = decodeOnce(current);
    if (decoded === current) break;
    current = decoded;
  }
  return current.normalize('NFC');
}

function repairElement(root: Document | Element) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const fixed = repair(node.data);
    if (fixed !== node.data) node.data = fixed;
  }

  for (const element of root.querySelectorAll<HTMLElement>('[placeholder],[aria-label],[title]')) {
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const fixed = repair(value);
      if (fixed !== value) element.setAttribute(attr, fixed);
    }
  }
}

export default function EncodingRepair() {
  useLayoutEffect(() => {
    repairElement(document.body);
    document.body.classList.remove('encoding-pending');
    document.body.classList.add('encoding-ready');

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const node = mutation.target as Text;
          const fixed = repair(node.data);
          if (fixed !== node.data) node.data = fixed;
          continue;
        }

        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node as Text;
            const fixed = repair(text.data);
            if (fixed !== text.data) text.data = fixed;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            repairElement(node as Element);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
