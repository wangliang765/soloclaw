use agent_diff::apply_unified_diff;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::{self, BufRead, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_OUTPUT: usize = 20_000;

fn main() {
    let root = match parse_root(env::args().skip(1).collect()) {
        Ok(root) => root,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("failed to read stdin: {error}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = handle_request(&root, &line);
        println!("{}", response);
        let _ = io::stdout().flush();
    }
}

fn parse_root(args: Vec<String>) -> Result<PathBuf, String> {
    let mut root: Option<PathBuf> = None;
    let mut index = 0;
    while index < args.len() {
        if args[index] == "--root" {
            index += 1;
            let Some(value) = args.get(index) else {
                return Err("missing --root value".to_string());
            };
            root = Some(PathBuf::from(value));
        }
        index += 1;
    }
    let root = root.ok_or_else(|| "usage: agent-runner --root <workspace>".to_string())?;
    fs::canonicalize(&root).map_err(|error| format!("invalid root {}: {error}", root.display()))
}

fn handle_request(root: &Path, line: &str) -> String {
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => return response_error(Value::Null, -32700, format!("parse error: {error}")),
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return response_error(id, -32600, "invalid JSON-RPC version".to_string());
    }
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return response_error(id, -32600, "missing method".to_string());
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));

    match dispatch(root, method, params) {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string(),
        Err(error) => response_error(id, -32000, error),
    }
}

fn response_error(id: Value, code: i64, message: String) -> String {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
    .to_string()
}

fn dispatch(root: &Path, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "workspace/listFiles" => list_files(root, string_param(&params, "path")?),
        "workspace/readFile" => read_file(
            root,
            string_param(&params, "path")?,
            optional_u64_param(&params, "startLine")?,
            optional_u64_param(&params, "endLine")?,
        ),
        "workspace/searchText" => search_text(
            root,
            string_param(&params, "query")?,
            optional_string_param(&params, "glob")?,
        ),
        "workspace/runCommand" => run_command(
            root,
            string_param(&params, "command")?,
            optional_u64_param(&params, "timeoutMs")?.unwrap_or(30_000),
            optional_string_param(&params, "executionProfile")?,
        ),
        "workspace/createFile" => create_file(
            root,
            string_param(&params, "path")?,
            string_param(&params, "content")?,
            optional_bool_param(&params, "overwrite")?.unwrap_or(false),
        ),
        "workspace/replaceRange" => replace_range(
            root,
            string_param(&params, "path")?,
            required_u64_param(&params, "startLine")?,
            required_u64_param(&params, "endLine")?,
            string_param(&params, "content")?,
        ),
        "workspace/applyPatch" => apply_patch(root, string_param(&params, "patch")?),
        _ => Err(format!("unknown method: {method}")),
    }
}

fn list_files(root: &Path, input_path: String) -> Result<Value, String> {
    let absolute = resolve_inside_workspace(root, &input_path, WorkspaceAccess::Read)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&absolute).map_err(|error| format!("read_dir failed: {error}"))? {
        let entry = entry.map_err(|error| format!("read_dir entry failed: {error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || name == ".git" || name == ".agent" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("file_type failed: {error}"))?;
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| format!("strip_prefix failed: {error}"))?
            .to_string_lossy()
            .to_string();
        entries.push(format!(
            "{} {}",
            if file_type.is_dir() { "dir " } else { "file" },
            if relative.is_empty() { "." } else { &relative }
        ));
    }
    Ok(json!(entries))
}

fn read_file(
    root: &Path,
    input_path: String,
    start_line: Option<u64>,
    end_line: Option<u64>,
) -> Result<Value, String> {
    let absolute = resolve_inside_workspace(root, &input_path, WorkspaceAccess::Read)?;
    let content = fs::read_to_string(&absolute).map_err(|error| format!("read failed: {error}"))?;
    let lines = split_lines_like_typescript(&content);
    let start = start_line.unwrap_or(1).saturating_sub(1) as usize;
    let end = end_line
        .map(|value| value as usize)
        .unwrap_or(lines.len())
        .min(lines.len());
    let rendered = lines
        .iter()
        .enumerate()
        .skip(start)
        .take(end.saturating_sub(start))
        .map(|(index, line)| format!("{}: {}", index + 1, line))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(json!(rendered))
}

fn search_text(root: &Path, query: String, glob: Option<String>) -> Result<Value, String> {
    let mut command = Command::new("rg");
    command
        .arg("--line-number")
        .arg("--hidden")
        .arg("--glob")
        .arg("!node_modules")
        .arg("--glob")
        .arg("!.git")
        .arg("--glob")
        .arg("!.agent");
    if let Some(glob) = glob {
        command.arg("--glob").arg(glob);
    }
    command.arg(query).arg(root);
    let output = match command.output() {
        Ok(output) => output,
        Err(_) => return Ok(json!(search_text_fallback(root, &query, glob.as_deref()))),
    };
    if output.status.code() == Some(1) {
        return Ok(json!(""));
    }
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(json!(truncate(&text)))
}

