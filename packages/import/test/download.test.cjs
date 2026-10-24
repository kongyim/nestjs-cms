const { test } = require("node:test");
const assert = require("node:assert/strict");
const dns = require("node:dns/promises");
const https = require("node:https");
const { PassThrough, Writable } = require("node:stream");
const {
  isPublicAddress,
  attachmentUrl,
  downloadAttachment,
} = require("../dist/download");

test("rejects local, private, mapped and reserved IP addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.throws(() => attachmentUrl("http://localhost/a"));
});

test("downloads are bounded, MIME checked, DNS pinned, and redirects revalidated", async () => {
  const originalLookup = dns.lookup,
    originalRequest = https.request;
  let mode = "ok",
    requests = 0;
  dns.lookup = async () => [
    { address: mode === "private-dns" ? "127.0.0.1" : "8.8.8.8", family: 4 },
  ];
  https.request = (url, options, callback) => {
    requests++;
    options.lookup(url.hostname, { all: true }, (_, result) =>
      assert.equal(result[0].address, "8.8.8.8"),
    );
    const req = new Writable({
      write(chunk, encoding, next) {
        next();
      },
    });
    req.on("finish", () => {
      const response = new PassThrough();
      response.statusCode = mode === "redirect" ? 302 : 200;
      response.headers = {
        "content-type": mode === "mime" ? "text/html" : "image/png",
        location: "http://127.0.0.1/secret",
      };
      callback(response);
      if (!response.destroyed) response.end(Buffer.from("image"));
    });
    return req;
  };
  try {
    const field = { field: "cover", mimeTypes: ["image/png"] };
    const file = await downloadAttachment(
      "https://example.com/image.png",
      field,
      10,
    );
    assert.equal(file.originalname, "image.png");
    assert.equal(file.buffer.toString(), "image");
    await assert.rejects(
      downloadAttachment("https://example.com/image.png", field, 2),
      /Could not download/,
    );
    for (mode of ["mime", "redirect", "private-dns"])
      await assert.rejects(
        downloadAttachment("https://example.com/image.png", field, 10),
        /Could not download/,
      );
    assert.equal(requests, 4);
  } finally {
    dns.lookup = originalLookup;
    https.request = originalRequest;
  }
});
