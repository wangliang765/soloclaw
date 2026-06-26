use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchApplyResult {
    pub summary: String,
    pub hunks: usize,
    pub files: Vec<PatchFileResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchFileResult {
    pub path: String,
    pub operation: PatchOperation,
    pub before_hash: Option<String>,
    pub after_hash: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchOperation {
    Create,
    Modify,
    Delete,
}

impl PatchOperation {
    pub fn as_str(self) -> &'static str {
        match self {
            PatchOperation::Create => "create",
            PatchOperation::Modify => "modify",
            PatchOperation::Delete => "delete",
        }
    }
}

pub fn apply_unified_diff(root: &Path, patch: &str) -> Result<PatchApplyResult, String> {
    let files = parse_unified_diff(patch)?;
    if files.is_empty() {
        return Err("Patch has no unified diff file hunks.".to_string());
    }

    let mut plans = Vec::new();
    for file in files {
        let target_path = patch_target_path(&file)?;
        let absolute = resolve_inside_workspace(root, &target_path)?;
        if let Some(old_path) = &file.old_path {
            let _ = resolve_inside_workspace(root, old_path)?;
        }
        if let (Some(old_path), Some(new_path)) = (&file.old_path, &file.new_path) {
            if old_path != new_path {
                return Err(format!(
                    "Patch renames are not supported yet: {old_path} -> {new_path}"
                ));
            }
        }

        let existing = read_optional(&absolute)?;
        let operation = patch_operation(&file);
        if operation != PatchOperation::Create && existing.is_none() {
            return Err(format!("Patch target file does not exist: {target_path}"));
        }
        if operation == PatchOperation::Create && existing.is_some() {
            return Err(format!("Patch target file already exists: {target_path}"));
        }

        let before_hash = existing.as_ref().map(|value| sha256(value));
        let next_content = if operation == PatchOperation::Delete {
            None
        } else {
            Some(apply_file_hunks(
                &target_path,
                existing.as_deref().unwrap_or(""),
                &file.hunks,
                operation == PatchOperation::Create,
            )?)
        };
        let after_hash = next_content.as_ref().map(|value| sha256(value));
        plans.push(PatchWritePlan {
            path: target_path,
            absolute,
            operation,
            before_hash,
            after_hash,
            content: next_content,
            hunk_count: file.hunks.len(),
        });
    }

    for plan in &plans {
        if plan.operation == PatchOperation::Delete {
            fs::remove_file(&plan.absolute).map_err(|error| format!("remove failed: {error}"))?;
        } else {
            if let Some(parent) = plan.absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("mkdir failed: {error}"))?;
            }
            fs::write(&plan.absolute, plan.content.as_deref().unwrap_or(""))
                .map_err(|error| format!("write failed: {error}"))?;
        }
    }

    let hunk_count = plans.iter().map(|plan| plan.hunk_count).sum();
    let changed_files = plans
        .into_iter()
        .map(|plan| PatchFileResult {
            path: plan.path,
            operation: plan.operation,
            before_hash: plan.before_hash,
            after_hash: plan.after_hash,
            summary: format!(
                "{} via {} patch hunk(s)",
                plan.operation.as_str(),
                plan.hunk_count
            ),
        })
        .collect::<Vec<_>>();

    Ok(PatchApplyResult {
        summary: format!(
            "applied {hunk_count} patch hunk(s) to {} file(s)",
            changed_files.len()
        ),
        hunks: hunk_count,
        files: changed_files,
    })
}

#[derive(Debug, Clone)]
struct ParsedPatchFile {
    old_path: Option<String>,
    new_path: Option<String>,
    hunks: Vec<ParsedPatchHunk>,
}

#[derive(Debug, Clone)]
struct ParsedPatchHunk {
    old_start: usize,
    old_count: usize,
    new_count: usize,
    lines: Vec<ParsedPatchLine>,
}

