import { z } from "zod";

/**
 * Evidence only: transcribe label text exactly as seen, or use null when unreadable.
 * Never correct spelling, normalize capitalization or punctuation, convert units
 * or proof to ABV, or invent missing values. No compliance decisions belong here.
 * Validation checks the data format; it cannot verify transcription accuracy.
 */
export const labelExtractionSchema = z.strictObject({
  brandName: z.string().nullable(),
  classType: z.string().nullable(),
  alcoholContent: z.string().nullable(),
  netContents: z.string().nullable(),
  producerName: z.string().nullable(),
  producerAddress: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  governmentWarningText: z.string().nullable(),
  // Visual observation only; the verification engine decides compliance later.
  governmentWarningHeadingBold: z.enum(["yes", "no", "uncertain"]),
  // Whether the warning body after the heading visually appears bold.
  governmentWarningBodyBold: z.enum(["yes", "no", "uncertain"]),
  imageQuality: z.strictObject({
    readable: z.boolean(),
    glare: z.enum(["none", "low", "high"]),
    perspectiveDistortion: z.enum(["none", "low", "high"]),
    criticalTextObscured: z.boolean(),
    reason: z.string().nullable(),
  }),
});

export type LabelExtraction = z.infer<typeof labelExtractionSchema>;
