import { useEffect, useRef } from "react";
import type { GlobalSearchArchiveFilter, GlobalSearchResult, GlobalSearchScope } from "./hooks/use-global-search";
import { formatRelativeTime } from "./string-utils";

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activeResult = results[activeIndex];

  return (
    <div className="search-palette" role="dialog" aria-modal="true" aria-label="Search threads">
      <div className="search-palette__backdrop" onClick={onClose} />
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
              onClose();
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
                  <span className="search-palette__result-preview search-palette__result-preview--transcript">{result.transcriptSnippet}</span>
                ) : result.preview ? (
                  <span className="search-palette__result-preview">{result.preview}</span>
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