fn search_text_fallback(root: &Path, query: &str, glob: Option<&str>) -> String {
    let mut matches = Vec::new();
    walk_search(root, Path::new(""), query, glob, &mut matches);
    truncate(&matches.join("\n"))
}

fn walk_search(
    root: &Path,
    relative_dir: &Path,
    query: &str,
    glob: Option<&str>,
    matches: &mut Vec<String>,
) {
    if matches.join("\n").chars().count() >= MAX_OUTPUT {
        return;
    }
    let absolute_dir = root.join(relative_dir);
    let Ok(entries) = fs::read_dir(&absolute_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let relative_path = relative_dir.join(&name);
        let normalized = normalize_output_path(&relative_path);
        if normalized.is_empty() {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if name == "node_modules" || name == ".git" || name == ".agent" {
                continue;
            }
            walk_search(root, &relative_path, query, glob, matches);
            continue;
        }
        if !file_type.is_file() || !glob_matches(glob, &normalized) {
            continue;
        }
        search_file(&entry.path(), &normalized, query, matches);
    }
}

fn search_file(absolute_path: &Path, relative_path: &str, query: &str, matches: &mut Vec<String>) {
    let Ok(content) = fs::read_to_string(absolute_path) else {
        return;
    };
    for (index, line) in split_lines_like_typescript(&content).iter().enumerate() {
        if line.contains(query) {
            matches.push(format!("{relative_path}:{}:{line}", index + 1));
            if matches.join("\n").chars().count() >= MAX_OUTPUT {
                return;
            }
        }
    }
}

fn glob_matches(glob: Option<&str>, input_path: &str) -> bool {
    let Some(glob) = glob else {
        return true;
    };
    wildcard_match(&normalize_glob_path(glob), input_path)
}

fn normalize_output_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn normalize_glob_path(value: &str) -> String {
    value.replace('\\', "/").trim_start_matches("./").to_string()
}

fn wildcard_match(pattern: &str, input: &str) -> bool {
    let pattern = pattern.as_bytes();
    let input = input.as_bytes();
    let (mut p, mut i) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut star_match = 0usize;
    while i < input.len() {
        if p < pattern.len() && (pattern[p] == b'?' && input[i] != b'/' || pattern[p] == input[i]) {
            p += 1;
            i += 1;
        } else if p + 1 < pattern.len() && pattern[p] == b'*' && pattern[p + 1] == b'*' {
            star = Some(p);
            star_match = i;
            p += 2;
        } else if p < pattern.len() && pattern[p] == b'*' {
            star = Some(p);
            star_match = i;
            p += 1;
        } else if let Some(star_index) = star {
            if pattern[star_index] != b'*' || (star_index + 1 >= pattern.len() || pattern[star_index + 1] != b'*') && input[star_match] == b'/' {
                return false;
            }
            p = if star_index + 1 < pattern.len() && pattern[star_index + 1] == b'*' {
                star_index + 2
            } else {
                star_index + 1
            };
            star_match += 1;
            i = star_match;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == b'*' {
        p += if p + 1 < pattern.len() && pattern[p + 1] == b'*' {
            2
        } else {
            1
        };
    }
    p == pattern.len()
}

fn run_command(
    root: &Path,
    command: String,
    timeout_ms: u64,
    execution_profile: Option<String>,
) -> Result<Value, String> {
    let started_at = Instant::now();
    let profile = command_execution_profile(execution_profile.as_deref().unwrap_or("local-safe"))?;
    let stdout_path = temp_output_path("stdout");
    let stderr_path = temp_output_path("stderr");
    let stdout_file = fs::File::create(&stdout_path)
        .map_err(|error| format!("stdout capture failed: {error}"))?;
    let stderr_file = fs::File::create(&stderr_path)
        .map_err(|error| format!("stderr capture failed: {error}"))?;
    let mut child = shell_command(&command)
        .current_dir(root)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|error| format!("spawn failed: {error}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut timed_out = false;
    let exit_code;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("wait failed: {error}"))?
        {
            exit_code = status.code();
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            let _ = child.kill();
            exit_code = child.wait().ok().and_then(|status| status.code());
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }

    let stdout = read_command_output_file(&stdout_path);
    let stderr = read_command_output_file(&stderr_path);
    Ok(json!({
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": exit_code,
        "timedOut": timed_out,
        "durationMs": started_at.elapsed().as_millis() as u64,
        "executionProfile": profile,
    }))
}

fn temp_output_path(kind: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    env::temp_dir().join(format!(
        "agent-runner-{}-{stamp}-{kind}.log",
        std::process::id()
    ))
}

fn read_command_output_file(path: &Path) -> String {
    let output = fs::read(path)
        .map(|bytes| truncate(&String::from_utf8_lossy(&bytes)))
        .unwrap_or_default();
    let _ = fs::remove_file(path);
    output
}

fn create_file(
    root: &Path,
    input_path: String,
    content: String,
    overwrite: bool,
) -> Result<Value, String> {
    let absolute = resolve_inside_workspace(root, &input_path, WorkspaceAccess::Write)?;
    let existing = fs::read_to_string(&absolute).ok();
    if existing.is_some() && !overwrite {
        return Err(format!("File already exists: {input_path}"));
    }
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("mkdir failed: {error}"))?;
    }
    fs::write(&absolute, &content).map_err(|error| format!("write failed: {error}"))?;
    Ok(write_result(
        input_path,
        existing.as_ref().map(|value| sha256(value)),
        sha256(&content),
        if existing.is_some() {
            "overwrote file"
        } else {
            "created file"
        },
    ))
}

