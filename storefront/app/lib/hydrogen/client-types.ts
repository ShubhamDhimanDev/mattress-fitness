// Type helpers that make `storefront.query` and `customerAccount.query` pick their result and variables from the
// codegen output by query text (storefrontapi.generated.d.ts). They are ported from @shopify/hydrogen 2026.4.7
// (MIT), which owned them until the 2026.10 library dropped the codegen-keyed client (ADR-0012).

type IsNever<T> = [T] extends [never] ? true : false;

type GenericVariables = Record<string, unknown>;

/** The variables of an operation, or a generic record when the query text is not in the generated map. */
type VariablesOf<
  Operations,
  Query extends string,
> = Query extends keyof Operations
  ? Operations[Query] extends {variables: infer Variables}
    ? Variables
    : GenericVariables
  : GenericVariables;

/** Keys the client fills from the request (`country`, `language`) become optional for the caller. */
type SetOptional<Base, Keys extends keyof Base> = Omit<Base, Keys> &
  Partial<Pick<Base, Keys>>;

export type AutoAddedVariableNames = 'country' | 'language';

export type ClientReturn<
  Operations,
  Query extends string,
  OverrideReturnType = never,
> =
  IsNever<OverrideReturnType> extends true
    ? Query extends keyof Operations
      ? Operations[Query] extends {return: infer Return}
        ? Return
        : unknown
      : unknown
    : OverrideReturnType;

type ClientVariables<
  Operations,
  Query extends string,
  OptionalNames extends string,
  Variables = VariablesOf<Operations, Query>,
> = {
  variables: SetOptional<Variables, Extract<keyof Variables, OptionalNames>>;
};

type VariablesAreOptional<
  Operations,
  Query extends string,
  OptionalNames extends string,
  Variables = VariablesOf<Operations, Query>,
  Required = Omit<Variables, OptionalNames>,
> = Query extends keyof Operations
  ? Partial<Required> extends Required
    ? true
    : false
  : true;

/** The rest parameter of `query` / `mutate`: the options object is optional only when no variable is required. */
export type ClientVariablesInRestParams<
  Operations,
  Query extends string,
  OtherParams extends Record<string, unknown> = Record<never, never>,
  OptionalNames extends string = never,
> =
  VariablesAreOptional<Operations, Query, OptionalNames> extends true
    ? [
        (OtherParams &
          Partial<ClientVariables<Operations, Query, OptionalNames>>)?,
      ]
    : [OtherParams & ClientVariables<Operations, Query, OptionalNames>];
