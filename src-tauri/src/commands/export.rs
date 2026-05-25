use crate::error::{AppError, AppResult};
use rust_xlsxwriter::{Format, Workbook, XlsxError};
use serde_json::Value;

/// Render a JSON value as plain text for a CSV/string cell. Null becomes empty.
fn scalar_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Quote a CSV field when it contains a delimiter, quote, or newline.
fn csv_field(v: &Value) -> String {
    let s = scalar_text(v);
    if s.contains(|c| matches!(c, '"' | ',' | '\n' | '\r')) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

fn build_csv(columns: &[String], rows: &[Vec<Value>]) -> String {
    let mut out = String::new();
    out.push_str(
        &columns
            .iter()
            .map(|c| csv_field(&Value::String(c.clone())))
            .collect::<Vec<_>>()
            .join(","),
    );
    out.push_str("\r\n");
    for row in rows {
        out.push_str(&row.iter().map(csv_field).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

fn build_json(columns: &[String], rows: &[Vec<Value>]) -> AppResult<Vec<u8>> {
    let objects: Vec<serde_json::Map<String, Value>> = rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in columns.iter().enumerate() {
                obj.insert(col.clone(), row.get(i).cloned().unwrap_or(Value::Null));
            }
            obj
        })
        .collect();
    Ok(serde_json::to_vec_pretty(&objects)?)
}

fn xlsx_err(e: XlsxError) -> AppError {
    AppError::Other(format!("xlsx error: {e}"))
}

fn write_xlsx(path: &str, columns: &[String], rows: &[Vec<Value>]) -> AppResult<()> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    let header = Format::new().set_bold();

    for (c, name) in columns.iter().enumerate() {
        worksheet
            .write_with_format(0, c as u16, name.as_str(), &header)
            .map_err(xlsx_err)?;
    }
    for (r, row) in rows.iter().enumerate() {
        let rownum = (r + 1) as u32;
        for (c, val) in row.iter().enumerate() {
            let col = c as u16;
            match val {
                Value::Null => {}
                Value::Bool(b) => {
                    worksheet.write(rownum, col, *b).map_err(xlsx_err)?;
                }
                Value::Number(n) => {
                    worksheet
                        .write(rownum, col, n.as_f64().unwrap_or(0.0))
                        .map_err(xlsx_err)?;
                }
                Value::String(s) => {
                    worksheet.write(rownum, col, s.as_str()).map_err(xlsx_err)?;
                }
                other => {
                    worksheet
                        .write(rownum, col, other.to_string())
                        .map_err(xlsx_err)?;
                }
            }
        }
    }
    workbook.save(path).map_err(xlsx_err)?;
    Ok(())
}

/// Write bytes to `path` atomically (temp file + rename).
fn write_atomic(path: &str, bytes: &[u8]) -> AppResult<()> {
    let target = std::path::PathBuf::from(path);
    let tmp = target.with_extension("export-tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/**
 * Export query results to a file in the requested format. `rows` are 2D value
 * arrays already projected to `columns` order (and pre-filtered to a selection
 * when the caller wants only some rows). CSV and JSON are built in memory and
 * written atomically; XLSX is written directly by the workbook writer.
 */
#[tauri::command]
pub async fn export_query(
    path: String,
    format: String,
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
) -> AppResult<()> {
    match format.as_str() {
        "csv" => write_atomic(&path, build_csv(&columns, &rows).as_bytes()),
        "json" => write_atomic(&path, &build_json(&columns, &rows)?),
        "xlsx" => write_xlsx(&path, &columns, &rows),
        other => Err(AppError::Other(format!("unknown export format: {other}"))),
    }
}
