/** A letter-or-digit boundary. JavaScript's `\b` treats accented letters as non-word characters, even with the `u` flag. */
const WORD_BOUNDARY = String.raw`(?:(?<=[\p{L}\p{N}])(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?=[\p{L}\p{N}]))`;

/** Case- and accent-insensitive name matching: "tio manuel" heard without its accent still names "Tío Manuel". */
export const foldName = (name: string): string => name.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US");

/** A case-insensitive Unicode pattern whose `\b` is a letter-or-digit boundary, accented letters included. */
export const spanishPattern = (source: string): RegExp => new RegExp(source.replaceAll(String.raw`\b`, WORD_BOUNDARY), "iu");
