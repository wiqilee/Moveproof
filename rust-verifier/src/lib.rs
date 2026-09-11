//! Canonical row serialization, stable hashing and reconciliation.
//!
//! This crate mirrors `backend/app/verify/canonical.py` exactly. The Python
//! implementation is the reference; this one exists because reconciliation is
//! the part of verification that touches every row of every dataset, and it is
//! the part where a subtle difference in string handling would be hardest to
//! notice.
//!
//! Both implementations are held to the same output by
//! `backend/tests/test_parity.py`, which runs the same inputs through each and
//! fails on any divergence. A hash function that two implementations disagree
//! about is worse than one implementation, so parity is not optional.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use unicode_normalization::UnicodeNormalization;

pub const FIELD_SEPARATOR: char = '\u{1f}';
pub const PAIR_SEPARATOR: char = '\u{1e}';
pub const NULL_TOKEN: &str = "\u{0}NULL";
pub const EMPTY_TOKEN: &str = "\u{0}EMPTY";
pub const CANONICAL_VERSION: &str = "moveproof.canonical.v1";

/// A single field value as it arrives from the pipeline.
///
/// The tag matters. A decimal and a string that happen to look alike are not
/// interchangeable: a decimal is normalised numerically and an identifier
/// never is, because 00127 and 127 must not hash the same.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value")]
pub enum Value {
    #[serde(rename = "null")]
    Null,
    #[serde(rename = "text")]
    Text(String),
    #[serde(rename = "int")]
    Int(i64),
    #[serde(rename = "bool")]
    Bool(bool),
    /// Carried as a string so no precision is lost crossing the boundary.
    #[serde(rename = "decimal")]
    DecimalText(String),
    /// ISO 8601 date or datetime, already formatted by the caller.
    #[serde(rename = "date")]
    DateText(String),
}

impl Value {
    /// Render this value in canonical form.
    pub fn canonical(&self) -> String {
        match self {
            Value::Null => NULL_TOKEN.to_string(),
            Value::Bool(flag) => if *flag { "true" } else { "false" }.to_string(),
            Value::Int(number) => number.to_string(),
            Value::DateText(text) => text.clone(),
            Value::DecimalText(text) => canonical_decimal(text),
            Value::Text(text) => {
                if text.is_empty() {
                    EMPTY_TOKEN.to_string()
                } else {
                    text.nfc().collect::<String>()
                }
            }
        }
    }
}

/// Normalise a decimal so 1200.50 and 1200.5 agree while 1200.4999 differs.
///
/// A value that does not parse is returned untouched rather than guessed at.
/// Silently coercing an unparseable number would be the exact failure this
/// product reports on.
pub fn canonical_decimal(text: &str) -> String {
    match Decimal::from_str(text.trim()) {
        Ok(parsed) => {
            let normalized = parsed.normalize();
            normalized.to_string()
        }
        Err(_) => text.to_string(),
    }
}

pub type Row = BTreeMap<String, Value>;

/// Render a whole row in canonical form.
///
/// `fields` restricts and orders the comparison. Passing `None` uses every key
/// in the row. Either way the names are sorted, so field order in the input
/// never affects the result.
pub fn canonical_row(row: &Row, fields: Option<&[String]>) -> String {
    let names: Vec<String> = match fields {
        Some(list) => {
            let mut sorted: Vec<String> = list.to_vec();
            sorted.sort();
            sorted
        }
        None => row.keys().cloned().collect(),
    };

    names
        .iter()
        .map(|name| {
            let rendered = row.get(name).unwrap_or(&Value::Null).canonical();
            format!("{name}{PAIR_SEPARATOR}{rendered}")
        })
        .collect::<Vec<String>>()
        .join(&FIELD_SEPARATOR.to_string())
}

