import type {
  FieldGroup,
  FieldWidth,
  FormField,
  FormItem,
} from '../configs/types';

export function isFieldGroup(item: FormItem): item is FieldGroup {
  return item.type === 'group' && 'fields' in item;
}

export function flattenFields(items: FormItem[]): FormField[] {
  return items.flatMap((item) =>
    isFieldGroup(item) ? flattenFields(item.fields) : [item],
  );
}

export function gridColumns(width?: FieldWidth): Record<string, string> {
  const spans =
    typeof width === 'number' ? { xs: 12, md: width } : { xs: 12, ...width };
  return Object.fromEntries(
    Object.entries(spans)
      .filter(([, span]) => span !== undefined)
      .map(([breakpoint, span]) => [breakpoint, `span ${span} / span ${span}`]),
  );
}

export function validateLayout(items: FormItem[]) {
  const groupKeys = new Set<string>();
  function visit(items: FormItem[]) {
    for (const item of items) {
      const spans =
        typeof item.width === 'number'
          ? [item.width]
          : Object.values(item.width ?? {});
      if (
        spans.some(
          (span) =>
            span !== undefined &&
            (!Number.isInteger(span) || span < 1 || span > 12),
        )
      ) {
        throw new Error(
          'Field and group widths must be whole columns between 1 and 12.',
        );
      }
      if (isFieldGroup(item)) {
        if (!item.key || groupKeys.has(item.key))
          throw new Error(`Missing or duplicate form group key: ${item.key}`);
        groupKeys.add(item.key);
        visit(item.fields);
      }
    }
  }
  visit(items);
}
