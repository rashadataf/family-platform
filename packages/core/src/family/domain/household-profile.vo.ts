/**
 * The household profile downstream contexts read (ARCHITECTURE.md §5.2,
 * FR-002).
 *
 * Every field is optional. A family is useful the moment it exists, and
 * Principle VI's data minimisation means we do not require a postcode from
 * someone who has not yet been given a reason to give one.
 */
export interface HouseholdComposition {
  readonly adults: number;
  readonly children: number;
}

export interface HouseholdProfileProps {
  readonly postcode: string | null;
  readonly localAuthorityCode: string | null;
  readonly composition: HouseholdComposition | null;
}

/**
 * Normalises a UK postcode's *shape* without validating that it exists:
 * uppercased, internal whitespace collapsed to a single space. Two people
 * typing `sw1a1aa` and `SW1A 1AA` mean the same household, and a later
 * lookup against real reference data should not fail on a space.
 *
 * Deliberately NOT a format check. Validating against real addresses belongs
 * to the deferred Reference and Locale context (spec.md Assumptions), and a
 * half-right regex here would reject valid overseas-territory and BFPO codes
 * that a UK-first product should still be able to store.
 */
function normalisePostcode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, ' ');
}

export class HouseholdProfile {
  private constructor(private readonly props: HouseholdProfileProps) {}

  static readonly empty = new HouseholdProfile({
    postcode: null,
    localAuthorityCode: null,
    composition: null,
  });

  static from(input: {
    postcode?: string | null;
    localAuthorityCode?: string | null;
    composition?: HouseholdComposition | null;
  }): HouseholdProfile {
    const postcode = input.postcode?.trim();
    const localAuthorityCode = input.localAuthorityCode?.trim();

    return new HouseholdProfile({
      postcode: postcode === undefined || postcode === '' ? null : normalisePostcode(postcode),
      // An IDENTIFIER, never a council name — the constitution's
      // UK-first-without-being-UK-welded constraint. Uppercased because ONS
      // codes (`E09000033`) are conventionally uppercase and a lowercase copy
      // would fail a later join against reference data.
      localAuthorityCode:
        localAuthorityCode === undefined || localAuthorityCode === ''
          ? null
          : localAuthorityCode.toUpperCase(),
      composition: input.composition ?? null,
    });
  }

  get postcode(): string | null {
    return this.props.postcode;
  }

  get localAuthorityCode(): string | null {
    return this.props.localAuthorityCode;
  }

  get composition(): HouseholdComposition | null {
    return this.props.composition;
  }
}
