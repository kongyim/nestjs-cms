import { hashPassword, verifyPassword } from "../src/password";

describe("password hashing", () => {
  it("uses random salts and verifies only the correct password", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    expect(first).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery staple", first)).toBe(
      true,
    );
    expect(await verifyPassword("wrong password", first)).toBe(false);
    expect(await verifyPassword("anything", "malformed")).toBe(false);
  });
});
