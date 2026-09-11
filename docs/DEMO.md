# Three minute demo

Judges are not required to watch past three minutes, so the identifier failure
has to land before ninety seconds.

Record the real application in a browser. No mockups, no animated fakes.

## Before recording

```bash
cd backend && make db-up migrate rust reset && make api
npm run dev
```

Confirm `/health` reports the database connected, the Rust verifier available
and PDF generation available. If the Rust verifier is missing, canonical
reconciliation will show as not verified on camera, which is honest but muddies
the story.

## 0:00 to 0:20, the hook

The spreadsheet cell reads `00127`. The database row reads `127`. The import
log reads success.

> Moving data is easy. Knowing whether it survived the move is harder.

## 0:20 to 0:55, planning

Upload `backend/tests/fixtures/clean.csv`. Show the preview, then the mapping
step. Choose the legacy import profile. Point at `customer_id` marked review
required and at the approve button staying disabled until the acknowledgement
is ticked.

> A model proposes the mapping and says what it is unsure about. The risky
> operation cannot be approved by accident, and the acknowledgement is
> recorded against the plan version.

## 0:55 to 1:30, execution

Stage and run. Show the row accounting as arithmetic.

> The executor runs exactly what was approved. Nothing more.

## 1:30 to 2:05, verification, the centre of the demo

Identifier preservation fails. Show the four counts, then the discrepancy
explorer.

> A separate verifier checked the result. Every identifier that began with a
> zero was destroyed, not just the first, and it reports the real number.
> Note the fourth count: properties that were not checked at all are listed as
> not verified rather than folded into a score.

Try to commit. It is refused.

## 2:05 to 2:35, repair

Show the plan diff and the note explaining that the rerun reparses the
original file, because the zero cannot be recovered from `127`. Approve.
It reruns and reverifies.

## 2:35 to 2:55, the result

Commit. Open the evidence report, show the limitations section, download the
PDF.

> Verified against the approved contract, with an explicit record of what was
> not checked.

## Rules for the recording

- The dataset is synthetic and the failing profile is a deliberate choice. Say
  so. Do not imply the model discovered an unplanned incident.
- Keep text readable at 1080p.
- No architecture slides.
