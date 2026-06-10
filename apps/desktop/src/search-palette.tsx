import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobalSearchArchiveFilter, GlobalSearchResult, GlobalSearchScope } from "./hooks/use-global-search";
import { formatRelativeTime } from "./string-utils";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <mark key={i} className="rounded-[3px] bg-brand/15 px-px text-brand">
            {part.mark}
          </mark>
        ),
      )}
    </>
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
    <div
      className="flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/50 p-0.5"
      aria-label={label}
    >
      {options.map(([optionValue, optionLabel]) => (
        <button
          key={optionValue}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-all duration-150",
            optionValue === value
              ? "bg-card text-brand shadow-sm"
              : "hover:text-foreground",
          )}
          type="button"
          onClick={() => onChange(optionValue)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

interface SearchPaletteProps {
  readonly query: string;
  readonly scope: GlobalSearchScope;
  readonly archiveFilter: GlobalSearchArchiveFilter;
  readonly results: readonly GlobalSearchResult[];
  readonly currentProjectIds: ReadonlySet<string>;
  readonly activeIndex: number;
  readonly onQueryChange: (query: string) => void;
  readonly onScopeChange: (scope: GlobalSearchScope) => void;
  readonly onArchiveFilterChange: (filter: GlobalSearchArchiveFilter) => void;
  readonly onActiveIndexChange: (index: number) => void;
  readonly onSelect: (result: GlobalSearchResult) => void;
  readonly onClose: () => void;
  /** Called after the exit animation finishes and the palette is about to unmount. */
  readonly restoreFocus?: () => void;
}

export function SearchPalette({
  query,
  scope,
  archiveFilter,
  results,
  currentProjectIds,
  activeIndex,
  onQueryChange,
  onScopeChange,
  onArchiveFilterChange,
  onActiveIndexChange,
  onSelect,
  onClose,
  restoreFocus,
}: SearchPaletteProps) {
  const [open, setOpen] = useState(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref-stable so requestClose deps don't churn when the caller's
  // focusComposer is intentionally re-created every render.
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // Play the Radix exit animation, then unmount via onClose. Idempotent.
  const requestClose = useCallback(() => {
    if (closeTimer.current) return;
    setOpen(false);
    closeTimer.current = setTimeout(() => {
      onClose();
      // The palette stole focus from the composer; hand it back after the
      // exit animation so the user can keep typing.
      restoreFocusRef.current?.();
    }, 160);
  }, [onClose]);

  const activeResult = results[activeIndex];

  const { currentItems, otherItems } = useMemo(() => {
    const current: GlobalSearchResult[] = [];
    const other: GlobalSearchResult[] = [];
    for (const r of results) {
      if (currentProjectIds.has(r.id)) current.push(r);
      else other.push(r);
    }
    return { currentItems: current, otherItems: other };
  }, [results, currentProjectIds]);

  const renderResult = (result: GlobalSearchResult) => {
    return (
      <CommandItem
        key={result.id}
        value={result.id}
        className="search-palette__result flex flex-col items-start gap-0.5 rounded-lg px-3 py-2"
        onSelect={() => onSelect(result)}
      >
        <span className="w-full truncate text-[13px] font-semibold text-foreground">
          {result.title}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {result.kind === "chat" ? "Chat" : result.projectName} · {result.archived ? "Past" : "Active"} · {formatRelativeTime(result.updatedAt)}
        </span>
        {result.transcriptSnippet ? (
          <span className="line-clamp-2 w-full text-xs text-muted-foreground/90">
            <HighlightedText text={result.transcriptSnippet} query={query} />
          </span>
        ) : result.preview ? (
          <span className="line-clamp-2 w-full text-xs text-muted-foreground/90">
            <HighlightedText text={result.preview} query={query} />
          </span>
        ) : null}
      </CommandItem>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestClose();
      }}
      title="Search threads"
      description="Search threads and chats"
      showCloseButton={false}
      className="search-palette top-[18%] max-w-xl translate-y-0"
      commandProps={{
        shouldFilter: false,
        loop: true,
        value: activeResult?.id ?? "",
        onValueChange: (value) => {
          const index = results.findIndex((r) => r.id.toLowerCase() === value.toLowerCase());
          if (index !== -1 && index !== activeIndex) onActiveIndexChange(index);
        },
      }}
    >
      <CommandInput
        value={query}
        placeholder="Search threads and chats..."
        onValueChange={onQueryChange}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            onArchiveFilterChange(archiveFilter === "all" ? "active" : "all");
            return;
          }
          if (event.key === "A" && (event.metaKey || event.ctrlKey) && event.shiftKey) {
            event.preventDefault();
            onScopeChange(scope === "all" ? "project" : "all");
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <SegmentedControl
            label="Scope"
            value={scope}
            options={[
              ["all", "All"],
              ["project", "This Project"],
            ]}
            onChange={(value) => onScopeChange(value as GlobalSearchScope)}
          />
          <SegmentedControl
            label="Thread state"
            value={archiveFilter}
            options={[
              ["all", "All"],
              ["active", "Active"],
            ]}
            onChange={(value) => onArchiveFilterChange(value as GlobalSearchArchiveFilter)}
          />
        </div>
        {query.trim() && results.length > 0 ? (
          <div className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <kbd className="rounded border border-border bg-muted px-1">Tab</kbd> active ·{" "}
            <kbd className="rounded border border-border bg-muted px-1">⌘⇧A</kbd> scope
          </div>
        ) : null}
      </div>
      <CommandList className="search-palette__results max-h-[420px] p-1">
        {!query.trim() ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Type to search titles, previews, and message history.
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No matches.</div>
        ) : (
          <>
            {currentItems.length > 0 && (
              <CommandGroup heading="This Project">{currentItems.map(renderResult)}</CommandGroup>
            )}
            {currentItems.length > 0 && otherItems.length > 0 && <CommandSeparator />}
            {otherItems.length > 0 && (
              <CommandGroup
                heading={scope === "all" && currentItems.length > 0 ? "All Projects" : undefined}
              >
                {otherItems.map(renderResult)}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
