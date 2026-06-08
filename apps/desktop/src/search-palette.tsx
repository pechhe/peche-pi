import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobalSearchArchiveFilter, GlobalSearchResult, GlobalSearchScope } from "./hooks/use-global-search";
import { formatRelativeTime } from "./string-utils";

/** Wraps case-insensitive occurrences of `query` in <mark> for visual highlight. */
function HighlightedText({ text, query }: { readonly text: string; readonly query: string }) {
  const parts = useMemo(() => {
    const q = query.trim();
    if (!q) return [text];
    const segments: (string | { mark: string })[] = [];
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(qLower, from);
    while (idx !== -1) {
      if (idx > from) segments.push(text.slice(from, idx));
      segments.push({ mark: text.slice(idx, idx + q.length) });
      from = idx + q.length;
      idx = lower.indexOf(qLower, from);
    }
    if (from < text.length) segments.push(text.slice(from));
    return segments;
  }, [text, query]);

  return (
    <>
      {parts.map((part, i) => (typeof part === "string" ? part : <mark key={i}>{part.mark}</mark>))}
    </>
  );
}

interface SearchPaletteProps {
  readonly query: string;
  readonly scope: GlobalSearchScope;
  readonly archiveFilter: GlobalSearchArchiveFilter;
  readonly results: readonly GlobalSearchResult[];
  readonly activeIndex: number;
  readonly onQueryChange: (query: string) => void;
  readonly onScopeChange: (scope: GlobalSearchScope) => void;
  readonly onArchiveFilterChange: (filter: GlobalSearchArchiveFilter) => void;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onSelect: (result: GlobalSearchResult) => void;
  readonly onClose: () => void;
}

export function SearchPalette({
  query,
  scope,
  archiveFilter,
  results,
  activeIndex,
  onQueryChange,
  onScopeChange,
  onArchiveFilterChange,
  onActiveIndexChange,
  onSelect,
  onClose,
}: SearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Play exit animation, then unmount via onClose. Idempotent for repeated triggers.
  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 160);
  }, [onClose]);

  const activeResult = results[activeIndex];

  return (
    <div
      className={`search-palette${closing ? " search-palette--closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Search threads"
    >
      <div className="search-palette__backdrop" onClick={requestClose} />
      <div className="search-palette__panel">
        <input
          ref={inputRef}
          className="search-palette__input"
          value={query}
          placeholder="Search threads and chats..."
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              requestClose();
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActiveIndexChange(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onActiveIndexChange(results.length === 0 ? 0 : (activeIndex - 1 + results.length) % results.length);
              return;
            }
            if (event.key === "Enter" && activeResult) {
              event.preventDefault();
              onSelect(activeResult);
            }
          }}
        />
        <div className="search-palette__controls">
          <SegmentedControl
            label="Scope"
            value={scope}
            options={[
              ["thread", "Thread"],
              ["project", "Project"],
              ["all", "All"],
            ]}
            onChange={(value) => onScopeChange(value as GlobalSearchScope)}
          />
          <SegmentedControl
            label="Thread state"
            value={archiveFilter}
            options={[
              ["all", "All"],
              ["active", "Active"],
              ["past", "Past"],
            ]}
            onChange={(value) => onArchiveFilterChange(value as GlobalSearchArchiveFilter)}
          />
        </div>
        <div className="search-palette__results" role="listbox" aria-label="Search results">
          {!query.trim() ? (
            <div className="search-palette__empty">Type to search titles, previews, and message history.</div>
          ) : results.length === 0 ? (
            <div className="search-palette__empty">No matches.</div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                className={`search-palette__result ${index === activeIndex ? "search-palette__result--active" : ""}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onSelect(result)}
              >
                <span className="search-palette__result-title">{result.title}</span>
                <span className="search-palette__result-meta">
                  {result.kind === "chat" ? "Chat" : result.projectName} · {result.archived ? "Past" : "Active"} · {formatRelativeTime(result.updatedAt)}
                </span>
                {result.transcriptSnippet ? (
                  <span className="search-palette__result-preview search-palette__result-preview--transcript">
                    <HighlightedText text={result.transcriptSnippet} query={query} />
                  </span>
                ) : result.preview ? (
                  <span className="search-palette__result-preview">
                    <HighlightedText text={result.preview} query={query} />
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="search-palette__segmented" aria-label={label}>
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          className={optionValue === value ? "search-palette__segmented-button search-palette__segmented-button--active" : "search-palette__segmented-button"}
          type="button"
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}
