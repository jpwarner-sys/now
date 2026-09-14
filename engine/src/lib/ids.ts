/**
 * REDACTED FOR THE PUBLIC REPO.
 *
 * The real file holds live identifiers — a Google Sheet id, an Apps Script web-app
 * deployment id, two Drive folder ids, a file id and an account hint. Two of those are
 * irreplaceable and one is effectively an endpoint, so none of them belong in a public
 * repository. They live only on the owner's machine.
 *
 * This copy exists so the rest of `engine/` reads and type-checks as written. It will
 * build; it will not reach anything. Restore the real values before running it against
 * the live ledger.
 *
 * See RECONCILIATION.md § "What is redacted".
 */
export const LIVE = {
  sheetId: "REDACTED_SHEET_ID",
  webappDeploy: "REDACTED_WEBAPP_DEPLOYMENT",
  appFolder: "REDACTED_APP_FOLDER_ID",
  feedsFolder: "REDACTED_FEEDS_FOLDER_ID",
  codeGs: "REDACTED_CODE_GS_FILE_ID",
  accountHint: "REDACTED_ACCOUNT",
} as const;

export const LIVE_CONTROL = false;

export const TICKET = "gb-now-shell-v0";
export const ORIGIN_SURFACE = "joe_os_now";

export const SHEETS = {
  floor: "Sheet1",
  captures: "Captures",
  wins: "Wins",
} as const;
