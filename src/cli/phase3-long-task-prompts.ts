export function formatPhaseThreeReadOnlyGoalPrompt(workspace: string, files: string[]): string {
  const workspaceName = workspace.split(/[\\/]+/).filter(Boolean).at(-1) ?? "workspace";
  const fileInstructions = files.map((file) => `Call read_file with path exactly as \`${file}\`.`).join(" ");
  return [
    "Phase 3 real-provider read-only Goal validation.",
    "This is an automated tool-use gate. A plain text plan, checklist, or summary before tool results is a failure.",
    "Your next assistant response must contain file tool calls only, starting with read_file. Do not answer from memory.",
    `The workspace root is already selected: ${workspace}.`,
    `Use only workspace-relative paths. Do not prefix any path with the workspace folder name (${workspaceName}), a drive letter, or a parent directory.`,
    "Do not call `run_command`; this check needs file-tool progress only.",
    "Do not modify files.",
    `Use separate file-tool calls for these existing project files: ${files.join(", ")}.`,
    fileInstructions,
    "If a `read_file` call fails, call `list_files` with path exactly as `.` once, then retry using exact relative file names from the listing.",
    "Return a concise final answer that lists what you inspected and whether changes are needed.",
  ].join(" ");
}
