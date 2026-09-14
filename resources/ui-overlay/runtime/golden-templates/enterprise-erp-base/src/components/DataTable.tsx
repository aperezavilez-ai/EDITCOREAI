import * as React from "react";

export type Column<T> = { key: keyof T | string; header: string; render?: (row: T) => React.ReactNode; sortable?: boolean };

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  searchKeys?: Array<keyof T | string>;
};

export function DataTable<T extends Record<string, unknown>>({ rows, columns, pageSize = 10, searchKeys = [] }: Props<T>) {
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<string>("");
  const [asc, setAsc] = React.useState(true);
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let next = rows;
    if (q && searchKeys.length) {
      next = rows.filter((row) => searchKeys.some((key) => String(row[key as string] ?? "").toLowerCase().includes(q)));
    }
    if (sortKey) {
      next = [...next].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    return next;
  }, [rows, query, searchKeys, sortKey, asc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder="Filtrar..."
          className="h-9 w-full sm:max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        <p className="text-xs text-muted-foreground">{filtered.length} registros</p>
      </div>
      <div className="overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((col) => (
                <th key={String(col.key)} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    disabled={col.sortable === false}
                    onClick={() => {
                      const key = String(col.key);
                      if (sortKey === key) setAsc(!asc);
                      else { setSortKey(key); setAsc(true); }
                    }}
                  >
                    {col.header}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr key={idx} className="border-t border-border/70 hover:bg-muted/30">
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-3 py-2 align-top">
                    {col.render ? col.render(row) : String(row[col.key as string] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={columns.length}>Sin datos</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs">
        <button type="button" className="rounded-md border px-2 py-1 disabled:opacity-40" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <span>Página {page + 1} / {pageCount}</span>
        <button type="button" className="rounded-md border px-2 py-1 disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
      </div>
    </div>
  );
}
