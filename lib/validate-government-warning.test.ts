import { describe, expect, it } from "vitest";
import {
  REQUIRED_GOVERNMENT_WARNING,
  validateGovernmentWarning,
} from "./validate-government-warning";

describe("validateGovernmentWarning", () => {
  it.each([
    ["exact required text", REQUIRED_GOVERNMENT_WARNING],
    ["multiple lines", REQUIRED_GOVERNMENT_WARNING.replace(/ /g, "\n")],
    ["repeated spaces", REQUIRED_GOVERNMENT_WARNING.replace(/ /g, "   ")],
    ["leading and trailing whitespace", ` \n${REQUIRED_GOVERNMENT_WARNING}\t `],
    ["tabs", REQUIRED_GOVERNMENT_WARNING.replace(/ /g, "\t")],
    ["mixed formatting whitespace", REQUIRED_GOVERNMENT_WARNING.replace(/ /g, " \t\r\n ")],
  ])("passes with %s", (_description, text) => {
    expect(validateGovernmentWarning(text)).toEqual({
      status: "Pass",
      reason: "Government warning wording and capitalization match the required text.",
    });
  });

  it.each([
    ["title case heading", "Government Warning:"],
    ["omitted heading", ""],
    ["lowercase heading", "government warning:"],
    ["missing colon", "GOVERNMENT WARNING"],
    ["changed colon", "GOVERNMENT WARNING;"],
    ["space before colon", "GOVERNMENT WARNING :"],
  ])("fails with %s", (_description, heading) => {
    const text = REQUIRED_GOVERNMENT_WARNING.replace("GOVERNMENT WARNING:", heading);
    expect(validateGovernmentWarning(text)).toEqual({
      status: "Fail",
      reason: "Government warning heading must be exactly 'GOVERNMENT WARNING:'.",
    });
  });

  it.each([
    ["changed word", REQUIRED_GOVERNMENT_WARNING.replace("women", "people")],
    ["missing word", REQUIRED_GOVERNMENT_WARNING.replace("alcoholic beverages", "beverages")],
    ["added word", REQUIRED_GOVERNMENT_WARNING.replace("women", "all women")],
    ["missing comma", REQUIRED_GOVERNMENT_WARNING.replace("General,", "General")],
    ["missing second comma", REQUIRED_GOVERNMENT_WARNING.replace("machinery,", "machinery")],
    ["missing period", REQUIRED_GOVERNMENT_WARNING.replace("defects.", "defects")],
    ["missing final period", REQUIRED_GOVERNMENT_WARNING.slice(0, -1)],
    ["missing (1)", REQUIRED_GOVERNMENT_WARNING.replace("(1) ", "")],
    ["missing (2)", REQUIRED_GOVERNMENT_WARNING.replace("(2) ", "")],
    ["changed punctuation", REQUIRED_GOVERNMENT_WARNING.replace("General,", "General;")],
    ["changed numbering punctuation", REQUIRED_GOVERNMENT_WARNING.replace("(1)", "[1]")],
    ["changed body capitalization", REQUIRED_GOVERNMENT_WARNING.replace("According", "according")],
    ["added final text", `${REQUIRED_GOVERNMENT_WARNING} Extra words.`],
  ])("fails with %s", (_description, text) => {
    expect(validateGovernmentWarning(text)).toEqual({
      status: "Fail",
      reason: "Government warning wording or punctuation does not match the required statement.",
    });
  });

  it.each(["", " \t\r\n ", null, undefined])(
    "reports a missing warning for %s",
    (text) => {
      expect(validateGovernmentWarning(text)).toEqual({
        status: "Fail",
        reason: "Government warning is missing.",
      });
    },
  );
});