fn replace_range(
    root: &Path,
    input_path: String,
    start_line: u64,
    end_line: u64,
    content: String,
) -> Result<Value, String> {
    if start_line < 1 || end_line < start_line {
        return Err("Invalid line range.".to_string());
    }
    let absolute = resolve_inside_workspace(root, &input_path, WorkspaceAccess::Write)?;
    let existing =
        fs::read_to_string(&absolute).map_err(|error| format!("read failed: {error}"))?;
    let mut lines = split_lines_like_typescript(&existing);
    if end_line as usize > lines.len() {
        return Err(format!(
            "Line range exceeds file length: {} > {}",
            end_line,
            lines.len()
        ));
    }
    let replacement = split_lines_like_typescript(&content);
    lines.splice((start_line as usize - 1)..(end_line as usize), replacement);
    let next = lines.join("\n");
    fs::write(&absolute, &next).map_err(|error| format!("write failed: {error}"))?;
    Ok(write_result(
        input_path,
        Some(sha256(&existing)),
        sha256(&next),
        format!("replaced lines {start_line}-{end_line}"),
    ))
}

fn apply_patch(root: &Path, patch: String) -> Result<Value, String> {
    let result = apply_unified_diff(root, &patch)?;
    Ok(json!({
        "summary": result.summary,
        "hunks": result.hunks,
        "files": result.files.into_iter().map(|file| {
            let mut value = Map::new();
            value.insert("path".to_string(), json!(file.path));
            value.insert("operation".to_string(), json!(file.operation.as_str()));
            if let Some(before_hash) = file.before_hash {
                value.insert("beforeHash".to_string(), json!(before_hash));
            }
            if let Some(after_hash) = file.after_hash {
                value.insert("afterHash".to_string(), json!(after_hash));
            }
            value.insert("summary".to_string(), json!(file.summary));
            Value::Object(value)
        }).collect::<Vec<_>>()
    }))
}

#[derive(Clone, Copy)]
enum WorkspaceAccess {
    Read,
    Write,
}

fn resolve_inside_workspace(
    root: &Path,
    input_path: &str,
    access: WorkspaceAccess,
) -> Result<PathBuf, String> {
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
    assert_workspace_path_allowed(&relative, input_path, access)?;
    Ok(root.join(relative))
}

fn assert_workspace_path_allowed(
    relative: &Path,
    input_path: &str,
    access: WorkspaceAccess,
) -> Result<(), String> {
    let normalized = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if normalized.is_empty() || normalized == ".agent/tmp" || normalized.starts_with(".agent/tmp/")
    {
        return Ok(());
    }
    let protected = normalized
        .split('/')
        .next()
        .is_some_and(|root| root == ".git" || root == ".agent");
    if protected {
        let action = match access {
            WorkspaceAccess::Read => "read",
            WorkspaceAccess::Write => "modified",
        };
        return Err(format!(
            "Protected workspace path cannot be {action} by agent tools: {input_path}"
        ));
    }
    Ok(())
}

fn string_param(params: &Value, name: &str) -> Result<String, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| format!("expected string param: {name}"))
}

fn optional_string_param(params: &Value, name: &str) -> Result<Option<String>, String> {
    Ok(params
        .get(name)
        .and_then(Value::as_str)
        .map(ToString::to_string))
}

fn optional_bool_param(params: &Value, name: &str) -> Result<Option<bool>, String> {
    Ok(params.get(name).and_then(Value::as_bool))
}

