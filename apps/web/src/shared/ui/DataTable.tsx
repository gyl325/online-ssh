import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState
} from "@tanstack/react-table";
import { type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { cx } from "./classNames";

type DataTableProps<TData> = {
  className?: string;
  columns: Array<ColumnDef<TData>>;
  columnsTemplate?: string;
  data: TData[];
  emptyMessage?: string;
  emptyState?: ReactNode;
  getRowId?: (row: TData, index: number) => string;
  getRowClassName?: (row: TData) => string | undefined;
  getRowProps?: (row: TData) => HTMLAttributes<HTMLElement> | undefined;
  manualSorting?: boolean;
  onRowClick?: (row: TData) => void;
  onRowDoubleClick?: (row: TData) => void;
  rowElement?: "article" | "tr";
  onSortingChange?: OnChangeFn<SortingState>;
  sorting?: SortingState;
};

function shouldIgnoreRowEvent(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, select, textarea, [role='button']"))
  );
}

export function DataTable<TData>({
  className,
  columns,
  columnsTemplate,
  data,
  emptyMessage,
  emptyState,
  getRowClassName,
  getRowProps,
  getRowId,
  manualSorting = false,
  onRowClick,
  onRowDoubleClick,
  rowElement = "article",
  onSortingChange,
  sorting
}: DataTableProps<TData>) {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    ...(manualSorting ? { manualSorting: true } : { getSortedRowModel: getSortedRowModel() }),
    onSortingChange,
    state: sorting ? { sorting } : undefined
  });
  const gridTemplateColumns =
    columnsTemplate || `repeat(${Math.max(1, columns.length)}, minmax(160px, 1fr))`;
  const rowStyle: CSSProperties = { gridTemplateColumns };

  return (
    <div className={cx("ui-data-table", className)} role="table">
      <div className="ui-data-table-head" role="rowgroup">
        {table.getHeaderGroups().map((headerGroup) => (
          <div
            className="ui-data-table-row ui-data-table-header-row"
            key={headerGroup.id}
            role="row"
            style={rowStyle}
          >
            {headerGroup.headers.map((header) => (
              <div
                aria-sort={
                  header.column.getIsSorted() === "asc"
                    ? "ascending"
                    : header.column.getIsSorted() === "desc"
                      ? "descending"
                      : undefined
                }
                className="ui-data-table-cell ui-data-table-header-cell"
                key={header.id}
                role="columnheader"
              >
                {header.isPlaceholder ? null : header.column.getCanSort() && onSortingChange ? (
                  <button
                    className="ui-data-table-sort-button"
                    onClick={header.column.getToggleSortingHandler()}
                    type="button"
                  >
                    <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                    {header.column.getIsSorted() === "asc" ? (
                      <ArrowUp aria-hidden="true" />
                    ) : header.column.getIsSorted() === "desc" ? (
                      <ArrowDown aria-hidden="true" />
                    ) : (
                      <ArrowUpDown aria-hidden="true" />
                    )}
                  </button>
                ) : (
                  flexRender(header.column.columnDef.header, header.getContext())
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="ui-data-table-body" role="rowgroup">
        {table.getRowModel().rows.length > 0 ? table.getRowModel().rows.map((row) => {
          const RowElement = rowElement;
          const CellElement = rowElement === "tr" ? "td" : "div";
          const rowProps = getRowProps?.(row.original) || {};
          const {
            className: rowPropsClassName,
            onClick: rowPropsOnClick,
            onDoubleClick: rowPropsOnDoubleClick,
            style: rowPropsStyle,
            ...restRowProps
          } = rowProps;

          return (
            <RowElement
              {...restRowProps}
              className={cx("ui-data-table-row", getRowClassName?.(row.original), rowPropsClassName)}
              key={row.id}
              onClick={(event) => {
                rowPropsOnClick?.(event);
                if (event.defaultPrevented || shouldIgnoreRowEvent(event.target)) {
                  return;
                }
                onRowClick?.(row.original);
              }}
              onDoubleClick={(event) => {
                rowPropsOnDoubleClick?.(event);
                if (event.defaultPrevented || shouldIgnoreRowEvent(event.target)) {
                  return;
                }
                onRowDoubleClick?.(row.original);
              }}
              role="row"
              style={{ ...rowStyle, ...rowPropsStyle }}
            >
              {row.getVisibleCells().map((cell) => (
                <CellElement className="ui-data-table-cell" key={cell.id} role="cell">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </CellElement>
              ))}
            </RowElement>
          );
        }) : (
          <div className="ui-data-table-empty">
            {emptyState || emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