pub fn row_hash(row: &Row, fields: Option<&[String]>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_row(row, fields).as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// A hash of a whole dataset that does not depend on row order.
pub fn dataset_hash(rows: &[Row], fields: Option<&[String]>) -> String {
    let mut digests: Vec<String> = rows.iter().map(|row| row_hash(row, fields)).collect();
    digests.sort();

    let mut hasher = Sha256::new();
    hasher.update(CANONICAL_VERSION.as_bytes());
    for digest in &digests {
        hasher.update(digest.as_bytes());
    }
    format!("sha256:{:x}", hasher.finalize())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FieldDifference {
    pub field: String,
    pub source: String,
    pub destination: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RowDifference {
    pub key: String,
    pub fields: Vec<FieldDifference>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Reconciliation {
    pub canonical_version: String,
    pub source_row_count: usize,
    pub destination_row_count: usize,
    pub matched: usize,
    pub missing: Vec<String>,
    pub unexpected: Vec<String>,
    pub differing: Vec<RowDifference>,
    pub source_dataset_hash: String,
    pub destination_dataset_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct ReconcileRequest {
    pub fields: Vec<String>,
    pub source: BTreeMap<String, Row>,
    pub destination: BTreeMap<String, Row>,
}

/// Compare two keyed sets of rows by canonical hash.
pub fn reconcile(
    source: &BTreeMap<String, Row>,
    destination: &BTreeMap<String, Row>,
    fields: &[String],
) -> Reconciliation {
    let source_keys: BTreeSet<&String> = source.keys().collect();
    let destination_keys: BTreeSet<&String> = destination.keys().collect();

    let missing: Vec<String> = source_keys
        .difference(&destination_keys)
        .map(|key| (*key).clone())
        .collect();
    let unexpected: Vec<String> = destination_keys
        .difference(&source_keys)
        .map(|key| (*key).clone())
        .collect();

    let mut differing: Vec<RowDifference> = Vec::new();
    for key in source_keys.intersection(&destination_keys) {
        let left = &source[*key];
        let right = &destination[*key];
        if row_hash(left, Some(fields)) == row_hash(right, Some(fields)) {
            continue;
        }
        let changed: Vec<FieldDifference> = fields
            .iter()
            .filter_map(|field| {
                let a = left.get(field).unwrap_or(&Value::Null).canonical();
                let b = right.get(field).unwrap_or(&Value::Null).canonical();
                if a == b {
                    None
                } else {
                    Some(FieldDifference {
                        field: field.clone(),
                        source: a,
                        destination: b,
                    })
                }
            })
            .collect();
        differing.push(RowDifference {
            key: (*key).clone(),
            fields: changed,
        });
    }

    let source_rows: Vec<Row> = source.values().cloned().collect();
    let destination_rows: Vec<Row> = destination.values().cloned().collect();

    Reconciliation {
        canonical_version: CANONICAL_VERSION.to_string(),
        source_row_count: source.len(),
        destination_row_count: destination.len(),
        matched: source.len() - missing.len() - differing.len(),
        missing,
        unexpected,
        differing,
        source_dataset_hash: dataset_hash(&source_rows, Some(fields)),
        destination_dataset_hash: dataset_hash(&destination_rows, Some(fields)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> Value {
        Value::Text(value.to_string())
    }

    fn row(pairs: &[(&str, Value)]) -> Row {
        pairs
            .iter()
            .map(|(name, value)| (name.to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn leading_zeros_are_never_normalised_away() {
        let padded = row(&[("customer_id", text("00127"))]);
        let bare = row(&[("customer_id", text("127"))]);
        assert_ne!(row_hash(&padded, None), row_hash(&bare, None));
    }

    #[test]
    fn an_integer_cast_changes_the_hash() {
        let source = row(&[("customer_id", text("00127"))]);
        let cast = row(&[("customer_id", Value::Int(127))]);
        assert_ne!(row_hash(&source, None), row_hash(&cast, None));
    }

    #[test]
    fn trailing_zeros_on_a_decimal_do_not_change_the_hash() {
        let long = row(&[("balance", Value::DecimalText("1200.50".into()))]);
        let short = row(&[("balance", Value::DecimalText("1200.5".into()))]);
        assert_eq!(row_hash(&long, None), row_hash(&short, None));
    }

    #[test]
    fn a_lost_fraction_of_a_cent_changes_the_hash() {
        let exact = row(&[("balance", Value::DecimalText("1200.50".into()))]);
        let drifted = row(&[("balance", Value::DecimalText("1200.4999".into()))]);
        assert_ne!(row_hash(&exact, None), row_hash(&drifted, None));
    }

    #[test]
    fn combining_marks_normalise_to_the_precomposed_form() {
        let precomposed = row(&[("full_name", text("Zoë"))]);
        let decomposed = row(&[("full_name", text("Zoe\u{0308}"))]);
        assert_eq!(row_hash(&precomposed, None), row_hash(&decomposed, None));
    }

    #[test]
    fn null_and_empty_are_different_facts() {
        let missing = row(&[("region", Value::Null)]);
        let blank = row(&[("region", text(""))]);
        assert_ne!(row_hash(&missing, None), row_hash(&blank, None));
    }

    #[test]
    fn field_order_does_not_affect_the_hash() {
        let mut forward: Row = BTreeMap::new();
        forward.insert("a".into(), text("1"));
        forward.insert("b".into(), text("2"));

        let mut backward: Row = BTreeMap::new();
        backward.insert("b".into(), text("2"));
        backward.insert("a".into(), text("1"));

        assert_eq!(row_hash(&forward, None), row_hash(&backward, None));
    }

    #[test]
    fn dataset_hash_ignores_row_order() {
        let first = row(&[("id", text("1"))]);
        let second = row(&[("id", text("2"))]);
        assert_eq!(
            dataset_hash(&[first.clone(), second.clone()], None),
            dataset_hash(&[second, first], None)
        );
    }

    #[test]
    fn reconcile_reports_a_damaged_identifier() {
        let fields = vec!["customer_id".to_string()];
        let mut source = BTreeMap::new();
        source.insert("00127".to_string(), row(&[("customer_id", text("00127"))]));
        let mut destination = BTreeMap::new();
        destination.insert("00127".to_string(), row(&[("customer_id", Value::Int(127))]));

        let result = reconcile(&source, &destination, &fields);
        assert_eq!(result.differing.len(), 1);
        assert_eq!(result.differing[0].fields[0].source, "00127");
        assert_eq!(result.differing[0].fields[0].destination, "127");
        assert_eq!(result.matched, 0);
    }

    #[test]
    fn reconcile_reports_missing_and_unexpected_keys() {
        let fields = vec!["id".to_string()];
        let mut source = BTreeMap::new();
        source.insert("a".to_string(), row(&[("id", text("a"))]));
        let mut destination = BTreeMap::new();
        destination.insert("b".to_string(), row(&[("id", text("b"))]));

        let result = reconcile(&source, &destination, &fields);
        assert_eq!(result.missing, vec!["a".to_string()]);
        assert_eq!(result.unexpected, vec!["b".to_string()]);
    }

    #[test]
    fn an_unparseable_decimal_is_left_alone() {
        assert_eq!(canonical_decimal("not a number"), "not a number");
    }
}
