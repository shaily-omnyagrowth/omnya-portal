import { pageList } from "./Pagination";
import { gradientFor } from "./Avatar";

test("pageList keeps the ends and neighbours, with gaps", () => {
  expect(pageList(0, 1)).toEqual([0]);
  expect(pageList(0, 12)).toEqual([0, 1, null, 11]);
  expect(pageList(5, 12)).toEqual([0, null, 4, 5, 6, null, 11]);
  expect(pageList(2, 5)).toEqual([0, 1, 2, 3, 4]);
});

test("gradientFor is stable per name and differs between names", () => {
  expect(gradientFor("Shaily")).toBe(gradientFor("Shaily"));
  expect(gradientFor("Shaily")).not.toBe(gradientFor("Jeremy"));
});
