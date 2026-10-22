import { useEffect } from 'react';

/** First thing a keyboard or screen-reader user reaches: jump straight past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(e) => {
        const main = document.getElementById('main');
        if (main) {
          e.preventDefault();
          main.focus();
        }
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-fg"
    >
      Skip to main content
    </a>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const visible = (el: HTMLElement) => el.getClientRects().length > 0;

/**
 * Makes every dialog in the app behave like one for keyboard and screen-reader users, without each dialog
 * having to do it: focus moves inside when it opens and goes back to where it was when it closes, Tab stays
 * inside, Escape closes it (the same as clicking outside), and it is announced as modal.
 */
export function DialogManager() {
  useEffect(() => {
    const stack: { el: HTMLElement; opener: HTMLElement | null }[] = [];
    const inside = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

    const sync = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
        if (stack.some((s) => s.el === el)) continue;
        el.setAttribute('aria-modal', 'true');
        stack.push({ el, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null });
        if (!el.contains(document.activeElement)) {
          if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
          (inside(el)[0] ?? el).focus();
        }
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (document.body.contains(stack[i].el)) continue;
        const { opener } = stack.splice(i, 1)[0];
        if (opener && document.body.contains(opener)) opener.focus(); // back to the button that opened it
      }
    };

    const onKey = (e: KeyboardEvent) => {
      const top = stack[stack.length - 1]?.el;
      if (!top) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        top.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // dialogs close when the backdrop is pressed
      } else if (e.key === 'Tab') {
        const items = inside(top);
        if (!items.length) return e.preventDefault();
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !top.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const obs = new MutationObserver(sync);
    obs.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onKey);
    sync();
    return () => {
      obs.disconnect();
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