#[derive(Debug, Clone)]
struct ParsedPatchLine {
    kind: PatchLineKind,
    text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PatchLineKind {
    Context,
    Add,
    Delete,
}

struct PatchWritePlan {
    path: String,
    absolute: PathBuf,
    operation: PatchOperation,
    before_hash: Option<String>,
    after_hash: Option<String>,
    content: Option<String>,
    hunk_count: usize,
}

fn parse_unified_diff(patch: &str) -> Result<Vec<ParsedPatchFile>, String> {
    let normalized = patch.replace("\r\n", "\n");
    let lines = normalized.split('\n').collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;

    while index < lines.len() {
        if !lines[index].starts_with("--- ") {
            index += 1;
            continue;
        }

        let old_path = parse_diff_path(lines[index], "--- ");
        index += 1;
        if index >= lines.len() || !lines[index].starts_with("+++ ") {
            return Err("Invalid unified diff: missing +++ file header.".to_string());
        }
        let new_path = parse_diff_path(lines[index], "+++ ");
        index += 1;

        let mut file = ParsedPatchFile {
            old_path,
            new_path,
            hunks: Vec::new(),
        };

        while index < lines.len() && !lines[index].starts_with("--- ") {
            let line = lines[index];
            if line.is_empty() {
                index += 1;
                continue;
            }
            if !line.starts_with("@@ ") {
                index += 1;
                continue;
            }

            let mut hunk = parse_hunk_header(line)?;
            index += 1;
            let mut old_seen = 0;
            let mut new_seen = 0;
            while index < lines.len() && (old_seen < hunk.old_count || new_seen < hunk.new_count) {
                let hunk_line = lines[index];
                if hunk_line.starts_with("\\ No newline at end of file") {
                    index += 1;
                    continue;
                }
                if let Some(text) = hunk_line.strip_prefix(' ') {
                    hunk.lines.push(ParsedPatchLine {
                        kind: PatchLineKind::Context,
                        text: text.to_string(),
                    });
                    old_seen += 1;
                    new_seen += 1;
                } else if let Some(text) = hunk_line.strip_prefix('+') {
                    hunk.lines.push(ParsedPatchLine {
                        kind: PatchLineKind::Add,
                        text: text.to_string(),
                    });
                    new_seen += 1;
                } else if let Some(text) = hunk_line.strip_prefix('-') {
                    hunk.lines.push(ParsedPatchLine {
                        kind: PatchLineKind::Delete,
                        text: text.to_string(),
                    });
                    old_seen += 1;
                } else {
                    return Err(format!("Invalid unified diff hunk line: {hunk_line}"));
                }
                index += 1;
            }
            validate_hunk_counts(&hunk)?;
            file.hunks.push(hunk);
        }

        if file.hunks.is_empty() {
            return Err(format!(
                "Patch file has no hunks: {}",
                file.new_path
                    .as_deref()
                    .or(file.old_path.as_deref())
                    .unwrap_or("/dev/null")
            ));
        }
        files.push(file);
    }

    Ok(files)
}

fn parse_diff_path(line: &str, prefix: &str) -> Option<String> {
    let raw = line.strip_prefix(prefix)?.trim();
    if raw == "/dev/null" {
        return None;
    }
    let without_timestamp = raw.split('\t').next().unwrap_or(raw).trim();
    let unquoted = without_timestamp
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(without_timestamp);
    let without_prefix = unquoted
        .strip_prefix("a/")
        .or_else(|| unquoted.strip_prefix("b/"))
        .unwrap_or(unquoted);
    Some(without_prefix.to_string())
}

fn parse_hunk_header(line: &str) -> Result<ParsedPatchHunk, String> {
    let parts = line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 3 || parts[0] != "@@" {
        return Err(format!("Invalid unified diff hunk header: {line}"));
    }
    let (old_start, old_count) = parse_hunk_range(parts[1], '-')?;
    let (_new_start, new_count) = parse_hunk_range(parts[2], '+')?;
    Ok(ParsedPatchHunk {
        old_start,
        old_count,
        new_count,
        lines: Vec::new(),
    })
}

fn parse_hunk_range(value: &str, prefix: char) -> Result<(usize, usize), String> {
    let body = value
        .strip_prefix(prefix)
        .ok_or_else(|| format!("Invalid unified diff hunk range: {value}"))?;
    let mut pieces = body.split(',');
    let start = pieces
        .next()
        .ok_or_else(|| format!("Invalid unified diff hunk range: {value}"))?
        .parse::<usize>()
        .map_err(|_| format!("Invalid unified diff hunk range: {value}"))?;
    let count = pieces
        .next()
        .map(|piece| {
            piece
                .parse::<usize>()
                .map_err(|_| format!("Invalid unified diff hunk range: {value}"))
        })
        .transpose()?
        .unwrap_or(1);
    Ok((start, count))
}

fn validate_hunk_counts(hunk: &ParsedPatchHunk) -> Result<(), String> {
    let old_count = hunk
        .lines
        .iter()
        .filter(|line| line.kind == PatchLineKind::Context || line.kind == PatchLineKind::Delete)
        .count();
    let new_count = hunk
        .lines
        .iter()
        .filter(|line| line.kind == PatchLineKind::Context || line.kind == PatchLineKind::Add)
        .count();
    if old_count != hunk.old_count || new_count != hunk.new_count {
        return Err(format!(
            "Unified diff hunk line counts do not match header: expected -{} +{}, got -{} +{}",
            hunk.old_count, hunk.new_count, old_count, new_count
        ));
    }
    Ok(())
}

fn patch_target_path(file: &ParsedPatchFile) -> Result<String, String> {
    file.new_path
        .clone()
        .or_else(|| file.old_path.clone())
        .ok_or_else(|| "Patch file cannot have both old and new path set to /dev/null.".to_string())
}

fn patch_operation(file: &ParsedPatchFile) -> PatchOperation {
    if file.old_path.is_none() {
        return PatchOperation::Create;
    }
    if file.new_path.is_none() {
        return PatchOperation::Delete;
    }
    PatchOperation::Modify
}

fn apply_file_hunks(
    file_path: &str,
    existing_content: &str,
    hunks: &[ParsedPatchHunk],
    is_new_file: bool,
) -> Result<String, String> {
    let (original_lines, trailing_newline) = split_content(existing_content);
    let mut next_lines = Vec::new();
    let mut source_index = 0;

    for hunk in hunks {
        let hunk_start = if hunk.old_start == 0 {
            0
        } else {
            hunk.old_start - 1
        };
        if hunk_start < source_index {
            return Err(format!(
                "Patch hunks overlap or are out of order for {file_path}."
            ));
        }
        if hunk_start > original_lines.len() {
            let expected = hunk
                .lines
                .iter()
                .find(|line| line.kind != PatchLineKind::Add)
                .map(|line| line.text.as_str())
                .unwrap_or("<end of file>");
            return Err(format!(
                "Patch context mismatch in {file_path}: expected {:?}, found {:?}",
                expected, "<end of file>"
            ));
        }
        next_lines.extend(original_lines[source_index..hunk_start].iter().cloned());
        source_index = hunk_start;

        for line in &hunk.lines {
            if line.kind == PatchLineKind::Add {
                next_lines.push(line.text.clone());
                continue;
            }

            assert_patch_line_matches(
                file_path,
                original_lines.get(source_index).map(String::as_str),
                &line.text,
            )?;
            if line.kind == PatchLineKind::Context {
                next_lines.push(line.text.clone());
            }
            source_index += 1;
        }
    }

    next_lines.extend(original_lines[source_index..].iter().cloned());
    Ok(join_content(next_lines, is_new_file || trailing_newline))
}

fn split_content(content: &str) -> (Vec<String>, bool) {
    let normalized = content.replace("\r\n", "\n");
    let trailing_newline = normalized.ends_with('\n');
    let body = if trailing_newline {
        &normalized[..normalized.len() - 1]
    } else {
        &normalized
    };
    let lines = if body.is_empty() {
        Vec::new()
    } else {
        body.split('\n').map(ToString::to_string).collect()
    };
    (lines, trailing_newline)
}

fn join_content(lines: Vec<String>, trailing_newline: bool) -> String {
    format!(
        "{}{}",
        lines.join("\n"),
        if trailing_newline { "\n" } else { "" }
    )
}

fn assert_patch_line_matches(
    file_path: &str,
    actual: Option<&str>,
    expected: &str,
) -> Result<(), String> {
    if actual != Some(expected) {
        return Err(format!(
            "Patch context mismatch in {file_path}: expected {:?}, found {:?}",
            expected,
            actual.unwrap_or("<end of file>")
        ));
    }
    Ok(())
}

fn resolve_inside_workspace(root: &Path, input_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(input_path);
    if path.is_absolute() {
        return Err(format!("Path escapes workspace: {input_path}"));
    }
    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Path escapes workspace: {input_path}")),
        }
    }
    assert_workspace_path_allowed(&relative, input_path)?;
    Ok(root.join(relative))
}

