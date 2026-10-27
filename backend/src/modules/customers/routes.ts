import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit.js';
import { assertBranchAccess, branchScope, effectiveBranch, getAuth, requirePermission } from '../../auth/middleware.js';
import { pool, withTransaction } from '../../db.js';
import { badRequest, businessRule, notFound } from '../../http/errors.js';
import { Filters, likePattern, paginate } from '../../http/sql.js';
import {
  idParam,
  optionalText,
  orderBy,
  pageQuery,
  phoneString,
  queryBool,
  requiredText,
  searchText,
} from '../../http/validation.js';

export const customersRouter = Router();

const ID_DOCUMENT_TYPES = ['AADHAAR', 'PAN', 'VOTER_ID', 'PASSPORT', 'DRIVING_LICENSE'] as const;

const listQuery = pageQuery.extend({
  search: searchText,
  branchId: z.coerce.number().int().positive().optional(),
  isActive: queryBool.optional(),
  sort: z.string().optional(),
});

const SORTS = {
  code: 'c.customer_code',
  name: 'c.full_name',
  branch: 'b.branch_name',
  createdAt: 'c.created_at',
};

const CUSTOMER_COLUMNS = `
  c.id, c.customer_code AS "customerCode", c.full_name AS "fullName", c.phone, c.email,
  c.address, c.occupation, c.id_document_type AS "idDocumentType",
  c.id_document_last4 AS "idDocumentLast4", c.is_active AS "isActive",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt",
  c.branch_id AS "branchId", b.branch_name AS "branchName"`;

customersRouter.get('/', requirePermission('customers.view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const f = new Filters();
  f.addIf(effectiveBranch(req, q.branchId), 'c.branch_id = ?');
  f.addIf(q.isActive, 'c.is_active = ?');
  if (q.search) {
    f.add(
      `(c.full_name ILIKE ? OR c.customer_code ILIKE ? OR c.phone ILIKE ? OR c.email ILIKE ?)`,
      ...Array(4).fill(likePattern(q.search)),
    );
  }
  res.json(
    await paginate(pool, {
      select: `${CUSTOMER_COLUMNS},
        (SELECT count(*) FROM loans l WHERE l.customer_id = c.id AND l.status IN ('ACTIVE','DEFAULTED')) AS "openLoans"`,
      from: 'customers c JOIN branches b ON b.id = c.branch_id',
      filters: f,
      orderBy: orderBy(q.sort, SORTS, 'c.created_at DESC, c.id DESC'),
      page: q.page,
      pageSize: q.pageSize,
    }),
  );
});

customersRouter.get('/:id', requirePermission('customers.view'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { rows } = await pool.query(
    `SELECT ${CUSTOMER_COLUMNS}, cu.name AS "createdByName"
     FROM customers c JOIN branches b ON b.id = c.branch_id
     LEFT JOIN users cu ON cu.id = c.created_by
     WHERE c.id = $1`,
    [id],
  );
  const customer = rows[0];
  if (!customer) throw notFound('Customer');
  assertBranchAccess(req, customer.branchId);

  const loans = await pool.query(
    `SELECT l.id, l.loan_code AS "loanCode", l.principal_amount AS "principalAmount",
            l.total_payable AS "totalPayable", l.outstanding_balance AS "outstandingBalance",
            l.collection_frequency AS "collectionFrequency", l.loan_term AS "loanTerm",
            l.loan_start_date AS "loanStartDate", l.maturity_date AS "maturityDate", l.status
     FROM loans l WHERE l.customer_id = $1 ORDER BY l.created_at DESC`,
    [id],
  );
  const totals = await pool.query(
    `SELECT COALESCE(SUM(l.outstanding_balance), 0) AS "totalOutstanding",
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN loans l2 ON l2.id = p.loan_id
                      WHERE l2.customer_id = $1 AND p.status = 'RECORDED'), 0) AS "totalPaid",
            (SELECT count(*) FROM v_collection_schedules s JOIN loans l3 ON l3.id = s.loan_id
             WHERE l3.customer_id = $1 AND s.effective_status = 'OVERDUE') AS "overdueInstallments"
     FROM loans l WHERE l.customer_id = $1 AND l.status IN ('ACTIVE','DEFAULTED')`,
    [id],
  );
  res.json({ data: { ...customer, loans: loans.rows, totals: totals.rows[0] } });
});

