import { SelectQueryBuilder } from "typeorm";
import { applyQuery } from "../src/resource/query";
import articles from "../resources/articles";

function builder(driver = "postgres") {
  const qb = {
    connection: { options: { type: driver } },
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
  };
  return {
    qb,
    typed: qb as unknown as SelectQueryBuilder<Record<string, unknown>>,
  };
}
it("keeps real field names distinct from dollar operators", () => {
  const { qb, typed } = builder();
  applyQuery(
    typed,
    {
      ...articles,
      columns: { eq: { type: String }, in: { type: String } },
      filterable: ["eq", "in"],
    },
    {
      query: JSON.stringify({
        eq: { $eq: "literal" },
        in: { $in: ["a", "b"] },
      }),
    },
  );
  expect(qb.andWhere).toHaveBeenCalledWith("r.eq = :p0", { p0: "literal" });
  expect(qb.andWhere).toHaveBeenCalledWith("r.in IN (:...p1)", {
    p1: ["a", "b"],
  });
});
it.each([
  "eq",
  "in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "locate",
  "$contians",
  "$raw",
])("rejects unsupported operator %s", (op) => {
  const { typed } = builder();
  expect(() =>
    applyQuery(typed, articles, {
      query: JSON.stringify({ title: { [op]: "x" } }),
    }),
  ).toThrow();
});
it.each(["postgres", "mysql"])(
  "binds locate text and position values on %s",
  (driver) => {
    const { qb, typed } = builder(driver);
    const search = "%' OR 1=1 --";
    applyQuery(typed, articles, {
      query: JSON.stringify({ title: { $locate: { search, $eq: 0 } } }),
    });
    const [sql, parameters] = qb.andWhere.mock.calls[0];
    expect(sql).not.toContain(search);
    expect(Object.values(parameters)).toEqual([search, 0]);
  },
);
it("rejects locate on non-string columns", () => {
  const { typed } = builder();
  expect(() =>
    applyQuery(
      typed,
      {
        ...articles,
        columns: { count: { type: Number } },
        filterable: ["count"],
      },
      { query: JSON.stringify({ count: { $locate: "1" } }) },
    ),
  ).toThrow("$locate requires a string column");
});
