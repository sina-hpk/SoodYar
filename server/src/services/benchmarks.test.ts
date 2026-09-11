import { describe, expect, it } from "vitest";
import { parseTgjuHistoryTable } from "./benchmarks.js";

/**
 * A trimmed copy of the real TGJU history table shape: open / low / high /
 * close / change / change% / Gregorian date / Jalali date, newest first.
 */
const FIXTURE = `
<table><thead><tr><th>بازگشایی</th><th>پایانی</th></tr></thead>
<tbody id="table-list">
  <tr> <td>2,277,000</td> <td>2,276,600</td> <td>2,328,200</td> <td>2,327,000</td> <td><span class="high" dir="ltr">60000</span></td> <td> <span class="high" dir="ltr">2.65%</span> </td> <td>2026/09/09</td> <td>1405/06/18</td> </tr>
  <tr> <td>2,232,650</td> <td>2,232,600</td> <td>2,267,200</td> <td>2,267,000</td> <td><span class="high" dir="ltr">46000</span></td> <td> <span class="high" dir="ltr">2.07%</span> </td> <td>2026/09/08</td> <td>1405/06/17</td> </tr>
  <tr> <td>خراب</td> <td>—</td> <td>—</td> <td>—</td> <td>—</td> <td>—</td> <td>—</td> <td>—</td> </tr>
  <tr> <td>2,251,000</td> <td>2,220,600</td> <td>2,253,200</td> <td>2,221,000</td> <td><span class="low" dir="ltr">9000</span></td> <td> <span class="low" dir="ltr">0.41%</span> </td> <td>2026/09/07</td> <td>1405/06/16</td> </tr>
</tbody></table>`;

describe("TGJU history parsing", () => {
  it("takes the close price and the Gregorian date, newest-first input sorted ascending", () => {
    expect(parseTgjuHistoryTable(FIXTURE)).toEqual([
      { date: "2026-09-07", closeRial: "2221000" },
      { date: "2026-09-08", closeRial: "2267000" },
      { date: "2026-09-09", closeRial: "2327000" },
    ]);
  });

  it("skips malformed rows instead of guessing a price", () => {
    const rows = parseTgjuHistoryTable(FIXTURE);
    expect(rows.some((row) => row.date === "—")).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it("returns nothing when the expected table is absent", () => {
    expect(parseTgjuHistoryTable("<html><body>no table here</body></html>")).toEqual([]);
  });

  it("keeps the first occurrence of a duplicated date", () => {
    const duplicated = `<tbody id="table-list">
      <tr><td>1</td><td>1</td><td>1</td><td>100</td><td>0</td><td>0%</td><td>2026/09/09</td><td>1405/06/18</td></tr>
      <tr><td>1</td><td>1</td><td>1</td><td>999</td><td>0</td><td>0%</td><td>2026/09/09</td><td>1405/06/18</td></tr>
    </tbody>`;
    expect(parseTgjuHistoryTable(duplicated)).toEqual([
      { date: "2026-09-09", closeRial: "100" },
    ]);
  });
});
