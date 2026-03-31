export function filterByPrefixQuery<TItem>(
  items: readonly TItem[],
  query: string,
  getFields: (item: TItem) => readonly (string | null | undefined)[],
): TItem[] {
  const normalizedQuery = normalizePickerQuery(query)
  if (!normalizedQuery) {
    return [...items]
  }

  return items.filter((item) =>
    getFields(item).some((field) => getMatchPrefixes(field).some((prefix) => prefix.startsWith(normalizedQuery))),
  )
}

function normalizePickerQuery(query: string): string {
  return query.trim().toLowerCase()
}

function getMatchPrefixes(value: string | null | undefined): readonly string[] {
  if (!value) {
    return []
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return []
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  return [normalized, ...tokens]
}
