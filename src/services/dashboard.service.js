const prisma = require('../lib/prisma');

const buildDateFilter = (startDate, endDate) => {
  const where = {};
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }
  return where;
};

const summary = async (startDate, endDate) => {
  const where = buildDateFilter(startDate, endDate);

  const [income, expense] = await Promise.all([
    prisma.financialRecord.aggregate({
      where: { ...where, type: 'INCOME' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.financialRecord.aggregate({
      where: { ...where, type: 'EXPENSE' },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const totalIncome = income._sum.amount || 0;
  const totalExpenses = expense._sum.amount || 0;

  return {
    totalIncome,
    totalExpenses,
    netBalance: totalIncome - totalExpenses,
    recordCount: income._count + expense._count,
  };
};

const categoryBreakdown = async (startDate, endDate) => {
  const where = buildDateFilter(startDate, endDate);

  const breakdown = await prisma.financialRecord.groupBy({
    by: ['category', 'type'],
    where,
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: 'desc' } },
  });

  return breakdown.map((item) => ({
    category: item.category,
    type: item.type,
    total: item._sum.amount,
    count: item._count,
  }));
};

/**
 * Monthly trends — uses raw SQL for efficient GROUP BY at the database level.
 * Avoids fetching all records into JS memory.
 */
const trends = async (startDate, endDate) => {
  const conditions = ['deleted_at IS NULL'];
  const params = [];
  let idx = 1;

  if (startDate) {
    conditions.push(`date >= $${idx++}::date`);
    params.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= $${idx++}::date`);
    params.push(endDate);
  }

  const result = await prisma.$queryRawUnsafe(
    `SELECT
      TO_CHAR(date, 'YYYY-MM') AS month,
      SUM(CASE WHEN type = 'INCOME' THEN amount ELSE 0 END)::int AS income,
      SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END)::int AS expense
    FROM financial_record
    WHERE ${conditions.join(' AND ')}
    GROUP BY TO_CHAR(date, 'YYYY-MM')
    ORDER BY month ASC`,
    ...params
  );

  return result.map((row) => ({
    month: row.month,
    income: Number(row.income),
    expense: Number(row.expense),
  }));
};

const recent = async (limit) => {
  return prisma.financialRecord.findMany({
    orderBy: { date: 'desc' },
    take: limit,
  });
};

module.exports = { summary, categoryBreakdown, trends, recent };
