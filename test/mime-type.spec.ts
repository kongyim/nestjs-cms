import { matchesMimeType } from "../src/storage/mime-type";

it.each(["image/jpeg", "image/png", "image/webp", "image/svg+xml"])("matches image wildcard: %s", (mime) => {
  expect(matchesMimeType(mime, ["application/pdf", "image/*"])).toBe(true);
});
it("preserves exact matches and rejects unrelated or invalid types", () => {
  expect(matchesMimeType("application/pdf", ["application/pdf", "image/*"])).toBe(true);
  expect(matchesMimeType(" IMAGE/JPEG ", ["Image/*"])).toBe(true);
  for (const mime of ["text/html", "application/pdf", "image/", "image/*", "image/jpeg/extra", "image/jpeg; charset=utf-8", ""]) {
    expect(matchesMimeType(mime, ["image/*"])).toBe(false);
  }
  expect(matchesMimeType("image/png", ["image/jpeg"])).toBe(false);
});
