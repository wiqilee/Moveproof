//! The command line interface between Python and Rust.
//!
//! A subprocess boundary rather than a native extension. The reasoning: a
//! narrow interface that speaks JSON on stdin and stdout is trivial to test
//! from either side, needs no build toolchain matching between the two
//! languages, and can be swapped for a native module later without changing a
//! single caller.
//!
//! Commands:
//!
//!   moveproof-verifier hash          reads {"fields": [...], "row": {...}}
//!   moveproof-verifier reconcile     reads {"fields": [...], "source": {...},
//!                                           "destination": {...}}
//!   moveproof-verifier version       prints the canonical version marker
//!
//! Every failure is reported as JSON on stdout with a non zero exit code, so
//! the Python side never has to parse an error out of stderr.

use moveproof_verifier::{
    canonical_row, dataset_hash, reconcile, row_hash, ReconcileRequest, Row, CANONICAL_VERSION,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::process::ExitCode;

#[derive(Deserialize)]
struct HashRequest {
    #[serde(default)]
    fields: Option<Vec<String>>,
    row: Row,
}

#[derive(Deserialize)]
struct DatasetRequest {
    #[serde(default)]
    fields: Option<Vec<String>>,
    rows: Vec<Row>,
}

fn fail(message: &str) -> ExitCode {
    let payload = serde_json::json!({ "error": message });
    let _ = writeln!(io::stdout(), "{payload}");
    ExitCode::from(1)
}

fn read_stdin() -> Result<String, String> {
    let mut buffer = String::new();
    io::stdin()
        .read_to_string(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(buffer)
}

fn main() -> ExitCode {
    let command = std::env::args().nth(1).unwrap_or_else(|| "version".into());

    match command.as_str() {
        "version" => {
            let payload = serde_json::json!({
                "canonical_version": CANONICAL_VERSION,
                "crate_version": env!("CARGO_PKG_VERSION"),
            });
            println!("{payload}");
            ExitCode::SUCCESS
        }

        "hash" => {
            let input = match read_stdin() {
                Ok(text) => text,
                Err(error) => return fail(&error),
            };
            let request: HashRequest = match serde_json::from_str(&input) {
                Ok(parsed) => parsed,
                Err(error) => return fail(&format!("invalid hash request: {error}")),
            };
            let fields = request.fields.as_deref();
            let payload = serde_json::json!({
                "canonical": canonical_row(&request.row, fields),
                "hash": row_hash(&request.row, fields),
            });
            println!("{payload}");
            ExitCode::SUCCESS
        }

        "dataset" => {
            let input = match read_stdin() {
                Ok(text) => text,
                Err(error) => return fail(&error),
            };
            let request: DatasetRequest = match serde_json::from_str(&input) {
                Ok(parsed) => parsed,
                Err(error) => return fail(&format!("invalid dataset request: {error}")),
            };
            let fields = request.fields.as_deref();
            let payload = serde_json::json!({
                "row_count": request.rows.len(),
                "dataset_hash": dataset_hash(&request.rows, fields),
            });
            println!("{payload}");
            ExitCode::SUCCESS
        }

        "reconcile" => {
            let input = match read_stdin() {
                Ok(text) => text,
                Err(error) => return fail(&error),
            };
            let request: ReconcileRequest = match serde_json::from_str(&input) {
                Ok(parsed) => parsed,
                Err(error) => return fail(&format!("invalid reconcile request: {error}")),
            };
            let source: BTreeMap<String, Row> = request.source;
            let destination: BTreeMap<String, Row> = request.destination;
            let result = reconcile(&source, &destination, &request.fields);
            match serde_json::to_string(&result) {
                Ok(text) => {
                    println!("{text}");
                    ExitCode::SUCCESS
                }
                Err(error) => fail(&format!("could not serialise the result: {error}")),
            }
        }

        other => fail(&format!(
            "unknown command {other}. Use version, hash, dataset or reconcile."
        )),
    }
}
