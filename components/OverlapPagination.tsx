interface OverlapPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  showing: number;
  onPageChange: (page: number) => void;
}

export function OverlapPagination({
  page,
  totalPages,
  total,
  showing,
  onPageChange,
}: OverlapPaginationProps) {
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-lb-cloud">
        Showing {showing} of {total} films
        {totalPages > 1 && ` · Page ${page} of ${totalPages}`}
      </p>
      {totalPages > 1 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded-lg border border-lb-ocean bg-lb-charcoal px-3 py-1.5 text-sm text-lb-dust transition hover:bg-lb-shadow disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="rounded-lg border border-lb-ocean bg-lb-charcoal px-3 py-1.5 text-sm text-lb-dust transition hover:bg-lb-shadow disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
