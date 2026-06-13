import { operatorSections } from "./operator-detail.js";
import type { OperatorItemKind, OperatorItemView, OperatorSeverity, OperatorStatus, OperatorViewModel } from "./operator-view-models.js";

export type OperatorRowsOptions = {
  limit?: number;
  kind?: OperatorItemKind;
  status?: OperatorStatus;
  severity?: OperatorSeverity;
  id?: string;
};

export type OperatorRowView = {
  ordinal: number;
  section: string;
  item: OperatorItemView;
};

export function collectOperatorRows(operator: OperatorViewModel, options: OperatorRowsOptions = {}): OperatorRowView[] {
  const rows: OperatorRowView[] = [];
  const limit = options.limit ?? 5;
  for (const section of operatorSections(operator)) {
    const visibleItems = section.items.filter((item) => operatorItemMatches(item, options)).slice(0, limit);
    for (const item of visibleItems) {
      rows.push({ ordinal: rows.length + 1, section: section.name, item });
    }
  }
  return rows;
}

export function operatorItemMatches(item: OperatorItemView, options: OperatorRowsOptions = {}): boolean {
  return (
    (!options.kind || item.kind === options.kind) &&
    (!options.status || item.status === options.status) &&
    (!options.severity || item.severity === options.severity) &&
    (!options.id || item.id === options.id || Object.values(item.refs ?? {}).includes(options.id))
  );
}

export function hasOperatorFilters(options: OperatorRowsOptions): boolean {
  return Boolean(options.kind || options.status || options.severity || options.id);
}
