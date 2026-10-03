import { z } from "zod";
import type { ApplicationData } from "./evaluate-verification";
import type { BeverageType } from "./normalize-alcohol-content";

const beverageTypes = ["distilled-spirits", "wine", "beer-malt-beverage"] as const satisfies readonly BeverageType[];
const requiredText = (max: number) => z.string().max(max).refine(
  (value) => value.trim().length > 0,
  "Enter a nonblank value.",
);

/** Validate application input without normalizing the values used for comparison. */
export const applicationSchema = z.strictObject({
  beverageType: z.enum(beverageTypes),
  brandName: requiredText(500),
  classType: requiredText(500),
  alcoholContent: requiredText(100),
  netContents: requiredText(100),
  producerName: requiredText(500),
  producerAddress: requiredText(1000),
  importedProduct: z.boolean(),
  countryOfOrigin: z.string().max(200).nullish(),
}).refine(
  (data) => !data.importedProduct || Boolean(data.countryOfOrigin?.trim()),
  { path: ["countryOfOrigin"], message: "Enter the country of origin for an imported product." },
).transform((data): ApplicationData => ({
  ...data,
  countryOfOrigin: data.countryOfOrigin ?? undefined,
}));
