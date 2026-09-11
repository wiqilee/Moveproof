//! Integration tests for the reconciliation entry point.
//!
//! The unit tests in src/lib.rs cover canonicalisation rule by rule. These
//! cover the shape a caller actually uses: a whole dataset in, a
//! reconciliation report out.

use moveproof_verifier::{dataset_hash, reconcile, Row, Value};
use std::collections::BTreeMap;

fn text(value: &str) -> Value {
    Value::Text(value.to_string())
}

fn customer(id: &str, name: &str, balance: &str) -> Row {
    let mut row: Row = BTreeMap::new();
    row.insert("customer_id".into(), text(id));
    row.insert("full_name".into(), text(name));
    row.insert("balance".into(), Value::DecimalText(balance.into()));
    row
}

fn fields() -> Vec<String> {
    vec![
        "customer_id".to_string(),
        "full_name".to_string(),
        "balance".to_string(),
    ]
}

#[test]
fn an_identical_dataset_reconciles_completely() {
    let mut source = BTreeMap::new();
    source.insert(
        "00127".to_string(),
        customer("00127", "Amara Chen", "1200.50"),
    );
    source.insert(
        "00128".to_string(),
        customer("00128", "Diego Fernandez", "980.00"),
    );

    let destination = source.clone();
    let result = reconcile(&source, &destination, &fields());

    assert_eq!(result.matched, 2);
    assert!(result.missing.is_empty());
    assert!(result.unexpected.is_empty());
    assert!(result.differing.is_empty());
    assert_eq!(result.source_dataset_hash, result.destination_dataset_hash);
}

#[test]
fn an_integer_cast_across_the_dataset_is_reported_row_by_row() {
    let mut source = BTreeMap::new();
    let mut destination = BTreeMap::new();

    for id in ["00127", "00128", "00129"] {
        source.insert(id.to_string(), customer(id, "Someone", "10.00"));
        let mut damaged = customer(id, "Someone", "10.00");
        damaged.insert(
            "customer_id".into(),
            Value::Int(id.trim_start_matches('0').parse().unwrap()),
        );
        destination.insert(id.to_string(), damaged);
    }

    let result = reconcile(&source, &destination, &fields());

    // Every zero padded identifier is damaged, not just the first.
    assert_eq!(result.differing.len(), 3);
    assert_eq!(result.matched, 0);
    assert_ne!(result.source_dataset_hash, result.destination_dataset_hash);
}

#[test]
fn a_lost_cent_is_reported_even_when_the_identifier_survives() {
    let mut source = BTreeMap::new();
    source.insert(
        "00127".to_string(),
        customer("00127", "Amara Chen", "1200.50"),
    );
    let mut destination = BTreeMap::new();
    destination.insert(
        "00127".to_string(),
        customer("00127", "Amara Chen", "1200.49"),
    );

    let result = reconcile(&source, &destination, &fields());
    assert_eq!(result.differing.len(), 1);
    assert_eq!(result.differing[0].fields.len(), 1);
    assert_eq!(result.differing[0].fields[0].field, "balance");
}

#[test]
fn a_dropped_row_is_reported_as_missing() {
    let mut source = BTreeMap::new();
    source.insert("00127".to_string(), customer("00127", "Amara Chen", "1.00"));
    source.insert(
        "00128".to_string(),
        customer("00128", "Diego Fernandez", "2.00"),
    );
    let mut destination = BTreeMap::new();
    destination.insert("00127".to_string(), customer("00127", "Amara Chen", "1.00"));

    let result = reconcile(&source, &destination, &fields());
    assert_eq!(result.missing, vec!["00128".to_string()]);
    assert_eq!(result.matched, 1);
}

#[test]
fn dataset_hash_is_stable_across_repeated_calls() {
    let rows = vec![customer("00127", "Amara Chen", "1200.50")];
    assert_eq!(dataset_hash(&rows, None), dataset_hash(&rows, None));
}
