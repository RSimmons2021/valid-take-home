/**
 * Shared by the app (video callouts) and the AI server (places the copy may cite), so a
 * person is filtered out the same way everywhere.
 */

/**
 * Overture lists individual practitioners as places ("Jane Doe, MD", "Vivien Sun, Md"). An
 * ad shouldn't point at a person, so callouts and AI citations skip names that look like one. It errs towards
 * skipping: losing a business named "Smith Plumbing, Inc" costs one callout, naming a person
 * in an ad is the harm we're avoiding.
 */
const CREDENTIAL = "MD|M\\.D\\.|DDS|DMD|DO|DVM|PhD|LCSW|LMFT|NP|PA-C|RN";
const PERSONAL = [
  new RegExp(`,\\s*(${CREDENTIAL})\\b`, "i"), // "…, Md", "…, lcsw": credentials after a comma, any case
  new RegExp(`\\b(${CREDENTIAL})\\b`), // "Paws Clinic DVM": a credential in capitals anywhere
  /^Dr\.?\s/i, // "Dr. Dawn Rosenberg"
  /^[A-Z][a-z'-]+(?: [A-Z]\.?)? [A-Z][a-z'-]+,/, // "Vivien Sun, …", "Dawn L. Rosenberg, …": a person's name, then a comma
];
export const looksPersonal = (name: string) => PERSONAL.some((re) => re.test(name));
