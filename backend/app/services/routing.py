"""Selective reasoning escalation.

MoveProof proposes a mapping with Nemotron 3 Super. Most migrations need
nothing more: a column called `email` mapping to `email` is not a hard problem,
and sending every one of them to a 550B model would cost more and take longer
without interpreting anything better.

Some migrations are genuinely harder. When a single file carries an identifier
whose format is in doubt, a date that reads two ways, and a number whose
decimal separator is locale dependent, those ambiguities interact: how you read
one constrains how you should read the others. That is the case worth a second,
deeper pass.

The routing decision is deterministic and made *after* the first proposal has
been validated, so it reads facts rather than guesses.

**There is no confidence score here, and none is invented.** The model reply
schema has no confidence field, and adding a fabricated number purely to drive
routing would make the decision unexplainable in the one place it needs to be
explainable: the audit trail. Every signal below is something validation
already computed from the plan.

Escalation changes which model drafts a proposal. It changes nothing else. The
second proposal is validated by the same code, acknowledged by the same human,
executed by the same deterministic executor and checked by the same independent
verifier. Model capability may increase; model authority does not.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.plan import ValidationResult
from app.domain.types import Operation

# A "concern" is an interpretation decision the validator flagged, of either
# kind:
#
#   * a mapping that needs a human to acknowledge it by name, which is the
#     domain's own marker for a lossy transformation, and
#   * a non-fatal validation issue, which is the validator saying a mapping is
#     legal but questionable.
#
# Counting these rather than counting operations matters. Every plan, including
# the safe baseline, contains parse_date, cast_to_decimal and null_handling.
# Escalating on those would escalate every migration, which defeats the point
# of having a default model at all.
#
# Two is the threshold, deliberately. One concern is an ordinary migration and
# the acknowledgement gate already covers it: the leading-zero demonstration is
# exactly that case, and it should not escalate. The case for a deeper
# reinterpretation is interaction, where how you read one field constrains how
# you should read another.
INTERACTION_THRESHOLD = 2


@dataclass(frozen=True)
class RoutingDecision:
    """Why a proposal stayed on Super or went to the escalation model.

    Carried into the audit trail verbatim, so a reviewer can answer "why did
    this migration use the stronger model" without reading backend code.
    """

    escalate: bool
    default_model: str
    selected_model: str
    reasons: tuple[str, ...] = field(default_factory=tuple)

    def as_metadata(self) -> dict[str, object]:
        return {
            "default_model": self.default_model,
            "selected_model": self.selected_model,
            "escalated": self.escalate,
            "reasons": list(self.reasons),
        }


def evaluate(
    validation: ValidationResult,
    default_model: str,
    escalation_model: str | None,
) -> RoutingDecision:
    """Decide whether the first proposal deserves a deeper second pass.

    Reads only what plan validation produced from the first proposal. Nothing
    from the later evidence stage is consulted, because that stage runs long
    after planning and its results do not exist yet.

    Dataset size is deliberately not a signal. A million clean rows are easy
    and fifty messy ones are hard.
    """
    reasons: list[str] = []

    acknowledgements = [
        mapping.source_column
        for mapping in validation.plan.mappings
        if mapping.requires_acknowledgement
    ]
    advisories = [issue for issue in validation.issues if not issue.fatal]

    concerns = len(acknowledgements) + len(advisories)

    if concerns >= INTERACTION_THRESHOLD:
        if acknowledgements:
            reasons.append(
                f"{len(acknowledgements)} mapping(s) need explicit "
                f"acknowledgement: {', '.join(sorted(acknowledgements))}"
            )
        if advisories:
            reasons.append(
                f"{len(advisories)} mapping(s) validated with concerns: "
                + ", ".join(sorted({issue.source_column for issue in advisories}))
            )
        reasons.append(
            f"{concerns} interpretation concerns appear in one plan, so the "
            "reading of one field may constrain the reading of another"
        )

    if not reasons:
        return RoutingDecision(
            escalate=False,
            default_model=default_model,
            selected_model=default_model,
        )

    if not escalation_model:
        # The signals fired but no escalation model is configured. Say so in
        # the record rather than silently pretending nothing was noticed, and
        # carry on with the Super proposal exactly as before.
        return RoutingDecision(
            escalate=False,
            default_model=default_model,
            selected_model=default_model,
            reasons=(
                *reasons,
                "no escalation model is configured, so the first proposal stands",
            ),
        )

    return RoutingDecision(
        escalate=True,
        default_model=default_model,
        selected_model=escalation_model,
        reasons=tuple(reasons),
    )
