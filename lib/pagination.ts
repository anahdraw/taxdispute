export type PaginationMeta = {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type PaginationParams = {
  page: number;
  perPage: number;
  offset: number;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function parsePaginationParams(url: string, defaults: { page?: number; perPage?: number; maxPerPage?: number } = {}): PaginationParams {
  const params = new URL(url).searchParams;
  const maxPerPage = defaults.maxPerPage || 100;
  const page = clampInteger(params.get("page"), defaults.page || 1, 1, 100000);
  const perPage = clampInteger(params.get("perPage") || params.get("limit"), defaults.perPage || 25, 1, maxPerPage);
  return {
    page,
    perPage,
    offset: (page - 1) * perPage
  };
}

export function buildPaginationMeta(params: PaginationParams, total: number): PaginationMeta {
  const safeTotal = Math.max(0, Number(total || 0));
  const totalPages = Math.max(1, Math.ceil(safeTotal / params.perPage));
  return {
    page: Math.min(params.page, totalPages),
    perPage: params.perPage,
    total: safeTotal,
    totalPages,
    hasNext: params.page < totalPages,
    hasPrevious: params.page > 1
  };
}
