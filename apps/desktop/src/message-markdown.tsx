import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS = {
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const language = className?.replace(/^language-/, "");
    const code = String(children).replace(/\n$/, "");
    if (!className) {
      return <code>{code}</code>;
    }
    return (
      <pre data-language={language}>
        <code className={className}>{code}</code>
      </pre>
    );
  },
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  ),
} as const;

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="message__content">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

// Render-side typewriter buffer. Provider deltas arrive in bursts (5–30 char
// chunks, sometimes whole sentences); painting each burst as-received looks
// chunky regardless of how cheap rendering is. This hook decouples the visible
// reveal from the network cadence: characters are appended at a fixed rate per
// animation frame, so the user sees a smooth typewriter regardless of how the
// model chunked its output.
//
// Fast fixed-rate reveal. We intentionally do NOT snap or flush mid-stream:
// snapping is what makes the rest of a sentence appear as a burst. This is
// closer to the terminal `pi` feel: very fast streaming, but still painted at
// a consistent frame cadence instead of provider-sized chunks.
const TYPEWRITER_BASE_CHARS_PER_FRAME = 9; // ~540 chars/sec at 60 Hz

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useTypewriter(targetText: string, onCaughtUp?: () => void): string {
  // prefers-reduced-motion users opt out of the typewriter effect entirely.
  // Resolve once; matchMedia is renderer-side only. A ref (not state) so a
  // theoretical change at runtime doesn't tear down the raf loop — the user
  // can revisit the page if they want the new setting to apply.
  const reducedMotionRef = useRef<boolean | null>(null);
  if (reducedMotionRef.current === null) {
    reducedMotionRef.current = prefersReducedMotion();
  }
  const [displayedLength, setDisplayedLength] = useState<number>(() =>
    reducedMotionRef.current ? targetText.length : 0,
  );
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef(targetText);
  targetRef.current = targetText;

  // Keep tick in a ref so the effect doesn't need to recreate it on every
  // delta (every new text string would otherwise re-run the effect, tear
  // down the in-flight raf and rebind closures — wasteful but not broken).
  const tickRef = useRef<() => void>(() => {});
  tickRef.current = () => {
    rafRef.current = null;
    setDisplayedLength((current) => {
      const target = targetRef.current.length;
      if (current >= target) return current;
      const next = Math.min(target, current + TYPEWRITER_BASE_CHARS_PER_FRAME);
      if (next < target) {
        rafRef.current = requestAnimationFrame(() => tickRef.current());
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (reducedMotionRef.current) {
      setDisplayedLength(targetText.length);
      onCaughtUp?.();
      return;
    }
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    }
  }, [targetText, onCaughtUp]);

  useEffect(() => {
    if (displayedLength >= targetText.length) {
      onCaughtUp?.();
    }
  }, [displayedLength, targetText.length, onCaughtUp]);

  // Guard: if targetText shrunk (shouldn't happen for streaming, but be safe).
  const effectiveLength = Math.min(displayedLength, targetText.length);
  return targetText.slice(0, effectiveLength);
}

// While an assistant message is still streaming, render it as plain text
// (no markdown parse per delta) and reveal characters through a render-side
// typewriter buffer so the visible cadence is smooth regardless of how the
// provider chunked deltas. The parent keeps this mounted after run end until
// onCaughtUp fires, so the final markdown swap never reveals hidden text as
// a burst.
//
// `white-space: pre-wrap` preserves newlines and spaces so the stream looks
// like prose during typing. The wrapper class matches MessageMarkdown so
// layout/typography don't shift on swap.
export const StreamingMessageText = memo(function StreamingMessageText({
  text,
  onCaughtUp,
}: {
  readonly text: string;
  readonly onCaughtUp?: () => void;
}) {
  const displayed = useTypewriter(text, onCaughtUp);
  return (
    <div className="message__content message__content--streaming" style={{ whiteSpace: "pre-wrap" }}>
      {displayed}
      {/* Blinking caret to signal active typing. Inline so it follows the
          current end-of-text position even mid-line. Pure CSS animation —
          no React state, no re-renders. Removed entirely when the run ends
          because the whole component swaps out to MessageMarkdown. */}
      <span className="streaming-caret" aria-hidden="true" />
    </div>
  );
});
