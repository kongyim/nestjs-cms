import { GoogleAuth } from "google-auth-library";
import type { ImportOptions } from "./options";
export type SheetRows = Record<string, unknown[][]>;
export interface SheetReader {
  read(options: ImportOptions, resourceNames: string[]): Promise<SheetRows>;
}

/** Uses read-only OAuth scope. Credentials and upstream responses never reach the browser. */
export class GoogleSheetReader implements SheetReader {
  async read(
    options: ImportOptions,
    resourceNames: string[],
  ): Promise<SheetRows> {
    const auth = new GoogleAuth({
      keyFilename: options.keyFile,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(options.spreadsheetId)}`;
    try {
      const client = await auth.getClient();
      const meta = await client.request<{
        sheets?: { properties: { title: string } }[];
      }>({
        url: base,
        params: { fields: "sheets.properties.title" },
        timeout: 30000,
      });
      const titles = new Set(
        meta.data.sheets?.map((sheet) => sheet.properties.title),
      );
      const selected = resourceNames.filter((name) => titles.has(name));
      if (!selected.length) return {};
      const query = new URLSearchParams({
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });
      // Read each complete tab: a bounded range could silently omit distant rows.
      // The planner enforces maxRows over all nonempty data rows.
      for (const name of selected) query.append("ranges", `'${name}'`);
      const values = await client.request<{
        valueRanges: { values?: unknown[][] }[];
      }>({
        url: `${base}/values:batchGet?${query}`,
        timeout: 30000,
      });
      return Object.fromEntries(
        selected.map((name, index) => [
          name,
          values.data.valueRanges[index]?.values ?? [],
        ]),
      );
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response
        ?.status;
      if (status === 403 || status === 404)
        throw new Error(
          "Google Sheets access denied. Check the sheet ID, Sheets API access, and sharing with the service account.",
        );
      throw new Error(
        "Could not read Google Sheets. Check the server credential file and network access.",
      );
    }
  }
}
