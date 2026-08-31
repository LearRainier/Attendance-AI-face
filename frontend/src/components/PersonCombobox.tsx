import { useEffect, useMemo, useRef, useState } from "react";
import { Search, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

interface PersonComboboxProps {
  id?: string;
  people: string[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Search-as-you-type person picker. A plain <select> stops being usable once
 * there are dozens of registered people to scroll through — this filters by
 * substring match against the current query and supports arrow-key/enter
 * selection, without pulling in a combobox dependency. */
export function PersonCombobox({
  id,
  people,
  value,
  onChange,
  placeholder = "Search for a person…",
  disabled,
  className,
}: PersonComboboxProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the input text in sync when the selection changes elsewhere
  // (e.g. the caller resetting it after a successful submit).
  useEffect(() => {
    if (!open) setQuery(value);
  }, [value, open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((name) => name.toLowerCase().includes(needle));
  }, [people, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [filtered.length, open]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, value]);

  const selectName = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = filtered[highlighted];
      if (match) selectName(match);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full min-w-0 rounded-md border bg-transparent py-1 pr-3 pl-8 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {open && (
        <div className="bg-popover text-popover-foreground absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border p-1 shadow-md">
          {filtered.length > 0 ? (
            filtered.map((name, i) => (
              <button
                key={name}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep input focus so onBlur-driven revert doesn't race the click
                onClick={() => selectName(name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  i === highlighted ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  name === value && "font-medium"
                )}
              >
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{name}</span>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground px-2 py-3 text-center text-sm">No matching people</div>
          )}
        </div>
      )}
    </div>
  );
}
