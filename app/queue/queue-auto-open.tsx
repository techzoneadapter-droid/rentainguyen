'use client';

import { useEffect } from 'react';

export default function QueueAutoOpen() {
  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-production-queue-nav]');
      if (button) {
        button.click();
        window.clearInterval(timer);
        return;
      }
      attempts += 1;
      if (attempts >= 40) window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
