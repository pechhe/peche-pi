/**
 * Thread type classification + visual metadata.
 *
 * The model classifies each thread into one of 5 types when generating the
 * auto-title. Each type has a fixed icon and accent colour used for the
 * sidebar accent bar and type indicator.
 */

export type ThreadType = "bug" | "feature" | "refactor" | "investigate" | "other";

export interface ThreadTypeMeta {
  readonly label: string;
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

const THREAD_TYPE_META: Record<ThreadType, ThreadTypeMeta> = {
  bug:       { label: "Bug",        hue: 350, saturation: 60, lightness: 58 },
  feature:   { label: "Feature",    hue: 215, saturation: 55, lightness: 58 },
  refactor:  { label: "Refactor",   hue: 35,  saturation: 55, lightness: 55 },
  investigate: { label: "Investigate", hue: 175, saturation: 50, lightness: 52 },
  other:     { label: "Other",      hue: 220, saturation: 10, lightness: 55 },
};

function threadTypeMeta(type: ThreadType): ThreadTypeMeta {
  return THREAD_TYPE_META[type] ?? THREAD_TYPE_META.other;
}

export function threadTypeAccent(type: ThreadType): string {
  const m = threadTypeMeta(type);
  return `hsl(${m.hue} ${m.saturation}% ${m.lightness}%)`;
}

/**
 * Parse a thread type string from model output. Returns "other" for
 * unrecognised values.
 */
export function parseThreadType(raw: string): ThreadType {
  const normalised = raw.trim().toLowerCase();
  if (normalised in THREAD_TYPE_META) {
    return normalised as ThreadType;
  }
  return "other";
}

/** All valid thread type keys, for validation / UI pickers. */
const ALL_THREAD_TYPES: readonly ThreadType[] = ["bug", "feature", "refactor", "investigate", "other"];
