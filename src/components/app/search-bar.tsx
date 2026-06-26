import { Search } from "lucide-react";

/** Server-rendered GET search form; submitting reloads the page with ?q=. */
export function SearchBar({ placeholder, defaultValue }: { placeholder: string; defaultValue?: string }) {
  return (
    <form className="mb-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>
    </form>
  );
}
