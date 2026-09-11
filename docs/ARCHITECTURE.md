# Architecture notes

Why each boundary sits where it does. The README covers setup and testing;
this covers reasoning.

## Why the Python domain layer holds no framework

`backend/app/domain` imports no web framework and no database driver. Three
things follow.

**A route cannot invent a status.** `CheckStatus` and `MappingStatus` are
separate enums with no overlapping members, so a plan proposal cannot be
rendered through the verification vocabulary. The frontend mirrors the same
split in `src/domain/types.ts`.

**The commit gate cannot be forgotten on a new screen.** `assert_commit_allowed`
reads stored records and refuses. A page that forgets to disable a button
still cannot commit, because the gate is not in the page.

**The rules run in a second.** The core suite needs no database and no
network, so a change to a transformation rule is verified immediately rather
than after a container starts.

## Why the frontend has almost no domain logic

It used to have a verification engine. That engine returned fixed objects
derived from boolean flags, which meant the interface could show a result the
backend had never computed. It was deleted when the API landed.

What remains in `src/domain` is the status vocabulary and the presentation
rules. Every number on every screen arrives over HTTP.

## Why plan versions are immutable

`revise()` returns a new plan with an incremented version. `save_plan` has no
update path, and the primary key on `(migration_id, version)` makes a second
write of the same version an error rather than an overwrite.

If an approved plan could be edited, an evidence report could never truthfully
answer "what did the operator approve". Keeping v1 on the record, including
the risky cast that failed, is the point rather than an oversight.

## Why approval takes a validation result

`approve()` will not accept a bare plan. It takes a `ValidationResult`, which
can only come from `validate_plan`. A proposal therefore cannot become
executable by calling a function on it.

It refuses on two conditions: any fatal validation issue, and any lossy
operation whose column is not named in the acknowledgements. Naming the column
matters. A single "I understand the risks" checkbox would not record which
risk was understood.

The executor checks the same two things again on the plan it is handed, which
closes the path where a caller constructs an approved-looking object directly.

## Why the repair rereads the source

A leading zero destroyed by an integer cast is not recoverable from the
integer. `127` cast to text gives `"127"`. There is no transformation back to
`"00127"` that is not a guess.

`moveproof.source_files` stores the uploaded bytes, and every run reparses
them. No run reads a previous run's staged output. `load_original_bytes`
recomputes the checksum on every read, so a corrupted or substituted source is
caught rather than used as the basis for a repair.

## Why there are four result categories

A single accuracy percentage lets an unchecked property hide inside a green
number.

- **Passed** the check ran against transformed data and succeeded.
- **Failed** the check ran and an approved invariant was violated.
- **Review required** the check ran and a human decision is outstanding.
- **Not verified** the property was never checked for this schema.

They do not overlap, and the counts always sum to the contract size. The
fourth is the one that matters: it is why an unbuilt Rust binary produces
`not_verified` rather than silence or a pass.

## Why commit fails closed on a conflict

The first implementation used `ON CONFLICT (customer_id) DO NOTHING`. A row
that already existed was skipped and the migration reported success. That is
the same class of silent damage the product exists to expose, reproduced
inside the product.

Now a preflight query finds colliding keys and colliding emails before
anything is written. Without an approved conflict policy the commit is
refused. With one, the number skipped is reported and reconciled, and
`moveproof.commits` carries a `CHECK` constraint requiring
`written + skipped = expected`.

## Why the verifier reads back from the database

An in-memory check compares the objects the executor produced. A check that
reads rows back out of PostgreSQL compares what was actually written. A JSON
round trip, a type adapter or a truncating column is invisible to the first
and visible to the second.

`db_verifier.verify_run` reloads the source rows, the staged rows, the applied
operations and the transformation errors, then hands a reconstructed result to
the same verifier the in-memory path uses.

An earlier version passed `errors=[]` when reconstructing, which meant a
rejected row became invisible after storage. That is now read back.

## Why Rust is a subprocess rather than an extension

A native module means matching build toolchains between two languages and a
compilation step in every environment that runs a test. A subprocess speaking
JSON on stdin and stdout can be exercised from either side with a shell
command, and can be replaced with a native module later without changing a
caller.

The cost is process start and serialisation per call. `make bench` measures
it. If that cost ever dominates, the interface is narrow enough to swap.

## Why the evidence object is built once

`build_evidence` assembles one dictionary from stored records. The HTML view,
the JSON export and the PDF are pure functions of it.

Three renderers reading three sources would eventually disagree. Three
renderers reading one dictionary cannot, and `test_reports.py` asserts the
property that keeps it true: rendering does not mutate the object.

## Data access boundary

The frontend reads through `src/data/api.ts` and never constructs a URL
itself. Every internal route is in `src/lib/routes.ts`, so a rename is a
compile error rather than a dead link found by a judge.