fn optional_u64_param(params: &Value, name: &str) -> Result<Option<u64>, String> {
    Ok(params.get(name).and_then(Value::as_u64))
}

fn required_u64_param(params: &Value, name: &str) -> Result<u64, String> {
    optional_u64_param(params, name)?.ok_or_else(|| format!("expected number param: {name}"))
}

#[cfg(windows)]
fn shell_command(command: &str) -> Command {
    let mut child = Command::new("cmd");
    child.raw_arg("/C").raw_arg(format!("\"{command}\""));
    child
}

#[cfg(not(windows))]
fn shell_command(command: &str) -> Command {
    let mut child = Command::new("sh");
    child.arg("-c").arg(command);
    child
}

fn command_execution_profile(name: &str) -> Result<Value, String> {
    match name {
        "local-safe" => Ok(json!({
            "name": name,
            "filesystem": "workspace_cwd",
            "workspaceWrite": "not_requested",
            "network": "not_requested",
            "enforcement": "policy_and_audit",
            "summary": "Local shell in workspace cwd; writes/network are not requested and are controlled by policy/audit.",
        })),
        "local-workspace-write" => Ok(json!({
            "name": name,
            "filesystem": "workspace_cwd",
            "workspaceWrite": "allowed",
            "network": "not_requested",
            "enforcement": "policy_and_audit",
            "summary": "Local shell in workspace cwd; workspace writes are expected and policy-gated.",
        })),
        "local-network" => Ok(json!({
            "name": name,
            "filesystem": "workspace_cwd",
            "workspaceWrite": "allowed",
            "network": "allowed",
            "enforcement": "policy_and_audit",
            "summary": "Local shell in workspace cwd; network/dependency operations are expected and policy-gated.",
        })),
        "local-full-access" => Ok(json!({
            "name": name,
            "filesystem": "host_shell",
            "workspaceWrite": "allowed",
            "network": "allowed",
            "enforcement": "policy_and_audit",
            "summary": "Local host shell for high-risk operations; allowed only after policy approval.",
        })),
        other => Err(format!("invalid execution profile: {other}")),
    }
}

fn write_result(
    path: String,
    before_hash: Option<String>,
    after_hash: String,
    summary: impl Into<String>,
) -> Value {
    let mut result = Map::new();
    result.insert("path".to_string(), json!(path));
    if let Some(before_hash) = before_hash {
        result.insert("beforeHash".to_string(), json!(before_hash));
    }
    result.insert("afterHash".to_string(), json!(after_hash));
    result.insert("summary".to_string(), json!(summary.into()));
    Value::Object(result)
}

fn split_lines_like_typescript(value: &str) -> Vec<String> {
    value
        .replace("\r\n", "\n")
        .split('\n')
        .map(ToString::to_string)
        .collect()
}

fn sha256(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn truncate(value: &str) -> String {
    if value.chars().count() > MAX_OUTPUT {
        format!(
            "{}\n[truncated]",
            value.chars().take(MAX_OUTPUT).collect::<String>()
        )
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn protected_paths_are_blocked_while_agent_tmp_is_allowed() {
        let root = temp_root();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join(".agent").join("tmp")).unwrap();
        fs::write(root.join(".git").join("config"), "private").unwrap();

        let read_error = read_file(&root, ".git/config".to_string(), None, None).unwrap_err();
        assert!(read_error.contains("Protected workspace path cannot be read"));

        let write_error = create_file(
            &root,
            ".agent/state.json".to_string(),
            "{}\n".to_string(),
            false,
        )
        .unwrap_err();
        assert!(write_error.contains("Protected workspace path cannot be modified"));

        let allowed = create_file(
            &root,
            ".agent/tmp/runtime-smoke.txt".to_string(),
            "ok\n".to_string(),
            false,
        )
        .unwrap();
        assert_eq!(allowed["path"], ".agent/tmp/runtime-smoke.txt");

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn run_command_returns_after_shell_exits_when_background_child_keeps_stdio_open() {
        let root = temp_root();
        fs::write(
            root.join("hold-open.cmd"),
            "@echo off\r\nping 127.0.0.1 -n 4 >nul\r\n",
        )
        .unwrap();

        let started_at = Instant::now();
        let result =
            run_command(&root, "start /B \"\" hold-open.cmd".to_string(), 200, None).unwrap();

        assert_eq!(result["timedOut"], false);
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "background child kept command open for {:?}: {result}",
            started_at.elapsed()
        );

        let _ = fs::remove_dir_all(root);
    }

    fn temp_root() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("agent-runner-test-{stamp}"));
        fs::create_dir_all(&root).unwrap();
        root
    }
}
