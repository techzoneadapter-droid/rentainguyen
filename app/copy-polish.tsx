'use client';

import { useEffect } from 'react';

const replacements = new Map<string, string>([
  ['Tạo BM thật', 'Tạo Business Manager'],
  ['Tạo Business Manager thật', 'Tạo Business Manager'],
  ['Tạo BM khác', 'Tạo Business Manager khác'],
  ['1 BM mỗi lần · chọn ngẫu nhiên Page từ token · không tự đổi token', 'Tạo Business Manager từ token đã chọn · xử lý từng yêu cầu'],
  ['Push sang CRM', 'Đẩy sang CRM'],
  ['Push CRM', 'Đẩy CRM'],
]);

function polish(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    const value = node.data;
    for (const [from, to] of replacements) {
      if (!value.includes(from)) continue;
      const next = value.replaceAll(from, to);
      if (next !== value) node.data = next;
      break;
    }
  }
}

export default function CopyPolish() {
  useEffect(() => {
    polish(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') polish(record.target);
        for (const node of record.addedNodes) polish(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
