'use client';

import { useEffect } from 'react';

function refreshCreateWorkspace() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
  const createButton = buttons.find((button) =>
    button.textContent?.replace(/\s+/g, ' ').trim().toUpperCase().includes('TẠO TÀI NGUYÊN'),
  );
  createButton?.click();
}

export default function CredentialImportSync() {
  useEffect(() => {
    let timer = 0;
    const onImported = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refreshCreateWorkspace();
      }, 60);
    };

    window.addEventListener('meta-credentials-imported', onImported);
    return () => {
      window.removeEventListener('meta-credentials-imported', onImported);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
