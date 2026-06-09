import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SKIP, visit } from "unist-util-visit";

const REMARK_PLUGINS = [remarkGfm];

// rehype plugin: wrap every word of a streamed message in <span class="sw">
// so newly revealed words fade in via CSS (opacity 0→1) as they mount. Skips
// code/pre so inline code and code blocks stay untouched (copyable, monospace).
//
// Why this survives re-parse: ReactMarkdown rebuilds the tree on every delta,
// but React reconciliation reuses the existing DOM node for word spans whose
// position is unchanged (the stable prefix), so their fade animation plays
// once on mount and never restarts. Only the new tail word mounts fresh and
// animates. Markdown structural shifts (e.g. a closing **) remount a small
// tail subtree — a tail-local re-fade, which is acceptable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypeStreamWords = () => (tree: any) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(tree, "text", (node: any, index: number | undefined, parent: any) => {
    if (index === undefined || index === null || !parent) return;
    const tag = parent.tagName;
    if (tag === "code" || tag === "pre") return;
    const value: string = node.value ?? "";
    if (!value.trim()) return;
    const parts = value.split(/(\s+)/).filter((part) => part.length > 0);
    const replacement = parts.map((part) =>
      /^\s+$/.test(part)
        ? { type: "text", value: part }
        : {
            type: "element",
            tagName: "span",
            properties: { className: ["sw"] },
            children: [{ type: "text", value: part }],
          },
    );
    parent.children.splice(index, 1, ...replacement);
    return [SKIP, index + replacement.length];
  });
};

const STREAM_REHYPE_PLUGINS = [rehypeStreamWords];

// During streaming the revealed slice often ends mid-token — e.g. an inline
// `code span before its closing backtick. The parser then shows the raw
// backtick + plain text ("variable names don't render properly") until the
// closer arrives, and at slow reveal speeds that broken state lingers. Close a
// dangling inline-code span so it renders as styled code immediately and keeps
// revealing char-by-char; the real closer replaces ours on the next frame.
// Skips when inside a fenced ``` block (that content is code anyway).
function closeDanglingInlineCode(text: string): string {
  const fences = text.match(/```/g);
  if (fences && fences.length % 2 === 1) return text; // inside an open code fence
  const singleTicks = (text.replace(/```/g, "").match(/`/g) ?? []).length;
  return singleTicks % 2 === 1 ? `${text}\`` : text;
}

// Opt-in reveal effects, read once per stream from localStorage so they can be
// toggled live in devtools without a rebuild (see the .sw CSS for tokens):
//   localStorage.streamFx = "rise glow"   /   delete localStorage.streamFx
// Empty => baseline blur-to-sharp only. Returns undefined so the attribute is
// omitted entirely when unset.
function readStreamFx(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem("streamFx") ?? undefined;
  } catch {
    return undefined;
  }
}

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
// Steady-rate reveal at character boundaries. Each active frame advances a
// fixed number of chars (step), chosen by the user via Settings. Lower speeds
// reveal fewer chars per frame and/or skip frames entirely, so the animation
// is always visible. No adaptive catch-up — the rate is constant regardless
// of how fast the model delivers text.
type TypewriterRate = { readonly step: number; readonly tickEvery: number };
const TYPEWRITER_SPEED_TABLE: Record<"low" | "medium" | "high", TypewriterRate> = {
  low: { step: 1, tickEvery: 4 },    // ~15 chars/sec at 60 fps
  medium: { step: 1, tickEvery: 2 },  // ~30 chars/sec
  high: { step: 1, tickEvery: 1 },    // ~60 chars/sec
};
const DEFAULT_TYPEWRITER_RATE = TYPEWRITER_SPEED_TABLE.medium;

// When the buffer runs this far ahead of what's revealed, the provider is
// dumping text faster than we can trickle it. Char-by-char then looks wrong:
// each word's .sw span appears partial, fades, then snap-grows as more chars
// land inside the already-faded span (the growth isn't animated). Past this
// threshold we advance to whole-word boundaries instead, so every word span
// appears complete and fades as one unit — a clean wave even at speed. Below
// it (genuine slow trickle) we keep the visible char-by-char cadence.
const WORD_SNAP_BACKLOG = 16;

// Reveal index of the end of the word at/after `from`: skip the current
// non-space run, then the trailing whitespace, so the next reveal lands on a
// word boundary rather than mid-word.
function nextWordBoundary(text: string, from: number): number {
  let i = from;
  while (i < text.length && !/\s/.test(text[i]!)) i += 1;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

function resolveTypewriterRate(): TypewriterRate {
  if (typeof document === "undefined") return DEFAULT_TYPEWRITER_RATE;
  const raw = document.documentElement.getAttribute("data-stream-speed");
  return TYPEWRITER_SPEED_TABLE[raw as keyof typeof TYPEWRITER_SPEED_TABLE] ?? DEFAULT_TYPEWRITER_RATE;
}

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
  // Resolve reveal speed once per mount (like reduced-motion); in-flight
  // streams keep their speed if the setting changes — new messages pick it up.
  const rateRef = useRef<TypewriterRate | null>(null);
  if (rateRef.current === null) {
    rateRef.current = resolveTypewriterRate();
  }
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const targetRef = useRef(targetText);
  targetRef.current = targetText;

  // Keep tick in a ref so the effect doesn't need to recreate it on every
  // delta (every new text string would otherwise re-run the effect, tear
  // down the in-flight raf and rebind closures — wasteful but not broken).
  const tickRef = useRef<() => void>(() => {});
  tickRef.current = () => {
    rafRef.current = null;
    const rate = rateRef.current ?? DEFAULT_TYPEWRITER_RATE;
    frameCountRef.current += 1;
    if (frameCountRef.current % rate.tickEvery !== 0) {
      rafRef.current = requestAnimationFrame(() => tickRef.current());
      return;
    }
    setDisplayedLength((current) => {
      const text = targetRef.current;
      const target = text.length;
      if (current >= target) return current;
      const backlog = target - current;
      let next: number;
      if (backlog > WORD_SNAP_BACKLOG) {
        // Behind: reveal a whole word so its span fades as a complete unit.
        next = Math.min(nextWordBoundary(text, current), target);
        if (next <= current) next = current + 1; // guarantee progress
      } else {
        // Slow trickle: keep the tuned char-by-char cadence.
        next = current + Math.min(rate.step, backlog);
      }
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

// While an assistant message is still streaming, render markdown-parsed text
// and reveal characters through a render-side typewriter buffer so the visible
// cadence is smooth regardless of how the provider chunked deltas. The parent
// keeps this mounted after run end until onCaughtUp fires, so the final swap
// to the final MessageMarkdown never reveals hidden text as a burst.
//
// Partial markdown (e.g. unclosed bold markers) renders imperfectly during
// streaming but is far better than raw syntax. It self-corrects as more text
// arrives.
export const StreamingMessageText = memo(function StreamingMessageText({
  text,
  onCaughtUp,
}: {
  readonly text: string;
  readonly onCaughtUp?: () => void;
}) {
  const displayed = closeDanglingInlineCode(useTypewriter(text, onCaughtUp));
  const streamFx = readStreamFx();
  return (
    <div className="message__content message__content--streaming" data-stream-fx={streamFx}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={STREAM_REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {displayed}
      </ReactMarkdown>
    </div>
  );
});
