import { join } from "node:path";
import { createCmsDataSource } from "./create-data-source";
import { loadResources } from "../resource/resource.loader";

// Demo application's CLI data source; not part of the library entry point.
export const dataSource = createCmsDataSource(
  loadResources(join(__dirname, "../../resources")),
  {
    migrations: [join(__dirname, "migrations/*{.ts,.js}")],
  },
);
