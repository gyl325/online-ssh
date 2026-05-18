import { type FormEvent, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "./Button";
import { FormField } from "./FormField";
import { SelectInput } from "./SelectInput";
import { IconButton } from "./IconButton";

type PaginationProps = {
  firstLabel: string;
  jumpLabel?: string;
  label: string;
  lastLabel: string;
  nextLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  page: number;
  pageInputLabel?: string;
  pageSize?: number;
  pageSizeLabel?: string;
  pageSizeOptions?: number[];
  previousLabel: string;
  totalPages: number;
};

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), totalPages);
}

export function Pagination({
  firstLabel,
  jumpLabel,
  label,
  lastLabel,
  nextLabel,
  onPageChange,
  onPageSizeChange,
  page,
  pageInputLabel,
  pageSize,
  pageSizeLabel,
  pageSizeOptions,
  previousLabel,
  totalPages
}: PaginationProps) {
  const normalizedTotalPages = Math.max(1, totalPages);
  const normalizedPage = clampPage(page, normalizedTotalPages);
  const isFirst = normalizedPage <= 1;
  const isLast = normalizedPage >= normalizedTotalPages;
  const [pageInput, setPageInput] = useState(String(normalizedPage));
  const pageSizeControl =
    pageSizeOptions && pageSizeOptions.length > 0 && pageSize !== undefined && pageSizeLabel && onPageSizeChange
      ? {
          label: pageSizeLabel,
          onChange: onPageSizeChange,
          options: pageSizeOptions,
          value: pageSize
        }
      : null;

  useEffect(() => {
    setPageInput(String(normalizedPage));
  }, [normalizedPage]);

  const goToPage = (targetPage: number) => {
    const nextPage = clampPage(targetPage, normalizedTotalPages);
    onPageChange(nextPage);
    setPageInput(String(nextPage));
  };

  const submitJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(pageInput);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(normalizedPage));
      return;
    }
    goToPage(Math.trunc(parsed));
  };

  return (
    <nav className="ui-pagination" aria-label={label}>
      <div className="ui-pagination-controls">
        <IconButton className="pagination-control" disabled={isFirst} label={firstLabel} onClick={() => goToPage(1)}>
          <ChevronsLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          className="pagination-control"
          disabled={isFirst}
          label={previousLabel}
          onClick={() => goToPage(normalizedPage - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <Button className="pagination-control ui-pagination-current" disabled variant="ghost">
          {normalizedPage} / {normalizedTotalPages}
        </Button>
        <IconButton
          className="pagination-control"
          disabled={isLast}
          label={nextLabel}
          onClick={() => goToPage(normalizedPage + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
        <IconButton
          className="pagination-control"
          disabled={isLast}
          label={lastLabel}
          onClick={() => goToPage(normalizedTotalPages)}
        >
          <ChevronsRight aria-hidden="true" />
        </IconButton>
      </div>
      {jumpLabel ? (
        <form className="ui-pagination-jump" onSubmit={submitJump}>
          <input
            aria-label={pageInputLabel || jumpLabel}
            className="pagination-input"
            inputMode="numeric"
            onChange={(event) => setPageInput(event.target.value)}
            value={pageInput}
          />
          <Button className="pagination-control" type="submit" variant="secondary">
            {jumpLabel}
          </Button>
        </form>
      ) : null}
      {pageSizeControl ? (
        <FormField className="pagination-size ui-pagination-size" label={pageSizeControl.label}>
          {(id) => (
            <SelectInput
              aria-label={pageSizeControl.label}
              id={id}
              onChange={(event) => pageSizeControl.onChange(Number(event.target.value))}
              value={pageSizeControl.value}
            >
              {pageSizeControl.options.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      ) : null}
    </nav>
  );
}
