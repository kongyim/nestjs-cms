import * as loader from "../src/resource/resource.loader";

it("exports the library API without discovering resources or importing the demo data source", () => {
  const discover = jest.spyOn(loader, "loadResources");
  try {
    const cms = require("../src/index");
    expect(typeof cms.ResourceModule.forRoot).toBe("function");
    expect(typeof cms.defineResource).toBe("function");
    expect(typeof cms.z.object).toBe("function");
    expect(typeof cms.createCmsDataSource).toBe("function");
    expect(typeof cms.configureCmsApp).toBe("function");
    expect(discover).not.toHaveBeenCalled();
  } finally {
    discover.mockRestore();
  }
});
