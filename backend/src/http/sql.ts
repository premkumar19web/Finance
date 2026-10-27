import type { Queryable } from '../db.js';
import { pageMeta } from './validation.js';

/**
 * Builds a parameterised WHERE clause. Each `?` in a clause becomes the next $n
 * placeholder, so values are always sent separately from the SQL text.
 */
export class Filters {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  add(clause: string, ...values: unknown[]): this {
    let i = 0;
    this.clauses.push(clause.replace(/\?/g, () => this.param(values[i++])));
    return this;
  }

  /** Adds the clause only when `value` is not undefined/null. */
  addIf(value: unknown, clause: string): this {
    if (value !== undefined && value !== null) this.add(clause, ...Array(countMarks(clause)).fill(value));
    return this;
  }

  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  get where(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

const countMarks = (s: string) => (s.match(/\?/g) ?? []).length;

/** '%term%' for ILIKE with the user's own % and _ treated literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

export interface PageRequest {
  select: string;
  from: string;
  filters: Filters;
  orderBy: string;
  page: number;
  pageSize: number;
}

export async function paginate<T extends Record<string, unknown>>(db: Queryable, req: PageRequest) {
  const { select, from, filters, orderBy, page, pageSize } = req;
  const countResult = await db.query<{ total: number }>(
    `SELECT count(*) AS total FROM ${from} ${filters.where}`,
    filters.params,
  );
  const total = countResult.rows[0]?.total ?? 0;
  const params = [...filters.params, pageSize, (page - 1) * pageSize];
  const { rows } = await db.query<T>(
    `SELECT ${select} FROM ${from} ${filters.where} ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: rows, meta: pageMeta(page, pageSize, total) };
}