fn assert_workspace_path_allowed(relative: &Path, input_path: &str) -> Result<(), String> {
    let normalized = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if normalized.is_empty() {
        return Ok(());
    }
    if normalized == ".agent/tmp" || normalized.starts_with(".agent/tmp/") {
        return Ok(());
    }
    let root = normalized.split('/').next().unwrap_or("");
    if root == ".git" || root == ".agent" {
        return Err(format!(
            "Protected workspace path cannot be modified by agent tools: {input_path}"
        ));
    }
    Ok(())
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("read failed: {error}")),
    }
}

fn sha256(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn applies_create_modify_and_delete_patches() {
        let root = temp_root();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/math.js"),
            "export function add(a, b) {\n  return a - b;\n}\n",
        )
        .unwrap();

        let modify = [
            "diff --git a/src/math.js b/src/math.js",
            "--- a/src/math.js",
            "+++ b/src/math.js",
            "@@ -1,3 +1,3 @@",
            " export function add(a, b) {",
            "-  return a - b;",
            "+  return a + b;",
            " }",
            "",
        ]
        .join("\n");
        let result = apply_unified_diff(&root, &modify).unwrap();
        assert_eq!(result.hunks, 1);
        assert_eq!(result.files[0].operation, PatchOperation::Modify);
        assert_eq!(
            fs::read_to_string(root.join("src/math.js")).unwrap(),
            "export function add(a, b) {\n  return a + b;\n}\n"
        );

        let create = [
            "diff --git a/notes/todo.txt b/notes/todo.txt",
            "--- /dev/null",
            "+++ b/notes/todo.txt",
            "@@ -0,0 +1,2 @@",
            "+first",
            "+second",
            "",
        ]
        .join("\n");
        let result = apply_unified_diff(&root, &create).unwrap();
        assert_eq!(result.files[0].operation, PatchOperation::Create);
        assert_eq!(
            fs::read_to_string(root.join("notes/todo.txt")).unwrap(),
            "first\nsecond\n"
        );

        let delete = [
            "diff --git a/notes/todo.txt b/notes/todo.txt",
            "--- a/notes/todo.txt",
            "+++ /dev/null",
            "@@ -1,2 +0,0 @@",
            "-first",
            "-second",
            "",
        ]
        .join("\n");
        let result = apply_unified_diff(&root, &delete).unwrap();
        assert_eq!(result.files[0].operation, PatchOperation::Delete);
        assert!(!root.join("notes/todo.txt").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_mismatched_and_protected_patches() {
        let root = temp_root();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/math.js"), "one\n").unwrap();

        let mismatch = [
            "diff --git a/src/math.js b/src/math.js",
            "--- a/src/math.js",
            "+++ b/src/math.js",
            "@@ -1,1 +1,1 @@",
            "-two",
            "+three",
            "",
        ]
        .join("\n");
        let error = apply_unified_diff(&root, &mismatch).unwrap_err();
        assert!(error.contains("Patch context mismatch in src/math.js"));

        let protected = [
            "diff --git a/.git/config b/.git/config",
            "--- /dev/null",
            "+++ b/.git/config",
            "@@ -0,0 +1,1 @@",
            "+unsafe",
            "",
        ]
        .join("\n");
        let error = apply_unified_diff(&root, &protected).unwrap_err();
        assert!(error.contains("Protected workspace path cannot be modified"));

        fs::remove_dir_all(root).unwrap();
    }

    fn temp_root() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("agent-diff-test-{stamp}"));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