const customerBody = z.object({
  branchId: z.number().int().positive().optional(),
  fullName: requiredText(150),
  phone: phoneString,
  email: z.email('Enter a valid email').max(255).optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: optionalText(500),
  occupation: optionalText(100),
  idDocumentType: z.enum(ID_DOCUMENT_TYPES).optional().nullable(),
  idDocumentLast4: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{4}$/, 'Enter only the last 4 characters')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

function checkDocumentPair(body: { idDocumentType?: string | null | undefined; idDocumentLast4?: string | null | undefined }) {
  if (Boolean(body.idDocumentType) !== Boolean(body.idDocumentLast4)) {
    throw badRequest('Provide both the identity document type and its last 4 characters, or neither.');
  }
}

customersRouter.post('/', requirePermission('customers.manage'), async (req, res) => {
  const body = customerBody.parse(req.body);
  checkDocumentPair(body);
  const auth = getAuth(req);
  const branchId = effectiveBranch(req, body.branchId) ?? body.branchId;
  if (!branchId) throw badRequest('Choose a branch for the customer.');

  const customer = await withTransaction(async (db) => {
    const branch = await db.query('SELECT is_active FROM branches WHERE id = $1', [branchId]);
    if (!branch.rows[0]) throw badRequest('Branch does not exist.');
    if (!branch.rows[0].is_active) throw businessRule('BRANCH_INACTIVE', 'This branch is inactive.');

    const { rows } = await db.query<{ id: number; customerCode: string }>(
      `INSERT INTO customers (customer_code, branch_id, full_name, phone, email, address, occupation,
                              id_document_type, id_document_last4, created_by)
       VALUES ('CUST-' || lpad(nextval('customer_code_seq')::text, 6, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, customer_code AS "customerCode"`,
      [
        branchId,
        body.fullName,
        body.phone,
        body.email,
        body.address,
        body.occupation,
        body.idDocumentType ?? null,
        body.idDocumentLast4 ?? null,
        auth.userId,
      ],
    );
    const created = rows[0]!;
    await audit(db, req, {
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: created.id,
      details: { customerCode: created.customerCode, branchId },
    });
    return created;
  });
  res.status(201).json({ data: customer });
});

const updateBody = customerBody.partial().extend({ isActive: z.boolean().optional() });

const UPDATABLE: Record<string, string> = {
  branchId: 'branch_id',
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  occupation: 'occupation',
  idDocumentType: 'id_document_type',
  idDocumentLast4: 'id_document_last4',
  isActive: 'is_active',
};

customersRouter.patch('/:id', requirePermission('customers.manage'), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);

  await withTransaction(async (db) => {
    const existing = await db.query(
      'SELECT branch_id, is_active, id_document_type, id_document_last4 FROM customers WHERE id = $1 FOR UPDATE',
      [id],
    );
    const current = existing.rows[0];
    if (!current) throw notFound('Customer');
    assertBranchAccess(req, current.branch_id);
    if (body.branchId !== undefined && body.branchId !== current.branch_id) {
      if (branchScope(req) !== null) throw badRequest('You cannot move customers to another branch.');
    }
    checkDocumentPair({
      idDocumentType: body.idDocumentType !== undefined ? body.idDocumentType : current.id_document_type,
      idDocumentLast4: body.idDocumentLast4 !== undefined ? body.idDocumentLast4 : current.id_document_last4,
    });
    if (body.isActive === false && current.is_active) {
      const open = await db.query(
        `SELECT 1 FROM loans WHERE customer_id = $1 AND status IN ('PENDING','APPROVED','ACTIVE','DEFAULTED') LIMIT 1`,
        [id],
      );
      if (open.rowCount) {
        throw businessRule('CUSTOMER_HAS_OPEN_LOANS', 'Close or reject this customer’s open loans before deactivating.');
      }
    }

    const f = new Filters();
    const sets: string[] = [];
    for (const [key, column] of Object.entries(UPDATABLE)) {
      const value = (body as Record<string, unknown>)[key];
      if (value !== undefined) sets.push(`${column} = ${f.param(value)}`);
    }
    if (!sets.length) throw badRequest('Nothing to update.');
    await db.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = ${f.param(id)}`, f.params);

    const changed = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
    await audit(db, req, {
      action: body.isActive === false ? 'CUSTOMER_DEACTIVATED' : 'CUSTOMER_UPDATED',
      entityType: 'customer',
      entityId: id,
      details: { fields: changed },
    });
  });
  res.status(204).end();
});
